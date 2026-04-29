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

// GET /api/ws/[workspaceSlug]/members — list members + roles. Open to
// all roles (matches "members list page is open to all roles" in
// spec). Mutation actions (PATCH/DELETE on /members/[userId]) are
// gated separately.

import { NextResponse } from "next/server";
import { withMembership } from "@/lib/api/with-membership";
import { listWorkspaceMembers } from "@/services/members/list-members";

export const GET = withMembership(async ({ supabase, workspace }) => {
  const members = await listWorkspaceMembers(supabase, workspace.slug);
  return NextResponse.json({ members });
});
