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

type WorkspaceRow = Pick<
  Tables<"workspaces">,
  "id" | "name" | "slug" | "template" | "plan_tier"
>;

export type WorkspaceForDashboard = {
  id: string;
  name: string;
  slug: string;
  template: "creator" | "smb" | "community";
  planTier: string;
};

/**
 * Look up a workspace by slug as the calling user. RLS-gated by
 * `workspaces_member_select`, so:
 *   - workspace exists AND user is a member  → returns the row
 *   - workspace exists AND user is NOT a member → returns null
 *   - workspace does not exist                  → returns null
 *
 * Both no-access and not-exists collapse to `null` on purpose; surfacing
 * different errors would leak the existence of workspaces the caller
 * doesn't belong to.
 *
 * Pass the request-scoped server client so the SELECT runs with the user's
 * `auth.uid()`. Do NOT call this with a service-role client — that would
 * silently bypass RLS and defeat the access check.
 */
export async function getWorkspaceBySlug(
  supabase: AuthentlyServerClient,
  slug: string,
): Promise<WorkspaceForDashboard | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, slug, template, plan_tier")
    .eq("slug", slug)
    .maybeSingle<WorkspaceRow>();

  if (error) {
    // Real DB / network failure (not "row hidden by RLS"). Let the caller
    // decide how to surface this; the dashboard route renders its error UI.
    throw error;
  }

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    // The DB CHECK constraint guarantees the value is one of the three
    // template names; the generated row type is `string` because Postgres
    // doesn't surface CHECK constraints to supabase's type generator.
    template: data.template as WorkspaceForDashboard["template"],
    planTier: data.plan_tier,
  };
}
