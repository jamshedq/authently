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

// Idempotency contract for /api/auth/post-signup, enforced at the DB layer
// by public.api_ensure_my_workspace (migration 20260428000002).

describe("api_ensure_my_workspace (post-sign-up reconciliation)", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("returns the trigger-created workspace and is idempotent across repeated calls", async () => {
    const u = await pool.create({ fullName: "Repeat Caller" });
    const client = createAuthenticatedClient(u.accessToken);

    const first = await client.rpc("api_ensure_my_workspace");
    const second = await client.rpc("api_ensure_my_workspace");

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data).toBe(u.workspaceId);
    expect(second.data).toBe(u.workspaceId);

    // No duplicate workspace was created.
    const admin = createServiceRoleClient();
    const memberships = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", u.userId);
    expect(memberships.error).toBeNull();
    expect(memberships.data).toHaveLength(1);
  });

  test("creates a workspace + owner membership when the user has none (fallback path)", async () => {
    const u = await pool.create({ fullName: "Fallback User" });
    const admin = createServiceRoleClient();

    // Drop the trigger-created workspace; cascades clear the membership.
    const wipe = await admin
      .from("workspaces")
      .delete()
      .eq("id", u.workspaceId);
    expect(wipe.error).toBeNull();

    const before = await admin
      .from("workspace_members")
      .select("workspace_id", { count: "exact", head: true })
      .eq("user_id", u.userId);
    expect(before.count).toBe(0);

    // RPC the fallback path.
    const client = createAuthenticatedClient(u.accessToken);
    const rpc = await client.rpc("api_ensure_my_workspace");
    expect(rpc.error).toBeNull();
    expect(rpc.data).toBeTruthy();

    const newWorkspaceId = rpc.data as string;
    expect(newWorkspaceId).not.toBe(u.workspaceId);

    // Verify shape: creator template, owner role, name from full_name.
    const ws = await admin
      .from("workspaces")
      .select("id, name, slug, template, plan_tier")
      .eq("id", newWorkspaceId)
      .single();
    expect(ws.error).toBeNull();
    expect(ws.data?.template).toBe("creator");
    expect(ws.data?.plan_tier).toBe("free");
    expect(ws.data?.name).toBe("Fallback User's Workspace");
    expect(ws.data?.slug).toMatch(/^fallback-user-[a-f0-9]{8}$/);

    const member = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", newWorkspaceId)
      .eq("user_id", u.userId)
      .single();
    expect(member.error).toBeNull();
    expect(member.data?.role).toBe("owner");

    // The TestUserPool only knows about u.workspaceId (already deleted).
    // Clean up the freshly-created workspace explicitly so the user delete
    // doesn't leave it orphaned.
    const cleanup = await admin.from("workspaces").delete().eq("id", newWorkspaceId);
    expect(cleanup.error).toBeNull();
  });
});
