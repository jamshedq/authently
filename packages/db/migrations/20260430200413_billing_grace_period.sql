-- =============================================================================
-- Authently migration
-- Created: 2026-04-30T20:04:13.412Z
-- Slug: billing_grace_period
--
-- Sprint 02 Section D Commit 1 — past-due grace period support.
--
-- Adds:
--   1. public.find_workspaces_past_due_grace_expired()
--      Selects workspace IDs where subscription_status = 'past_due' and
--      past_due_since is older than 7 days. Used by the daily Trigger.dev
--      scheduled task at apps/jobs/src/trigger/billing-grace-period.ts.
--
--   2. public.downgrade_workspace_to_free(_workspace_id uuid)
--      Atomic downgrade: plan_tier='free', status='canceled', clears the
--      past_due anchor and current_period_end, nulls stripe_subscription_id.
--      Race-safe: WHERE clause asserts subscription_status='past_due', so
--      a concurrent invoice.payment_succeeded webhook that flipped the
--      workspace back to 'active' between find_ and downgrade_ will leave
--      the row unchanged.
--
-- Both follow the SECURITY DEFINER hardening pattern (search_path='', fully-
-- qualified refs, revoke from public, grant to service_role only).
--
-- Schema is `public` (not `private`) because the daily Trigger.dev task
-- invokes these via PostgREST. See the matching note in
-- 20260430200155_billing_event_processor.sql.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- public.find_workspaces_past_due_grace_expired
-- ---------------------------------------------------------------------------
create or replace function public.find_workspaces_past_due_grace_expired()
returns table(workspace_id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select w.id
    from public.workspaces w
    where w.subscription_status = 'past_due'
      and w.past_due_since is not null
      and w.past_due_since < (now() - interval '7 days')
$$;

revoke all on function public.find_workspaces_past_due_grace_expired() from public;
revoke all on function public.find_workspaces_past_due_grace_expired() from anon, authenticated;
grant execute on function public.find_workspaces_past_due_grace_expired() to service_role;

-- ---------------------------------------------------------------------------
-- public.downgrade_workspace_to_free
-- ---------------------------------------------------------------------------
create or replace function public.downgrade_workspace_to_free(_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _workspace_id is null then
    raise exception 'workspace_id is required'
      using errcode = '22023'; -- invalid_parameter_value
  end if;

  -- Defensive WHERE: don't downgrade a workspace that has recovered between
  -- the find_ and downgrade_ calls (an invoice.payment_succeeded webhook
  -- could have flipped it back to 'active').
  update public.workspaces
    set plan_tier = 'free',
        subscription_status = 'canceled',
        past_due_since = null,
        subscription_current_period_end = null,
        stripe_subscription_id = null
    where id = _workspace_id
      and subscription_status = 'past_due';
end;
$$;

revoke all on function public.downgrade_workspace_to_free(uuid) from public;
revoke all on function public.downgrade_workspace_to_free(uuid) from anon, authenticated;
grant execute on function public.downgrade_workspace_to_free(uuid) to service_role;
