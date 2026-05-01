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

// POST /api/ws/[workspaceSlug]/ownership-transfer
//
// Initiates an ownership transfer (Sprint 04 A2). Owner-only; the route
// gate is defence-in-depth — the SECURITY DEFINER worker re-checks owner
// role before inserting the transfer row.

import { NextResponse } from "next/server";
import { withMembership } from "@/lib/api/with-membership";
import { InitiateOwnershipTransferSchema } from "@/lib/schemas/workspaces";
import { initiateOwnershipTransfer } from "@/services/workspaces/initiate-ownership-transfer";

export const POST = withMembership(
  async ({ request, supabase, workspace }) => {
    const body = await request.json().catch(() => ({}));
    const parsed = InitiateOwnershipTransferSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Invalid input",
        },
        { status: 400 },
      );
    }

    const transferId = await initiateOwnershipTransfer(
      supabase,
      workspace.id,
      parsed.data.toUserId,
    );
    return NextResponse.json({ ok: true, transferId });
  },
  { requireRole: ["owner"] },
);
