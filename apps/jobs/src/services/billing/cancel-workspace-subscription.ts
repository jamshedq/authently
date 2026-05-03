/*
 * Authently — Open-source AI content engine
 * Copyright (C) 2026 The Authently Contributors
 *
 * This file is part of Authently.
 *
 * Authently is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// =============================================================================
// Sprint 05 A2 STUB — replace before A2 lands.
//
// A1 (sweep-soft-deleted-workspaces task) calls this service per
// workspace before invoking svc_finalize_workspace_hard_delete. The stub
// returns { ok: true } unconditionally so A1's commit is CI-green
// standalone (no Stripe call, no test mode required for A1's tests).
//
// A2 replaces the stub body with the real Stripe `subscription.cancel`
// logic. Locked decisions for A2 (per Sprint 05 spec + A1 pre-flight Q4):
//
//   - Cancel mode: immediate (`subscription.cancel(id)`), NOT
//     `cancel_at_period_end: true`. Aligns with delete-workspace-dialog.tsx
//     disclosure copy.
//   - In-flight invoices: no special handling; Stripe's natural mid-period
//     cancel behavior applies.
//   - Idempotent: if Stripe reports the subscription is already cancelled,
//     return { ok: true } (goal state is reached).
//   - No-Stripe path: workspace.stripe_subscription_id IS NULL → return
//     { ok: true } without calling Stripe (workspace was on free tier).
//   - Error shape on Stripe failure: return
//     { ok: false, error: <message> } so the Trigger.dev caller can route
//     to svc_record_workspace_sweep_error.
//   - Stripe SDK + STRIPE_SECRET_KEY env wiring: A2 must add these to
//     apps/jobs (currently web-only). See "package boundary note" below
//     for context.
//
// A2 PACKAGE BOUNDARY NOTE: A1 surfaced that the originally-locked spec
// path (apps/web/src/services/billing/...) was not importable from
// apps/jobs (no @authently/web dep, no path alias, no exports field).
// Resolution path (b) was locked: this stub lives in apps/jobs. A2's
// pre-flight should explicitly cover Stripe SDK + env wiring scope in
// apps/jobs.
//
// A2's commit is service-only: this file's body changes; the task body
// (sweep-soft-deleted-workspaces.ts) and tests do not change. A2 also
// adds dedicated tests in
// apps/jobs/tests/services/billing/cancel-workspace-subscription.test.ts
// covering the four paths above.
// =============================================================================

export type CancelWorkspaceSubscriptionInput = {
  workspaceId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

export type CancelWorkspaceSubscriptionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function cancelWorkspaceSubscription(
  input: CancelWorkspaceSubscriptionInput,
): Promise<CancelWorkspaceSubscriptionResult> {
  // STUB: A1 ships this returning { ok: true } unconditionally so the
  // sweeper task body can be wired and tested end-to-end without a Stripe
  // dependency. A2 replaces this body per the locked decisions above.
  void input;
  return { ok: true };
}
