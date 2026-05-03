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

import Stripe from "stripe";
import { getJobsStripeClient } from "../../lib/stripe.ts";

// Sprint 05 A2 — Stripe subscription cancellation for soft-deleted
// workspaces. Called from the hard-delete sweeper (and its retry
// companion) before the finalize RPC removes the workspace from the
// active billing surface.
//
// Idempotency strategy: pre-read via subscriptions.retrieve, check
// status === "canceled", short-circuit if already canceled. This was a
// build-time switch from the originally-locked catch-and-detect path
// (Sprint 05 A2 pre-flight Q4) — Stripe's already-canceled error
// predicate was not definitively documented at Context7 verification
// time, so pre-read against the documented response shape (the canceled
// subscription object's `status` field) is the more robust contract for
// an unattended sweeper. 2x API calls per common-path workspace accepted
// as cost of correctness.
//
// Error contract: returns { ok: true } on goal-state-reached (cancel
// succeeded, was already canceled, or subscription/customer doesn't
// exist on Stripe). Returns { ok: false, error } on transient errors
// (network, 5xx, 429) AND on auth errors (401/403). The Trigger.dev
// caller treats { ok: false } as retry-eligible.

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
  const { workspaceId, stripeSubscriptionId } = input;

  // No-Stripe-relationship short-circuit. Free-tier workspaces and
  // workspaces whose customer existed but never produced an active
  // subscription both land here (pre-flight Q7 — sweeper's job is
  // "cancel the recorded subscription," not "audit Stripe state").
  if (!stripeSubscriptionId) {
    return { ok: true };
  }

  const stripe = getJobsStripeClient();

  try {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    if (sub.status === "canceled") {
      console.warn(
        "subscription already canceled in Stripe; finalizing locally",
        { workspaceId, subscriptionId: stripeSubscriptionId },
      );
      return { ok: true };
    }
    await stripe.subscriptions.cancel(stripeSubscriptionId);
    return { ok: true };
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      // 404 / resource_missing: the subscription our DB records as
      // existing has no record on Stripe's side. Treat as goal-state-
      // reached (nothing to cancel) but warn loudly — operators may
      // grep for this specific phrasing during triage of data-
      // inconsistency incidents.
      if (err.code === "resource_missing") {
        console.warn(
          "subscription not found in Stripe; finalizing locally",
          {
            workspaceId,
            subscriptionId: stripeSubscriptionId,
            stripeCode: err.code,
          },
        );
        return { ok: true };
      }
      // Other 4xx invalid_request errors are not goal-state — surface as
      // failure so the sweeper records them in last_sweep_error.
      return { ok: false, error: `invalid_request: ${err.message}` };
    }
    if (err instanceof Stripe.errors.StripeAuthenticationError) {
      // Auth errors intentionally route through retry-then-sentinel
      // rather than failing fast: a misconfigured STRIPE_SECRET_KEY in
      // apps/jobs should land loudly in last_sweep_error after the
      // sweeper's 3 retries deplete, even at the cost of burning 3
      // attempts per workspace per hour across every sweep candidate.
      // Quiet auth failure would let billing leakage continue
      // unobserved; loud-and-recorded is the right trade.
      return { ok: false, error: `auth: ${(err as Error).message}` };
    }
    if (err instanceof Stripe.errors.StripeRateLimitError) {
      return { ok: false, error: `rate_limit: ${err.message}` };
    }
    if (err instanceof Stripe.errors.StripeConnectionError) {
      return { ok: false, error: `connection: ${err.message}` };
    }
    if (err instanceof Stripe.errors.StripeAPIError) {
      return { ok: false, error: `stripe_api: ${err.message}` };
    }
    if (err instanceof Stripe.errors.StripeError) {
      return { ok: false, error: `stripe: ${err.message}` };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
