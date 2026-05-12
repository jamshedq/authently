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
import { triggerYoutubeExtraction } from "@/lib/trigger";

// Sprint 08 B2 — service module orchestrating YouTube source creation.
// Mirrors createSourceUrl shape exactly per A5.2 forward-coupling lock
// (ensures B4's eventual collapse to createSource() is a uniform
// "swap createSourceYoutube() for createSource()" change across all
// four action handlers).
//
// Flow:
//   1. Validate input via zod (defense-in-depth; api_create_source_youtube
//      also validates server-side).
//   2. Call api_create_source_youtube RPC → returns source_id, row in
//      'processing' status with type='youtube_transcript' and source_url
//      stored as the original user-pasted URL (per A3.4).
//   3. Trigger extractFromYoutubeTask. On trigger failure, best-effort
//      rollback the row via api_delete_source (matches Sprint 07
//      C2b.2's rollback discipline).
//
// URL validation: client-side + server-side at the action handler
// already performs domain pre-check (per A3.2 — must be youtube.com,
// youtu.be, m.youtube.com, music.youtube.com). The zod schema below
// uses z.string().url() for shape validity only; yt-dlp at extraction
// time is the canonical URL parser for "is this a single video"
// (per A3.1 route (i) lock).

export type CreateSourceYoutubeInput = {
  workspaceId: string;
  sourceUrl: string;
};

export type CreateSourceYoutubeResult =
  | { ok: true; sourceId: string }
  | { ok: false; error: string };

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  sourceUrl: z.string().url(),
});

export async function createSourceYoutube(
  input: CreateSourceYoutubeInput,
): Promise<CreateSourceYoutubeResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "input";
    return { ok: false, error: `validation: ${path}: ${issue?.message}` };
  }

  const sb = await createSupabaseServerClient();

  const { data: sourceId, error: rpcError } = await typedRpc(
    sb,
    "api_create_source_youtube",
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

  try {
    await triggerYoutubeExtraction(
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
      return {
        ok: false,
        error: `trigger_failed_rollback_failed: ${triggerMsg} | rollback: ${rollback.error.message}`,
      };
    }
    return { ok: false, error: `trigger_failed: ${triggerMsg}` };
  }

  return { ok: true, sourceId };
}
