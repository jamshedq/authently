-- =============================================================================
-- Authently migration
-- Created: 2026-04-29T23:16:00.586Z
-- Slug: workspace_members_write_policies
--
-- Sprint 02 Section C — RLS write policies on workspace_members.
--
-- Sprint 01 only enabled SELECT (writes happened via the SECURITY
-- DEFINER signup trigger and post-signup RPC). Sprint 02 Section B's
-- create-workspace RPC bypasses RLS by design. Section C surfaces the
-- first user-facing write paths on workspace_members:
--
--   - UPDATE role        → role-change UI on the members page
--   - DELETE             → "Remove member" + "Leave workspace"
--   - INSERT             → still bypassed (handled by signup trigger,
--                          create-workspace RPC, accept-invitation RPC).
--                          No INSERT policy added; PostgREST callers
--                          can't insert directly.
--
-- Policy structure:
--   * UPDATE              — owner/admin in this workspace. The full
--     actor-vs-target role matrix lives in the API service layer
--     (admins can only change editor↔viewer; owners can change any
--     non-owner role; promote-to-owner is Sprint 03 transfer).
--   * DELETE              — owner/admin, OR the row is the caller's
--     own membership (self-leave). Last-owner protection is enforced
--     by the private.prevent_last_owner_loss trigger from migration
--     20260429230559, which fires BEFORE DELETE / UPDATE regardless
--     of which policy admitted the request.
--
-- Column-level lockdown: revoke UPDATE on all columns from
-- authenticated except `role` so the API can't accidentally rewrite
-- workspace_id, user_id, or created_at.
-- =============================================================================

create policy workspace_members_owner_admin_update on public.workspace_members
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner', 'admin']))
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_workspace_role(workspace_id, array['owner', 'admin'])
  );

revoke update on public.workspace_members from authenticated;
grant update (role) on public.workspace_members to authenticated;
