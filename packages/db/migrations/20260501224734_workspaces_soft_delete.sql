-- =============================================================================
-- Authently migration
-- Created: 2026-05-01T22:47:34.699Z
-- Slug: workspaces_soft_delete
--
-- Sprint 04 A1 — Workspace soft-deletion.
--
-- Adds:
--   1. workspaces.deleted_at timestamptz column (nullable; default null).
--      Soft-delete sentinel; partial index on `where deleted_at is not null`
--      keeps the common (active) path cheap.
--   2. private.is_workspace_member recreated to JOIN public.workspaces and
--      require `w.deleted_at is null`. Single-helper cascade — every
--      existing policy that uses the helper inherits the predicate without
--      a per-policy rewrite. Affected policies (init.sql + four billing
--      migrations + invitations + member-write):
--        - workspaces_member_select
--        - workspace_members_select (also restructured below; see #3)
--        - workspaces_owner_admin_update
--        - workspace_members_owner_admin_update + workspace_members_delete
--        - invitations_member_select + invitations_owner_admin_insert
--          + invitations_owner_admin_delete
--        - smoke_test_member_all (lingering S01 fixture; see
--          docs/specs/SPRINT_03_carryovers.md "Sprint 02 lingering")
--   3. workspace_members_select policy restructured: the
--      `OR user_id = auth.uid()` short-circuit from init.sql let users
--      see their own membership rows unconditionally. Locked decision β
--      (Sprint 04 spec §"Decisions locked at pre-flight" #5): deleted
--      workspaces fully vanish from user view; audit/history visibility
--      is admin-tooling territory, not RLS-permitted SELECT. The branch
--      now also requires `w.deleted_at IS NULL` via an EXISTS check.
--   4. private.delete_workspace_impl(_workspace_id uuid) — owner-only
--      soft-delete worker. Verifies caller via private.has_workspace_role
--      with array['owner']; raises 42501 on non-owner; raises 22023 on
--      already-deleted (so ops can disambiguate retry vs unauthorized).
--   5. public.api_delete_workspace(_workspace_id uuid) — thin SECURITY
--      DEFINER wrapper, granted EXECUTE to authenticated only (anon is
--      explicitly revoked).
--
-- Caller-signature compat: private.is_workspace_member(uuid)::boolean
-- signature is unchanged — same return type, same parameter list. Every
-- existing policy that references it (init.sql, 20260429213717,
-- 20260429231600, 20260429230559, billing chain) continues to typecheck
-- and execute identically; they just inherit the additional
-- `w.deleted_at IS NULL` predicate via the helper recreate.
--
-- IMPORTANT — Stripe gap (per Sprint 04 spec §"Decisions locked at
-- pre-flight" #6):
--   Soft-delete does NOT cancel active Stripe subscriptions. Until
--   a future scheduled-cleanup task ships, users who delete a
--   workspace continue to be billed; the settings UI must surface
--   this in the deletion-confirm modal.
-- The Settings page deletion-confirm modal carries the disclosure
-- copy verbatim. Sprint 05+ candidate: scheduled task to cancel
-- Stripe subscriptions for workspaces soft-deleted >24 hours ago.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. workspaces.deleted_at column
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column deleted_at timestamptz;

-- Partial index — only deleted rows. Active workspaces are the common case
-- and don't need the index for `where deleted_at is null` predicates
-- (selectivity is poor). The partial index supports the future
-- scheduled-cleanup task's "find workspaces soft-deleted >24h ago" query.
create index workspaces_deleted_at_idx
  on public.workspaces(deleted_at)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- 2. private.is_workspace_member — recreate with deleted_at predicate
-- ---------------------------------------------------------------------------
-- Same signature as init.sql; only the body changes. JOINs public.workspaces
-- and requires `w.deleted_at is null`. Single-helper cascade — every policy
-- that references this helper now treats deleted workspaces as
-- non-existent for membership purposes.
create or replace function private.is_workspace_member(_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.workspace_id = _workspace_id
      and wm.user_id = auth.uid()
      and w.deleted_at is null
  );
$$;

-- GRANTs preserved by CREATE OR REPLACE (init.sql granted to
-- authenticated, service_role; we don't re-issue here).

-- ---------------------------------------------------------------------------
-- 3. workspace_members_select — restructure OR-branch (locked β)
-- ---------------------------------------------------------------------------
-- Init.sql's policy:
--   user_id = auth.uid() OR private.is_workspace_member(workspace_id)
-- Restructured: the `user_id = auth.uid()` branch now also requires the
-- parent workspace to be non-deleted, so deleted-workspace membership
-- rows disappear from the user's view. The second branch is unchanged
-- by signature but now inherits the deleted_at predicate via the helper
-- recreate above.
drop policy workspace_members_select on public.workspace_members;

create policy workspace_members_select on public.workspace_members
  for select
  to authenticated
  using (
    (
      user_id = (select auth.uid())
      and exists (
        select 1
        from public.workspaces w
        where w.id = workspace_id
          and w.deleted_at is null
      )
    )
    or private.is_workspace_member(workspace_id)
  );

-- ---------------------------------------------------------------------------
-- 4. private.delete_workspace_impl — owner-only soft-delete worker
-- ---------------------------------------------------------------------------
-- Authorisation chain:
--   - api_delete_workspace wrapper enforces `auth.uid() is not null`
--     (defence-in-depth; the `revoke from anon` GRANT below is the
--     primary perimeter — anon callers receive 42501 from PostgREST
--     before reaching the function body).
--   - This worker re-checks owner role via private.has_workspace_role
--     (also defence-in-depth; if a future caller forgets the wrapper
--     and dispatches the worker directly, this is the floor).
--   - Already-deleted guard returns 22023 (invalid_parameter_value),
--     a distinct code from 42501 (insufficient_privilege) so ops can
--     disambiguate "tried again" from "not authorised".
--
-- The actual UPDATE bypasses RLS by virtue of SECURITY DEFINER (runs
-- as postgres). RLS on the workspaces table doesn't have an UPDATE
-- policy that would let the owner mutate `deleted_at` directly anyway
-- — that column isn't in the column-level GRANT from migration
-- 20260429213717, and we don't add it here.
create or replace function private.delete_workspace_impl(_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if _workspace_id is null then
    raise exception 'workspace id is required'
      using errcode = '22023';
  end if;

  -- Owner check via the existing role helper from migration 20260429213717.
  -- has_workspace_role is itself SECURITY DEFINER + stable, so it's safe
  -- to call from inside another DEFINER function.
  if not private.has_workspace_role(_workspace_id, array['owner']) then
    raise exception 'caller is not the workspace owner'
      using errcode = '42501';
  end if;

  -- Already-deleted guard. Distinct error from 42501 so retries don't
  -- look like authorisation failures.
  if exists (
    select 1
    from public.workspaces
    where id = _workspace_id
      and deleted_at is not null
  ) then
    raise exception 'workspace is already deleted'
      using errcode = '22023';
  end if;

  update public.workspaces
    set deleted_at = now()
    where id = _workspace_id
      and deleted_at is null;
end;
$$;

revoke all on function private.delete_workspace_impl(uuid) from public;
revoke all on function private.delete_workspace_impl(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.api_delete_workspace — RPC wrapper exposed on PostgREST
-- ---------------------------------------------------------------------------
-- Returns void. The client knows the workspace_id it just deleted; no
-- follow-up data is needed. Post-delete the caller redirects to /app
-- (which handles both no-memberships and N-memberships branches).
create or replace function public.api_delete_workspace(_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  perform private.delete_workspace_impl(_workspace_id);
end;
$$;

revoke all on function public.api_delete_workspace(uuid) from public;
revoke all on function public.api_delete_workspace(uuid) from anon;
grant execute on function public.api_delete_workspace(uuid) to authenticated;
