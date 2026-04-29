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
  createAuthenticatedClient,
  createServiceRoleClient,
} from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";

// Section C — private.prevent_last_owner_loss trigger contract.
// Errcode 23514 (check_violation) is the canonical signal.

describe("last-owner protection trigger", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("last owner cannot DELETE their own row", async () => {
    const owner = await pool.create({ fullName: "Lonely Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    const del = await ownerClient
      .from("workspace_members")
      .delete()
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", owner.userId);

    expect(del.error).not.toBeNull();
    expect(del.error?.code).toBe("23514");
  });

  test("last owner cannot UPDATE their role to non-owner (admin/editor/viewer)", async () => {
    const owner = await pool.create({ fullName: "Solo Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    const update = await ownerClient
      .from("workspace_members")
      // supabase-js v2.105 typed-update workaround.
      .update({ role: "admin" } as never)
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", owner.userId);

    expect(update.error).not.toBeNull();
    expect(update.error?.code).toBe("23514");
  });

  test("with two owners, either can leave (delete own row)", async () => {
    const ownerA = await pool.create({ fullName: "Owner A" });
    const ownerB = await pool.create({ fullName: "Owner B" });

    // Promote B to owner of A's workspace via service role.
    const admin = createServiceRoleClient();
    const addB = await admin.from("workspace_members").insert({
      workspace_id: ownerA.workspaceId,
      user_id: ownerB.userId,
      role: "owner",
    });
    expect(addB.error).toBeNull();

    // Now A leaves — protected by the trigger only if they're the LAST.
    // With B still owning, A's leave should succeed.
    const aClient = createAuthenticatedClient(ownerA.accessToken);
    const del = await aClient
      .from("workspace_members")
      .delete()
      .eq("workspace_id", ownerA.workspaceId)
      .eq("user_id", ownerA.userId);
    expect(del.error).toBeNull();

    // B is now the last owner; their leave attempt should fail 23514.
    const bClient = createAuthenticatedClient(ownerB.accessToken);
    const delB = await bClient
      .from("workspace_members")
      .delete()
      .eq("workspace_id", ownerA.workspaceId)
      .eq("user_id", ownerB.userId);
    expect(delB.error).not.toBeNull();
    expect(delB.error?.code).toBe("23514");
  });

  test("non-last-owner DELETE works fine (admin removed by owner)", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const adminUser = await pool.create({ fullName: "Admin" });

    const admin = createServiceRoleClient();
    const addAdmin = await admin.from("workspace_members").insert({
      workspace_id: owner.workspaceId,
      user_id: adminUser.userId,
      role: "admin",
    });
    expect(addAdmin.error).toBeNull();

    const ownerClient = createAuthenticatedClient(owner.accessToken);
    const del = await ownerClient
      .from("workspace_members")
      .delete()
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", adminUser.userId);
    expect(del.error).toBeNull();
  });
});
