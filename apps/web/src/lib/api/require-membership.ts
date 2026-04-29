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

import { redirect } from "next/navigation";
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

export type RequireMembershipResult = {
  supabase: AuthentlyServerClient;
  user: User;
  workspace: WorkspaceForDashboard;
  role: WorkspaceRole;
};

export type RequireMembershipOptions = {
  /** If set, the role list a user must be in. Otherwise any member passes. */
  roles?: readonly WorkspaceRole[];
};

/**
 * Page-level mirror of `withMembership`. Designed for Server Components —
 * on auth/membership/role failure it calls `redirect()` rather than
 * throwing structured errors (Server Components have no error envelope).
 *
 * Failure routing (mirrors withMembership semantics — 404-vs-403 collapses
 * are preserved so we never leak existence of workspaces the caller can't
 * see):
 *   - Unauthenticated                     → /login
 *   - Authenticated, not a member         → /app  (the workspace switcher
 *     surface; sends them to one they DO own)
 *   - Authenticated, member, wrong role   → /app/{slug}/dashboard  (drops
 *     them at the most-permissive page in the same workspace)
 *
 * The redirect to /app/{slug}/dashboard uses the SAME slug they tried to
 * reach, not a "primary" workspace, so a viewer who wandered into the
 * settings URL ends up exactly where they should be — looking at the
 * workspace they're a member of, just not its admin pane.
 */
export async function requireMembership(
  slug: string,
  options: RequireMembershipOptions = {},
): Promise<RequireMembershipResult> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const workspace = await getWorkspaceBySlug(supabase, slug);
  if (!workspace) {
    // Not a member (or workspace doesn't exist — RLS collapses both).
    redirect("/app");
  }

  const { data: membership, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle<{ role: WorkspaceRole }>();
  if (error) throw error;
  if (!membership) {
    redirect("/app");
  }

  if (options.roles && !options.roles.includes(membership.role)) {
    // Member, but not in the role gate. Send them to a page they CAN see
    // in the same workspace.
    redirect(`/app/${workspace.slug}/dashboard`);
  }

  return { supabase, user, workspace, role: membership.role };
}
