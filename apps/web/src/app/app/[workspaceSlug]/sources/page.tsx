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

// /app/[workspaceSlug]/sources — Sprint 07 C3.1 list page baseline.
//
// Server component shell:
//   1. requireMembership(workspaceSlug) — auth + membership gate. Returns
//      { supabase, workspace, ... } or redirects to /login or /app.
//   2. listSources(supabase, workspace.id) — RLS-scoped SELECT, ordered
//      by created_at DESC, deleted_at IS NULL filter.
//   3. <SourcesList rows={rows} workspaceSlug={...} /> — renders list or
//      empty state internally (empty-state branch lives in SourcesList
//      per C3.1 Checkpoint 0 lock).
//
// C3.2 will add `setInterval` polling on the client component side
// (no change here). C3.3 will add delete UI and failed-row error
// display.

import { requireMembership } from "@/lib/api/require-membership";
import { listSources } from "@/services/sources/list-sources";
import { SourcesList } from "./sources-list";

export const dynamic = "force-dynamic";

export default async function SourcesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { supabase, workspace } = await requireMembership(workspaceSlug);
  const rows = await listSources(supabase, workspace.id);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Sources</h1>
      </header>
      <SourcesList rows={rows} workspaceSlug={workspaceSlug} />
    </main>
  );
}
