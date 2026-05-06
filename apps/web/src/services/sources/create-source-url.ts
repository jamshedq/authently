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

import { z } from "zod";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { triggerUrlExtraction } from "@/lib/trigger";

// Sprint 07 C2b.2 — service module orchestrating URL source creation.
// Flow:
//   1. Validate input via zod (defense-in-depth; api_create_source_url
//      also validates).
//   2. Call api_create_source_url RPC → returns source_id, row in
//      'processing' status.
//   3. Trigger extractFromUrlTask. On trigger failure, best-effort
//      rollback the row via api_delete_source.
//
// Rollback discipline (locked at C2b.2 prompt review):
//   Trigger-failure → roll back the row (this service). The row would
//   otherwise be stuck in 'processing' indefinitely, which is the orphan
//   class E6d accepts but at higher frequency than task-internal crashes.
//   The rollback is BEST-EFFORT: if api_delete_source itself fails, the
//   row falls back to the E6d accept-orphan case (delete-and-resubmit per
//   E6a is the user-facing remediation). The rollback is a frequency-
//   reduction mechanism, not a guarantee.
//
//   Task-internal crash (post-trigger) → accept the orphan per E6d. This
//   service has already returned to the caller before the task-internal
//   failure surfaces.

export type CreateSourceUrlInput = {
  workspaceId: string;
  sourceUrl: string;
};

export type CreateSourceUrlResult =
  | { ok: true; sourceId: string }
  | { ok: false; error: string };

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  sourceUrl: z.string().url(),
});

export async function createSourceUrl(
  input: CreateSourceUrlInput,
): Promise<CreateSourceUrlResult> {
  // Step 1: validate.
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "input";
    return { ok: false, error: `validation: ${path}: ${issue?.message}` };
  }

  const sb = await createSupabaseServerClient();

  // Step 2: create the row via RPC. The RPC enforces workspace membership
  // (42501 if non-member) and auth.uid() presence (22023 if anon). Either
  // surfaces here as an error.
  const { data: sourceId, error: rpcError } = await typedRpc(
    sb,
    "api_create_source_url",
    {
      _workspace_id: parsed.data.workspaceId,
      _source_url: parsed.data.sourceUrl,
    },
  );
  if (rpcError) {
    return { ok: false, error: `rpc: ${rpcError.message}` };
  }
  if (typeof sourceId !== "string") {
    return {
      ok: false,
      error: `rpc: unexpected_payload: ${JSON.stringify(sourceId)}`,
    };
  }

  // Step 3: trigger the extraction task. On failure, best-effort rollback.
  try {
    await triggerUrlExtraction(
      parsed.data.workspaceId,
      sourceId,
      parsed.data.sourceUrl,
    );
  } catch (triggerError) {
    const triggerMsg =
      triggerError instanceof Error
        ? triggerError.message
        : String(triggerError);
    const rollback = await typedRpc(sb, "api_delete_source", {
      _source_id: sourceId,
    });
    if (rollback.error) {
      // Rollback failed too — row is stuck in 'processing' until the
      // E6d accept-orphan path (or future sweeper) catches it.
      return {
        ok: false,
        error: `trigger_failed_rollback_failed: ${triggerMsg} | rollback: ${rollback.error.message}`,
      };
    }
    return { ok: false, error: `trigger_failed: ${triggerMsg}` };
  }

  return { ok: true, sourceId };
}
