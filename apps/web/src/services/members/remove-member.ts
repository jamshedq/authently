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

// Removes another member from the workspace. RLS gate:
// `workspace_members_delete` lets owners/admins DELETE other rows in
// their workspaces. The DB trigger `private.prevent_last_owner_loss`
// blocks removing the last owner (raises 23514 / check_violation).
//
// Actor-vs-target rules live in the API service layer (mirroring
// update-member-role.ts):
//   - Admins cannot remove other admins or owners.
//   - Owners can remove any non-owner; owner-vs-owner removal is the
//     ownership transfer flow (Sprint 04 A2).

import {
  AppError,
  ForbiddenError,
  type WorkspaceRole,
} from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";

type Args = {
  workspaceId: string;
  targetUserId: string;
  actorRole: WorkspaceRole;
};

export async function removeMember(
  supabase: AuthentlyServerClient,
  { workspaceId, targetUserId, actorRole }: Args,
): Promise<void> {
  const { data: target, error: lookupError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId)
    .maybeSingle<{ role: WorkspaceRole }>();
  if (lookupError) throw lookupError;
  if (!target) throw new ForbiddenError();

  if (actorRole === "admin") {
    if (target.role === "owner" || target.role === "admin") {
      throw new ForbiddenError();
    }
  } else if (actorRole === "owner") {
    if (target.role === "owner") {
      // Ownership transfer flow (Sprint 04 A2) handles owner removals.
      throw new ForbiddenError();
    }
  } else {
    throw new ForbiddenError();
  }

  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId);
  if (error) {
    if (error.code === "23514") {
      // Last-owner trigger fired. Caller's matrix above shouldn't allow
      // hitting this on owner-removal, but surface defensively.
      throw new AppError({
        code: "LAST_OWNER",
        message: "Cannot remove the last owner of the workspace",
        statusCode: 409,
      });
    }
    throw error;
  }
}
