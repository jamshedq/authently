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

// POST /api/invite/[token]/accept — authenticated. Atomic accept via
// the api_accept_invitation RPC: validates the email match (case-
// insensitive), confirms not-expired and not-yet-accepted, atomically
// inserts workspace_members + sets accepted_at, and returns the
// workspace's slug for the client to redirect.

import { NextResponse } from "next/server";
import { AuthError } from "@authently/shared";
import { withErrorHandling } from "@/lib/api/handler";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptInvitation } from "@/services/invitations/accept-invitation";

export const POST = withErrorHandling(async (_request, ctx) => {
  const { token } = (await ctx.params) as { token: string };
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AuthError();
  }

  const result = await acceptInvitation(supabase, token);
  return NextResponse.json({ ok: true, ...result });
});
