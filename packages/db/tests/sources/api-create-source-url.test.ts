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

// =============================================================================
// Sprint 07 C2b.1 — public.api_create_source_url.
//
// Coverage (mirrors api_create_source_audio test shape):
//   1. Perimeter: anon rejected (22023, auth.uid() defensive check —
//      api_* convention; svc_* uses 42501 at the GRANT layer).
//   2. Perimeter: authenticated non-member rejected (42501 from
//      private.is_workspace_member check).
//   3. Happy path: member calls RPC; row inserted with workspace_id,
//      user_id, type='url_extraction', content='', status='processing',
//      source_url, title=null, error=null, deleted_at=null.
//   4. Cross-tenant SELECT isolation: user A's url_extraction source is
//      not visible to user B (member of workspace B only). Verifies the
//      shared sources_select RLS policy applies cleanly to the new type.
// =============================================================================

describe("public.api_create_source_url", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("perimeter: anon rejected with 22023 (auth.uid() defensive check)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_create_source_url", {
      _workspace_id: "00000000-0000-0000-0000-000000000000",
      _source_url: "https://example.test/article",
    } as never);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toMatch(/user id is required/i);
  });

  test("perimeter: authenticated non-member rejected with 42501", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });

    const outsiderClient = createAuthenticatedClient(outsider.accessToken);
    const { error } = await outsiderClient.rpc("api_create_source_url", {
      _workspace_id: owner.workspaceId,
      _source_url: "https://example.test/article",
    } as never);

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/not a member of workspace/i);
  });

  test("happy path: member RPC call inserts row with correct columns", async () => {
    const owner = await pool.create({ fullName: "URL Source Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    const sourceUrl = "https://example.test/article";
    const { data: sourceId, error } = await ownerClient.rpc(
      "api_create_source_url",
      {
        _workspace_id: owner.workspaceId,
        _source_url: sourceUrl,
      } as never,
    );

    expect(error).toBeNull();
    expect(sourceId).toBeTypeOf("string");

    // Verify row contents via service-role read (bypassing RLS).
    const admin = createServiceRoleClient();
    const { data: row, error: readError } = await admin
      .from("sources")
      .select(
        "id, workspace_id, user_id, type, content, status, source_url, title, error, deleted_at",
      )
      .eq("id", sourceId as string)
      .maybeSingle();

    expect(readError).toBeNull();
    expect(row).not.toBeNull();
    expect(row?.workspace_id).toBe(owner.workspaceId);
    expect(row?.user_id).toBe(owner.userId);
    expect(row?.type).toBe("url_extraction");
    expect(row?.content).toBe("");
    expect(row?.status).toBe("processing");
    expect(row?.source_url).toBe(sourceUrl);
    expect(row?.title).toBeNull();
    expect(row?.error).toBeNull();
    expect(row?.deleted_at).toBeNull();
  });

  test("cross-tenant SELECT isolation: user B cannot see user A's url source", async () => {
    const userA = await pool.create({ fullName: "User A" });
    const userB = await pool.create({ fullName: "User B" });

    const userAClient = createAuthenticatedClient(userA.accessToken);
    const { data: sourceId, error: createError } = await userAClient.rpc(
      "api_create_source_url",
      {
        _workspace_id: userA.workspaceId,
        _source_url: "https://example.test/private-article",
      } as never,
    );
    expect(createError).toBeNull();
    expect(sourceId).toBeTypeOf("string");

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
