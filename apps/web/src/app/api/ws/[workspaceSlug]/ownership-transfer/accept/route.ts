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

// POST /api/ws/[workspaceSlug]/ownership-transfer/accept
//
// Accepts the pending ownership transfer offered to the calling user.
// The route resolves the transfer id from (workspace, auth.uid()) since
// the partial-unique constraint guarantees at most one pending transfer
// per workspace. The DEFINER worker enforces target-only as the
// authoritative check; this route just discovers the right transfer id.

import { NextResponse } from "next/server";
import { AppError } from "@authently/shared";
import { withMembership } from "@/lib/api/with-membership";
import { acceptOwnershipTransfer } from "@/services/workspaces/accept-ownership-transfer";

export const POST = withMembership(async ({ supabase, workspace, user }) => {
  const { data: pending, error: lookupError } = await supabase
    .from("workspace_ownership_transfers")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("to_user_id", user.id)
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
      { ok: false, error: "No pending transfer to accept" },
      { status: 404 },
    );
  }

  await acceptOwnershipTransfer(supabase, pending.id);
  return NextResponse.json({ ok: true });
});
