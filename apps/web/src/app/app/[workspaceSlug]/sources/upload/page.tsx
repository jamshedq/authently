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

import { requireMembership } from "@/lib/api/require-membership";
import { UploadTabs } from "./upload-tabs";

export const dynamic = "force-dynamic";

// Vercel Pro plan supports up to 300s server-action timeouts. Whisper
// transcription for files near the 25MB cap takes 1-3 minutes; this
// budget covers the worst case + the small overhead of the
// api_create_source_audio RPC call. Hobby plan max is 60s; Sprint 06
// requires Pro per the locked B1 pre-flight. Lives on the route
// segment (page.tsx), not the server-action file — Next.js's
// "use server" directive forbids non-async-function exports.
//
// Sprint 07 C4 extends the page from audio-only to tabbed (Audio |
// URL | PDF) via the UploadTabs client component. The maxDuration
// covers the audio sync flow's worst case; URL/PDF flows return
// immediately with a sourceId (status='processing') and the heavy
// extraction work happens in Trigger.dev tasks, well outside the
// server-action budget.
export const maxDuration = 300;

type Props = {
  params: Promise<{ workspaceSlug: string }>;
};

// Sprint 06 B5 + Sprint 07 C4 — sources upload page. Server-component
// shell that asserts workspace membership (any role) and mounts the
// tabbed upload client component. Audio tab preserves Sprint 06
// behavior unchanged; URL and PDF tabs are async source-creation flows
// added in Sprint 07.
export default async function UploadPage({ params }: Props) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMembership(workspaceSlug);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Upload a source</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Add a source from audio, a URL, or a PDF. Audio is transcribed
        synchronously; URLs and PDFs are processed in the background and
        will appear in your sources list once ready.
      </p>
      <div className="mt-6">
        <UploadTabs
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
        />
      </div>
    </main>
  );
}
