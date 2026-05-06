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

import { logger } from "@trigger.dev/sdk";
import { getJobsSupabaseClient } from "../../lib/supabase.ts";

// Sprint 07 C2a — shared service-role wrapper around
// public.svc_update_source_status (Sprint 07 C1, migration
// 20260506162740_sources_status_columns.sql). Both extraction tasks
// (extract-from-url and extract-from-pdf) route status mutations
// through this wrapper rather than calling the RPC directly, so the
// state-machine contract is enforced at one boundary.
//
// State machine (per C1's private.update_source_status_impl):
//   - processing → ready  : requires non-empty content
//   - processing → failed : requires non-empty error
// Any other transition or missing required field is rejected by the
// worker with errcode 22023. The wrapper functions below encode the
// non-empty requirements as TypeScript signatures (content/error are
// `string` not `string | null`) so callers can't omit them at compile
// time.
//
// On RPC failure both functions throw — the caller (task wrapper)
// surfaces the throw to Trigger.dev which marks the task failed.
// In the failure-path setStatusFailed, throwing on RPC error is
// still the right call: a row stuck in 'processing' because we
// couldn't even record the failure is a worse state than a thrown
// task that operators can re-investigate.

export async function setSourceStatusReady(
  sourceId: string,
  content: string,
  title: string | null,
): Promise<void> {
  if (!content) {
    throw new Error(
      "setSourceStatusReady: content must be non-empty (state machine contract)",
    );
  }
  const sb = getJobsSupabaseClient();
  const { error } = await sb.rpc("svc_update_source_status", {
    _source_id: sourceId,
    _status: "ready",
    _content: content,
    ...(title !== null ? { _title: title } : {}),
  } as never);
  if (error) {
    logger.error("svc_update_source_status (ready) failed", {
      sourceId,
      error: error.message,
      code: error.code,
    });
    throw new Error(
      `svc_update_source_status (ready) failed for ${sourceId}: ${error.message}`,
    );
  }
}

export async function setSourceStatusFailed(
  sourceId: string,
  error: string,
): Promise<void> {
  if (!error) {
    throw new Error(
      "setSourceStatusFailed: error must be non-empty (state machine contract)",
    );
  }
  const sb = getJobsSupabaseClient();
  const { error: rpcError } = await sb.rpc("svc_update_source_status", {
    _source_id: sourceId,
    _status: "failed",
    _error: error,
  } as never);
  if (rpcError) {
    logger.error("svc_update_source_status (failed) failed", {
      sourceId,
      error: rpcError.message,
      code: rpcError.code,
    });
    throw new Error(
      `svc_update_source_status (failed) failed for ${sourceId}: ${rpcError.message}`,
    );
  }
}
