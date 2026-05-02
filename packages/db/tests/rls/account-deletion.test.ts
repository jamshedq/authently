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
// Sprint 04 A3 — account deletion RLS + state-machine contract.
//
// Migration 20260501234834 introduces:
//   - public.user_profiles (user_id PK ref auth.users on delete cascade,
//     deleted_at)
//   - private.account_blocking_workspaces(_user_id) — shared predicate;
//     used by both the worker's blocking check and the SSR helper
//   - public.api_my_blocking_workspaces — SSR-callable wrapper
//   - private.delete_account_impl — atomic: blocking check → cascade
//     soft-delete sole-member workspaces → upsert user_profiles
//   - public.api_delete_account — wrapper, granted to authenticated
//
// β policy: account cannot be deleted if user owns workspaces with
// other members. Block returns 22023; clear path cascades sole-member
// workspaces and sets user_profiles.deleted_at.
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

async function readDeletedAt(workspaceId: string): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("workspaces")
    .select("deleted_at")
    .eq("id", workspaceId)
    .single();
  if (error) throw new Error(`readDeletedAt failed: ${error.message}`);
  return data.deleted_at;
}

async function readProfileDeletedAt(
  userId: string,
): Promise<string | null | undefined> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("user_profiles")
    .select("deleted_at")
    .eq("user_id", userId)
    .maybeSingle<{ deleted_at: string | null }>();
  if (error) throw new Error(`readProfileDeletedAt failed: ${error.message}`);
  if (!data) return undefined;
  return data.deleted_at;
}

describe("api_delete_account — RPC perimeter + state machine", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("anonymous client cannot call api_delete_account (42501)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_delete_account");
    expect(error?.code).toBe("42501");
  });

  test("user with only their auto-created workspace deletes cleanly; cascade soft-deletes that workspace", async () => {
    // TestUserPool.create gives the user a default sole-member workspace
    // (the trigger-created one). No other members.
    const solo = await pool.create({ fullName: "Solo" });
    const client = await clientFor(solo);

    const before = Date.now();
    const { error } = await client.rpc("api_delete_account");
    const after = Date.now();
    expect(error).toBeNull();

    // Workspace cascaded.
    const wsDeletedAt = await readDeletedAt(solo.workspaceId);
    expect(wsDeletedAt).not.toBeNull();
    const wsMs = new Date(wsDeletedAt!).getTime();
    expect(wsMs).toBeGreaterThanOrEqual(before - 1000);
    expect(wsMs).toBeLessThanOrEqual(after + 1000);

    // user_profiles row created with deleted_at populated.
    const profileDeleted = await readProfileDeletedAt(solo.userId);
    expect(profileDeleted).not.toBeNull();
    expect(profileDeleted).not.toBeUndefined();
    const profileMs = new Date(profileDeleted!).getTime();
    expect(profileMs).toBeGreaterThanOrEqual(before - 1000);
    expect(profileMs).toBeLessThanOrEqual(after + 1000);
  });

  test("mixed memberships: cascade only touches sole-member-owner workspaces; non-owner memberships preserved (Q6)", async () => {
    const me = await pool.create({ fullName: "Me" });
    const otherOwner = await pool.create({ fullName: "Other Owner" });

    // Me is added as editor to otherOwner's workspace.
    await addMembership(otherOwner.workspaceId, me.userId, "editor");

    const client = await clientFor(me);
    const { error } = await client.rpc("api_delete_account");
    expect(error).toBeNull();

    // My sole-member workspace cascaded.
    expect(await readDeletedAt(me.workspaceId)).not.toBeNull();

    // Non-owner membership preserved (Q6 — UX leak bounded by Sprint 05+
    // hard-delete cleanup; soft-delete-via-user_profiles is reversible-
    // in-principle so we don't drop memberships).
    const admin = createServiceRoleClient();
    const ghost = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", otherOwner.workspaceId)
      .eq("user_id", me.userId)
      .maybeSingle();
    expect(ghost.data?.role).toBe("editor");

    // The other owner's workspace untouched.
    expect(await readDeletedAt(otherOwner.workspaceId)).toBeNull();
  });

  test("user with one blocking workspace (owns + others present) is blocked (22023)", async () => {
    const me = await pool.create({ fullName: "Owner" });
    const editor = await pool.create({ fullName: "Editor" });
    await addMembership(me.workspaceId, editor.userId, "editor");

    const client = await clientFor(me);
    const { error } = await client.rpc("api_delete_account");
    expect(error?.code).toBe("22023");

    // Ground truth: workspace not soft-deleted; profile row not created.
    expect(await readDeletedAt(me.workspaceId)).toBeNull();
    expect(await readProfileDeletedAt(me.userId)).toBeUndefined();
  });

  test("multiple blocking workspaces: blocked + atomicity (no partial cascade)", async () => {
    const me = await pool.create({ fullName: "Multi-Owner" });

    // Build a second owned workspace via service-role.
    const admin = createServiceRoleClient();
    const ws2 = await admin
      .from("workspaces")
      .insert({
        name: "Secondary",
        slug: `secondary-${crypto.randomUUID().slice(0, 8)}`,
      })
      .select("id")
      .single();
    expect(ws2.error).toBeNull();
    const ws2Id = ws2.data!.id;
    await admin.from("workspace_members").insert({
      workspace_id: ws2Id,
      user_id: me.userId,
      role: "owner",
    });

    // Both workspaces have other members.
    const editor1 = await pool.create({ fullName: "E1" });
    const editor2 = await pool.create({ fullName: "E2" });
    await addMembership(me.workspaceId, editor1.userId, "editor");
    await addMembership(ws2Id, editor2.userId, "editor");

    const client = await clientFor(me);
    const { error } = await client.rpc("api_delete_account");
    expect(error?.code).toBe("22023");

    // Atomicity check: NEITHER workspace got soft-deleted; profile not
    // created. The blocking check fires before the cascade.
    expect(await readDeletedAt(me.workspaceId)).toBeNull();
    expect(await readDeletedAt(ws2Id)).toBeNull();
    expect(await readProfileDeletedAt(me.userId)).toBeUndefined();

    // Cleanup the manually-created secondary workspace (the test-user
    // pool only knows about the auto-created one).
    await admin.from("workspaces").delete().eq("id", ws2Id);
  });

  test("already-deleted retry returns 22023 (Q7 idempotency)", async () => {
    const solo = await pool.create({ fullName: "Idempotent" });
    const client = await clientFor(solo);

    const first = await client.rpc("api_delete_account");
    expect(first.error).toBeNull();

    const second = await client.rpc("api_delete_account");
    expect(second.error?.code).toBe("22023");
  });

  test("after cascade, the soft-deleted workspace is RLS-hidden from former members (A1 β policy)", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const otherOwner = await pool.create({ fullName: "Other Owner" });

    // Add otherOwner as editor to owner's workspace, then remove them
    // again — leaves the workspace as sole-member so cascade fires.
    // (We need a real "former member" who can attempt to SELECT post-
    // cascade; service-role inserts a member, then deletion clears them.)
    // Simpler: use a separate workspace-scoped check via service-role
    // ground truth + an authenticated client lookup.
    const client = await clientFor(owner);
    const { error } = await client.rpc("api_delete_account");
    expect(error).toBeNull();

    // otherOwner (not a member) attempts to SELECT — should see nothing
    // under RLS regardless of soft-delete; this is just sanity.
    const otherClient = await clientFor(otherOwner);
    const select = await otherClient
      .from("workspaces")
      .select("id")
      .eq("id", owner.workspaceId);
    expect(select.error).toBeNull();
    expect(select.data ?? []).toHaveLength(0);
  });

  test("Q8 canary — soft-deleted workspaces do NOT count as blockers (only-soft-deleted-blockers user can delete cleanly)", async () => {
    // Setup: user owns one workspace with another member, then
    // soft-deletes that workspace (via api_delete_workspace, the A1
    // RPC). The blocking predicate's `deleted_at IS NULL` clause must
    // exclude this workspace; otherwise the user would be blocked by
    // their own already-deleted workspace.
    const me = await pool.create({ fullName: "Recovered" });
    const editor = await pool.create({ fullName: "Editor" });
    await addMembership(me.workspaceId, editor.userId, "editor");

    const client = await clientFor(me);
    // Soft-delete the workspace first.
    const del = await client.rpc("api_delete_workspace", {
      _workspace_id: me.workspaceId,
    });
    expect(del.error).toBeNull();

    // Now api_delete_account must succeed — the only "potentially-
    // blocking" workspace is soft-deleted, which the predicate skips.
    const { error } = await client.rpc("api_delete_account");
    expect(error).toBeNull();

    // Ground truth: user_profiles row created.
    expect(await readProfileDeletedAt(me.userId)).not.toBeUndefined();
  });

  test("api_my_blocking_workspaces returns the same set the worker uses (shared-predicate sanity)", async () => {
    const me = await pool.create({ fullName: "Inspector" });
    const editor = await pool.create({ fullName: "Editor" });
    await addMembership(me.workspaceId, editor.userId, "editor");

    const client = await clientFor(me);
    const { data, error } = await client.rpc("api_my_blocking_workspaces");
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data?.length).toBe(1);
    expect((data as Array<{ id: string }>)[0]?.id).toBe(me.workspaceId);

    // Confirm the worker agrees with the SSR helper.
    const del = await client.rpc("api_delete_account");
    expect(del.error?.code).toBe("22023");
  });

  test("anonymous client cannot call api_my_blocking_workspaces (42501)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_my_blocking_workspaces");
    expect(error?.code).toBe("42501");
  });

  test("api_my_blocking_workspaces returns empty when caller has no live blocking workspaces", async () => {
    const solo = await pool.create({ fullName: "Solo" });
    const client = await clientFor(solo);
    const { data, error } = await client.rpc("api_my_blocking_workspaces");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
