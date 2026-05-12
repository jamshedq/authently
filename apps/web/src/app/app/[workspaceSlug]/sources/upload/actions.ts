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

"use server";

import { transcribeAudio } from "@authently/ai/transcription";
import { createSourceAudio } from "@/services/sources/create-source-audio";
import type { TranscribeAndSaveResult } from "./types";

export async function transcribeAndSave(
  formData: FormData,
): Promise<TranscribeAndSaveResult> {
  const file = formData.get("file");
  const workspaceId = formData.get("workspaceId");

  if (!(file instanceof File)) {
    return { ok: false, error: "validation: file_missing" };
  }
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { ok: false, error: "validation: workspace_id_missing" };
  }

  // Step 1: transcribe via OpenAI Whisper (B1).
  const transcribeResult = await transcribeAudio({
    file,
    fileName: file.name,
  });
  if (!transcribeResult.ok) {
    // Pass B1's prefix-encoded error through unchanged. The widget
    // switches on the prefix to render user-facing copy.
    return { ok: false, error: transcribeResult.error };
  }

  // Step 2: persist via api_create_source_audio (B5).
  const saveResult = await createSourceAudio({
    workspaceId,
    content: transcribeResult.transcript,
  });
  if (!saveResult.ok) {
    return { ok: false, error: `save_failed: ${saveResult.error}` };
  }

  return {
    ok: true,
    sourceId: saveResult.sourceId,
    transcript: transcribeResult.transcript,
  };
}
