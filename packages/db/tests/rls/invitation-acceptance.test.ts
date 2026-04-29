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
  createAnonClient,
  createAuthenticatedClient,
  createServiceRoleClient,
  type AuthentlyClient,
} from "../helpers/supabase-clients.ts";
import { insertInvitationViaRls } from "../helpers/invitations.ts";
import { TestUserPool, type TestUser } from "../helpers/test-user.ts";

// Section C — invitation acceptance lifecycle (api_accept_invitation +
// api_lookup_invitation), including the concurrent-acceptance race.

async function rpc<T>(
  client: AuthentlyClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  return (await (client.rpc as unknown as (
    f: string,
    a: Record<string, unknown>,
  ) => Promise<unknown>)(fn, args)) as never;
}

describe("invitation lifecycle", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  async function inviteFor(
    owner: TestUser,
    invitee: TestUser,
    overrides: { role?: "admin" | "editor" | "viewer"; expiresAt?: Date | null } = {},
  ) {
    const ownerClient = createAuthenticatedClient(owner.accessToken);
    return insertInvitationViaRls(ownerClient, {
      workspaceId: owner.workspaceId,
      email: invitee.email,
      role: overrides.role ?? "editor",
      invitedBy: owner.userId,
      ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
    });
  }

  test("anonymous lookup of valid token returns workspace + role; invalid envelope on bad/expired/accepted", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const invitee = await pool.create({ fullName: "Invitee" });
    const inv = await inviteFor(owner, invitee, { role: "admin" });

    const anon = createAnonClient();
    const valid = await rpc<Array<{ status: string; workspace_slug: string; role: string }>>(
      anon,
      "api_lookup_invitation",
      { _token: inv.rawToken },
    );
    expect(valid.error).toBeNull();
    const validRow = valid.data?.[0];
    expect(validRow?.status).toBe("valid");
    expect(validRow?.role).toBe("admin");

    // Anti-enumeration: nonsense token returns same shape, no metadata.
    const bogus = await rpc<Array<{ status: string; workspace_slug: string | null }>>(
      anon,
      "api_lookup_invitation",
      { _token: "deadbeef".repeat(8) },
    );
    expect(bogus.error).toBeNull();
    expect(bogus.data?.[0]?.status).toBe("invalid");
    expect(bogus.data?.[0]?.workspace_slug).toBeNull();

    // Expired invitation surfaces the same envelope as bogus.
    const expired = await inviteFor(owner, invitee, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const expiredLookup = await rpc<Array<{ status: string; workspace_slug: string | null }>>(
      anon,
      "api_lookup_invitation",
      { _token: expired.rawToken },
    );
    expect(expiredLookup.data?.[0]?.status).toBe("invalid");
    expect(expiredLookup.data?.[0]?.workspace_slug).toBeNull();
  });

  test("accept happy path: inserts workspace_member + sets accepted_at", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const invitee = await pool.create({ fullName: "Invitee" });
    const inv = await inviteFor(owner, invitee, { role: "editor" });

    const inviteeClient = createAuthenticatedClient(invitee.accessToken);
    const result = await rpc<Array<{ workspace_slug: string; workspace_name: string }>>(
      inviteeClient,
      "api_accept_invitation",
      { _token: inv.rawToken },
    );
    expect(result.error).toBeNull();
    const row = result.data?.[0];
    expect(row?.workspace_slug).toBeTruthy();

    const admin = createServiceRoleClient();
    const member = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", invitee.userId)
      .single();
    expect(member.data?.role).toBe("editor");

    const inviteRow = await admin
      .from("workspace_invitations")
      .select("accepted_at")
      .eq("id", inv.id)
      .single();
    expect(inviteRow.data?.accepted_at).not.toBeNull();
  });

  test("expired invitation rejected (22023)", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const invitee = await pool.create({ fullName: "Invitee" });
    const inv = await inviteFor(owner, invitee, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const inviteeClient = createAuthenticatedClient(invitee.accessToken);
    const result = await rpc(inviteeClient, "api_accept_invitation", {
      _token: inv.rawToken,
    });
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe("22023");
  });

  test("already-accepted invitation cannot be accepted again (23505)", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const invitee = await pool.create({ fullName: "Invitee" });
    const inv = await inviteFor(owner, invitee);

    const inviteeClient = createAuthenticatedClient(invitee.accessToken);
    const first = await rpc(inviteeClient, "api_accept_invitation", { _token: inv.rawToken });
    expect(first.error).toBeNull();

    const second = await rpc(inviteeClient, "api_accept_invitation", { _token: inv.rawToken });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");
  });

  test("email mismatch rejected (22023)", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const invitee = await pool.create({ fullName: "Invitee" });
    const stranger = await pool.create({ fullName: "Stranger" });

    const ownerClient = createAuthenticatedClient(owner.accessToken);
    const inv = await insertInvitationViaRls(ownerClient, {
      workspaceId: owner.workspaceId,
      email: invitee.email,
      role: "editor",
      invitedBy: owner.userId,
    });

    // stranger tries to accept the invitation meant for invitee.
    const strangerClient = createAuthenticatedClient(stranger.accessToken);
    const result = await rpc(strangerClient, "api_accept_invitation", {
      _token: inv.rawToken,
    });
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe("22023");
  });

  test("anonymous accept rejected (42501)", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const invitee = await pool.create({ fullName: "Invitee" });
    const inv = await inviteFor(owner, invitee);

    const anon = createAnonClient();
    const result = await rpc(anon, "api_accept_invitation", { _token: inv.rawToken });
    // anon doesn't have EXECUTE on the function — PostgREST surfaces
    // the GRANT denial as 42501.
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe("42501");
  });

  test("concurrent acceptance — exactly one wins, the other gets 23505", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const invitee = await pool.create({ fullName: "Invitee" });
    const inv = await inviteFor(owner, invitee, { role: "viewer" });

    const inviteeClient = createAuthenticatedClient(invitee.accessToken);

    // Fire two simultaneous accepts. The atomic UPDATE on accepted_at
    // is the race-protection — one row matches, the other gets 0
    // affected and the function raises 23505.
    const [a, b] = await Promise.all([
      rpc(inviteeClient, "api_accept_invitation", { _token: inv.rawToken }),
      rpc(inviteeClient, "api_accept_invitation", { _token: inv.rawToken }),
    ]);

    const errors = [a.error, b.error].filter((e) => e !== null);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("23505");

    // Exactly one workspace_member row should exist.
    const admin = createServiceRoleClient();
    const members = await admin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", invitee.userId);
    expect(members.data).toHaveLength(1);
  });
});
