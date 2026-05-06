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

// Sprint 07 C2a — extractFromUrlTask. Triggered by api_create_source_url
// (lands in C2b) after the user submits a URL via the upload page (C4).
// The task is workspace-scoped via defineTenantTask: workspace_id is
// validated as a real existing workspace before any extraction work.
//
// Flow:
//   1. HEAD the URL (5s timeout) to discover Content-Type without
//      paying the full body fetch cost on unsupported types.
//   2. Reject early if Content-Type is missing or unsupported. Status
//      flips to 'failed' with the appropriate error class prefix.
//   3. Invoke apps/jobs/python/extract_from_url.py with [url, content_type]
//      via @trigger.dev/python's python.runScript helper. The Python
//      script branches internally on content_type — text/html runs
//      through trafilatura; application/pdf runs through pdfplumber
//      with an inline urllib fetch (the URL-resolves-to-PDF case
//      resolved at C2a Checkpoint 2).
//   4. Parse stdout JSON via parsePythonOutput. The parser enforces
//      the protocol contract (non-empty stdout, valid JSON, expected
//      shape) and surfaces transient: errors when violated.
//   5. Update source row via setSourceStatusReady (success) or
//      setSourceStatusFailed (failure). Both wrappers route through
//      svc_update_source_status from C1's migration, satisfying the
//      state-machine contract: processing → ready requires non-empty
//      content; processing → failed requires non-empty error.

import { logger } from "@trigger.dev/sdk";
import { python } from "@trigger.dev/python";
import { z } from "zod";
import { uuidSchema } from "@authently/shared";
import { defineTenantTask } from "../lib/tenant-task.ts";
import { parsePythonOutput } from "../services/sources/parse-python-output.ts";
import {
  setSourceStatusFailed,
  setSourceStatusReady,
} from "../services/sources/update-source-status.ts";

const HEAD_TIMEOUT_MS = 5_000;

const SUPPORTED_CONTENT_TYPES = new Set<string>([
  "text/html",
  "application/xhtml+xml",
  "application/pdf",
]);

type HeadResult =
  | { ok: true; contentType: string }
  | { ok: false; error: string };

/**
 * HEAD the URL with a tight timeout. Defensive Content-Type parsing
 * (split on `;`, trim, lowercase) handles `text/html;charset=utf-8`,
 * `Application/PDF`, and absent-header variants. Missing Content-Type
 * is treated as unsupported — conservative default.
 */
async function headAndClassify(sourceUrl: string): Promise<HeadResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    const headResp = await fetch(sourceUrl, {
      method: "HEAD",
      signal: controller.signal,
    });
    if (!headResp.ok) {
      return { ok: false, error: `network: http_${headResp.status}` };
    }
    const rawCt = headResp.headers.get("content-type") ?? "";
    const contentType = (rawCt.split(";")[0] ?? "").trim().toLowerCase();
    if (!contentType) {
      return { ok: false, error: "extraction_failed: missing_content_type" };
    }
    if (!SUPPORTED_CONTENT_TYPES.has(contentType)) {
      return {
        ok: false,
        error: `extraction_failed: unsupported_content_type:${contentType}`,
      };
    }
    return { ok: true, contentType };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "timeout: head_request" };
    }
    const name = err instanceof Error ? err.name : "Unknown";
    return { ok: false, error: `network: head_${name}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Exported separately from the Trigger.dev task definition so tests can
// invoke the body directly with mocked python.runScript + supabase
// without standing up the full Trigger.dev runtime. The task wrapper
// below is a thin adapter.
export type ExtractFromUrlPayload = {
  source_id: string;
  source_url: string;
};

export type ExtractFromUrlResult =
  | { ok: true; source_id: string }
  | { ok: false; source_id: string; error: string };

export async function runExtractFromUrl(
  payload: ExtractFromUrlPayload,
): Promise<ExtractFromUrlResult> {
  const { source_id, source_url } = payload;

  // Step 1+2: HEAD + classify
  const head = await headAndClassify(source_url);
  if (!head.ok) {
    logger.info("extract-from-url: HEAD rejected", {
      source_id,
      error: head.error,
    });
    await setSourceStatusFailed(source_id, head.error);
    return { ok: false, source_id, error: head.error };
  }

  // Step 3: invoke Python
  let pythonResult;
  try {
    pythonResult = await python.runScript(
      "./python/extract_from_url.py",
      [source_url, head.contentType],
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : "Unknown";
    const errorClass = `transient: python_runtime:${name}`;
    logger.error("extract-from-url: python.runScript threw", {
      source_id,
      error: errorClass,
    });
    await setSourceStatusFailed(source_id, errorClass);
    return { ok: false, source_id, error: errorClass };
  }

  // Step 4: parse output
  const parsed = parsePythonOutput(pythonResult);
  if (!parsed.ok) {
    logger.info("extract-from-url: extraction failed", {
      source_id,
      error: parsed.error,
    });
    await setSourceStatusFailed(source_id, parsed.error);
    return { ok: false, source_id, error: parsed.error };
  }

  // Step 5: success path
  await setSourceStatusReady(source_id, parsed.content, parsed.title);
  logger.info("extract-from-url: ready", {
    source_id,
    contentLength: parsed.content.length,
    hasTitle: parsed.title !== null,
  });
  return { ok: true, source_id };
}

export { headAndClassify };

export const extractFromUrlTask = defineTenantTask({
  id: "extract-from-url",
  payloadSchema: z.object({
    source_id: uuidSchema,
    source_url: z.string().url(),
  }),
  run: async (payload) => runExtractFromUrl(payload),
});
