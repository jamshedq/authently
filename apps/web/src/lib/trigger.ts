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

import { tasks } from "@trigger.dev/sdk";

// Sprint 07 C2b.2 — Trigger.dev client wrapper for apps/web. Typed
// triggering of the C2a tasks (extract-from-url, extract-from-pdf) from
// the apps/web service-action layer.
//
// === Wire payload contract (source of truth) ===
//
// Verified against apps/jobs/src/lib/tenant-task.ts (defineTenantTask
// schema-merge at lines 68-71) + apps/jobs/README.md:65-69 example +
// the @trigger.dev/sdk schemaTask source (createSchemaTask in
// node_modules/@trigger.dev/sdk/dist/esm/v3/shared.js calls
// `getSchemaParseFn(params.schema)` which validates the wire payload
// against the merged schema). defineTenantTask MERGES `workspace_id`
// into the wire schema, so the payload validated by tasks.trigger() is:
//
//   extract-from-url:  { workspace_id, source_id, source_url }
//   extract-from-pdf:  { workspace_id, source_id }
//
// Storage path for PDFs is computed deterministically from
// (workspace_id, source_id) by both apps/web and apps/jobs's
// extractFromPdfTask — NOT passed in the payload (the
// "computed-not-passed" pattern locked at C2a). `workspace_id` is
// "required-at-wire" because defineTenantTask validates membership
// before the task body runs.
//
// Source files (cross-package; types defined inline here rather than
// imported across the apps/jobs↔apps/web boundary to keep the wire
// contract self-contained — apps/jobs is the source of truth and
// any change there should propagate to this file):
//   apps/jobs/src/trigger/extract-from-url.ts (extractFromUrlTask)
//   apps/jobs/src/trigger/extract-from-pdf.ts (extractFromPdfTask)
//   apps/jobs/src/lib/tenant-task.ts          (defineTenantTask merge)
//
// === SDK error semantics (verified at C2b.2 Checkpoint 3) ===
//
// `tasks.trigger()` throws on:
//   1. apiClientManager.clientOrThrow — no TRIGGER_SECRET_KEY configured
//   2. getSchemaParseFn(payload) — payload doesn't match merged schema
//   3. apiClient.triggerTask — network/auth/quota/server failure
//
// All three propagate via thrown Error to the service module's
// try/catch, which fires the best-effort row rollback per the C2b.2
// rollback discipline (trigger-failure → roll back row; PDF Storage
// orphan accepted per E6d-Storage; rollback is frequency-reduction not
// guarantee).

type ExtractFromUrlWirePayload = {
  workspace_id: string;
  source_id: string;
  source_url: string;
};

type ExtractFromPdfWirePayload = {
  workspace_id: string;
  source_id: string;
};

export type TriggerHandle = {
  id: string;
};

/**
 * Trigger the URL-extraction task for a newly created url_extraction
 * source row. Wire payload: { workspace_id, source_id, source_url }.
 * Throws on any SDK failure; caller handles via try/catch + rollback.
 */
export async function triggerUrlExtraction(
  workspaceId: string,
  sourceId: string,
  sourceUrl: string,
): Promise<TriggerHandle> {
  const payload: ExtractFromUrlWirePayload = {
    workspace_id: workspaceId,
    source_id: sourceId,
    source_url: sourceUrl,
  };
  const handle = await tasks.trigger("extract-from-url", payload);
  return { id: handle.id };
}

/**
 * Trigger the PDF-extraction task for a newly created pdf_extraction
 * source row. The PDF bytes must already exist at
 * `ws/{workspaceId}/{sourceId}.pdf` in the `sources-pdf` bucket — the
 * task fetches via signed URL using the same deterministic path. Wire
 * payload: { workspace_id, source_id }. Throws on any SDK failure.
 */
export async function triggerPdfExtraction(
  workspaceId: string,
  sourceId: string,
): Promise<TriggerHandle> {
  const payload: ExtractFromPdfWirePayload = {
    workspace_id: workspaceId,
    source_id: sourceId,
  };
  const handle = await tasks.trigger("extract-from-pdf", payload);
  return { id: handle.id };
}

// Sprint 08 B2 — YouTube extraction task wire payload + trigger wrapper.
// Same { workspace_id, source_id, source_url } shape as extract-from-url
// because both tasks operate on a user-pasted URL; the workspace_id is
// merged in by defineTenantTask at apps/jobs/src/lib/tenant-task.ts.
type ExtractFromYoutubeWirePayload = {
  workspace_id: string;
  source_id: string;
  source_url: string;
};

/**
 * Trigger the YouTube-extraction task for a newly created
 * youtube_transcript source row. The task downloads audio via yt-dlp
 * (apps/jobs/python/extract_from_youtube.py) and hands the bytes to
 * @authently/ai/transcription for Whisper transcription. Wire payload:
 * { workspace_id, source_id, source_url }. Throws on any SDK failure.
 */
export async function triggerYoutubeExtraction(
  workspaceId: string,
  sourceId: string,
  sourceUrl: string,
): Promise<TriggerHandle> {
  const payload: ExtractFromYoutubeWirePayload = {
    workspace_id: workspaceId,
    source_id: sourceId,
    source_url: sourceUrl,
  };
  const handle = await tasks.trigger("extract-from-youtube", payload);
  return { id: handle.id };
}
