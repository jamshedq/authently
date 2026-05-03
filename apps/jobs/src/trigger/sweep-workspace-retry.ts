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
// SYSTEM TASK — DOES NOT USE defineTenantTask
// =============================================================================
//
// Per-workspace retry companion to sweep-soft-deleted-workspaces. Triggered
// by the main sweeper's catch block when an individual workspace's Stripe
// cancel or finalize step fails. Re-attempts the cancel + finalize for
// just that workspace; if exhausted (3 attempts), records a sentinel-
// prefixed error message so operators can grep for triage candidates.
//
// Idempotency: keyed on workspace_id at trigger time
// (`{ idempotencyKey: workspaceId }`). Multiple failures of the same
// workspace within Trigger.dev's idempotency window collapse to one
// retry chain.
//
// Built-in retry config below handles the in-task retry semantics
// (1m → 2m → 4m). The task body assumes the underlying RPCs are
// idempotent (svc_finalize_workspace_hard_delete asserts state in WHERE).
//
// Security review: same checklist as the main sweeper —
//   [x] Payload contains workspace_id (sourced from main sweeper, never
//       from end-user input)
//   [x] All DB writes via SECURITY DEFINER svc_* RPCs
//   [x] No PII in logs
// =============================================================================

import { logger, task } from "@trigger.dev/sdk";
import { cancelWorkspaceSubscription } from "../services/billing/cancel-workspace-subscription.ts";
import { getJobsSupabaseClient } from "../lib/supabase.ts";

const MAX_ATTEMPTS = 3;

type RetryPayload = {
  workspaceId: string;
  attempt: number;
};

type RetryOutcome =
  | { status: "finalized"; workspaceId: string }
  | { status: "abandoned"; workspaceId: string; lastError: string }
  | { status: "retrying"; workspaceId: string; attempt: number };

export const sweepWorkspaceRetryTask = task({
  id: "sweep-workspace-retry",
  retry: {
    maxAttempts: MAX_ATTEMPTS,
    factor: 2,
    minTimeoutInMs: 60_000,
    maxTimeoutInMs: 240_000,
    randomize: false,
  },
  run: async (payload: RetryPayload, { ctx }): Promise<RetryOutcome> => {
    const { workspaceId } = payload;
    const sb = getJobsSupabaseClient();

    // Read current Stripe IDs — they may have been updated since the
    // main sweep snapshotted them.
    const { data: ws, error: readError } = await sb
      .from("workspaces")
      .select(
        "stripe_customer_id, stripe_subscription_id, deleted_at, hard_deleted_at",
      )
      .eq("id", workspaceId)
      .maybeSingle();

    if (readError || !ws) {
      throw new Error(
        `retry: workspace read failed: ${readError?.message ?? "no row"}`,
      );
    }

    // No-op if the workspace is no longer a sweep candidate (e.g.,
    // already finalized by a parallel sweep or restored).
    if (ws.hard_deleted_at !== null || ws.deleted_at === null) {
      logger.info("retry no-op (workspace no longer a candidate)", {
        workspaceId,
      });
      return { status: "finalized", workspaceId };
    }

    const cancelResult = await cancelWorkspaceSubscription({
      workspaceId,
      stripeCustomerId: ws.stripe_customer_id,
      stripeSubscriptionId: ws.stripe_subscription_id,
    });

    if (!cancelResult.ok) {
      throw new Error(`stripe_cancel: ${cancelResult.error}`);
    }

    const finalizeResult = await sb.rpc(
      "svc_finalize_workspace_hard_delete",
      { _workspace_id: workspaceId } as never,
    );

    if (finalizeResult.error) {
      throw new Error(`finalize: ${finalizeResult.error.message}`);
    }

    logger.info("workspace finalized via retry", {
      workspaceId,
      attempt: ctx.attempt.number,
    });
    return { status: "finalized", workspaceId };
  },
  handleError: async ({ payload, error, ctx }) => {
    // Trigger.dev calls handleError after each failed attempt. On the
    // FINAL attempt failure, write a sentinel-prefixed last_sweep_error
    // so operators can `WHERE last_sweep_error LIKE 'abandoned_%'` for
    // triage candidates without parsing free-form error text.
    if (ctx.attempt.number < MAX_ATTEMPTS) {
      // Not the last attempt — let Trigger.dev retry naturally.
      return;
    }

    const lastError =
      error instanceof Error ? error.message : String(error);
    const sentinel = `abandoned_after_${MAX_ATTEMPTS}_retries: ${lastError}`;

    logger.error("workspace sweep abandoned after retries", {
      workspaceId: payload.workspaceId,
      attempt: ctx.attempt.number,
      lastError,
    });

    const sb = getJobsSupabaseClient();
    const { error: recordError } = await sb.rpc(
      "svc_record_workspace_sweep_error",
      {
        _workspace_id: payload.workspaceId,
        _error_text: sentinel,
      } as never,
    );
    if (recordError) {
      // Best-effort; don't mask the original error.
      logger.error("record sentinel failed", {
        workspaceId: payload.workspaceId,
        error: recordError.message,
      });
    }
  },
});
