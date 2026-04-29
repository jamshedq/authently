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
import { insertInvitationViaRls } from "../helpers/invitations.ts";
import { TestUserPool } from "../helpers/test-user.ts";

// Section C — RLS contract for workspace_invitations.
// Coverage:
//   - SELECT visible to all members of the workspace
//   - SELECT blocked for non-members
//   - INSERT allowed for owner (also via additional admin path)
//   - INSERT blocked for editor / viewer
//   - DELETE blocked for non-members
//   - Anonymous direct table read returns empty (anti-enumeration; access
//     is only via api_lookup_invitation RPC, which is tested separately)

describe("workspace_invitations RLS", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("owner can INSERT and member can SELECT", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    const inv = await insertInvitationViaRls(ownerClient, {
      workspaceId: owner.workspaceId,
      email: "newhire@example.com",
      role: "editor",
      invitedBy: owner.userId,
    });

    const { data, error } = await ownerClient
      .from("workspace_invitations")
      .select("id, email, role")
      .eq("id", inv.id)
      .single();
    expect(error).toBeNull();
    expect(data?.email).toBe("newhire@example.com");
    expect(data?.role).toBe("editor");
  });

  test("editor cannot INSERT — RLS rejects", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const editor = await pool.create({ fullName: "Editor" });
    // Add editor as a member of owner's workspace.
    const admin = createServiceRoleClient();
    const addEditor = await admin.from("workspace_members").insert({
      workspace_id: owner.workspaceId,
      user_id: editor.userId,
      role: "editor",
    });
    expect(addEditor.error).toBeNull();

    const editorClient = createAuthenticatedClient(editor.accessToken);
    await expect(
      insertInvitationViaRls(editorClient, {
        workspaceId: owner.workspaceId,
        email: "blocked@example.com",
        role: "viewer",
        invitedBy: editor.userId,
      }),
    ).rejects.toThrow();
  });

  test("non-member cannot SELECT another workspace's invitations", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const stranger = await pool.create({ fullName: "Stranger" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);
    const inv = await insertInvitationViaRls(ownerClient, {
      workspaceId: owner.workspaceId,
      email: "private@example.com",
      role: "viewer",
      invitedBy: owner.userId,
    });

    const strangerClient = createAuthenticatedClient(stranger.accessToken);
    const { data, error } = await strangerClient
      .from("workspace_invitations")
      .select("id")
      .eq("id", inv.id);
    // RLS hides the row — empty result, no error leak.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  test("non-member cannot DELETE another workspace's invitation", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const stranger = await pool.create({ fullName: "Stranger" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);
    const inv = await insertInvitationViaRls(ownerClient, {
      workspaceId: owner.workspaceId,
      email: "victim@example.com",
      role: "viewer",
      invitedBy: owner.userId,
    });

    const strangerClient = createAuthenticatedClient(stranger.accessToken);
    const del = await strangerClient
      .from("workspace_invitations")
      .delete()
      .eq("id", inv.id)
      .select("id");
    expect(del.error).toBeNull();
    // RLS hides the row → DELETE affects 0 rows. Verify the row still
    // exists via service role.
    expect(del.data ?? []).toHaveLength(0);

    const admin = createServiceRoleClient();
    const ground = await admin
      .from("workspace_invitations")
      .select("id")
      .eq("id", inv.id);
    expect(ground.data).toHaveLength(1);
  });

  test("anonymous direct SELECT returns empty (anti-enumeration)", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);
    await insertInvitationViaRls(ownerClient, {
      workspaceId: owner.workspaceId,
      email: "scanned@example.com",
      role: "viewer",
      invitedBy: owner.userId,
    });

    const anon = createAnonClient();
    const { data, error } = await anon
      .from("workspace_invitations")
      .select("id");
    // No SELECT policy for anon → empty result; no surface-level error
    // distinguishes "you can't list this" from "the table is empty".
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
