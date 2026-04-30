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

// PKCE code-exchange callback for any flow where Supabase Auth redirects
// the browser back to us with a `?code=…` query (password reset, email
// confirmation, magic link, OAuth). The exchange must happen in a
// Route Handler — Server Components can't write the session cookies that
// `exchangeCodeForSession` produces.
//
// Sprint 02 wires this for password reset (Section A1). Future sections
// will reuse the same `?next=` redirect pattern.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";
import { safeNext } from "@/lib/auth/safe-next";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), "/");
  const env = getServerEnv();
  const origin = env.NEXT_PUBLIC_SITE_URL;

  if (!code) {
    // No code present — the link was malformed or pre-fetched. Send the
    // user back to /login with a generic error rather than silently
    // swallowing the problem.
    return NextResponse.redirect(
      new URL("/login?error=invalid_link", origin),
      { status: 303 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_link", origin),
      { status: 303 },
    );
  }

  return NextResponse.redirect(new URL(next, origin), { status: 303 });
}
