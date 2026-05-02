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

// PKCE-style email-link confirmation handler (Sprint 04 B1). Used by the
// recovery email template at supabase/templates/recovery.html, which
// delivers a `?token_hash=...&type=recovery&next=/reset-password` URL.
//
// Distinct from /auth/callback: that handler does PKCE OAuth code
// exchange via `exchangeCodeForSession`. This handler does email-link
// `verifyOtp({ token_hash, type })` — Supabase v2's PKCE-style for
// email flows. The token_hash IS the credential; there is no
// application-managed code_verifier and no cookie/storage to wrangle.
// Cross-device flows (request on desktop, click on mobile) work
// natively because the credential lives in the URL.
//
// All failure modes (missing token_hash, verifyOtp error, missing/wrong
// type) redirect to /forgot-password?error=invalid_link with status 303
// — matches /auth/callback's pattern. Single error code keeps the UX
// simple and avoids leaking which specific failure occurred.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";
import { safeNext } from "@/lib/auth/safe-next";

export const dynamic = "force-dynamic";

type RecoveryOtpType = "recovery" | "email";

function isSupportedOtpType(value: string | null): value is RecoveryOtpType {
  return value === "recovery" || value === "email";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeNext(url.searchParams.get("next"), "/reset-password");
  const env = getServerEnv();
  const origin = env.NEXT_PUBLIC_SITE_URL;

  if (!tokenHash || !isSupportedOtpType(type)) {
    return NextResponse.redirect(
      new URL("/forgot-password?error=invalid_link", origin),
      { status: 303 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    return NextResponse.redirect(
      new URL("/forgot-password?error=invalid_link", origin),
      { status: 303 },
    );
  }

  return NextResponse.redirect(new URL(next, origin), { status: 303 });
}
