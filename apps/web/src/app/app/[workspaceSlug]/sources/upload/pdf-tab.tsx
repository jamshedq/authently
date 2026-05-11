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

import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { uploadPdfAction } from "./pdf-action";

// Sprint 07 C4 — PDF upload tab. Drag-and-drop + click-to-browse,
// mirroring the upload-widget.tsx audio pattern (onDrop / onDragOver
// handlers, hidden file input + label, MIME + size validation
// client-side as defense-in-depth — the server action re-validates).
//
// PDF flow differs from audio in two ways:
//   1. Async on the backend (returns sourceId immediately, processing
//      happens in Trigger.dev). The tab redirects to the list page on
//      success rather than displaying a synchronous transcript.
//   2. Server action requires a `title` (per pdf-action.ts:44 — title
//      validation is required-not-optional). Auto-derived from filename
//      with the .pdf extension stripped; user can edit before submit.

const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MiB — matches MAX_PDF_BYTES in create-source-pdf.ts:54

type Props = {
  workspaceId: string;
  workspaceSlug: string;
};

export function PdfTab({ workspaceId, workspaceSlug }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function selectFile(picked: File): void {
    setError(null);
    if (picked.type !== "application/pdf") {
      setError("File must be a PDF.");
      return;
    }
    if (picked.size > MAX_PDF_BYTES) {
      setError("File exceeds 50 MB limit.");
      return;
    }
    setFile(picked);
    if (title === "") {
      setTitle(picked.name.replace(/\.pdf$/i, ""));
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const picked = event.target.files?.[0];
    if (picked) selectFile(picked);
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const picked = event.dataTransfer.files?.[0];
    if (picked) selectFile(picked);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
  }

  async function handleSubmit(): Promise<void> {
    if (!file || title.trim() === "") return;
    setError(null);
    setIsPending(true);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("workspaceId", workspaceId);
    formData.set("title", title.trim());

    const result = await uploadPdfAction(formData);

    if (result.ok) {
      router.push(`/app/${workspaceSlug}/sources`);
      router.refresh();
    } else {
      setError(result.error);
      setIsPending(false);
    }
  }

  const canSubmit = !!file && title.trim() !== "" && !isPending;

  return (
    <div className="space-y-4">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        className="rounded-md border-2 border-dashed border-muted-foreground/30 p-10 text-center transition-colors hover:border-muted-foreground/60"
      >
        {isPending ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Uploading…</p>
          </div>
        ) : file ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setTitle("");
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="text-sm underline-offset-4 hover:underline"
            >
              Choose a different file
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Drag a PDF here, or
            </p>
            <label
              htmlFor="pdf-upload-input"
              className="mt-3 inline-block cursor-pointer rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Choose a file
            </label>
            <p className="mt-3 text-xs text-muted-foreground">
              PDF only · up to 50 MB
            </p>
          </>
        )}
        <input
          id="pdf-upload-input"
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={onInputChange}
          className="sr-only"
        />
      </div>

      {file ? (
        <div className="space-y-2">
          <label htmlFor="pdf-title" className="text-sm font-medium">
            Title
          </label>
          <input
            id="pdf-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isPending ? "Uploading…" : "Upload PDF"}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
