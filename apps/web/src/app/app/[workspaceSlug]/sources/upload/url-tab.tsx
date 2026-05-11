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
import { uploadUrlAction } from "./url-action";

// Sprint 07 C4 — URL upload tab. Text input + submit button. Submits
// to the existing uploadUrlAction (shipped C2b.2), which returns a
// discriminated union {ok, sourceId} | {ok: false, error}. On success
// the tab redirects to the sources list page; polling there drives
// the row through processing → ready/failed.

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
      {pending ? "Submitting…" : "Submit URL"}
    </button>
  );
}

export function UrlTab({ workspaceId, workspaceSlug }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await uploadUrlAction(formData);
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
          Article or PDF URL
        </label>
        <input
          id="sourceUrl"
          name="sourceUrl"
          type="url"
          required
          placeholder="https://example.com/article"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          We&apos;ll extract the article content (HTML) or PDF text and save it as a source.
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
