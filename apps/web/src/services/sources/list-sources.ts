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

import type { Tables } from "@authently/db";
import type { AuthentlyServerClient } from "@/lib/supabase/server";

// Sprint 07 C3.1 — list sources for a workspace. RLS-scoped SELECT
// against the `sources` table, ordered by created_at DESC, filtered to
// non-soft-deleted rows. Per spec (E5 lock + Commit 3 description):
// `ORDER BY created_at DESC`, `WHERE deleted_at IS NULL` (RLS already
// filters but the explicit query filter is defense-in-depth and matches
// the existing `sources_select` policy predicate).
//
// Pass the request-scoped server client so the SELECT runs with the
// user's `auth.uid()`. Do NOT call this with a service-role client —
// that would silently bypass RLS and defeat the workspace-scoping. The
// `sources_select` RLS policy from Sprint 06 hides rows from non-members.

type SourcesRow = Pick<
  Tables<"sources">,
  "id" | "title" | "type" | "status" | "error" | "source_url" | "created_at"
>;

export type SourceStatus = "processing" | "ready" | "failed";
export type SourceType =
  | "audio_transcript"
  | "url_extraction"
  | "pdf_extraction";

export type SourceListRow = {
  id: string;
  title: string | null;
  type: SourceType;
  status: SourceStatus;
  error: string | null;
  source_url: string | null;
  created_at: string;
};

export async function listSources(
  supabase: AuthentlyServerClient,
  workspaceId: string,
): Promise<SourceListRow[]> {
  const { data, error } = await supabase
    .from("sources")
    .select("id, title, type, status, error, source_url, created_at")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<SourcesRow[]>();

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    // The DB CHECK constraints guarantee the values; the generated row
    // type is `string` because supabase's type generator doesn't surface
    // CHECK constraints. Cast at the trust boundary.
    type: row.type as SourceType,
    status: row.status as SourceStatus,
    error: row.error,
    source_url: row.source_url,
    created_at: row.created_at,
  }));
}
