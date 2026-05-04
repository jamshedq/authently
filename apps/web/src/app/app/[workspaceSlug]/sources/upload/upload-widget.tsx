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

"use client";

import Link from "next/link";
import { useReducer, useRef } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Loader2 } from "lucide-react";
import { transcribeAndSave } from "./actions";

// Sprint 06 B5 — file upload widget. State machine via useReducer with
// discriminated union states (idle, validating, transcribing, success,
// error). HTML5 drag-and-drop, no library. Spinner via lucide-react
// Loader2 + animate-spin. Error copy keyed off B1's prefix-encoded
// error classification.
//
// The validation here is the CLIENT-SIDE half of B1-Q4's both-side
// validation. The server action re-validates on receipt; this exists
// for instant UX feedback before the upload starts.

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
]);

type State =
  | { status: "idle" }
  | { status: "validating"; file: File }
  | { status: "transcribing"; file: File }
  | { status: "success"; sourceId: string; transcript: string; fileName: string }
  | { status: "error"; message: string; fileName: string | null };

type Action =
  | { type: "FILE_PICKED"; file: File }
  | { type: "VALIDATION_PASSED" }
  | { type: "TRANSCRIPTION_OK"; sourceId: string; transcript: string }
  | { type: "FAILED"; message: string }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "FILE_PICKED":
      return { status: "validating", file: action.file };
    case "VALIDATION_PASSED":
      if (state.status !== "validating") return state;
      return { status: "transcribing", file: state.file };
    case "TRANSCRIPTION_OK":
      if (state.status !== "transcribing") return state;
      return {
        status: "success",
        sourceId: action.sourceId,
        transcript: action.transcript,
        fileName: state.file.name,
      };
    case "FAILED": {
      const fileName =
        state.status === "validating" ||
        state.status === "transcribing"
        ? state.file.name
        : null;
      return { status: "error", message: action.message, fileName };
    }
    case "RESET":
      return { status: "idle" };
  }
}

// User-facing error copy. Locked at B5 pre-flight Q8. Keys off B1's
// prefix-encoded error class. Auth-class copy intentionally avoids
// "temporarily unavailable" — auth failures need operator
// intervention, not user-side patience.
function userMessageForError(error: string): string {
  if (error.startsWith("validation: size_exceeded")) {
    return "File is too large. Maximum size is 25 MB.";
  }
  if (error.startsWith("validation: unsupported_format")) {
    return "Unsupported audio format. Use MP3, M4A, WAV, or WebM.";
  }
  if (error.startsWith("validation:")) {
    // Catch-all for any future validation: subclass.
    return "Couldn't process this file. Check the format and size.";
  }
  if (error.startsWith("openai_rejected:")) {
    return "Couldn't process this file. Try another or check the format.";
  }
  if (error.startsWith("transient:")) {
    return "Something went wrong. Try again in a moment.";
  }
  if (error.startsWith("auth:")) {
    return "Transcription service is currently unavailable. We're looking into it.";
  }
  if (error.startsWith("timeout:")) {
    return "Transcription took too long. Try a shorter file or try again.";
  }
  if (error.startsWith("save_failed:")) {
    return "Transcription succeeded but saving failed. Try again.";
  }
  return "Something went wrong. Try again in a moment.";
}

type ValidationFailure = { ok: false; message: string };
type ValidationSuccess = { ok: true };

function validateFile(file: File): ValidationFailure | ValidationSuccess {
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      message: userMessageForError("validation: size_exceeded"),
    };
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      message: userMessageForError("validation: unsupported_format"),
    };
  }
  return { ok: true };
}

export type UploadWidgetProps = {
  workspaceId: string;
  workspaceSlug: string;
};

export function UploadWidget({
  workspaceId,
  workspaceSlug,
}: UploadWidgetProps) {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File): Promise<void> {
    dispatch({ type: "FILE_PICKED", file });

    const validation = validateFile(file);
    if (!validation.ok) {
      dispatch({ type: "FAILED", message: validation.message });
      return;
    }
    dispatch({ type: "VALIDATION_PASSED" });

    const formData = new FormData();
    formData.set("file", file);
    formData.set("workspaceId", workspaceId);

    const result = await transcribeAndSave(formData);
    if (!result.ok) {
      dispatch({
        type: "FAILED",
        message: userMessageForError(result.error),
      });
      return;
    }
    dispatch({
      type: "TRANSCRIPTION_OK",
      sourceId: result.sourceId,
      transcript: result.transcript,
    });
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    void handleFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void handleFile(file);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
  }

  const isBusy =
    state.status === "validating" || state.status === "transcribing";

  if (state.status === "success") {
    return (
      <div className="rounded-md border bg-card p-6">
        <h2 className="text-lg font-medium">Saved!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Transcribed and saved <span className="font-medium">{state.fileName}</span>.
        </p>
        <div className="mt-4 max-h-64 overflow-y-auto rounded-md bg-muted p-4 text-sm">
          {state.transcript}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => dispatch({ type: "RESET" })}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            Save another
          </button>
          <span className="text-muted-foreground">·</span>
          <Link
            href={`/app/${workspaceSlug}/dashboard`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        className="rounded-md border-2 border-dashed border-muted-foreground/30 p-10 text-center transition-colors hover:border-muted-foreground/60"
        aria-busy={isBusy}
      >
        {isBusy ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {state.status === "validating"
                ? "Validating file..."
                : "Transcribing... this can take up to a minute."}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Drag and drop an audio file here, or
            </p>
            <label
              htmlFor="upload-input"
              className="mt-3 inline-block cursor-pointer rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Choose a file
            </label>
            <input
              id="upload-input"
              ref={inputRef}
              type="file"
              accept="audio/*"
              onChange={onInputChange}
              className="sr-only"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              MP3, M4A, WAV, or WebM. Max 25 MB.
            </p>
          </>
        )}
      </div>

      {state.status === "error" ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p className="font-medium">{state.message}</p>
          <button
            type="button"
            onClick={() => dispatch({ type: "RESET" })}
            className="mt-2 text-xs font-medium underline-offset-4 hover:underline"
          >
            Try another file
          </button>
        </div>
      ) : null}
    </div>
  );
}
