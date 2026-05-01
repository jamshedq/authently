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
// Sprint 04 A2 — workspace ownership transfer RLS + state-machine contract.
//
// Migration 20260501231519 introduces:
//   - public.workspace_ownership_transfers (id, workspace_id, from_user_id,
//     to_user_id, created_at, accepted_at, cancelled_at) with partial unique
//     index on workspace_id where pending
//   - SELECT-only RLS (owner + target); INSERT/UPDATE/DELETE revoked from
//     authenticated — DEFINER RPCs are the sole write path
//   - Three private workers + three public.api_* wrappers:
//       initiate / accept / cancel
//   - All workers add a `workspace.deleted_at IS NULL` predicate (Q6)
//
// State machine the tests exercise:
//   pending → accepted (terminal)
//   pending → cancelled (terminal)
//
// Coverage classes:
//   1. RPC perimeter (anon rejected on all three RPCs)
//   2. initiate guards: non-owner, non-member target, self-transfer (target
//      is owner), partial-unique, soft-deleted workspace, happy path
//   3. accept guards: non-target, already-cancelled, target left workspace,
//      soft-deleted workspace, atomic role-swap on success
//   4. cancel guards: third party, soft-deleted workspace, owner-cancels,
//      target-cancels (rejects)
//   5. post-transfer: original owner cannot re-initiate (they're admin now)
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

async function readRoles(
  workspaceId: string,
  userIds: readonly string[],
): Promise<Record<string, string>> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .in("user_id", [...userIds]);
  if (error) throw new Error(`readRoles failed: ${error.message}`);
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[row.user_id] = row.role;
  return out;
}

describe("ownership transfer — RPC perimeter (anon)", () => {
  const pool = new TestUserPool();
  let owner: TestUser;
  let target: TestUser;
  let workspaceId: string;
  let transferId: string;

  beforeEach(async () => {
    owner = await pool.create({ fullName: "Owner" });
    target = await pool.create({ fullName: "Target" });
    workspaceId = owner.workspaceId;
    await addMembership(workspaceId, target.userId, "editor");

    // Seed a pending transfer via the owner so we can exercise accept/cancel
    // RPC perimeters too.
    const ownerClient = await clientFor(owner);
    const init = await ownerClient.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: target.userId,
    });
    if (init.error) throw new Error(`seed failed: ${init.error.message}`);
    transferId = init.data as string;
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("anonymous client cannot call api_initiate_ownership_transfer", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: target.userId,
    });
    expect(error?.code).toBe("42501");
  });

  test("anonymous client cannot call api_accept_ownership_transfer", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_accept_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(error?.code).toBe("42501");
  });

  test("anonymous client cannot call api_cancel_ownership_transfer", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_cancel_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(error?.code).toBe("42501");
  });
});

describe("ownership transfer — initiate guards", () => {
  const pool = new TestUserPool();
  let owner: TestUser;
  let target: TestUser;
  let workspaceId: string;

  beforeEach(async () => {
    owner = await pool.create({ fullName: "Owner" });
    target = await pool.create({ fullName: "Target" });
    workspaceId = owner.workspaceId;
    await addMembership(workspaceId, target.userId, "editor");
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("non-owner member cannot initiate (42501)", async () => {
    const nonOwner = await clientFor(target); // editor
    const { error } = await nonOwner.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: target.userId,
    });
    expect(error?.code).toBe("42501");
  });

  test("owner cannot initiate to a non-member (22023)", async () => {
    const stranger = await pool.create({ fullName: "Stranger" });
    const ownerClient = await clientFor(owner);
    const { error } = await ownerClient.rpc(
      "api_initiate_ownership_transfer",
      {
        _workspace_id: workspaceId,
        _to_user_id: stranger.userId,
      },
    );
    expect(error?.code).toBe("22023");
  });

  test("self-transfer is rejected (target is the owner; 22023)", async () => {
    const ownerClient = await clientFor(owner);
    const { error } = await ownerClient.rpc(
      "api_initiate_ownership_transfer",
      {
        _workspace_id: workspaceId,
        _to_user_id: owner.userId,
      },
    );
    // Hits the "target is already the workspace owner" branch — implicit
    // self-transfer guard via the non-owner-member check.
    expect(error?.code).toBe("22023");
  });

  test("partial-unique: owner cannot initiate two transfers simultaneously (22023)", async () => {
    const ownerClient = await clientFor(owner);
    const first = await ownerClient.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: target.userId,
    });
    expect(first.error).toBeNull();

    const second = await ownerClient.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: target.userId,
    });
    // Worker's explicit pending-exists check fires before the partial
    // unique constraint would (cleaner error code than 23505).
    expect(second.error?.code).toBe("22023");
  });

  test("Q6 — cannot initiate on a soft-deleted workspace (22023)", async () => {
    const ownerClient = await clientFor(owner);
    const del = await ownerClient.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(del.error).toBeNull();

    const { error } = await ownerClient.rpc(
      "api_initiate_ownership_transfer",
      {
        _workspace_id: workspaceId,
        _to_user_id: target.userId,
      },
    );
    expect(error?.code).toBe("22023");
  });

  test("owner happy path: returns transfer id; row is pending", async () => {
    const ownerClient = await clientFor(owner);
    const { data, error } = await ownerClient.rpc(
      "api_initiate_ownership_transfer",
      {
        _workspace_id: workspaceId,
        _to_user_id: target.userId,
      },
    );
    expect(error).toBeNull();
    expect(typeof data).toBe("string");

    // Ground truth via service role.
    const admin = createServiceRoleClient();
    const row = await admin
      .from("workspace_ownership_transfers")
      .select("workspace_id, from_user_id, to_user_id, accepted_at, cancelled_at")
      .eq("id", data as string)
      .single();
    expect(row.error).toBeNull();
    expect(row.data?.workspace_id).toBe(workspaceId);
    expect(row.data?.from_user_id).toBe(owner.userId);
    expect(row.data?.to_user_id).toBe(target.userId);
    expect(row.data?.accepted_at).toBeNull();
    expect(row.data?.cancelled_at).toBeNull();
  });
});

describe("ownership transfer — accept guards + happy path", () => {
  const pool = new TestUserPool();
  let owner: TestUser;
  let target: TestUser;
  let workspaceId: string;
  let transferId: string;

  beforeEach(async () => {
    owner = await pool.create({ fullName: "Owner" });
    target = await pool.create({ fullName: "Target" });
    workspaceId = owner.workspaceId;
    await addMembership(workspaceId, target.userId, "editor");

    const ownerClient = await clientFor(owner);
    const init = await ownerClient.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: target.userId,
    });
    if (init.error) throw new Error(`seed failed: ${init.error.message}`);
    transferId = init.data as string;
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("non-target authenticated user cannot accept (42501)", async () => {
    // The original owner is authenticated and is a party to the transfer
    // (from_user_id), but accept is target-only.
    const ownerClient = await clientFor(owner);
    const { error } = await ownerClient.rpc("api_accept_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(error?.code).toBe("42501");
  });

  test("cannot accept an already-cancelled transfer (22023)", async () => {
    const ownerClient = await clientFor(owner);
    const cancel = await ownerClient.rpc("api_cancel_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(cancel.error).toBeNull();

    const targetClient = await clientFor(target);
    const { error } = await targetClient.rpc("api_accept_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(error?.code).toBe("22023");
  });

  test("accept fails when target has left the workspace (22023)", async () => {
    // Service-role removes the target's membership row.
    const admin = createServiceRoleClient();
    const del = await admin
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", target.userId);
    expect(del.error).toBeNull();

    const targetClient = await clientFor(target);
    const { error } = await targetClient.rpc("api_accept_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(error?.code).toBe("22023");
  });

  test("Q6 — accept fails on a soft-deleted workspace (22023)", async () => {
    const ownerClient = await clientFor(owner);
    const delWs = await ownerClient.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(delWs.error).toBeNull();

    const targetClient = await clientFor(target);
    const { error } = await targetClient.rpc("api_accept_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(error?.code).toBe("22023");
  });

  test("target accepts → atomic role swap; transfer marked accepted_at", async () => {
    const targetClient = await clientFor(target);
    const before = Date.now();
    const { error } = await targetClient.rpc("api_accept_ownership_transfer", {
      _transfer_id: transferId,
    });
    const after = Date.now();
    expect(error).toBeNull();

    // Roles swapped: previous owner is admin; target is owner.
    const roles = await readRoles(workspaceId, [owner.userId, target.userId]);
    expect(roles[owner.userId]).toBe("admin");
    expect(roles[target.userId]).toBe("owner");

    // Transfer row marked accepted_at within the window.
    const admin = createServiceRoleClient();
    const row = await admin
      .from("workspace_ownership_transfers")
      .select("accepted_at, cancelled_at")
      .eq("id", transferId)
      .single();
    expect(row.error).toBeNull();
    expect(row.data?.cancelled_at).toBeNull();
    expect(row.data?.accepted_at).not.toBeNull();
    // Compare instants per packages/db/tests/CLAUDE.md.
    const acceptedMs = new Date(row.data!.accepted_at!).getTime();
    expect(acceptedMs).toBeGreaterThanOrEqual(before - 1000);
    expect(acceptedMs).toBeLessThanOrEqual(after + 1000);
  });
});

describe("ownership transfer — cancel guards + happy paths", () => {
  const pool = new TestUserPool();
  let owner: TestUser;
  let target: TestUser;
  let workspaceId: string;
  let transferId: string;

  beforeEach(async () => {
    owner = await pool.create({ fullName: "Owner" });
    target = await pool.create({ fullName: "Target" });
    workspaceId = owner.workspaceId;
    await addMembership(workspaceId, target.userId, "editor");

    const ownerClient = await clientFor(owner);
    const init = await ownerClient.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: target.userId,
    });
    if (init.error) throw new Error(`seed failed: ${init.error.message}`);
    transferId = init.data as string;
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("third-party authenticated user cannot cancel (42501)", async () => {
    const stranger = await pool.create({ fullName: "Stranger" });
    const strangerClient = await clientFor(stranger);
    const { error } = await strangerClient.rpc(
      "api_cancel_ownership_transfer",
      {
        _transfer_id: transferId,
      },
    );
    expect(error?.code).toBe("42501");
  });

  test("owner cancels their own transfer (state correct; can re-initiate)", async () => {
    const ownerClient = await clientFor(owner);
    const cancel = await ownerClient.rpc("api_cancel_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(cancel.error).toBeNull();

    const admin = createServiceRoleClient();
    const row = await admin
      .from("workspace_ownership_transfers")
      .select("accepted_at, cancelled_at")
      .eq("id", transferId)
      .single();
    expect(row.data?.accepted_at).toBeNull();
    expect(row.data?.cancelled_at).not.toBeNull();

    // Owner can re-initiate now that the previous transfer is terminal.
    const reInit = await ownerClient.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: target.userId,
    });
    expect(reInit.error).toBeNull();
  });

  test("target rejects via cancel (state correct)", async () => {
    const targetClient = await clientFor(target);
    const cancel = await targetClient.rpc("api_cancel_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(cancel.error).toBeNull();

    const admin = createServiceRoleClient();
    const row = await admin
      .from("workspace_ownership_transfers")
      .select("cancelled_at")
      .eq("id", transferId)
      .single();
    expect(row.data?.cancelled_at).not.toBeNull();
  });

  test("Q6 — cannot cancel on a soft-deleted workspace (22023)", async () => {
    const ownerClient = await clientFor(owner);
    const delWs = await ownerClient.rpc("api_delete_workspace", {
      _workspace_id: workspaceId,
    });
    expect(delWs.error).toBeNull();

    const { error } = await ownerClient.rpc("api_cancel_ownership_transfer", {
      _transfer_id: transferId,
    });
    expect(error?.code).toBe("22023");
  });
});

describe("ownership transfer — post-transfer", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("after successful transfer, original owner is now admin and cannot re-initiate (42501)", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const target = await pool.create({ fullName: "Target" });
    const workspaceId = owner.workspaceId;
    await addMembership(workspaceId, target.userId, "editor");

    const ownerClient = await clientFor(owner);
    const init = await ownerClient.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: target.userId,
    });
    expect(init.error).toBeNull();

    const targetClient = await clientFor(target);
    const accept = await targetClient.rpc("api_accept_ownership_transfer", {
      _transfer_id: init.data as string,
    });
    expect(accept.error).toBeNull();

    // Original owner (now admin) tries to initiate a new transfer.
    const reInit = await ownerClient.rpc("api_initiate_ownership_transfer", {
      _workspace_id: workspaceId,
      _to_user_id: owner.userId, // anything; perimeter rejects first
    });
    expect(reInit.error?.code).toBe("42501");

    // New owner (target) can initiate. Sanity check the role swap is real.
    const newOwnerInit = await targetClient.rpc(
      "api_initiate_ownership_transfer",
      {
        _workspace_id: workspaceId,
        _to_user_id: owner.userId,
      },
    );
    expect(newOwnerInit.error).toBeNull();
  });
});
