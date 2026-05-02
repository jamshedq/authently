-- =============================================================================
-- Authently migration
-- Created: 2026-05-01T23:48:34.004Z
-- Slug: account_deletion
--
-- Sprint 04 A3 — Account deletion with workspace-ownership guard.
--
-- β policy (locked at pre-flight): an account cannot be deleted if the
-- caller owns workspaces with other members. The user must transfer
-- ownership (Sprint 04 A2 flow) or remove the other members first.
--
-- On a clear path:
--   - Cascade soft-delete sole-member workspaces (caller is the only
--     workspace_members row AND is the owner). Same `workspaces.deleted_at
--     = now()` machinery as Sprint 04 A1; the future Sprint 05+ scheduled
--     sweeper will handle both A1's direct soft-deletes and A3's cascade
--     output through the same path.
--   - Upsert public.user_profiles (lazy strategy — Q3): single column
--     today, so creating the row only on delete is correct. WHEN this
--     table grows new columns, the row-creation strategy needs to be
--     reconsidered (eager trigger on auth.users insert + backfill).
--
-- Adds:
--
--   1. public.user_profiles — single non-PK column today (`deleted_at`).
--      ON DELETE CASCADE from auth.users(id) handles future hard-delete
--      cleanup when Sprint 05+ ships.
--
--   2. RLS — SELECT-only on own row (locked Q1 of A2 convention reuse:
--      DEFINER RPCs are sole write path). User can SELECT their own row;
--      INSERT/UPDATE/DELETE revoked from authenticated.
--
--   3. private.account_blocking_workspaces(_user_id uuid) — shared
--      predicate function used by BOTH the worker's blocking check AND
--      the SSR helper exposed via public.api_my_blocking_workspaces.
--      Returns (id uuid, name text, slug text) for each workspace where
--      `_user_id` is the owner AND the workspace has other members AND
--      the workspace is not soft-deleted. Single source of truth — the
--      regression Q8 names ("someone simplifies the blocking predicate
--      by dropping deleted_at IS NULL") is structurally prevented.
--
--   4. public.api_my_blocking_workspaces — wrapper exposed to
--      authenticated. Reads auth.uid() inside, dispatches to the helper.
--      Returns the same row shape; SSR account page uses it to render
--      the inline blocking-workspaces list.
--
--   5. private.delete_account_impl — worker. plpgsql function = implicit
--      transaction; everything below runs atomically:
--        a. Auth check (auth.uid() not null)
--        b. Already-deleted retry guard → 22023 (matches Sprint 04 A1
--           convention: 22023 = terminal-state, 42501 = authz)
--        c. Blocking check via private.account_blocking_workspaces — if
--           any blockers exist, raise 22023 with the count
--        d. Cascade soft-delete sole-member workspaces (caller is the
--           only workspace_members row + is the owner). The cascade
--           predicate is the structural complement of the blocking
--           predicate: blocked = "owns + others present"; cascaded =
--           "owns + no others present". Mutually exclusive.
--        e. UPSERT public.user_profiles deleted_at = now()
--      RAISE in any of (a)-(e) rolls all of (a)-(e) back.
--
--   6. public.api_delete_account — wrapper, granted to authenticated;
--      anon explicitly revoked.
--
-- IMPORTANT — Stripe gap (mirrors Sprint 04 A1's framing):
--   The cascade in step (d) does NOT cancel active Stripe subscriptions.
--   Until a future scheduled-cleanup task ships, cascaded workspaces
--   continue to be billed; the account-deletion confirm dialog must
--   surface this in user-facing copy. (See A1's locked decision #6.)
--
-- IMPORTANT — Non-owner memberships (Q6):
--   Account deletion does NOT remove the caller's non-owner memberships
--   from other workspaces. Soft-delete via user_profiles.deleted_at is
--   reversible-in-principle (set NULL); destructively dropping
--   memberships would prevent that. Other workspaces will surface a
--   "ghost member" UX leak — bounded by Sprint 05+ hard-delete cleanup
--   (FK cascade on auth.users delete will then sweep memberships).
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.user_profiles
-- ---------------------------------------------------------------------------
create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  deleted_at timestamptz
);

create index user_profiles_deleted_at_idx
  on public.user_profiles(deleted_at)
  where deleted_at is not null;

alter table public.user_profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 2. RLS — SELECT-only on own row
-- ---------------------------------------------------------------------------
create policy user_profiles_self_select on public.user_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- DEFINER RPCs are the sole write path; revoke implicit grants from
-- authenticated. (anon had no grants.)
revoke all on public.user_profiles from anon, authenticated;
grant select on public.user_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.account_blocking_workspaces — shared blocking predicate
-- ---------------------------------------------------------------------------
-- Used by:
--   - private.delete_account_impl (the security floor)
--   - public.api_my_blocking_workspaces (the SSR helper exposed to UI)
-- Single source of truth — drift between the UI's render-time fetch and
-- the worker's pre-cascade check is structurally impossible.
create or replace function private.account_blocking_workspaces(_user_id uuid)
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.slug
    from public.workspaces w
    where w.deleted_at is null
      and exists (
        select 1
        from public.workspace_members wm_owner
        where wm_owner.workspace_id = w.id
          and wm_owner.user_id = _user_id
          and wm_owner.role = 'owner'
      )
      and exists (
        select 1
        from public.workspace_members other_member
        where other_member.workspace_id = w.id
          and other_member.user_id <> _user_id
      );
$$;

revoke all on function private.account_blocking_workspaces(uuid) from public;
revoke all on function private.account_blocking_workspaces(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. public.api_my_blocking_workspaces — SSR helper wrapper
-- ---------------------------------------------------------------------------
create or replace function public.api_my_blocking_workspaces()
returns table (id uuid, name text, slug text)
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
  return query
    select b.id, b.name, b.slug
    from private.account_blocking_workspaces(uid) b;
end;
$$;

revoke all on function public.api_my_blocking_workspaces() from public;
revoke all on function public.api_my_blocking_workspaces() from anon;
grant execute on function public.api_my_blocking_workspaces() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. private.delete_account_impl — worker
-- ---------------------------------------------------------------------------
create or replace function private.delete_account_impl()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  blocker_count int;
begin
  -- (a) Auth.
  uid := auth.uid();
  if uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  -- (b) Already-deleted retry guard (Q7). 22023 = terminal-state,
  -- distinct from 42501 = authz; convention from Sprint 04 A1's
  -- already-deleted workspace check.
  if exists (
    select 1
    from public.user_profiles
    where user_id = uid
      and deleted_at is not null
  ) then
    raise exception 'account is already deleted'
      using errcode = '22023';
  end if;

  -- (c) Blocking check via the shared helper (Q8 — single source of
  -- truth for the predicate; the SSR helper uses the same function).
  select count(*) into blocker_count
  from private.account_blocking_workspaces(uid);

  if blocker_count > 0 then
    raise exception
      'account deletion is blocked: % workspaces with other members',
      blocker_count
      using errcode = '22023';
  end if;

  -- (d) Cascade soft-delete sole-member workspaces. Predicate is the
  -- structural complement of the blocking check: blocked = owns +
  -- others present; cascade = owns + no others present. Mutually
  -- exclusive — if (c) passed, every owned workspace is sole-member
  -- by construction. Idempotent on `deleted_at IS NULL` so a partial
  -- previous attempt won't double-update.
  update public.workspaces w
    set deleted_at = now()
    where w.deleted_at is null
      and exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id = w.id
          and wm.user_id = uid
          and wm.role = 'owner'
      )
      and not exists (
        select 1
        from public.workspace_members other_member
        where other_member.workspace_id = w.id
          and other_member.user_id <> uid
      );

  -- (e) Upsert user_profiles. Lazy strategy (Q3) — only creates the
  -- row when needed. Future profile-field additions will need their
  -- own backfill plan.
  insert into public.user_profiles (user_id, deleted_at)
  values (uid, now())
  on conflict (user_id)
    do update set deleted_at = now();
end;
$$;

revoke all on function private.delete_account_impl() from public;
revoke all on function private.delete_account_impl() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. public.api_delete_account — wrapper
-- ---------------------------------------------------------------------------
create or replace function public.api_delete_account()
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
  perform private.delete_account_impl();
end;
$$;

revoke all on function public.api_delete_account() from public;
revoke all on function public.api_delete_account() from anon;
grant execute on function public.api_delete_account() to authenticated;
