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
import { triggerPdfExtraction } from "@/lib/trigger";

// Sprint 07 C2b.2 — service module orchestrating PDF source creation.
// Flow:
//   1. Validate input (file MIME + size + non-empty title) via zod +
//      explicit File checks. Defense-in-depth — the bucket also enforces
//      mime + size, and api_create_source_pdf enforces non-empty title.
//   2. Call api_create_source_pdf RPC → returns source_id, row in
//      'processing'.
//   3. Upload PDF bytes to Storage at the deterministic path
//      `ws/{workspaceId}/{sourceId}.pdf` in the `sources-pdf` bucket. RLS
//      enforces workspace membership at the Storage layer (same predicate
//      as the RPC; defense-in-depth, not a redundant gate).
//   4. Trigger extractFromPdfTask. The task fetches the PDF via signed
//      URL at the same deterministic path.
//
// Rollback discipline (locked at C2b.2 prompt review):
//   Upload failure → roll back the row. No Storage object exists yet, so
//   no Storage cleanup needed.
//   Trigger failure (after upload succeeded) → roll back the row. The
//   Storage object becomes an orphan, accepted per E6d-Storage addendum
//   in SPRINT_07_carryovers.md entry #2.
//   Task-internal crash → accept the orphan per E6d (this service has
//   already returned to the caller).
//
// All rollbacks are BEST-EFFORT: if api_delete_source itself fails, the
// row falls back to the E6d accept-orphan case. Rollback is a frequency-
// reduction mechanism, not a guarantee.

const SOURCES_PDF_BUCKET = "sources-pdf";
export const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MiB — matches bucket file_size_limit + supabase config baseline

export type CreateSourcePdfInput = {
  workspaceId: string;
  file: File;
  title: string;
};

export type CreateSourcePdfResult =
  | { ok: true; sourceId: string }
  | { ok: false; error: string };

const metadataSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1),
});

// Exported for cross-package convergence test at
// apps/web/tests/services/sources/computed-path.test.ts (C2b.3 Checkpoint
// 3, Resolution 4 Option A). The function is otherwise module-private in
// spirit — only test code imports it directly. Production callers within
// this module use it via the closure below.
export function storagePathFor(workspaceId: string, sourceId: string): string {
  return `ws/${workspaceId}/${sourceId}.pdf`;
}

export async function createSourcePdf(
  input: CreateSourcePdfInput,
): Promise<CreateSourcePdfResult> {
  // Step 1: validate (file checks + zod for the rest).
  const meta = metadataSchema.safeParse({
    workspaceId: input.workspaceId,
    title: input.title,
  });
  if (!meta.success) {
    const issue = meta.error.issues[0];
    const path = issue?.path.join(".") || "input";
    return { ok: false, error: `validation: ${path}: ${issue?.message}` };
  }
  if (input.file.type !== "application/pdf") {
    return { ok: false, error: "validation: invalid_mime" };
  }
  if (input.file.size > MAX_PDF_BYTES) {
    return { ok: false, error: "validation: file_too_large" };
  }
  if (input.file.size === 0) {
    return { ok: false, error: "validation: empty_file" };
  }

  const sb = await createSupabaseServerClient();

  // Step 2: create the row via RPC.
  const { data: sourceId, error: rpcError } = await typedRpc(
    sb,
    "api_create_source_pdf",
    {
      _workspace_id: meta.data.workspaceId,
      _title: meta.data.title,
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

  // Step 3: upload PDF bytes to Storage. Path is computed; both apps/web
  // and the C2a task converge on the same string from (workspace_id,
  // source_id) — caller and task converge by construction.
  const path = storagePathFor(meta.data.workspaceId, sourceId);
  const { error: uploadError } = await sb.storage
    .from(SOURCES_PDF_BUCKET)
    .upload(path, input.file, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadError) {
    // Roll back the row — no Storage object landed.
    const rollback = await typedRpc(sb, "api_delete_source", {
      _source_id: sourceId,
    });
    if (rollback.error) {
      return {
        ok: false,
        error: `upload_failed_rollback_failed: ${uploadError.message} | rollback: ${rollback.error.message}`,
      };
    }
    return { ok: false, error: `upload_failed: ${uploadError.message}` };
  }

  // Step 4: trigger the extraction task.
  try {
    await triggerPdfExtraction(meta.data.workspaceId, sourceId);
  } catch (triggerError) {
    const triggerMsg =
      triggerError instanceof Error
        ? triggerError.message
        : String(triggerError);
    // Roll back the row. The Storage object becomes an orphan accepted
    // per E6d-Storage addendum — soft-deleted rows logically still exist
    // and don't cascade to Storage cleanup, and task-trigger-failure
    // orphans are explicitly in the accepted-state list.
    const rollback = await typedRpc(sb, "api_delete_source", {
      _source_id: sourceId,
    });
    if (rollback.error) {
      return {
        ok: false,
        error: `trigger_failed_rollback_failed: ${triggerMsg} | rollback: ${rollback.error.message}`,
      };
    }
    return { ok: false, error: `trigger_failed: ${triggerMsg}` };
  }

  return { ok: true, sourceId };
}
