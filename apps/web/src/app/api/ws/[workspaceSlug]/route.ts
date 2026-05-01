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

// PATCH /api/ws/[workspaceSlug]
//
// Updates the workspace's name and/or template. Owner + admin only;
// editor/viewer receive 403 via `withMembership`'s requireRole gate.
//
// Defence-in-depth:
//   - This route gates the role at the API layer (clear error code, fast
//     fail without a DB round-trip beyond auth).
//   - The DB still enforces the rule via the workspaces_owner_admin_update
//     RLS policy from migration 20260429213717.
//   - Column-level GRANTs restrict authenticated callers to (name,
//     template) — slug, plan_tier, stripe_* are not reachable here even
//     if the route handler attempted to set them.
//
// DELETE /api/ws/[workspaceSlug]
//
// Soft-deletes the workspace (Sprint 04 A1). Owner-only — admins
// receive 403 via `withMembership`'s requireRole gate. The
// `public.api_delete_workspace` RPC re-checks owner role inside the
// SECURITY DEFINER worker; this route's gate is the user-visible 403.

import { NextResponse } from "next/server";
import { withMembership } from "@/lib/api/with-membership";
import { UpdateWorkspaceSchema } from "@/lib/schemas/workspaces";
import { updateWorkspace } from "@/services/workspaces/update-workspace";
import { deleteWorkspace } from "@/services/workspaces/delete-workspace";

export const PATCH = withMembership(
  async ({ request, supabase, workspace }) => {
    const body = await request.json().catch(() => ({}));
    const parsed = UpdateWorkspaceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Invalid input",
        },
        { status: 400 },
      );
    }

    const updated = await updateWorkspace(supabase, workspace.id, parsed.data);
    return NextResponse.json({ ok: true, workspace: updated });
  },
  { requireRole: ["owner", "admin"] },
);

export const DELETE = withMembership(
  async ({ supabase, workspace }) => {
    await deleteWorkspace(supabase, workspace.id);
    return NextResponse.json({ ok: true });
  },
  { requireRole: ["owner"] },
);
