-- =============================================================================
-- Authently migration
-- Created: 2026-05-02T19:43:15.622Z
-- Slug: workspaces_sweep_columns
--
-- Sprint 05 A1 — scheduled hard-delete sweeper for soft-deleted workspaces.
-- Carryover #1 from SPRINT_04_carryovers.md, paired with #3 (Stripe
-- subscription cancellation, Sprint 05 A2 — runs in the same Trigger.dev
-- task body).
--
-- This migration adds:
--   - Three columns on public.workspaces: hard_deleted_at,
--     last_sweep_attempt_at, last_sweep_error
--   - Partial index workspaces_sweep_candidates_idx for sweeper query
--     performance
--   - Three RPC pairs (private.<name>_impl + public.svc_<name>):
--       1. sweep_soft_deleted_workspaces — find candidates past cutoff
--       2. finalize_workspace_hard_delete — delete children + mark
--          hard_deleted_at
--       3. record_workspace_sweep_error — log per-workspace error to columns
--
-- All svc_* wrappers granted to service_role only (revoked from public,
-- anon, authenticated). Sweeper invokes via
-- apps/jobs/src/trigger/sweep-soft-deleted-workspaces.ts.
--
-- Audit-preserving design (locked at A1 pre-flight Q1): finalize_ does NOT
-- delete the workspaces row itself. It explicitly deletes child rows in
-- workspace_invitations / workspace_members / workspace_ownership_transfers /
-- smoke_test, then sets hard_deleted_at on the workspace stub. The
-- workspaces row remains as audit trail; FK references to it from
-- audit-grade tables (e.g., stripe_events with ON DELETE SET NULL) stay
-- attached.
--
-- FK references to public.workspaces(id) verified during build:
--   - public.workspace_members              ON DELETE CASCADE   (deleted by finalize_)
--   - public.workspace_invitations          ON DELETE CASCADE   (deleted by finalize_)
--   - public.workspace_ownership_transfers  ON DELETE CASCADE   (deleted by finalize_)
--   - public.smoke_test                     ON DELETE CASCADE   (deleted by finalize_)
--   - public.stripe_events                  ON DELETE SET NULL  (preserved)
--
-- Operator preview pattern (locked at A1 pre-flight Q7): find is read-only
-- by design; manual operator preview is
--   `select * from public.svc_sweep_soft_deleted_workspaces();`
-- Returns the rowset the next hourly cron tick would act on, without
-- acting. No separate _dry_run flag — the find/finalize split IS the
-- dry-run mechanism.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schema: workspaces sweep tracking columns + partial index
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column hard_deleted_at timestamptz,
  add column last_sweep_attempt_at timestamptz,
  add column last_sweep_error text;

comment on column public.workspaces.hard_deleted_at is
  'Set by private.finalize_workspace_hard_delete_impl after children are deleted. Audit-preserving: workspaces row remains; this column marks the row as logically destroyed.';

comment on column public.workspaces.last_sweep_attempt_at is
  'Updated by private.record_workspace_sweep_error_impl on per-workspace sweep failure (Stripe error, finalize error, retry-task abandonment).';

comment on column public.workspaces.last_sweep_error is
  'Last error message from a failed sweep attempt. Sentinel-prefixed "abandoned_after_3_retries: <msg>" once sweep-workspace-retry exhausts its retry budget.';

-- Sweeper-query index — only soft-deleted-but-not-yet-hard-deleted rows.
-- Supports the cutoff scan in sweep_soft_deleted_workspaces_impl.
create index workspaces_sweep_candidates_idx
  on public.workspaces (deleted_at)
  where hard_deleted_at is null and deleted_at is not null;

-- ---------------------------------------------------------------------------
-- private.prevent_last_owner_loss — extend skip-cases to hard-delete sweep
--
-- The deferred constraint trigger from migration 20260429233046 already
-- skips when (a) the workspaces row was deleted entirely, or (b) the
-- auth.users row was deleted. Both are "the membership going away is
-- incidental, not a leave attempt." A1's hard-delete sweeper introduces
-- a third incidental case: the workspaces row remains (audit-preserved)
-- but is marked hard_deleted_at, and finalize_ has just explicitly
-- deleted the membership rows. Same semantic, same skip.
--
-- Without this extension, finalize_workspace_hard_delete_impl trips the
-- "cannot remove or demote the last owner" guard at commit time even
-- though the workspace itself is being torn down.
-- ---------------------------------------------------------------------------
create or replace function private.prevent_last_owner_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners int;
  workspace_still_exists boolean;
  workspace_hard_deleted boolean;
  user_still_exists boolean;
begin
  if not (
    (tg_op = 'DELETE' and old.role = 'owner')
    or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner')
  ) then
    return null;
  end if;

  -- Cascade-skip case 1: workspaces row was deleted entirely.
  select exists (
    select 1 from public.workspaces where id = old.workspace_id
  ) into workspace_still_exists;
  if not workspace_still_exists then
    return null;
  end if;

  -- Cascade-skip case 2 (NEW in Sprint 05 A1): workspaces row is
  -- audit-preserved but hard-deleted. finalize_ removed memberships
  -- intentionally — the leave-protection is moot.
  select hard_deleted_at is not null
    from public.workspaces
    where id = old.workspace_id
    into workspace_hard_deleted;
  if workspace_hard_deleted then
    return null;
  end if;

  -- Cascade-skip case 3: auth.users row was deleted.
  select exists (
    select 1 from auth.users where id = old.user_id
  ) into user_still_exists;
  if not user_still_exists then
    return null;
  end if;

  select count(*)
    into remaining_owners
    from public.workspace_members
    where workspace_id = old.workspace_id
      and role = 'owner';
  if remaining_owners = 0 then
    raise exception
      'cannot remove or demote the last owner of workspace %', old.workspace_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- private.sweep_soft_deleted_workspaces_impl — find worker
--
-- Returns rows of workspaces past the soft-delete cutoff with their Stripe
-- IDs for the Trigger.dev side to cancel before finalizing. Read-only;
-- per-row FOR UPDATE SKIP LOCKED for parallel-sweeper performance (lock
-- releases at end of this RPC's transaction; finalize_'s WHERE clause
-- provides at-most-once idempotency, not the lock).
-- ---------------------------------------------------------------------------
create or replace function private.sweep_soft_deleted_workspaces_impl(
  _cutoff_interval interval
)
returns table(
  workspace_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text
)
language sql
security definer
set search_path = ''
as $$
  select
    w.id as workspace_id,
    w.stripe_customer_id,
    w.stripe_subscription_id,
    w.subscription_status
  from public.workspaces w
  where w.deleted_at is not null
    and w.deleted_at < now() - _cutoff_interval
    and w.hard_deleted_at is null
  for update of w skip locked;
$$;

revoke all on function private.sweep_soft_deleted_workspaces_impl(interval) from public;
revoke all on function private.sweep_soft_deleted_workspaces_impl(interval) from anon, authenticated;
grant execute on function private.sweep_soft_deleted_workspaces_impl(interval) to service_role;

-- ---------------------------------------------------------------------------
-- public.svc_sweep_soft_deleted_workspaces — service-role wrapper
-- ---------------------------------------------------------------------------
create or replace function public.svc_sweep_soft_deleted_workspaces(
  _cutoff_interval interval default '24 hours'
)
returns table(
  workspace_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text
)
language sql
security definer
set search_path = ''
as $$
  select * from private.sweep_soft_deleted_workspaces_impl(_cutoff_interval);
$$;

revoke all on function public.svc_sweep_soft_deleted_workspaces(interval) from public;
revoke all on function public.svc_sweep_soft_deleted_workspaces(interval) from anon, authenticated;
grant execute on function public.svc_sweep_soft_deleted_workspaces(interval) to service_role;

-- ---------------------------------------------------------------------------
-- private.finalize_workspace_hard_delete_impl — finalize worker
--
-- Deletes child rows + sets hard_deleted_at. Audit-preserving: workspaces
-- row itself stays in place. Idempotent: if the workspace is already
-- hard-deleted or no longer soft-deleted, the function is a no-op (the
-- WHERE clause on UPDATE asserts both conditions; child DELETEs are
-- naturally idempotent).
--
-- Deletion order (locked at A1 pre-flight Q2):
--   1. workspace_invitations
--   2. workspace_members
--   3. workspace_ownership_transfers
--   4. smoke_test (carryover #13 lingering; will be no-op once that ships)
--   5. UPDATE workspaces SET hard_deleted_at = now()
--
-- Implicit plpgsql transaction; any step fails → whole function rolls back.
-- ---------------------------------------------------------------------------
create or replace function private.finalize_workspace_hard_delete_impl(
  _workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _workspace_id is null then
    raise exception 'workspace_id is required'
      using errcode = '22023';
  end if;

  -- Children first, parent UPDATE last. ON DELETE CASCADE on these FKs
  -- would auto-fire if we DELETE'd the workspace row, but we don't —
  -- audit preservation keeps the workspaces row, so children must be
  -- explicitly deleted.
  delete from public.workspace_invitations
    where workspace_id = _workspace_id;

  delete from public.workspace_members
    where workspace_id = _workspace_id;

  delete from public.workspace_ownership_transfers
    where workspace_id = _workspace_id;

  delete from public.smoke_test
    where workspace_id = _workspace_id;

  -- Idempotency guard: only act on workspaces still in the
  -- soft-deleted-but-not-finalized state. If a parallel sweeper or
  -- restore-mid-sweep beat us here, this UPDATE is a no-op.
  update public.workspaces
    set hard_deleted_at = now(),
        last_sweep_error = null
    where id = _workspace_id
      and deleted_at is not null
      and hard_deleted_at is null;
end;
$$;

revoke all on function private.finalize_workspace_hard_delete_impl(uuid) from public;
revoke all on function private.finalize_workspace_hard_delete_impl(uuid) from anon, authenticated;
grant execute on function private.finalize_workspace_hard_delete_impl(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- public.svc_finalize_workspace_hard_delete — service-role wrapper
-- ---------------------------------------------------------------------------
create or replace function public.svc_finalize_workspace_hard_delete(
  _workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.finalize_workspace_hard_delete_impl(_workspace_id);
end;
$$;

revoke all on function public.svc_finalize_workspace_hard_delete(uuid) from public;
revoke all on function public.svc_finalize_workspace_hard_delete(uuid) from anon, authenticated;
grant execute on function public.svc_finalize_workspace_hard_delete(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- private.record_workspace_sweep_error_impl — error logging worker
--
-- Updates last_sweep_attempt_at + last_sweep_error without touching
-- hard_deleted_at. Used both for transient errors (Stripe API failure,
-- finalize failure) and for the sentinel-prefixed
-- "abandoned_after_3_retries: ..." form written by sweep-workspace-retry
-- after exhausting its retry budget.
-- ---------------------------------------------------------------------------
create or replace function private.record_workspace_sweep_error_impl(
  _workspace_id uuid,
  _error_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _workspace_id is null then
    raise exception 'workspace_id is required'
      using errcode = '22023';
  end if;

  update public.workspaces
    set last_sweep_attempt_at = now(),
        last_sweep_error = _error_text
    where id = _workspace_id
      and hard_deleted_at is null;
end;
$$;

revoke all on function private.record_workspace_sweep_error_impl(uuid, text) from public;
revoke all on function private.record_workspace_sweep_error_impl(uuid, text) from anon, authenticated;
grant execute on function private.record_workspace_sweep_error_impl(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.svc_record_workspace_sweep_error — service-role wrapper
-- ---------------------------------------------------------------------------
create or replace function public.svc_record_workspace_sweep_error(
  _workspace_id uuid,
  _error_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_workspace_sweep_error_impl(_workspace_id, _error_text);
end;
$$;

revoke all on function public.svc_record_workspace_sweep_error(uuid, text) from public;
revoke all on function public.svc_record_workspace_sweep_error(uuid, text) from anon, authenticated;
grant execute on function public.svc_record_workspace_sweep_error(uuid, text) to service_role;
