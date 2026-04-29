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

// Lists workspace members with their email + display name. Backed by
// the SECURITY DEFINER `api_list_workspace_members` RPC (migration
// 20260429231411) — auth.users isn't readable through PostgREST under
// RLS, so we route through a function that joins auth.users and
// returns only safe columns. The function gates on
// `private.is_workspace_member(...)`, so a non-member call comes back
// as the empty result without leaking any user identities.

import type { WorkspaceRole } from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";

export type WorkspaceMember = {
  userId: string;
  role: WorkspaceRole;
  email: string | null;
  fullName: string | null;
  joinedAt: string;
};

type RpcRow = {
  user_id: string;
  role: WorkspaceRole;
  email: string | null;
  full_name: string | null;
  joined_at: string;
};

type SupabaseError = { code?: string; message: string };

export async function listWorkspaceMembers(
  supabase: AuthentlyServerClient,
  workspaceSlug: string,
): Promise<WorkspaceMember[]> {
  // supabase-js v2.105 typed-RPC workaround (see SPRINT_02 retro).
  const rpc = await (
    supabase.rpc as unknown as (
      fn: "api_list_workspace_members",
      args: { _workspace_slug: string },
    ) => Promise<{ data: RpcRow[] | null; error: SupabaseError | null }>
  )("api_list_workspace_members", { _workspace_slug: workspaceSlug });

  if (rpc.error) throw new Error(rpc.error.message);

  return (rpc.data ?? []).map((row) => ({
    userId: row.user_id,
    role: row.role,
    email: row.email,
    fullName: row.full_name,
    joinedAt: row.joined_at,
  }));
}
