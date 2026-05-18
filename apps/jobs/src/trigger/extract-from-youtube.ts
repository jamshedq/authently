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

// Sprint 08 B2 — extractFromYoutubeTask. Triggered by
// api_create_source_youtube (via apps/web's createSourceYoutube
// service) after the user submits a YouTube URL via the upload page's
// 4th tab. The task is workspace-scoped via defineTenantTask.
//
// Flow (two-stage subprocess per A4.1 lock):
//   1. Create a fresh temp directory for this run's audio output.
//   2. Invoke apps/jobs/python/extract_from_youtube.py with [url,
//      tmpDir]. The Python script downloads bestaudio[m4a/webm] via
//      yt-dlp and emits {audio_path, title, duration} JSON to stdout.
//   3. Read the audio file's bytes, construct a Node-compatible File
//      (Node 22 global), and hand to @authently/ai/transcription's
//      transcribeAudio (extracted from apps/web in Sprint 08 B0).
//   4. On Whisper success: setSourceStatusReady with transcript +
//      video title (from yt-dlp metadata per A3.5).
//   5. On any failure (Python or Whisper): setSourceStatusFailed with
//      the appropriate prefix from the consolidated YouTube
//      failure-prefix surface.
//   6. Always clean up the temp directory.
//
// Error-prefix flow (per SPRINT_08.md A2.3 + A3.1 consolidated table):
//   - yt-dlp failures (Python side): youtube_unavailable: /
//     youtube_age_restricted: / youtube_invalid_url: / transient:
//   - Whisper failures (transcription service): validation: /
//     openai_rejected: / auth: / transient: / timeout: (inherited
//     unchanged from B1; A4.1 outcome preservation)
//   - python.runScript itself throwing: transient: python_runtime:...
//
// Known limitation (not in scope for B2; carryover candidate if it
// surfaces as a real failure mode): Whisper API has a 25MB file-size
// cap. YouTube audio for videos >~25 minutes at typical bitrates may
// exceed this and surface as `validation: size_exceeded` from the
// transcription service. Workarounds (audio segmentation, lower-
// bitrate format selection, splitting into chunks) are deferred.

import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { logger } from "@trigger.dev/sdk";
import { python } from "@trigger.dev/python";
import { z } from "zod";
import { uuidSchema } from "@authently/shared";
import { transcribeAudio } from "@authently/ai/transcription";
import { defineTenantTask } from "../lib/tenant-task.ts";
import {
  setSourceStatusFailed,
  setSourceStatusReady,
} from "../services/sources/update-source-status.ts";

// MIME type lookup constrained to formats the Python module is allowed
// to emit (m4a / webm only per the format-selector constraint in
// extract_from_youtube.py). Any other extension surfaces as
// `transient: audio_format_unrecognized:...` which is a tighter signal
// than letting the openai-whisper service emit `validation:
// unsupported_format`.
function mimeFromAudioPath(audioPath: string): string | null {
  const lastDot = audioPath.lastIndexOf(".");
  if (lastDot < 0) return null;
  const ext = audioPath.slice(lastDot + 1).toLowerCase();
  switch (ext) {
    case "m4a":
      return "audio/m4a";
    case "webm":
      return "audio/webm";
    default:
      return null;
  }
}

// Parser for the YouTube-specific Python output shape. Different
// contract from parsePythonOutput (which expects {content, title} for
// URL/PDF) — YouTube emits {audio_path, title, duration} on success.
// Inline here rather than extracted because there's only one consumer;
// extract if a second emerges (matches the A5.1 "collapse at the
// layer where duplication actually lives" principle).
type YoutubePythonResult = {
  stdout: string;
  stderr: string;
  exitCode?: number | undefined;
};

type YoutubePythonPayload =
  | {
      ok: true;
      audio_path: string;
      title: string | null;
      duration: number | null;
    }
  | { ok: false; error: string };

function parseYoutubePythonOutput(
  result: YoutubePythonResult,
): YoutubePythonPayload {
  const stdout = result.stdout.trim();
  if (!stdout) {
    const exitMarker =
      typeof result.exitCode === "number" ? result.exitCode : "unknown";
    return {
      ok: false,
      error: `transient: python_no_stdout (exit=${exitMarker})`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, error: `transient: python_invalid_json` };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: `transient: python_invalid_shape` };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj["ok"] === true && typeof obj["audio_path"] === "string") {
    const title = typeof obj["title"] === "string" ? obj["title"] : null;
    const duration =
      typeof obj["duration"] === "number" ? obj["duration"] : null;
    return { ok: true, audio_path: obj["audio_path"], title, duration };
  }
  if (obj["ok"] === false && typeof obj["error"] === "string") {
    return { ok: false, error: obj["error"] };
  }

  return { ok: false, error: `transient: python_invalid_shape` };
}

export type ExtractFromYoutubePayload = {
  source_id: string;
  source_url: string;
};

export type ExtractFromYoutubeResult =
  | { ok: true; source_id: string }
  | { ok: false; source_id: string; error: string };

export async function runExtractFromYoutube(
  payload: ExtractFromYoutubePayload,
): Promise<ExtractFromYoutubeResult> {
  const { source_id, source_url } = payload;

  // Step 1: fresh temp directory for this run's audio output. Cleanup
  // happens in finally below regardless of which path returns.
  const tmpDir = mkdtempSync(join(tmpdir(), `youtube-${source_id}-`));

  try {
    // Step 2: invoke Python (yt-dlp).
    let pythonResult: YoutubePythonResult;
    try {
      pythonResult = await python.runScript(
        "./python/extract_from_youtube.py",
        [source_url, tmpDir],
      );
    } catch (err) {
      const name = err instanceof Error ? err.name : "Unknown";
      const errorClass = `transient: python_runtime:${name}`;
      logger.error("extract-from-youtube: python.runScript threw", {
        source_id,
        error: errorClass,
      });
      await setSourceStatusFailed(source_id, errorClass);
      return { ok: false, source_id, error: errorClass };
    }

    const parsed = parseYoutubePythonOutput(pythonResult);
    if (!parsed.ok) {
      logger.info("extract-from-youtube: python emitted failure", {
        source_id,
        error: parsed.error,
      });
      await setSourceStatusFailed(source_id, parsed.error);
      return { ok: false, source_id, error: parsed.error };
    }

    // Step 3: read audio bytes + construct File.
    const mime = mimeFromAudioPath(parsed.audio_path);
    if (mime === null) {
      const ext = parsed.audio_path.split(".").pop() ?? "<none>";
      const errorClass = `transient: audio_format_unrecognized:${ext}`;
      logger.error("extract-from-youtube: unexpected audio extension", {
        source_id,
        audio_path: parsed.audio_path,
      });
      await setSourceStatusFailed(source_id, errorClass);
      return { ok: false, source_id, error: errorClass };
    }

    let audioBytes: Uint8Array;
    try {
      audioBytes = await readFile(parsed.audio_path);
    } catch (err) {
      const name = err instanceof Error ? err.name : "Unknown";
      const errorClass = `transient: audio_read_failed:${name}`;
      logger.error("extract-from-youtube: readFile threw", {
        source_id,
        audio_path: parsed.audio_path,
        error: errorClass,
      });
      await setSourceStatusFailed(source_id, errorClass);
      return { ok: false, source_id, error: errorClass };
    }

    const fileName = basename(parsed.audio_path);
    // Node 22 has File as a global per web standards. The cast on
    // audioBytes addresses a TS variance false-positive: Buffer
    // extends Uint8Array<ArrayBufferLike>, but BlobPart's BufferSource
    // expects ArrayBuffer-backed views (not ArrayBufferLike, which is
    // ArrayBuffer | SharedArrayBuffer). At runtime, fs/promises.readFile
    // always returns ArrayBuffer-backed buffers (never SharedArrayBuffer),
    // so the cast reflects runtime reality.
    const audioFile = new File(
      [audioBytes as Uint8Array<ArrayBuffer>],
      fileName,
      { type: mime },
    );

    // Step 4: hand to the shared transcription service (B0 extraction;
    // A4.1 outcome preservation — Whisper quality + error
    // classification surface unchanged from B1).
    const transcription = await transcribeAudio({
      file: audioFile,
      fileName,
    });

    if (!transcription.ok) {
      logger.info("extract-from-youtube: transcription failed", {
        source_id,
        error: transcription.error,
      });
      await setSourceStatusFailed(source_id, transcription.error);
      return { ok: false, source_id, error: transcription.error };
    }

    // Step 5: success path.
    await setSourceStatusReady(
      source_id,
      transcription.transcript,
      parsed.title,
    );
    logger.info("extract-from-youtube: ready", {
      source_id,
      contentLength: transcription.transcript.length,
      hasTitle: parsed.title !== null,
      duration: parsed.duration,
    });
    return { ok: true, source_id };
  } finally {
    // Step 6: cleanup. Best-effort; swallow errors (the row is already
    // marked ready/failed by this point, and the temp file will be
    // reaped by the OS eventually even if rm fails).
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn("extract-from-youtube: tmpdir cleanup failed", {
        source_id,
        tmpDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export { parseYoutubePythonOutput, mimeFromAudioPath };

export const extractFromYoutubeTask = defineTenantTask({
  id: "extract-from-youtube",
  // CROSS-REFERENCE: apps/web/src/lib/trigger.ts mirrors this wire
  // schema inline (triggerYoutubeExtraction). If the schema below
  // changes, update the wire payload type in trigger.ts in lockstep.
  // Convention-enforced drift defense per Sprint 07 C2b.3.
  payloadSchema: z.object({
    source_id: uuidSchema,
    source_url: z.string().url(),
  }),
  run: async (payload) => runExtractFromYoutube(payload),
});
