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

import { AuthError, type WorkspaceRole, type WorkspaceTemplate } from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string | null;
};

export type MembershipSummary = {
  role: WorkspaceRole;
  workspace: {
    id: string;
    name: string;
    slug: string;
    template: WorkspaceTemplate;
    planTier: string;
  };
};

export type CurrentUserWithMemberships = {
  user: CurrentUser;
  memberships: MembershipSummary[];
};

type MembershipRow = {
  role: WorkspaceRole;
  workspace: {
    id: string;
    name: string;
    slug: string;
    template: WorkspaceTemplate;
    plan_tier: string;
  } | null;
};

/**
 * Returns the calling user and the workspaces they're a member of.
 *
 * Auth is established via Supabase's session cookies (handled by the server
 * client). The membership SELECT runs under RLS — the
 * `workspace_members_select` policy filters to rows where
 * `user_id = auth.uid()`, and the joined `workspaces` rows are visible
 * thanks to `workspaces_member_select`. No service-role key is involved.
 */
export async function getCurrentUserWithMemberships(
  supabase: AuthentlyServerClient,
): Promise<CurrentUserWithMemberships> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new AuthError();
  }

  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      "role, workspace:workspaces ( id, name, slug, template, plan_tier )",
    )
    .eq("user_id", user.id)
    .returns<MembershipRow[]>();
  if (error) throw error;

  const memberships: MembershipSummary[] = (data ?? []).flatMap((row) => {
    if (!row.workspace) return [];
    return [
      {
        role: row.role,
        workspace: {
          id: row.workspace.id,
          name: row.workspace.name,
          slug: row.workspace.slug,
          template: row.workspace.template,
          planTier: row.workspace.plan_tier,
        },
      },
    ];
  });

  const fullNameMeta = (user.user_metadata as Record<string, unknown> | null)?.[
    "full_name"
  ];

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      fullName: typeof fullNameMeta === "string" ? fullNameMeta : null,
    },
    memberships,
  };
}
