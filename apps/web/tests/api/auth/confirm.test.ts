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

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock @/lib/supabase/server to short-circuit the verifyOtp call. The
// two tests intentionally avoid exercising Supabase's behavior — the
// mocked verifyOtp paths would test Supabase, not our code. Manual
// Inbucket smoke (documented in the B1 commit message) covers the
// end-to-end success/error paths against a real Supabase instance.
const verifyOtpMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { verifyOtp: verifyOtpMock },
  }),
}));

import { GET } from "@/app/auth/confirm/route";

function buildRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    verifyOtpMock.mockReset();
  });

  afterEach(() => {
    verifyOtpMock.mockReset();
  });

  test("missing token_hash → 303 to /forgot-password?error=invalid_link", async () => {
    const res = await GET(buildRequest("http://localhost:3000/auth/confirm"));

    expect(res.status).toBe(303);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(location!).toContain("/forgot-password");
    expect(location!).toContain("error=invalid_link");
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  test("safeNext rejects external `next=` even on a successful verifyOtp; redirect lands on the in-origin fallback", async () => {
    verifyOtpMock.mockResolvedValueOnce({ error: null });

    const res = await GET(
      buildRequest(
        "http://localhost:3000/auth/confirm?token_hash=valid-hash&type=recovery&next=https://evil.example.com/x",
      ),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    // safeNext rejects the external URL — the location must NOT contain
    // the attacker host. The fallback for /auth/confirm is /reset-password.
    expect(location!).not.toContain("evil.example.com");
    expect(location!).toContain("/reset-password");
    expect(verifyOtpMock).toHaveBeenCalledOnce();
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: "valid-hash",
      type: "recovery",
    });
  });
});
