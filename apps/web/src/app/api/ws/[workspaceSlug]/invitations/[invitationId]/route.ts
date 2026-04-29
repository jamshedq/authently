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

// DELETE /api/ws/[workspaceSlug]/invitations/[invitationId] — revoke a
// pending invitation. Owner/admin only. The DB function
// public.api_revoke_invitation re-checks the role gate so the failure
// mode is a clean 42501 -> ForbiddenError.

import { NextResponse } from "next/server";
import { withMembership } from "@/lib/api/with-membership";
import { revokeInvitation } from "@/services/invitations/revoke-invitation";

export const DELETE = withMembership<{ invitationId: string }>(
  async ({ supabase, params }) => {
    await revokeInvitation(supabase, params.invitationId);
    return NextResponse.json({ ok: true });
  },
  { requireRole: ["owner", "admin"] },
);
