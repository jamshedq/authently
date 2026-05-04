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
import { UploadWidget } from "./upload-widget";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ workspaceSlug: string }>;
};

// Sprint 06 B5 — file upload page. Server-component shell that asserts
// workspace membership (any role) and mounts the client widget.
export default async function UploadPage({ params }: Props) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMembership(workspaceSlug);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Upload audio source</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Upload a short audio file (under 25 MB, up to ~25 minutes) to
        transcribe and save as a source.
      </p>
      <div className="mt-6">
        <UploadWidget
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
        />
      </div>
    </main>
  );
}
