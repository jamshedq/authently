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
  createAnonClient,
  createAuthenticatedClient,
  createServiceRoleClient,
  type AuthentlyClient,
} from "../helpers/supabase-clients.ts";
import { TestUserPool, type TestUser } from "../helpers/test-user.ts";

// =============================================================================
// Sprint 04 A1 — workspace soft-deletion RLS contract.
//
// Migration 20260501224734 adds:
//   - workspaces.deleted_at column
//   - private.is_workspace_member recreated to JOIN workspaces and require
//     deleted_at IS NULL (single-helper cascade — every existing policy
//     using the helper inherits the predicate)
//   - workspace_members_select policy restructured: the
//     `OR user_id = auth.uid()` short-circuit now also requires
//     workspace.deleted_at IS NULL (locked decision β: deleted workspace
//     fully vanishes from the user's view, including their own membership row)
//   - private.delete_workspace_impl + public.api_delete_workspace
//
// This file covers:
//   1. RPC perimeter (anon / non-member / non-owner all rejected with 42501)
//   2. Owner happy path + state assertion via service-role ground truth
//   3. β policy: post-delete the owner cannot SELECT the workspace
//   4. β policy explicit watch-list test: post-delete the owner cannot
//      SELECT their OWN membership row via the user_id = auth.uid()
//      short-circuit (the OR-branch restructure is the change under test)
//   5. β policy: other members also cannot SELECT a deleted workspace
//   6. Cascade via the helper: post-delete invitations are unreachable
//   7. Already-deleted retry returns 22023 (idempotency disambiguator)
// =============================================================================

async function clientFor(user: TestUser): Promise<AuthentlyClient> {
  return createAuthenticatedClient(user.accessToken);
}

async function addMembership(
  workspaceId: string,
  userId: string,
  role: "admin" | "editor" | "viewer",
): Promise<void> {
  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role });
  if (error) throw new Error(`addMembership failed: ${error.message}`);
}

describe("api_delete_workspace RPC perimeter", () => {
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

  test("anonymous client cannot call api_delete_workspace (42501)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  test("authenticated non-member cannot delete a workspace (42501)", async () => {
    const stranger = await pool.create({ fullName: "Stranger" });
    const client = await clientFor(stranger);
    const { error } = await client.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");

    // Ground truth: workspace not deleted.
    const admin = createServiceRoleClient();
    const ws = await admin
      .from("workspaces")
      .select("deleted_at")
      .eq("id", workspaceId)
      .single();
    expect(ws.data?.deleted_at).toBeNull();
  });

  test("authenticated member (admin role) cannot delete a workspace (42501)", async () => {
    const memberAdmin = await pool.create({ fullName: "Admin" });
    await addMembership(workspaceId, memberAdmin.userId, "admin");
    const client = await clientFor(memberAdmin);

    const { error } = await client.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");

    // Ground truth: workspace not deleted.
    const admin = createServiceRoleClient();
    const ws = await admin
      .from("workspaces")
      .select("deleted_at")
      .eq("id", workspaceId)
      .single();
    expect(ws.data?.deleted_at).toBeNull();
  });
});

describe("api_delete_workspace owner happy path + post-delete RLS (β)", () => {
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

  test("owner can delete their own workspace; deleted_at populated", async () => {
    const client = await clientFor(owner);
    const before = Date.now();
    const { error } = await client.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    const after = Date.now();
    expect(error).toBeNull();

    // Ground truth via service role.
    const admin = createServiceRoleClient();
    const ws = await admin
      .from("workspaces")
      .select("deleted_at")
      .eq("id", workspaceId)
      .single();
    expect(ws.data?.deleted_at).not.toBeNull();
    // Compare instants per packages/db/tests/CLAUDE.md.
    const deletedAtMs = new Date(ws.data!.deleted_at!).getTime();
    expect(deletedAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(deletedAtMs).toBeLessThanOrEqual(after + 1000);
  });

  test("after deletion, owner cannot SELECT the workspace via RLS", async () => {
    const client = await clientFor(owner);
    const del = await client.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(del.error).toBeNull();

    const select = await client
      .from("workspaces")
      .select("id, name, deleted_at")
      .eq("id", workspaceId);
    expect(select.error).toBeNull();
    // private.is_workspace_member now requires deleted_at IS NULL — RLS
    // hides the row from the owner's authenticated client.
    expect(select.data ?? []).toHaveLength(0);
  });

  test("after deletion, owner cannot SELECT their OWN membership row (β: OR-branch restructure)", async () => {
    // This is the explicit watch-list test for the workspace_members_select
    // policy restructure. Pre-Sprint-04 the policy let any member see their
    // own rows via `user_id = auth.uid()`. Post-Sprint-04 that branch also
    // requires the parent workspace to be non-deleted, so the row vanishes.
    const client = await clientFor(owner);
    const del = await client.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(del.error).toBeNull();

    const select = await client
      .from("workspace_members")
      .select("workspace_id, user_id, role")
      .eq("user_id", owner.userId)
      .eq("workspace_id", workspaceId);
    expect(select.error).toBeNull();
    expect(select.data ?? []).toHaveLength(0);

    // Ground truth: the membership row still exists in the DB; RLS hides it.
    const admin = createServiceRoleClient();
    const groundTruth = await admin
      .from("workspace_members")
      .select("workspace_id, user_id")
      .eq("user_id", owner.userId)
      .eq("workspace_id", workspaceId);
    expect(groundTruth.data ?? []).toHaveLength(1);
  });

  test("after deletion, other workspace members cannot SELECT the workspace", async () => {
    const editor = await pool.create({ fullName: "Editor" });
    await addMembership(workspaceId, editor.userId, "editor");

    const ownerClient = await clientFor(owner);
    const del = await ownerClient.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(del.error).toBeNull();

    const editorClient = await clientFor(editor);
    const select = await editorClient
      .from("workspaces")
      .select("id, name")
      .eq("id", workspaceId);
    expect(select.error).toBeNull();
    expect(select.data ?? []).toHaveLength(0);
  });

  test("after deletion, invitations to that workspace are unreachable via RLS", async () => {
    // Seed an invitation for the workspace (as the owner) before deletion.
    // We use service-role to insert directly to avoid coupling this test
    // to the invitation-creation flow.
    const admin = createServiceRoleClient();
    const seedToken = "deadbeef".repeat(8); // 64 hex chars; bytea-safe
    const ins = await admin.from("workspace_invitations").insert({
      workspace_id: workspaceId,
      email: "invitee@example.com",
      role: "editor",
      // token_hash uses the bytea wire shape `\x<hex>`.
      token_hash: `\\x${seedToken}` as unknown as string,
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(ins.error).toBeNull();

    const ownerClient = await clientFor(owner);
    // Pre-delete: owner can see the invitation.
    const pre = await ownerClient
      .from("workspace_invitations")
      .select("id")
      .eq("workspace_id", workspaceId);
    expect(pre.error).toBeNull();
    expect(pre.data?.length ?? 0).toBeGreaterThan(0);

    const del = await ownerClient.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(del.error).toBeNull();

    // Post-delete: same query returns 0 rows — the cascade through the
    // is_workspace_member helper hides invitations of deleted workspaces.
    const post = await ownerClient
      .from("workspace_invitations")
      .select("id")
      .eq("workspace_id", workspaceId);
    expect(post.error).toBeNull();
    expect(post.data ?? []).toHaveLength(0);
  });

  test("already-deleted retry returns 22023 (idempotency disambiguator)", async () => {
    const client = await clientFor(owner);
    const first = await client.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(first.error).toBeNull();

    const second = await client.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    // The owner check would reject because is_workspace_member now requires
    // deleted_at IS NULL — but private.has_workspace_role uses a direct
    // workspace_members lookup that doesn't include the deleted_at predicate,
    // so the role check still passes for the original owner. The
    // already-deleted guard is the one that fires here, returning 22023.
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("22023");
  });
});
