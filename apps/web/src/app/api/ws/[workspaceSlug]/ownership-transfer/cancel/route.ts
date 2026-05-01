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

// POST /api/ws/[workspaceSlug]/ownership-transfer/cancel
//
// Cancels the pending ownership transfer for this workspace. The DEFINER
// worker accepts either the original owner or the target as caller —
// owner cancels their own pending transfer, target rejects the offer.
//
// The route resolves the transfer id by querying for the pending row
// where the caller is either from_user_id or to_user_id (the SELECT RLS
// policy on workspace_ownership_transfers gates this query — non-parties
// see no rows). The worker re-validates as the authoritative check.

import { NextResponse } from "next/server";
import { AppError } from "@authently/shared";
import { withMembership } from "@/lib/api/with-membership";
import { cancelOwnershipTransfer } from "@/services/workspaces/cancel-ownership-transfer";

export const POST = withMembership(async ({ supabase, workspace, user }) => {
  const { data: pending, error: lookupError } = await supabase
    .from("workspace_ownership_transfers")
    .select("id")
    .eq("workspace_id", workspace.id)
    .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .maybeSingle<{ id: string }>();

  if (lookupError) {
    throw new AppError({
      code: "OWNERSHIP_TRANSFER_LOOKUP_FAILED",
      message: lookupError.message,
      statusCode: 500,
    });
  }
  if (!pending) {
    return NextResponse.json(
      { ok: false, error: "No pending transfer to cancel" },
      { status: 404 },
    );
  }

  await cancelOwnershipTransfer(supabase, pending.id);
  return NextResponse.json({ ok: true });
});
