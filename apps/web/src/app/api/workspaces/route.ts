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

// POST /api/workspaces
//
// Creates a new workspace + owner membership for the calling user. The
// workspace is created via `public.api_create_workspace` (SECURITY DEFINER
// RPC from migration 20260429213717), which bypasses RLS for the bootstrap
// insert without exposing SUPABASE_SERVICE_ROLE_KEY to apps/web.
//
// Lives at /api/workspaces (top-level) rather than /api/ws/[slug]/* because
// the workspace doesn't exist yet — there's no slug to gate membership on.

import { NextResponse } from "next/server";
import { AuthError } from "@authently/shared";
import { withErrorHandling } from "@/lib/api/handler";
import { CreateWorkspaceSchema } from "@/lib/schemas/workspaces";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createWorkspace } from "@/services/workspaces/create-workspace";

export const POST = withErrorHandling(async (request) => {
  const body = await request.json().catch(() => ({}));
  const parsed = CreateWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AuthError();
  }

  const workspace = await createWorkspace(supabase, parsed.data.name);

  return NextResponse.json({ ok: true, workspace }, { status: 201 });
});
