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

// PATCH /api/ws/[workspaceSlug]/members/[userId] — change a member's role
// DELETE /api/ws/[workspaceSlug]/members/[userId] — remove a member
//
// Both gated to owner/admin via withMembership requireRole. The
// finer actor-vs-target matrix (admins can only touch editor/viewer;
// owner removal goes through the ownership-transfer flow at
// /api/ws/[slug]/ownership-transfer — Sprint 04 A2 — not this DELETE)
// lives in the service layer. The DB last-owner trigger guards
// regardless.

import { NextResponse } from "next/server";
import { withMembership } from "@/lib/api/with-membership";
import { UpdateMemberRoleSchema } from "@/lib/schemas/members";
import { removeMember } from "@/services/members/remove-member";
import { updateMemberRole } from "@/services/members/update-member-role";

export const PATCH = withMembership<{ userId: string }>(
  async ({ request, supabase, workspace, role, params }) => {
    const body = await request.json().catch(() => ({}));
    const parsed = UpdateMemberRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    await updateMemberRole(supabase, {
      workspaceId: workspace.id,
      targetUserId: params.userId,
      newRole: parsed.data.role,
      actorRole: role,
    });
    return NextResponse.json({ ok: true });
  },
  { requireRole: ["owner", "admin"] },
);

export const DELETE = withMembership<{ userId: string }>(
  async ({ supabase, workspace, role, params }) => {
    await removeMember(supabase, {
      workspaceId: workspace.id,
      targetUserId: params.userId,
      actorRole: role,
    });
    return NextResponse.json({ ok: true });
  },
  { requireRole: ["owner", "admin"] },
);
