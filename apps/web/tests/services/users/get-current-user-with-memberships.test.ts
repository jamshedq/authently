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

import type { User } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";
import { getCurrentUserWithMemberships } from "@/services/users/get-current-user-with-memberships";

// Sprint 03 A4: getCurrentUserWithMemberships now accepts an optional
// `prefetchedUser` so callers that already validated the user via
// auth.getUser() can skip the second JWT round-trip. Header passes through;
// /api/me keeps the no-arg ergonomics.
//
// These tests pin the branching invariant: with `prefetchedUser`, getUser
// is NOT called; without it, getUser IS called exactly once.

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-test-1",
    aud: "authenticated",
    role: "authenticated",
    email: "test@authently.test",
    email_confirmed_at: "2026-05-01T00:00:00Z",
    phone: "",
    confirmed_at: "2026-05-01T00:00:00Z",
    last_sign_in_at: "2026-05-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "Test User" },
    identities: [],
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    is_anonymous: false,
    ...overrides,
  } as User;
}

function buildMockClient(args: {
  getUserReturns: { data: { user: User | null }; error: null | { message: string } };
  membershipRows: unknown[];
}) {
  const getUser = vi.fn().mockResolvedValue(args.getUserReturns);
  // workspace_members .select(...).eq(...).order(...).order(...).returns()
  // chain — flat mock returning the rows. Each chain step returns an
  // object exposing the next step.
  const returns = vi
    .fn()
    .mockResolvedValue({ data: args.membershipRows, error: null });
  const orderInner = vi.fn().mockReturnValue({ returns });
  const orderOuter = vi.fn().mockReturnValue({ order: orderInner });
  const eq = vi.fn().mockReturnValue({ order: orderOuter });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  return {
    client: { auth: { getUser }, from },
    spies: { getUser, from, select, eq, orderOuter, orderInner, returns },
  };
}

describe("getCurrentUserWithMemberships", () => {
  test("with prefetchedUser → does NOT call supabase.auth.getUser()", async () => {
    const prefetched = buildUser({ id: "user-prefetched-1" });
    const mock = buildMockClient({
      getUserReturns: { data: { user: null }, error: null },
      membershipRows: [],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getCurrentUserWithMemberships(mock.client as any, prefetched);

    expect(mock.spies.getUser).not.toHaveBeenCalled();
    expect(mock.spies.from).toHaveBeenCalledWith("workspace_members");
    // Membership SELECT still runs under user.id from the prefetched user.
    expect(mock.spies.eq).toHaveBeenCalledWith("user_id", "user-prefetched-1");
  });

  test("without prefetchedUser → calls supabase.auth.getUser() exactly once", async () => {
    const fetched = buildUser({ id: "user-fetched-1" });
    const mock = buildMockClient({
      getUserReturns: { data: { user: fetched }, error: null },
      membershipRows: [],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getCurrentUserWithMemberships(mock.client as any);

    expect(mock.spies.getUser).toHaveBeenCalledTimes(1);
    expect(mock.spies.eq).toHaveBeenCalledWith("user_id", "user-fetched-1");
  });

  test("without prefetchedUser AND auth.getUser fails → throws AuthError", async () => {
    const mock = buildMockClient({
      getUserReturns: {
        data: { user: null },
        error: { message: "session expired" },
      },
      membershipRows: [],
    });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getCurrentUserWithMemberships(mock.client as any),
    ).rejects.toThrow();
    expect(mock.spies.getUser).toHaveBeenCalledTimes(1);
    // Membership SELECT is never reached when auth fails.
    expect(mock.spies.from).not.toHaveBeenCalled();
  });

  test("sorts memberships by last_active_at desc, created_at desc (Sprint 03 A1)", async () => {
    const prefetched = buildUser({ id: "user-sort-1" });
    const mock = buildMockClient({
      getUserReturns: { data: { user: null }, error: null },
      membershipRows: [],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getCurrentUserWithMemberships(mock.client as any, prefetched);

    // Two .order() calls: outer last_active_at desc, inner created_at desc.
    expect(mock.spies.orderOuter).toHaveBeenCalledWith("last_active_at", {
      ascending: false,
    });
    expect(mock.spies.orderInner).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
  });

  test("with prefetchedUser → membership rows are mapped (filters out null workspace joins)", async () => {
    const prefetched = buildUser({ id: "user-mapper-1" });
    const mock = buildMockClient({
      getUserReturns: { data: { user: null }, error: null },
      membershipRows: [
        {
          role: "owner",
          workspace: {
            id: "ws-1",
            name: "Alpha",
            slug: "alpha",
            template: "solo_creator",
            plan_tier: "free",
          },
        },
        // RLS-hidden workspace shows up as null join — must be skipped.
        { role: "editor", workspace: null },
      ],
    });

    const result = await getCurrentUserWithMemberships(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock.client as any,
      prefetched,
    );

    expect(result.user.id).toBe("user-mapper-1");
    expect(result.memberships).toHaveLength(1);
    expect(result.memberships[0]!.workspace.slug).toBe("alpha");
  });
});
