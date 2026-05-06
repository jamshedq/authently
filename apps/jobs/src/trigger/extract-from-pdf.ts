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

// Sprint 07 C2a — extractFromPdfTask. Triggered by api_create_source_pdf
// (lands in C2b) after the user uploads a PDF via drag-and-drop on the
// upload page (C4). The task is workspace-scoped via defineTenantTask.
//
// Flow:
//   1. Generate a short-lived signed URL for the PDF stored in Supabase
//      Storage at ws/{workspace_id}/{source_id}.pdf in the 'sources-pdf'
//      bucket. Per pre-flight Item 3, the upload-then-task pattern
//      writes the PDF to Storage in the apps/web server action; this
//      task only reads it.
//   2. Invoke apps/jobs/python/extract_pdfplumber.py with [signed_url].
//      The Python script fetches via the signed URL and runs
//      pdfplumber. Per the C2a Checkpoint 2 resolution, this script
//      accepts ONLY signed URLs from Storage — the URL-resolves-to-PDF
//      case is handled by extract_from_url.py, not here.
//   3. Parse stdout JSON via parsePythonOutput.
//   4. Update source row via setSourceStatusReady or setSourceStatusFailed.
//   5. Best-effort delete of the Storage object once extraction
//      completes (privacy-respecting, mirrors Sprint 06 B5-Q3's
//      "stream through, don't store" pattern adapted to async: store
//      transiently for the extraction window, delete after).
//
// Storage bucket creation (`sources-pdf`) is NOT in C2a scope — the
// bucket is created alongside C2b's api_create_source_pdf RPC + server
// action. This task references the bucket by name; tests mock the
// Storage API; first end-to-end use is C2b.

import { logger } from "@trigger.dev/sdk";
import { python } from "@trigger.dev/python";
import { z } from "zod";
import { uuidSchema } from "@authently/shared";
import { defineTenantTask } from "../lib/tenant-task.ts";
import { getJobsSupabaseClient } from "../lib/supabase.ts";
import { parsePythonOutput } from "../services/sources/parse-python-output.ts";
import {
  setSourceStatusFailed,
  setSourceStatusReady,
} from "../services/sources/update-source-status.ts";

const SOURCES_PDF_BUCKET = "sources-pdf";
const SIGNED_URL_TTL_SECONDS = 120;

function storagePathFor(workspaceId: string, sourceId: string): string {
  return `ws/${workspaceId}/${sourceId}.pdf`;
}

// Exported separately from the Trigger.dev task definition so tests can
// invoke the body with mocked python.runScript + supabase. Task wrapper
// below is a thin adapter.
export type ExtractFromPdfPayload = {
  source_id: string;
  workspace_id: string;
};

export type ExtractFromPdfResult =
  | { ok: true; source_id: string }
  | { ok: false; source_id: string; error: string };

export async function runExtractFromPdf(
  payload: ExtractFromPdfPayload,
): Promise<ExtractFromPdfResult> {
  const { source_id, workspace_id } = payload;
  const sb = getJobsSupabaseClient();
  const path = storagePathFor(workspace_id, source_id);

  // Step 1: signed URL
  const signed = await sb.storage
    .from(SOURCES_PDF_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    const errorClass = `network: signed_url:${signed.error?.message ?? "no_url_returned"}`;
    logger.error("extract-from-pdf: signed URL generation failed", {
      source_id,
      path,
      error: errorClass,
    });
    await setSourceStatusFailed(source_id, errorClass);
    return { ok: false, source_id, error: errorClass };
  }
  const signedUrl = signed.data.signedUrl;

  // Step 2: invoke Python
  let pythonResult;
  try {
    pythonResult = await python.runScript(
      "./python/extract_pdfplumber.py",
      [signedUrl],
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : "Unknown";
    const errorClass = `transient: python_runtime:${name}`;
    logger.error("extract-from-pdf: python.runScript threw", {
      source_id,
      error: errorClass,
    });
    await setSourceStatusFailed(source_id, errorClass);
    await safeDeletePdf(sb, path);
    return { ok: false, source_id, error: errorClass };
  }

  // Step 3: parse output
  const parsed = parsePythonOutput(pythonResult);
  if (!parsed.ok) {
    logger.info("extract-from-pdf: extraction failed", {
      source_id,
      error: parsed.error,
    });
    await setSourceStatusFailed(source_id, parsed.error);
    await safeDeletePdf(sb, path);
    return { ok: false, source_id, error: parsed.error };
  }

  // Step 4: success path
  await setSourceStatusReady(source_id, parsed.content, parsed.title);
  logger.info("extract-from-pdf: ready", {
    source_id,
    contentLength: parsed.content.length,
    hasTitle: parsed.title !== null,
  });

  // Step 5: cleanup. Best-effort — extraction succeeded; cleanup
  // failure does not invalidate the result.
  await safeDeletePdf(sb, path);

  return { ok: true, source_id };
}

export const extractFromPdfTask = defineTenantTask({
  id: "extract-from-pdf",
  payloadSchema: z.object({
    source_id: uuidSchema,
  }),
  run: async (payload, { workspaceId }) =>
    runExtractFromPdf({ source_id: payload.source_id, workspace_id: workspaceId }),
});

/**
 * Best-effort delete of the PDF from Storage. Logs but never throws —
 * cleanup failure is observable but does not propagate to the task
 * caller. Storage objects that linger past extraction can be cleaned
 * up by a future sweeper if the orphan rate becomes user-visible
 * (recorded as SPRINT_07_carryovers.md entry #2).
 */
async function safeDeletePdf(
  sb: ReturnType<typeof getJobsSupabaseClient>,
  path: string,
): Promise<void> {
  try {
    const { error } = await sb.storage
      .from(SOURCES_PDF_BUCKET)
      .remove([path]);
    if (error) {
      logger.warn("extract-from-pdf: storage cleanup failed (non-fatal)", {
        path,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn("extract-from-pdf: storage cleanup threw (non-fatal)", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
