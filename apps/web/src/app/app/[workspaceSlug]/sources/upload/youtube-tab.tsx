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

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { uploadYoutubeAction } from "./youtube-action";

// Sprint 08 B2 — YouTube upload tab. Mirrors url-tab.tsx shape
// exactly per SPRINT_08.md A3.3 pattern-inheritance lock — text input
// + submit button + server-action invocation. Same <form
// action={handleSubmit}> pattern, same useFormStatus submit button,
// same router.push + router.refresh on success. The only meaningful
// differences from URL tab are: copy ("YouTube video URL" vs "Article
// or PDF URL"), the action handler (uploadYoutubeAction vs
// uploadUrlAction), and client-side domain validation (HTML5 pattern
// attribute as defense-in-depth; the server-side action enforces the
// domain check authoritatively).

type Props = {
  workspaceId: string;
  workspaceSlug: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {pending ? "Submitting…" : "Submit YouTube URL"}
    </button>
  );
}

export function YoutubeTab({ workspaceId, workspaceSlug }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await uploadYoutubeAction(formData);
    if (result.ok) {
      router.push(`/app/${workspaceSlug}/sources`);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4 rounded-md border p-6">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="space-y-2">
        <label htmlFor="sourceUrl" className="text-sm font-medium">
          YouTube video URL
        </label>
        <input
          id="sourceUrl"
          name="sourceUrl"
          type="url"
          required
          // Client-side domain pre-check (defense-in-depth; server-side
          // action enforces authoritatively). Matches youtube.com,
          // youtu.be, m.youtube.com, music.youtube.com.
          pattern="https?://(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)/.*"
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          We&apos;ll download the audio and transcribe it via OpenAI Whisper.
          Single-video URLs only — playlists and channels aren&apos;t supported.
        </p>
      </div>
      <SubmitButton />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
