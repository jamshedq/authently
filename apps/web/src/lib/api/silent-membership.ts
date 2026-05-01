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

import type { User } from "@supabase/supabase-js";
import type { WorkspaceRole } from "@authently/shared";
import {
  createSupabaseServerClient,
  type AuthentlyServerClient,
} from "@/lib/supabase/server";
import {
  getWorkspaceBySlug,
  type WorkspaceForDashboard,
} from "@/services/workspaces/get-workspace-by-slug";

export type SilentMembershipResult = {
  supabase: AuthentlyServerClient;
  user: User;
  workspace: WorkspaceForDashboard;
  role: WorkspaceRole;
};

/**
 * Variant of `requireMembership` that returns null on missing-auth /
 * missing-membership instead of redirecting. Designed for use inside
 * the workspace layout (and other infrastructure components like the
 * past-due banner) where a redirect from the layout would short-circuit
 * the leaf page's own auth gate — including the redirect logic in
 * `requireMembership` that knows where to send unauth/non-member users.
 *
 * Returns null in three cases:
 *   1. No authenticated user.
 *   2. Workspace not visible to the caller (RLS collapses).
 *   3. Caller is not a member of the workspace.
 *
 * The leaf page is still responsible for actual gating; this helper just
 * lets layout-level components silently skip rendering when there's no
 * legitimate caller context.
 */
export async function silentMembershipLookup(
  slug: string,
): Promise<SilentMembershipResult | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const workspace = await getWorkspaceBySlug(supabase, slug);
  if (!workspace) return null;

  const { data: membership, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle<{ role: WorkspaceRole }>();
  if (error) return null;
  if (!membership) return null;

  return { supabase, user, workspace, role: membership.role };
}
