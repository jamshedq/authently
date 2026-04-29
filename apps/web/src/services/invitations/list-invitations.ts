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

// Pending invitations for a workspace. RLS-gated by
// `invitations_member_select` — any workspace member can list.
// Mutation buttons in the UI are gated by role at the component layer.

import type { AuthentlyServerClient } from "@/lib/supabase/server";

export type PendingInvitation = {
  id: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  expiresAt: string;
  createdAt: string;
};

type Row = {
  id: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  expires_at: string;
  created_at: string;
};

export async function listPendingInvitations(
  supabase: AuthentlyServerClient,
  workspaceId: string,
): Promise<PendingInvitation[]> {
  const { data, error } = await supabase
    .from("workspace_invitations")
    .select("id, email, role, expires_at, created_at")
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .returns<Row[]>();

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}
