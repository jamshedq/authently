-- =============================================================================
-- Authently migration
-- Created: 2026-05-01T15:01:57.338Z
-- Slug: workspace_members_last_active_at
--
-- Sprint 02 retro [CARRYOVER] → Sprint 03 Section A item A1.
--
-- Adds activity tracking to workspace_members so the workspace switcher
-- and the /app cookie-fallback can sort by "most recently active." Sprint 02
-- shipped both surfaces with `memberships[0]` ordering = whatever Postgres
-- returned under RLS — stable per session but drifts across deployments.
--
-- Schema:
--   workspace_members.last_active_at timestamptz not null default now()
--
-- Existing rows backfill to now() via the column default. That treats
-- historic members as "recently active," which is acceptable per the spec:
-- the most-recently-active value among historic data is unknowable, so
-- treating them all equally on the migration boundary preserves correctness
-- for the next-visit-onward bump pattern. No index — workspace_members is
-- small per workspace (well under 100 rows in practice; under 1000 even at
-- the ceiling of an Agency-tier seat plan).
--
-- Activity bump RPC pair:
--   private.touch_workspace_member_activity_impl(_workspace_id uuid)
--   public.api_touch_workspace_member_activity(_workspace_id uuid)
--
-- Both follow the Sprint 01/02 naming convention from CLAUDE.md:
--   - private.<name>_impl is the worker, callable only via the public wrapper
--   - public.api_<name> is the user-callable entry point granted to
--     authenticated; uses auth.uid() to identify the caller
--
-- The 60-second debounce predicate lives inside the SQL (atomic) so
-- rapid intra-workspace navigation generates at most one DB write per
-- minute per (user, workspace) pair.
-- =============================================================================

-- 1. Column.
alter table public.workspace_members
  add column last_active_at timestamptz not null default now();

-- 2. Worker.
create or replace function private.touch_workspace_member_activity_impl(_workspace_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.workspace_members
    set last_active_at = now()
    where workspace_id = _workspace_id
      and user_id = auth.uid()
      and last_active_at < now() - interval '60 seconds';
$$;

revoke all on function private.touch_workspace_member_activity_impl(uuid) from public;
revoke all on function private.touch_workspace_member_activity_impl(uuid) from anon, authenticated;
-- Worker is reachable only via the public.api_* wrapper. SECURITY DEFINER
-- means the wrapper executes the worker with definer privileges; the caller
-- doesn't need EXECUTE on the worker itself.

-- 3. User-callable wrapper.
create or replace function public.api_touch_workspace_member_activity(_workspace_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.touch_workspace_member_activity_impl(_workspace_id);
$$;

revoke all on function public.api_touch_workspace_member_activity(uuid) from public;
revoke all on function public.api_touch_workspace_member_activity(uuid) from anon;
grant execute on function public.api_touch_workspace_member_activity(uuid) to authenticated;
