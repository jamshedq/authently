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

// GET /api/invite/[token] — public lookup. Anonymous + authenticated
// callers both go through the SECURITY DEFINER api_lookup_invitation
// RPC, which returns the same envelope on invalid/expired/accepted
// (anti-enumeration). Sprint 02 calls this from the /invite/[token]
// page server-side; the route is also useful for client-side
// state machines or future debugging.

import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { lookupInvitation } from "@/services/invitations/lookup-invitation";

export const GET = withErrorHandling(async (_request, ctx) => {
  const { token } = (await ctx.params) as { token: string };
  const supabase = await createSupabaseServerClient();
  const result = await lookupInvitation(supabase, token);
  return NextResponse.json(result);
});
