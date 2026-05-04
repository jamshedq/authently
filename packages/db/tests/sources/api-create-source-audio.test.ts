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
} from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";

// =============================================================================
// Sprint 06 B5 — public.api_create_source_audio + sources SELECT RLS.
//
// Coverage:
//   1. Perimeter: anon rejected (42501).
//   2. Perimeter: authenticated non-member rejected (42501 from
//      private.is_workspace_member check).
//   3. Happy path: member calls RPC; row inserted with correct
//      workspace_id, user_id, type='audio_transcript', content.
//   4. Cross-tenant SELECT isolation: user A's source in workspace A
//      is not visible to user B (member of workspace B only). Verifies
//      the SELECT RLS policy via private.is_workspace_member helper.
// =============================================================================

// Note on perimeter codes for api_* (auth-callable) RPCs:
//
// Unlike svc_* (service-role-only) RPCs, where anon is rejected at the
// GRANT layer with 42501/PGRST202, api_* wrappers grant EXECUTE to
// authenticated and rely on Supabase's anon-may-still-execute behavior
// being filtered by the wrapper's `auth.uid() is null` defensive check.
// Anon callers reach the wrapper body, hit the defensive check, and are
// rejected with 22023 ("user id is required"). Same pattern as
// api_create_workspace and api_ensure_my_workspace.
//
// Authenticated-non-member callers hit the
// `not private.is_workspace_member(...)` check and are rejected with
// 42501 ("not a member of workspace") — that's the cross-tenant perimeter.

describe("public.api_create_source_audio", () => {
  const pool = new TestUserPool();

  beforeEach(() => {
    // No setup beyond the pool — each test creates its own users.
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("perimeter: anon rejected with 22023 (auth.uid() defensive check)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_create_source_audio", {
      _workspace_id: "00000000-0000-0000-0000-000000000000",
      _content: "anon attempt",
    } as never);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toMatch(/user id is required/i);
  });

  test("perimeter: authenticated non-member rejected with 42501", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });

    const outsiderClient = createAuthenticatedClient(outsider.accessToken);
    const { error } = await outsiderClient.rpc("api_create_source_audio", {
      _workspace_id: owner.workspaceId,
      _content: "outsider attempt",
    } as never);

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/not a member of workspace/i);
  });

  test("happy path: member RPC call inserts row with correct columns", async () => {
    const owner = await pool.create({ fullName: "Source Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    const transcript = "the quick brown fox jumps over the lazy dog";
    const { data: sourceId, error } = await ownerClient.rpc(
      "api_create_source_audio",
      {
        _workspace_id: owner.workspaceId,
        _content: transcript,
      } as never,
    );

    expect(error).toBeNull();
    expect(sourceId).toBeTypeOf("string");

    // Verify row contents via service-role read (bypassing RLS).
    const admin = createServiceRoleClient();
    const { data: row, error: readError } = await admin
      .from("sources")
      .select("id, workspace_id, user_id, type, content, deleted_at")
      .eq("id", sourceId as string)
      .maybeSingle();

    expect(readError).toBeNull();
    expect(row).not.toBeNull();
    expect(row?.workspace_id).toBe(owner.workspaceId);
    expect(row?.user_id).toBe(owner.userId);
    expect(row?.type).toBe("audio_transcript");
    expect(row?.content).toBe(transcript);
    expect(row?.deleted_at).toBeNull();
  });

  test("cross-tenant SELECT isolation: user B cannot see user A's source", async () => {
    const userA = await pool.create({ fullName: "User A" });
    const userB = await pool.create({ fullName: "User B" });

    // User A creates a source in workspace A.
    const userAClient = createAuthenticatedClient(userA.accessToken);
    const { data: sourceId, error: createError } = await userAClient.rpc(
      "api_create_source_audio",
      {
        _workspace_id: userA.workspaceId,
        _content: "user A's secret transcript",
      } as never,
    );
    expect(createError).toBeNull();
    expect(sourceId).toBeTypeOf("string");

    // User B (member of workspace B only) tries to read sources globally.
    // RLS should filter out user A's source.
    const userBClient = createAuthenticatedClient(userB.accessToken);
    const { data: rowsVisibleToB, error: readError } = await userBClient
      .from("sources")
      .select("id")
      .eq("id", sourceId as string);

    expect(readError).toBeNull();
    expect(rowsVisibleToB).toEqual([]);

    // Sanity: user A CAN see their own source.
    const { data: rowsVisibleToA } = await userAClient
      .from("sources")
      .select("id")
      .eq("id", sourceId as string);

    expect(rowsVisibleToA).toHaveLength(1);
  });
});
