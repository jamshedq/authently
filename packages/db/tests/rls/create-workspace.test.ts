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
} from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";

// Section B contract for public.api_create_workspace (migration
// 20260429213717). The RPC is the only path apps/web uses to create
// workspaces post-signup; service-role keys are not in scope of apps/web.

describe("api_create_workspace", () => {
  const pool = new TestUserPool();
  const orphanedWorkspaceIds: string[] = [];

  afterEach(async () => {
    // Tear down any workspaces created beyond the one TestUserPool tracks.
    if (orphanedWorkspaceIds.length > 0) {
      const admin = createServiceRoleClient();
      const cleanup = await admin
        .from("workspaces")
        .delete()
        .in("id", orphanedWorkspaceIds);
      orphanedWorkspaceIds.length = 0;
      if (cleanup.error) {
        // Surface but don't fail the test on cleanup-only errors after the
        // assertions have already run.
        console.warn("[cleanup] workspace delete failed:", cleanup.error);
      }
    }
    await pool.cleanup();
  });

  test("creates a workspace + owner membership and returns its identity columns", async () => {
    const u = await pool.create({ fullName: "Creator" });
    const client = createAuthenticatedClient(u.accessToken);

    const rpc = await client.rpc("api_create_workspace", { _name: "My Brand" });
    expect(rpc.error).toBeNull();
    expect(rpc.data).toHaveLength(1);
    const row = rpc.data?.[0];
    expect(row?.name).toBe("My Brand");
    expect(row?.template).toBe("creator");
    expect(row?.plan_tier).toBe("free");
    expect(row?.slug).toMatch(/^my-brand-[a-f0-9]{8}$/);

    orphanedWorkspaceIds.push(row!.id);

    // Caller is now an owner of the new workspace.
    const admin = createServiceRoleClient();
    const member = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", row!.id)
      .eq("user_id", u.userId)
      .single();
    expect(member.error).toBeNull();
    expect(member.data?.role).toBe("owner");

    // The signup trigger's workspace + this new one — two memberships total.
    const memberships = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", u.userId);
    expect(memberships.data).toHaveLength(2);
  });

  test("rejects empty name and over-length name with 22023", async () => {
    const u = await pool.create({ fullName: "Validator" });
    const client = createAuthenticatedClient(u.accessToken);

    const empty = await client.rpc("api_create_workspace", { _name: "   " });
    expect(empty.error).not.toBeNull();
    expect(empty.error?.code).toBe("22023");

    const tooLong = await client.rpc("api_create_workspace", {
      _name: "x".repeat(81),
    });
    expect(tooLong.error).not.toBeNull();
    expect(tooLong.error?.code).toBe("22023");

    // No spurious workspaces were created on either rejection path.
    const admin = createServiceRoleClient();
    const memberships = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", u.userId);
    expect(memberships.data).toHaveLength(1);
  });

  test("anonymous callers are rejected", async () => {
    const anon = createAnonClient();
    const rpc = await anon.rpc("api_create_workspace", { _name: "Hacker WS" });
    // Anonymous role doesn't have EXECUTE on the function — PostgREST
    // surfaces this as 42501 (insufficient_privilege).
    expect(rpc.error).not.toBeNull();
    expect(rpc.error?.code).toBe("42501");
  });

  test("concurrent calls with the same base name produce distinct slugs", async () => {
    const u = await pool.create({ fullName: "Race Test" });
    const client = createAuthenticatedClient(u.accessToken);

    const results = await Promise.all([
      client.rpc("api_create_workspace", { _name: "Same Name" }),
      client.rpc("api_create_workspace", { _name: "Same Name" }),
      client.rpc("api_create_workspace", { _name: "Same Name" }),
    ]);

    for (const r of results) expect(r.error).toBeNull();
    const slugs = results.map((r) => r.data?.[0]?.slug ?? "");
    const ids = results.map((r) => r.data?.[0]?.id ?? "");
    expect(new Set(slugs).size).toBe(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) orphanedWorkspaceIds.push(id);
  });
});
