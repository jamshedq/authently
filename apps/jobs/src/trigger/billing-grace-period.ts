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
// This is the FIRST non-tenant-scoped Trigger.dev task in the codebase. The
// canonical workspace task constructor `defineTenantTask` from
// apps/jobs/src/lib/tenant-task.ts cannot be used because:
//
//   1. The task is intrinsically system-level. It runs daily without any
//      caller; no workspace owns the trigger. There is no `workspace_id`
//      to validate up front because the whole point is to FIND the
//      workspaces that need action.
//
//   2. The task accepts no user input. The cron schedule is the trigger;
//      the payload is empty. There is no surface to inject untrusted data.
//
//   3. The two RPCs the task calls (`public.find_workspaces_past_due_grace_expired`
//      and `public.downgrade_workspace_to_free`) are both SECURITY DEFINER,
//      granted exclusively to `service_role`, and self-contained:
//        - find_ takes no arguments and returns a stable predicate result
//        - downgrade_ takes one workspace_id and is race-safe via its
//          WHERE clause asserting subscription_status = 'past_due'
//
// Tenancy guarantee (replacing `defineTenantTask`'s up-front workspace
// existence check): the find_ RPC is the SOLE source of workspace IDs the
// task acts on. There is no caller-supplied ID to forge.
//
// Security review checklist:
//   [x] No user input in payload
//   [x] All DB writes go through SECURITY DEFINER RPCs
//   [x] RPCs are granted to service_role only
//   [x] Race-safety: downgrade_ asserts current state in WHERE, no-ops on stale
//   [x] No PII in logs
//
// See apps/jobs/SYSTEM_TASKS.md for the full system-task policy.
// =============================================================================

import { logger, schedules } from "@trigger.dev/sdk";
import { getJobsSupabaseClient } from "../lib/supabase.ts";

export const billingGracePeriodTask = schedules.task({
  id: "billing-grace-period",
  // 06:00 UTC daily — low-traffic hour for the platform. We're far from
  // any rate-limit pressure on Postgres or Stripe; the timing is chosen
  // for predictable observability rather than load shedding.
  cron: "0 6 * * *",
  run: async () => {
    const sb = getJobsSupabaseClient();

    const { data, error } = await sb
      .rpc("find_workspaces_past_due_grace_expired");

    if (error) {
      logger.error("find_workspaces_past_due_grace_expired failed", {
        error: error.message,
      });
      throw new Error(
        `find_workspaces_past_due_grace_expired failed: ${error.message}`,
      );
    }

    const rows = (data ?? []) as Array<{ workspace_id: string }>;
    logger.info("grace-period scan complete", {
      candidatesFound: rows.length,
    });

    let downgraded = 0;
    let failed = 0;

    for (const row of rows) {
      const workspaceId = row.workspace_id;
      const result = await sb
        .rpc("downgrade_workspace_to_free", {
          _workspace_id: workspaceId,
        } as never);

      if (result.error) {
        // Don't fail the whole task on a single workspace error — we want
        // to drain the queue. Stripe-related errors typically retry
        // themselves on the next cron tick.
        failed += 1;
        logger.error("downgrade_workspace_to_free failed", {
          workspaceId,
          error: result.error.message,
        });
        continue;
      }

      downgraded += 1;
      logger.info("workspace downgraded to free (grace period expired)", {
        workspaceId,
      });
    }

    return {
      candidatesFound: rows.length,
      downgraded,
      failed,
    };
  },
});
