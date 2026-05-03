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
// Second system task in the codebase (after billing-grace-period). Sweeps
// workspaces soft-deleted >24h ago, cancels their Stripe subscription
// (A2 stub for now; real call lands in A2 commit), then finalizes the
// hard-delete by deleting child rows + setting hard_deleted_at.
//
// The canonical workspace task constructor `defineTenantTask` from
// apps/jobs/src/lib/tenant-task.ts cannot be used because:
//
//   1. Intrinsically system-level. Hourly cron with empty payload; no
//      caller; no `workspace_id` to validate up front because the whole
//      point is to FIND workspaces past the cutoff.
//
//   2. No user input. Payload is empty.
//
//   3. The three RPCs are SECURITY DEFINER, granted to service_role only:
//        - svc_sweep_soft_deleted_workspaces (read-only find)
//        - svc_finalize_workspace_hard_delete (per-workspace act,
//          idempotent via WHERE clause)
//        - svc_record_workspace_sweep_error (per-workspace error log)
//
// Tenancy guarantee: the find RPC is the SOLE source of workspace IDs
// the task acts on. There is no caller-supplied ID to forge.
//
// Security review checklist:
//   [x] No user input in payload
//   [x] All DB writes go through SECURITY DEFINER RPCs
//   [x] RPCs are granted to service_role only
//   [x] Race-safety: finalize_ asserts deleted_at IS NOT NULL AND
//       hard_deleted_at IS NULL in WHERE; no-ops on stale rows
//   [x] No PII in logs (workspace_id only; no names, emails, Stripe IDs
//       beyond the workspace identifier)
//
// See apps/jobs/SYSTEM_TASKS.md for the full system-task policy and
// registry.
// =============================================================================

import { logger, schedules } from "@trigger.dev/sdk";
import { cancelWorkspaceSubscription } from "../services/billing/cancel-workspace-subscription.ts";
import { getJobsSupabaseClient } from "../lib/supabase.ts";
import { sweepWorkspaceRetryTask } from "./sweep-workspace-retry.ts";

type SweepCandidate = {
  workspace_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
};

type SweepSummary = {
  candidatesFound: number;
  finalized: number;
  stripeFailed: number;
  finalizeFailed: number;
  retryQueued: number;
  durationMs: number;
};

export const sweepSoftDeletedWorkspacesTask = schedules.task({
  id: "sweep-soft-deleted-workspaces",
  // Hourly. Sweep latency vs cost trade-off — hourly because billing
  // accrues at unrelated cadences and a slow sweep is a worse customer
  // experience than a fast one.
  cron: "0 * * * *",
  run: async (): Promise<SweepSummary> => {
    const startedAt = Date.now();
    const sb = getJobsSupabaseClient();

    const { data, error } = await sb.rpc(
      "svc_sweep_soft_deleted_workspaces",
      {} as never,
    );

    if (error) {
      logger.error("svc_sweep_soft_deleted_workspaces failed", {
        error: error.message,
      });
      throw new Error(
        `svc_sweep_soft_deleted_workspaces failed: ${error.message}`,
      );
    }

    const rows = (data ?? []) as SweepCandidate[];
    logger.info("sweep scan complete", { candidatesFound: rows.length });

    let finalized = 0;
    let stripeFailed = 0;
    let finalizeFailed = 0;
    let retryQueued = 0;

    for (const row of rows) {
      const workspaceId = row.workspace_id;

      // 1. Cancel Stripe subscription (A2 stub returns { ok: true } for
      //    workspaces with no Stripe IDs and for now until A2 lands).
      const cancelResult = await cancelWorkspaceSubscription({
        workspaceId,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
      });

      if (!cancelResult.ok) {
        stripeFailed += 1;
        logger.error("stripe cancel failed", {
          workspaceId,
          error: cancelResult.error,
        });
        await recordError(sb, workspaceId, `stripe_cancel: ${cancelResult.error}`);
        await sweepWorkspaceRetryTask.trigger(
          { workspaceId, attempt: 1 },
          { idempotencyKey: workspaceId },
        );
        retryQueued += 1;
        continue;
      }

      // 2. Finalize: delete children + set hard_deleted_at.
      const finalizeResult = await sb.rpc(
        "svc_finalize_workspace_hard_delete",
        { _workspace_id: workspaceId } as never,
      );

      if (finalizeResult.error) {
        finalizeFailed += 1;
        logger.error("finalize failed", {
          workspaceId,
          error: finalizeResult.error.message,
        });
        await recordError(
          sb,
          workspaceId,
          `finalize: ${finalizeResult.error.message}`,
        );
        await sweepWorkspaceRetryTask.trigger(
          { workspaceId, attempt: 1 },
          { idempotencyKey: workspaceId },
        );
        retryQueued += 1;
        continue;
      }

      finalized += 1;
      logger.info("workspace finalized", { workspaceId });
    }

    return {
      candidatesFound: rows.length,
      finalized,
      stripeFailed,
      finalizeFailed,
      retryQueued,
      durationMs: Date.now() - startedAt,
    };
  },
});

async function recordError(
  sb: ReturnType<typeof getJobsSupabaseClient>,
  workspaceId: string,
  errorText: string,
): Promise<void> {
  const { error } = await sb.rpc("svc_record_workspace_sweep_error", {
    _workspace_id: workspaceId,
    _error_text: errorText,
  } as never);
  if (error) {
    // Don't throw — error recording is best-effort. The next hourly tick
    // will re-pick the workspace via the partial index.
    logger.error("record_workspace_sweep_error failed", {
      workspaceId,
      error: error.message,
    });
  }
}
