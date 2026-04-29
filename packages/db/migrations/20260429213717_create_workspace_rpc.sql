-- =============================================================================
-- Authently migration
-- Created: 2026-04-29T21:37:17.785Z
-- Slug: create_workspace_rpc
--
-- Sprint 02 Section B (workspace creation + settings) DB layer.
--
-- Adds:
--   1. private.has_workspace_role(_workspace_id, _roles) — generic role-aware
--      membership check, SECURITY DEFINER (mirrors private.is_workspace_member
--      from migration 1, but parameterised over allowed roles). Used by the
--      new workspaces UPDATE policy and reused by Section C invitation +
--      member-management RLS.
--
--   2. public.workspaces UPDATE policy (workspaces_owner_admin_update) that
--      lets owners and admins update their workspaces. Combined with column-
--      level GRANTs that restrict authenticated callers to (name, template);
--      slug is stable for URL identity, plan_tier and stripe_* are managed
--      exclusively by the billing webhook (service-role only).
--
--   3. private.create_workspace_for_user(_user_id, _name) — worker that
--      generates a slug via private.generate_workspace_slug, inserts the
--      workspace row, and creates an owner membership atomically. Mirrors
--      the bootstrap path used by private.handle_new_user (trigger) and
--      private.ensure_workspace_for_user (post-signup reconcile fallback).
--      SECURITY DEFINER bypasses RLS on the workspaces INSERT — necessary
--      because the calling user is not yet a member, so a regular INSERT
--      would be denied. Off PostgREST (revoke-from-public).
--
--   4. public.api_create_workspace(_name) — public RPC wrapper. Reads
--      auth.uid(), trims+validates the name, dispatches to the private
--      worker, returns the new workspace's identity columns. Granted to
--      authenticated only — anonymous callers are rejected with 42501.
--
-- Multi-tenant rules (per CLAUDE.md):
--   - workspace UPDATE goes through RLS, not service-role (rule 6 stays
--     intact for the lifecycle write path)
--   - SUPABASE_SERVICE_ROLE_KEY is NOT used by apps/web for workspace
--     creation — the SECURITY DEFINER RPC handles privilege elevation at
--     the DB layer (same pattern as api_ensure_my_workspace from migration 2)
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- private.has_workspace_role — role-aware membership probe
-- ---------------------------------------------------------------------------
create or replace function private.has_workspace_role(
  _workspace_id uuid,
  _roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.workspace_members wm
      where wm.workspace_id = _workspace_id
        and wm.user_id = auth.uid()
        and wm.role = any(_roles)
  );
$$;

revoke all on function private.has_workspace_role(uuid, text[]) from public;
grant execute on function private.has_workspace_role(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- workspaces UPDATE policy — owners and admins
-- ---------------------------------------------------------------------------
-- Both USING and WITH CHECK gate on the same predicate. WITH CHECK ensures
-- an attacker can't pivot ownership of the row to themselves via UPDATE.
create policy workspaces_owner_admin_update on public.workspaces
  for update to authenticated
  using (private.has_workspace_role(id, array['owner','admin']))
  with check (private.has_workspace_role(id, array['owner','admin']));

-- Column-level lockdown. Revoke the implicit UPDATE-on-all-columns grant,
-- then re-grant only the columns owners/admins are allowed to change.
-- - slug:          stable for URL identity
-- - plan_tier:     managed by Stripe webhook (service-role)
-- - stripe_*:      managed by Stripe webhook (service-role)
-- - id, created_at: never editable
-- - updated_at:    maintained by the workspaces_set_updated_at trigger
revoke update on public.workspaces from authenticated;
grant update (name, template) on public.workspaces to authenticated;

-- ---------------------------------------------------------------------------
-- private.create_workspace_for_user — worker
-- ---------------------------------------------------------------------------
-- Mirrors private.ensure_workspace_for_user but always creates (no
-- short-circuit when the user already has a membership). Atomicity is
-- guaranteed by the surrounding plpgsql block: workspace + membership
-- INSERT happen in the same statement transaction.
create or replace function private.create_workspace_for_user(
  _user_id uuid,
  _name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_id uuid;
  workspace_slug text;
  attempt int := 0;
begin
  if _user_id is null then
    raise exception 'user id is required'
      using errcode = '22023'; -- invalid_parameter_value
  end if;

  if _name is null or length(trim(_name)) = 0 then
    raise exception 'workspace name is required'
      using errcode = '22023';
  end if;

  if length(_name) > 80 then
    raise exception 'workspace name must be 80 characters or fewer'
      using errcode = '22023';
  end if;

  loop
    attempt := attempt + 1;
    workspace_slug := private.generate_workspace_slug(_name);
    begin
      insert into public.workspaces (name, slug, template)
      values (
        _name,
        workspace_slug,
        'creator'
      )
      returning id into workspace_id;
      exit;
    exception when unique_violation then
      -- Slug collision (the random 8-hex suffix already minimises this; the
      -- retry exists to guarantee progress under concurrent calls with the
      -- same base name). Same 3-attempt cap as ensure_workspace_for_user.
      if attempt >= 3 then
        raise;
      end if;
    end;
  end loop;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace_id, _user_id, 'owner');

  return workspace_id;
end;
$$;

revoke all on function private.create_workspace_for_user(uuid, text) from public;
grant execute on function private.create_workspace_for_user(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- public.api_create_workspace — RPC wrapper exposed on PostgREST
-- ---------------------------------------------------------------------------
-- Returns the new workspace's identity columns so apps/web doesn't need a
-- follow-up SELECT (which would succeed under RLS now that the caller is a
-- member, but the round-trip is wasteful when the writer already has the
-- data in scope).
create or replace function public.api_create_workspace(_name text)
returns table(
  id uuid,
  name text,
  slug text,
  template text,
  plan_tier text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  trimmed_name text;
  new_workspace_id uuid;
begin
  uid := auth.uid();
  if uid is null then
    -- 42501 maps to PostgREST 401/403 (insufficient_privilege). The GRANT
    -- below also rejects anon, so this is a defence-in-depth check.
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  trimmed_name := trim(coalesce(_name, ''));
  if length(trimmed_name) = 0 then
    raise exception 'workspace name is required'
      using errcode = '22023';
  end if;

  if length(trimmed_name) > 80 then
    raise exception 'workspace name must be 80 characters or fewer'
      using errcode = '22023';
  end if;

  new_workspace_id := private.create_workspace_for_user(uid, trimmed_name);

  return query
    select w.id, w.name, w.slug, w.template, w.plan_tier
      from public.workspaces w
      where w.id = new_workspace_id;
end;
$$;

revoke all on function public.api_create_workspace(text) from public;
grant execute on function public.api_create_workspace(text) to authenticated;
