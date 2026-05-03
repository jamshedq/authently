# System Tasks Policy (apps/jobs)

A "system task" is a Trigger.dev task that **does NOT** use the `defineTenantTask` constructor from `src/lib/tenant-task.ts`. By default, every task in this app is workspace-scoped: payload includes `workspace_id`, the constructor verifies it exists before the run body executes, and the multi-tenant invariant from `CLAUDE.md` rule 4 holds automatically.

A system task explicitly opts out. That requires justification.

## When a task is allowed to bypass `defineTenantTask`

A task may bypass the tenant constructor only if **all four** of these hold:

1. **No caller-supplied workspace identity.** The task is invoked by a cron schedule or system event, never by user input. There is no `workspace_id` to validate at the boundary because no one supplied one.

2. **DB writes go through `SECURITY DEFINER` RPCs granted to `service_role` only.** The task does not write tables directly with the service-role client. All mutations must go through a `private.*` function with explicit `revoke from public; grant to service_role` and behavior tested in `packages/db/tests/`.

3. **The RPC the task uses to source workspace IDs is the SOLE source.** If the task acts on a list of workspaces, that list must come from a `private.*` function returning IDs based on a stable predicate — not from caller input, not from a free-form query, not from environment variables. This replaces the up-front workspace-existence check that `defineTenantTask` provides.

4. **Race-safe mutations.** Because system tasks act on workspaces independently of any synchronous user request, concurrent webhooks or other tasks may race against them. Mutation RPCs must defensively assert current state in their `WHERE` clause and treat "no rows updated" as a successful no-op, not an error.

A new system task ships with: a header comment block on the task file naming all four guarantees, a checklist signed by reviewer in PR, an entry below in this file, and a perimeter test in `packages/db/tests/billing/` (or the equivalent domain) demonstrating that the underlying RPCs reject non-service-role callers.

## Current registry

### `billing-grace-period` (Sprint 02 D Commit 1)

- **File:** `apps/jobs/src/trigger/billing-grace-period.ts`
- **Schedule:** daily at 06:00 UTC (`cron: "0 6 * * *"`)
- **Purpose:** find workspaces whose past-due grace period has expired (≥7 days since `past_due_since`) and downgrade them to `plan_tier='free'`.
- **RPCs used:**
  - `public.find_workspaces_past_due_grace_expired()` → returns workspace IDs
  - `public.downgrade_workspace_to_free(_workspace_id)` → race-safe downgrade
- **Why bypass `defineTenantTask`:** see file header. No caller-supplied input; both RPCs are SECURITY DEFINER + service_role-only; the find_ RPC is the sole source of workspace IDs; the downgrade_ RPC is race-safe (asserts `subscription_status='past_due'` in WHERE).
- **Perimeter tests:** `packages/db/tests/billing/process-stripe-event-rls.test.ts` covers the corresponding RLS perimeter for the webhook RPC; the grace-period RPCs share the same `service_role`-only grant model.

### `sweep-soft-deleted-workspaces` (Sprint 05 A1)

- **File:** `apps/jobs/src/trigger/sweep-soft-deleted-workspaces.ts`
- **Schedule:** hourly (`cron: "0 * * * *"`)
- **Purpose:** find workspaces soft-deleted >24h ago, cancel their Stripe subscription (Sprint 05 A2; A1 ships a stub at `apps/web/src/services/billing/cancel-workspace-subscription.ts`), then finalize the hard-delete by deleting child rows + setting `hard_deleted_at`. Audit-preserving: the workspaces row itself remains, marked hard-deleted.
- **RPCs used:**
  - `public.svc_sweep_soft_deleted_workspaces(_cutoff_interval)` → returns candidate rows with Stripe IDs
  - `public.svc_finalize_workspace_hard_delete(_workspace_id)` → idempotent finalize (asserts state in WHERE)
  - `public.svc_record_workspace_sweep_error(_workspace_id, _error_text)` → per-workspace error log
- **Why bypass `defineTenantTask`:** see file header. Hourly cron with empty payload — no caller-supplied workspace identity; all three RPCs are SECURITY DEFINER + service_role-only; the find RPC is the sole source of workspace IDs; finalize is race-safe via `WHERE deleted_at IS NOT NULL AND hard_deleted_at IS NULL`.
- **Perimeter tests:** `packages/db/tests/billing/sweep-soft-deleted-workspaces.test.ts` covers all three RPCs (anon + authenticated rejected with 42501 / PGRST202).

### `sweep-workspace-retry` (Sprint 05 A1)

- **File:** `apps/jobs/src/trigger/sweep-workspace-retry.ts`
- **Schedule:** event-triggered (called from `sweep-soft-deleted-workspaces` catch block)
- **Purpose:** per-workspace retry companion to the main sweeper. Re-attempts cancel + finalize for a single failed workspace; on attempt-3 abandonment, writes a sentinel-prefixed `last_sweep_error` (`abandoned_after_3_retries: ...`) so operators can grep for triage candidates.
- **RPCs used:**
  - `public.svc_finalize_workspace_hard_delete(_workspace_id)` (same as main sweeper)
  - `public.svc_record_workspace_sweep_error(_workspace_id, _error_text)` (same as main sweeper)
- **Why bypass `defineTenantTask`:** payload contains `workspace_id` but it is sourced from the main sweeper's find RPC, never from end-user input. Trigger-side idempotency keyed on `workspace_id` (`{ idempotencyKey: workspaceId }` at trigger time) collapses concurrent retry chains. Built-in retry config (3 attempts, factor 2, 1m → 2m → 4m).
- **Perimeter tests:** shares the perimeter test file with the main sweeper (RPCs are the same; perimeter is identical).

## Audit cadence

When a system task is added, the reviewer must confirm all four guarantees in the PR. When CLAUDE.md rule 6 evolves, this file should be updated in the same PR so the registry stays in sync with the policy.
