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

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createAuthenticatedClient,
  createServiceRoleClient,
} from "../helpers/supabase-clients.ts";
import { TestUserPool, type TestUser } from "../helpers/test-user.ts";

// Section C — RLS contract for workspace_members write paths
// (UPDATE role and DELETE). The DB layer enforces the WORKSPACE-WIDE
// owner/admin gate via `workspace_members_owner_admin_update`. The
// finer ACTOR-vs-TARGET matrix (admin can only touch editor/viewer,
// owner can touch any non-owner, etc.) is enforced in the API service
// layer; these tests pin the DB-level invariants.

type Role = "owner" | "admin" | "editor" | "viewer";

async function addMember(
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<void> {
  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role });
  if (error) throw error;
}

describe("workspace_members write RLS", () => {
  const pool = new TestUserPool();
  let owner: TestUser;
  let workspaceId: string;

  beforeEach(async () => {
    owner = await pool.create({ fullName: "Owner" });
    workspaceId = owner.workspaceId;
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("owner can UPDATE another member's role", async () => {
    const target = await pool.create({ fullName: "Target" });
    await addMember(workspaceId, target.userId, "viewer");

    const client = createAuthenticatedClient(owner.accessToken);
    const update = await client
      .from("workspace_members")
      .update({ role: "editor" } as never)
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId)
      .select("user_id, role");
    expect(update.error).toBeNull();
    expect(update.data?.[0]?.role).toBe("editor");
  });

  test("admin can UPDATE editor/viewer role (DB allows; API matrix is the finer gate)", async () => {
    const adminUser = await pool.create({ fullName: "Admin" });
    const target = await pool.create({ fullName: "Target" });
    await addMember(workspaceId, adminUser.userId, "admin");
    await addMember(workspaceId, target.userId, "viewer");

    const adminClient = createAuthenticatedClient(adminUser.accessToken);
    const update = await adminClient
      .from("workspace_members")
      .update({ role: "editor" } as never)
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId)
      .select("role");
    expect(update.error).toBeNull();
    expect(update.data?.[0]?.role).toBe("editor");
  });

  test("editor cannot UPDATE any role — RLS rejects (no rows affected)", async () => {
    const editor = await pool.create({ fullName: "Editor" });
    const target = await pool.create({ fullName: "Target" });
    await addMember(workspaceId, editor.userId, "editor");
    await addMember(workspaceId, target.userId, "viewer");

    const editorClient = createAuthenticatedClient(editor.accessToken);
    const update = await editorClient
      .from("workspace_members")
      .update({ role: "editor" } as never)
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId)
      .select("user_id");
    expect(update.error).toBeNull();
    expect(update.data ?? []).toHaveLength(0);

    // Ground truth: target's role unchanged.
    const adminClient = createServiceRoleClient();
    const ground = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId)
      .single();
    expect(ground.data?.role).toBe("viewer");
  });

  test("viewer cannot UPDATE any role", async () => {
    const viewer = await pool.create({ fullName: "Viewer" });
    const target = await pool.create({ fullName: "Target" });
    await addMember(workspaceId, viewer.userId, "viewer");
    await addMember(workspaceId, target.userId, "viewer");

    const viewerClient = createAuthenticatedClient(viewer.accessToken);
    const update = await viewerClient
      .from("workspace_members")
      .update({ role: "editor" } as never)
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId)
      .select("user_id");
    expect(update.error).toBeNull();
    expect(update.data ?? []).toHaveLength(0);
  });

  test("non-member cannot UPDATE roles in another workspace", async () => {
    const target = await pool.create({ fullName: "Target" });
    await addMember(workspaceId, target.userId, "viewer");
    const stranger = await pool.create({ fullName: "Stranger" });

    const strangerClient = createAuthenticatedClient(stranger.accessToken);
    const update = await strangerClient
      .from("workspace_members")
      .update({ role: "editor" } as never)
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId)
      .select("user_id");
    expect(update.error).toBeNull();
    expect(update.data ?? []).toHaveLength(0);
  });

  test("UPDATE is restricted to the role column (column-level GRANT)", async () => {
    const target = await pool.create({ fullName: "Target" });
    await addMember(workspaceId, target.userId, "viewer");

    const ownerClient = createAuthenticatedClient(owner.accessToken);

    // Attempt to mutate created_at — column-level GRANT denies the
    // UPDATE statement entirely. PostgREST surfaces 42501.
    const tampered = await ownerClient
      .from("workspace_members")
      .update({ created_at: new Date(0).toISOString() } as never)
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId);
    expect(tampered.error).not.toBeNull();
    expect(tampered.error?.code).toBe("42501");
  });

  test("owner can DELETE another member; non-member cannot", async () => {
    const target = await pool.create({ fullName: "Target" });
    await addMember(workspaceId, target.userId, "viewer");
    const stranger = await pool.create({ fullName: "Stranger" });

    const strangerClient = createAuthenticatedClient(stranger.accessToken);
    const blockedDel = await strangerClient
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId)
      .select("user_id");
    expect(blockedDel.data ?? []).toHaveLength(0);

    const ownerClient = createAuthenticatedClient(owner.accessToken);
    const ownerDel = await ownerClient
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId)
      .select("user_id");
    expect(ownerDel.error).toBeNull();
    expect(ownerDel.data?.[0]?.user_id).toBe(target.userId);
  });
});
