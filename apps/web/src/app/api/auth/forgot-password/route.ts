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

// POST /api/auth/forgot-password
//
// Anti-enumeration: ALWAYS returns 200 { ok: true } regardless of whether
// the email matches a real account or whether Supabase succeeds. Any
// upstream error is logged server-side but never surfaced — preserving
// the property that an attacker cannot probe the user database via this
// endpoint.
//
// Email transport: this currently uses Supabase Auth's built-in email
// service, which routes through Inbucket in local dev (port 54324) and
// Supabase's hosted SMTP in production. Resend is wired for invitations
// (Section C) but NOT yet for password reset; configuring Supabase to
// send via Resend SMTP is deferred to Sprint 03+ if needed.

import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { ForgotPasswordSchema } from "@/lib/schemas/account";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";

export const POST = withErrorHandling(async (request) => {
  const env = getServerEnv();
  const body = await request.json().catch(() => ({}));
  const parsed = ForgotPasswordSchema.safeParse(body);

  if (!parsed.success) {
    // Body shape errors don't reveal anything about the user database,
    // so they CAN return 400. Anti-enumeration only matters once we
    // accept the input shape.
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { email } = parsed.data;
  const supabase = await createSupabaseServerClient();
  // Sprint 04 B1 — recovery now goes through PKCE-style verifyOtp at
  // /auth/confirm. The email template (supabase/templates/recovery.html)
  // constructs the link itself: `{{ .SiteURL }}/auth/confirm?token_hash=…&
  // type=recovery&next=/reset-password`. The `redirectTo` parameter below
  // is preserved because Supabase still validates it against the URL
  // allowlist — removing it would trip a "redirect_to is not allowed"
  // rejection. The new template ignores it for URL construction.
  const redirectTo = `${env.NEXT_PUBLIC_SITE_URL}/reset-password`;

  // Fire-and-log: anti-enumeration requires identical responses across
  // all branches (email matches a user / email matches no user / upstream
  // failure). Errors are logged but never returned.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (error) {
    console.error("[forgot-password] resetPasswordForEmail failed", {
      // Don't log the email — that's user PII. The error message is
      // upstream-provided and safe.
      message: error.message,
    });
  }

  return NextResponse.json({ ok: true });
});
