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

// Role-change rules (per Sprint 02 spec):
//   - Owners can change any non-owner role to admin / editor / viewer.
//   - Admins can ONLY change editor ↔ viewer. They cannot touch other
//     admins, cannot promote to admin, and cannot touch owners.
//   - Editor / viewer cannot change roles at all (gated at the API
//     layer via withMembership({ requireRole: ['owner', 'admin'] })).
//   - Owner role assignment is reserved for the Sprint 03 transfer
//     flow; the zod AssignableMemberRoleSchema disallows 'owner'.
//
// This service applies the actor-role gate before mutating. The DB-side
// `private.prevent_last_owner_loss` trigger guards against demoting the
// last owner; that doesn't fire here because the actor can't promote-to
// or demote-from owner from this surface, but it stays in place as the
// independent floor.

import { ForbiddenError, type WorkspaceRole } from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";
import { typedUpdate } from "@/lib/supabase/typed-update";
import type { AssignableMemberRole } from "@/lib/schemas/members";

type Args = {
  workspaceId: string;
  targetUserId: string;
  newRole: AssignableMemberRole;
  actorRole: WorkspaceRole;
};

export async function updateMemberRole(
  supabase: AuthentlyServerClient,
  { workspaceId, targetUserId, newRole, actorRole }: Args,
): Promise<void> {
  // Look up the target's current role so we can enforce the actor-role
  // matrix. RLS lets the actor read their co-members.
  const { data: target, error: lookupError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId)
    .maybeSingle<{ role: WorkspaceRole }>();
  if (lookupError) throw lookupError;
  if (!target) throw new ForbiddenError();

  if (actorRole === "admin") {
    // Admins can ONLY change editor ↔ viewer. No promote-to-admin, no
    // touching other admins, no touching owners.
    if (target.role === "owner" || target.role === "admin") {
      throw new ForbiddenError();
    }
    if (newRole === "admin") {
      throw new ForbiddenError();
    }
  } else if (actorRole === "owner") {
    // Owners can re-assign any non-owner role; promoting/demoting
    // owners themselves is the Sprint 03 transfer flow. Block here.
    if (target.role === "owner") {
      throw new ForbiddenError();
    }
  } else {
    // Editor / viewer never reach this path — withMembership requireRole
    // already rejected them. Defensive:
    throw new ForbiddenError();
  }

  const { error } = await typedUpdate(supabase, "workspace_members", {
    role: newRole,
  })
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId);
  if (error) throw error;
}
