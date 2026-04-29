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
// Supabase's default recovery email template uses the implicit flow:
// the recovery link, when followed, redirects to `redirectTo` with
// access_token + refresh_token in the URL fragment (NOT a query
// `?code=...`). The browser-side /reset-password page handles this via
// supabase.auth.setSession; the test mimics that handshake directly.
//
// The flow we're exercising:
//   1. anon: resetPasswordForEmail({ email, redirectTo })
//   2. Mailpit receives the email
//   3. fetch the verify URL with redirect:manual; parse the Location's
//      fragment to recover access_token + refresh_token
//   4. anon: setSession({ access_token, refresh_token }) → session active
//   5. anon (now authed): updateUser({ password: NEW })
//   6. signOut + signIn(NEW)  → success
//   7. signIn(OLD)            → error
//
// "Expired link" is NOT exercised here — Supabase's recovery TTL would
// require time travel or a wait that's brittle in CI. The second test
// covers the synthetic-invalid-token rejection instead.

const NEW_PASSWORD = "NewSecurePassword456!";
// Site URL — must match an entry in supabase/config.toml's
// additional_redirect_urls (we added http://localhost:3000/** there).
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

    // 2. Wait for Inbucket to receive
    const message = await fetchLatestMessage({
      email: user.email,
      timeoutMs: 5_000,
    });
    const body = message.HTML !== "" ? message.HTML : message.Text;
    expect(body.length).toBeGreaterThan(0);

    // 3. Extract the verify URL from the email body, follow it with
    //    redirect:manual, and parse access_token + refresh_token from the
    //    Location header's URL fragment (implicit flow).
    const verifyMatch = body.match(
      /https?:\/\/[^"\s>]+\/auth\/v1\/verify\?[^"\s>]+/,
    );
    expect(verifyMatch).not.toBeNull();
    const verifyUrl = verifyMatch![0]!.replace(/&amp;/g, "&");

    const verifyRes = await fetch(verifyUrl, { redirect: "manual" });
    expect([301, 302, 303, 307, 308]).toContain(verifyRes.status);
    const location = verifyRes.headers.get("location");
    expect(location).not.toBeNull();

    const fragmentIndex = location!.indexOf("#");
    expect(fragmentIndex).toBeGreaterThan(-1);
    const fragment = location!.slice(fragmentIndex + 1);
    const fragParams = new URLSearchParams(fragment);
    const accessToken = fragParams.get("access_token");
    const refreshToken = fragParams.get("refresh_token");
    const type = fragParams.get("type");
    expect(accessToken).not.toBeNull();
    expect(refreshToken).not.toBeNull();
    expect(type).toBe("recovery");

    // 4. Establish session on a fresh anon client via setSession (mimics
    //    what the browser-side /reset-password page does on mount).
    const reset = createAnonClient();
    const setRes = await reset.auth.setSession({
      access_token: accessToken!,
      refresh_token: refreshToken!,
    });
    expect(setRes.error).toBeNull();
    expect(setRes.data.session).not.toBeNull();

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
    // A syntactically-plausible but unrecognised access_token + refresh_token.
    const res = await anon.auth.setSession({
      access_token: "this-is-not-a-real-jwt",
      refresh_token: "neither-is-this",
    });
    expect(res.error).not.toBeNull();
    expect(res.data.session).toBeNull();
  });
});
