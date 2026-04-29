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
import type { Database } from "../../types.ts";
import {
  createAuthenticatedClient,
  createServiceRoleClient,
  type AuthentlyClient,
} from "../helpers/supabase-clients.ts";
import { TestUserPool, type TestUser } from "../helpers/test-user.ts";

// RLS contract for the workspaces UPDATE path introduced in migration
// 20260429213717: only owner + admin can mutate; column-level GRANTs
// further restrict the writeable set to (name, template).

type Role = Database["public"]["Tables"]["workspace_members"]["Row"]["role"];

async function addMembership(
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<void> {
  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role });
  if (error) throw new Error(`addMembership failed: ${error.message}`);
}

async function clientFor(user: TestUser): Promise<AuthentlyClient> {
  return createAuthenticatedClient(user.accessToken);
}

describe("workspaces UPDATE RLS", () => {
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

  test("owner can update name + template", async () => {
    const client = await clientFor(owner);
    const update = await client
      .from("workspaces")
      .update({ name: "Renamed by Owner", template: "smb" })
      .eq("id", workspaceId)
      .select("id, name, template");

    expect(update.error).toBeNull();
    expect(update.data).toHaveLength(1);
    expect(update.data?.[0]?.name).toBe("Renamed by Owner");
    expect(update.data?.[0]?.template).toBe("smb");
  });

  test("admin can update name + template", async () => {
    const admin = await pool.create({ fullName: "Admin" });
    await addMembership(workspaceId, admin.userId, "admin");
    const client = await clientFor(admin);

    const update = await client
      .from("workspaces")
      .update({ name: "Renamed by Admin", template: "community" })
      .eq("id", workspaceId)
      .select("id, name, template");

    expect(update.error).toBeNull();
    expect(update.data).toHaveLength(1);
    expect(update.data?.[0]?.name).toBe("Renamed by Admin");
  });

  test("editor cannot update — RLS hides the row from the update result set", async () => {
    const editor = await pool.create({ fullName: "Editor" });
    await addMembership(workspaceId, editor.userId, "editor");
    const client = await clientFor(editor);

    const update = await client
      .from("workspaces")
      .update({ name: "Should Not Apply" })
      .eq("id", workspaceId)
      .select("id, name");

    expect(update.error).toBeNull();
    expect(update.data ?? []).toHaveLength(0);

    // Ground truth via service role: name was not changed.
    const groundTruth = createServiceRoleClient();
    const ws = await groundTruth
      .from("workspaces")
      .select("name")
      .eq("id", workspaceId)
      .single();
    expect(ws.data?.name).not.toBe("Should Not Apply");
  });

  test("viewer cannot update", async () => {
    const viewer = await pool.create({ fullName: "Viewer" });
    await addMembership(workspaceId, viewer.userId, "viewer");
    const client = await clientFor(viewer);

    const update = await client
      .from("workspaces")
      .update({ name: "Viewer Attempt" })
      .eq("id", workspaceId)
      .select("id");

    expect(update.error).toBeNull();
    expect(update.data ?? []).toHaveLength(0);
  });

  test("non-member from another workspace cannot update", async () => {
    const stranger = await pool.create({ fullName: "Stranger" });
    const client = await clientFor(stranger);

    const update = await client
      .from("workspaces")
      .update({ name: "Cross-tenant" })
      .eq("id", workspaceId)
      .select("id");

    expect(update.error).toBeNull();
    expect(update.data ?? []).toHaveLength(0);
  });

  test("owner cannot update locked columns (slug, plan_tier, stripe_*)", async () => {
    const client = await clientFor(owner);

    // Column-level GRANTs revoke UPDATE on these columns from authenticated.
    // PostgREST surfaces this as 42501 (insufficient_privilege).
    const slugAttempt = await client
      .from("workspaces")
      .update({ slug: "rebranded-by-owner" })
      .eq("id", workspaceId);
    expect(slugAttempt.error).not.toBeNull();
    expect(slugAttempt.error?.code).toBe("42501");

    const planAttempt = await client
      .from("workspaces")
      .update({ plan_tier: "studio" })
      .eq("id", workspaceId);
    expect(planAttempt.error).not.toBeNull();
    expect(planAttempt.error?.code).toBe("42501");

    const stripeAttempt = await client
      .from("workspaces")
      .update({ stripe_customer_id: "cus_attacker" })
      .eq("id", workspaceId);
    expect(stripeAttempt.error).not.toBeNull();
    expect(stripeAttempt.error?.code).toBe("42501");
  });
});
