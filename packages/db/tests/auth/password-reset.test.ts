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

import { afterEach, describe, expect, test } from "vitest";
import {
  clearAllMessages,
  fetchLatestMessage,
} from "../helpers/mailpit.ts";
import { createAnonClient } from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";

// Section A1 (password reset) — end-to-end against local Supabase + Mailpit.
//
// Sprint 04 B1 migrated the recovery email template to a PKCE-style flow.
// The recovery link now goes to
//   `<site>/auth/confirm?token_hash=...&type=recovery&next=/reset-password`
// and the session is established by a server-side `verifyOtp({ token_hash,
// type })` exchange. There is no application-managed code_verifier; the
// token_hash itself is the credential.
//
// The /auth/confirm route handler is covered by apps/web/tests/api/auth/
// confirm.test.ts. This test stays at the supabase-js abstraction level —
// the same level the original implicit-flow test used — and exercises the
// direct path that the route handler dispatches to internally:
//
// The flow we're exercising:
//   1. anon: resetPasswordForEmail({ email, redirectTo })
//   2. Mailpit receives the email
//   3. extract the /auth/confirm URL from the email body, parse the
//      `token_hash` query param
//   4. anon: verifyOtp({ token_hash, type: 'recovery' })  → session active
//   5. anon (now authed): updateUser({ password: NEW })
//   6. signOut + signIn(NEW)  → success
//   7. signIn(OLD)            → error
//
// "Expired link" is NOT exercised here — Supabase's recovery TTL would
// require time travel or a wait that's brittle in CI. The second test
// covers the synthetic-invalid-token rejection instead.

const NEW_PASSWORD = "NewSecurePassword456!";
// Site URL for the redirectTo passthrough. Even under PKCE, Supabase
// validates `redirectTo` against the URL allowlist (see
// supabase/config.toml [auth].additional_redirect_urls); the new email
// template ignores it for URL construction (the template uses
// `{{ .SiteURL }}` which expands to [auth].site_url, currently
// 127.0.0.1:3000) but the parameter must still pass the allowlist.
const SITE_URL = "http://localhost:3000";

describe("password reset flow (A1)", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("end-to-end: request → email → exchange → updateUser → sign-in with new password works, old password fails", async () => {
    const user = await pool.create({ fullName: "Reset Test User" });
    await clearAllMessages();

    const anon = createAnonClient();

    // 1. Request reset email
    const reqResult = await anon.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${SITE_URL}/reset-password`,
    });
    expect(reqResult.error).toBeNull();

    // 2. Wait for Mailpit to receive
    const message = await fetchLatestMessage({
      email: user.email,
      timeoutMs: 5_000,
    });
    const body = message.HTML !== "" ? message.HTML : message.Text;
    expect(body.length).toBeGreaterThan(0);

    // 3. Extract the /auth/confirm URL from the email body. Tolerant
    //    regex matches either localhost or 127.0.0.1 — `{{ .SiteURL }}`
    //    in the template expands to whatever [auth].site_url is in
    //    config.toml, which may differ from the redirectTo origin.
    const confirmMatch = body.match(
      /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/auth\/confirm\?[^"\s>]+/,
    );
    expect(confirmMatch).not.toBeNull();
    const confirmUrl = confirmMatch![0]!.replace(/&amp;/g, "&");
    const confirmParams = new URL(confirmUrl).searchParams;
    const tokenHash = confirmParams.get("token_hash");
    const linkType = confirmParams.get("type");
    const linkNext = confirmParams.get("next");
    expect(tokenHash).not.toBeNull();
    expect(linkType).toBe("recovery");
    expect(linkNext).toBe("/reset-password");

    // 4. Establish session via verifyOtp on a fresh anon client. This
    //    is what /auth/confirm dispatches to server-side; calling it
    //    directly mirrors that handshake at the supabase-js level.
    const reset = createAnonClient();
    const verifyRes = await reset.auth.verifyOtp({
      token_hash: tokenHash!,
      type: "recovery",
    });
    expect(verifyRes.error).toBeNull();
    expect(verifyRes.data.session).not.toBeNull();

    // 5. Update password with the active session
    const updateRes = await reset.auth.updateUser({ password: NEW_PASSWORD });
    expect(updateRes.error).toBeNull();

    // 6. Sign out, then sign in with the new password
    await reset.auth.signOut();
    const fresh = createAnonClient();
    const newSignIn = await fresh.auth.signInWithPassword({
      email: user.email,
      password: NEW_PASSWORD,
    });
    expect(newSignIn.error).toBeNull();
    expect(newSignIn.data.session).not.toBeNull();

    // 7. The original test password should no longer work
    const oldSignIn = await createAnonClient().auth.signInWithPassword({
      email: user.email,
      password: "TestPassword123!", // matches TEST_PASSWORD in test-user helper
    });
    expect(oldSignIn.error).not.toBeNull();
  }, 15_000);

  test("invalid token is rejected (no session created)", async () => {
    const anon = createAnonClient();
    // A syntactically-plausible but unrecognised token_hash. Under PKCE
    // recovery, verifyOtp is the surface that validates the email-link
    // credential — mirrors the path /auth/confirm dispatches to.
    const res = await anon.auth.verifyOtp({
      token_hash: "this-is-not-a-real-token-hash",
      type: "recovery",
    });
    expect(res.error).not.toBeNull();
    expect(res.data.session).toBeNull();
  });
});
