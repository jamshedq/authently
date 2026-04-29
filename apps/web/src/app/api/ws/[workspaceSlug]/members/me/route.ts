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

// DELETE /api/ws/[workspaceSlug]/members/me — leave the workspace.
// Open to all roles. Last-owner protection is at the DB trigger; the
// service translates 23514 to a 409 with "transfer ownership first"
// copy that the UI surfaces as a sonner toast.

import { NextResponse } from "next/server";
import { withMembership } from "@/lib/api/with-membership";
import { leaveWorkspace } from "@/services/members/leave-workspace";

export const DELETE = withMembership(async ({ supabase, user, workspace }) => {
  await leaveWorkspace(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
  });
  return NextResponse.json({ ok: true });
});
