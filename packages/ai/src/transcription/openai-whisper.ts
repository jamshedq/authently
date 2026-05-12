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

import OpenAI from "openai";
import { getOpenAIClient } from "./openai-client.ts";

// Sprint 06 B1 — OpenAI Whisper transcription service.
//
// Synchronous server-side transcription of short audio files (≤25MB,
// per OpenAI Whisper API's file-endpoint cap). Called by B5's server
// action; B1 ships this service with no production caller until B5
// lands (stub-then-caller pattern from Sprint 05 A1/A2).
//
// Result shape: prefix-encoded for UI consumption.
//   - `{ ok: true, transcript, duration? }` on success
//   - `{ ok: false, error: "<class>: <reason>" }` on failure
// Error classes: validation / openai_rejected / transient / auth /
// timeout. Sync execution → no automatic retry; classification exists
// for UX (B5 surfaces user-friendly messages keyed off the prefix).
//
// Model: `whisper-1`. Current and stable per the OpenAI API as of
// 2026-05. Future bump candidates (whisper-2, etc.) are a low-stakes
// upgrade — change this constant and re-test.

const WHISPER_MODEL = "whisper-1";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
]);

export type TranscribeAudioInput = {
  file: File;
  fileName: string;
};

export type TranscribeAudioResult =
  | { ok: true; transcript: string; duration?: number }
  | { ok: false; error: string };

export async function transcribeAudio(
  input: TranscribeAudioInput,
): Promise<TranscribeAudioResult> {
  const { file, fileName } = input;

  // Server-side revalidation. Client-side does the same checks for
  // instant feedback; server-side enforces them as defense in depth.
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `validation: size_exceeded (file is ${file.size} bytes, max ${MAX_FILE_BYTES})`,
    };
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      error: `validation: unsupported_format (got ${file.type || "<empty>"})`,
    };
  }

  const client = getOpenAIClient();

  try {
    const result = await client.audio.transcriptions.create({
      file,
      model: WHISPER_MODEL,
    });

    return {
      ok: true,
      transcript: result.text,
      ...("duration" in result && typeof result.duration === "number"
        ? { duration: result.duration }
        : {}),
    };
  } catch (err) {
    return classifyOpenAIError(err, fileName);
  }
}

function classifyOpenAIError(
  err: unknown,
  fileName: string,
): { ok: false; error: string } {
  // Connection timeout — checked before APIConnectionError because
  // the timeout class extends the connection class in stripe-node-
  // style hierarchies; checking the more specific class first.
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return { ok: false, error: `timeout: ${err.message}` };
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return { ok: false, error: `auth: ${err.message}` };
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    // 403 from OpenAI is consistently key/org access — operator-fixable,
    // routes to auth: alongside 401. Locked at B1 pre-flight Q5.
    return { ok: false, error: `auth: ${err.message}` };
  }
  if (err instanceof OpenAI.RateLimitError) {
    return { ok: false, error: `transient: ${err.message}` };
  }
  if (err instanceof OpenAI.InternalServerError) {
    return { ok: false, error: `transient: ${err.message}` };
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return { ok: false, error: `transient: ${err.message}` };
  }
  if (
    err instanceof OpenAI.BadRequestError ||
    err instanceof OpenAI.NotFoundError ||
    err instanceof OpenAI.UnprocessableEntityError
  ) {
    return {
      ok: false,
      error: `openai_rejected: ${err.message}`,
    };
  }
  // Catch-all for any other APIError subclass we don't explicitly
  // map. Treat as openai_rejected — the request reached OpenAI and
  // came back with an error; it's not a network/auth/timeout class.
  if (err instanceof OpenAI.APIError) {
    return { ok: false, error: `openai_rejected: ${err.message}` };
  }
  // Non-API errors (programmer error, unexpected throw). Treat as
  // transient so the UI offers retry; logs surface the underlying
  // shape via fileName context.
  void fileName;
  return {
    ok: false,
    error: `transient: ${err instanceof Error ? err.message : String(err)}`,
  };
}
