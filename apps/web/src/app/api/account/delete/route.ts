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

// POST /api/account/delete
//
// Sprint 04 A3 — account deletion. β policy enforced inside the worker;
// blocked accounts return 422 with a structured error. On success, the
// route clears session cookies via supabase.auth.signOut() so the user
// is signed out from this browser before redirecting.

import { NextResponse } from "next/server";
import { AuthError } from "@authently/shared";
import { withErrorHandling } from "@/lib/api/handler";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteAccount } from "@/services/users/delete-account";

export const POST = withErrorHandling(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AuthError();
  }

  await deleteAccount(supabase);

  // Server-side sign-out clears cookies on the response. Other-device
  // sessions remain valid until JWT expiry — Sprint 05+ "revoke all
  // sessions" scope, not a bug.
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true, redirectTo: "/" });
});
