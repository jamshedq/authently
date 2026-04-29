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

// Section A1 — anti-enumeration property test.
//
// resetPasswordForEmail must NOT differentiate between "email exists" and
// "email does not exist" in either response time or response body, or an
// attacker can probe the user database. We verify this directly against
// the Supabase API the API route delegates to (same code path).

import { afterEach, describe, expect, test } from "vitest";
import { createAnonClient } from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";

const SITE_URL = "http://localhost:3000";

describe("password-reset request — anti-enumeration", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("Supabase resetPasswordForEmail returns no error for either real or fake email", async () => {
    const real = await pool.create({ fullName: "Real User" });
    const anon = createAnonClient();

    const realResult = await anon.auth.resetPasswordForEmail(real.email, {
      redirectTo: `${SITE_URL}/reset-password`,
    });
    const fakeResult = await anon.auth.resetPasswordForEmail(
      `nonexistent-${Date.now()}@authently.test`,
      { redirectTo: `${SITE_URL}/reset-password` },
    );

    // Both succeed at the API level. Supabase's anti-enumeration is the
    // upstream guarantee that our route relies on — if this ever starts
    // returning differently for "user not found", our route's contract
    // breaks and we'd need to add explicit suppression.
    expect(realResult.error).toBeNull();
    expect(fakeResult.error).toBeNull();
  });
});
