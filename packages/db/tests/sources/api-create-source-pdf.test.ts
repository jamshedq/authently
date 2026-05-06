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
// Sprint 07 C2b.1 — public.api_create_source_pdf.
//
// Coverage (mirrors api_create_source_audio test shape):
//   1. Perimeter: anon rejected (22023, auth.uid() defensive check).
//   2. Perimeter: authenticated non-member rejected (42501).
//   3. Happy path: member calls RPC; row inserted with workspace_id,
//      user_id, type='pdf_extraction', content='', status='processing',
//      source_url=null (Storage path is computed, not stored), title from
//      param, error=null, deleted_at=null.
//   4. Cross-tenant SELECT isolation: user A's pdf_extraction source is
//      not visible to user B.
//
// Note. _title is the user-supplied filename for display fallback (per E5);
// Python extraction may overwrite it via svc_update_source_status. The
// PDF bytes live at `ws/{workspace_id}/{source_id}.pdf` in the
// `sources-pdf` Storage bucket — the path is NOT stored in any column;
// it's computed deterministically by both the apps/web action layer
// (C2b.2) and C2a's extractFromPdfTask.
// =============================================================================

describe("public.api_create_source_pdf", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("perimeter: anon rejected with 22023 (auth.uid() defensive check)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_create_source_pdf", {
      _workspace_id: "00000000-0000-0000-0000-000000000000",
      _title: "anon attempt.pdf",
    } as never);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toMatch(/user id is required/i);
  });

  test("perimeter: authenticated non-member rejected with 42501", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });

    const outsiderClient = createAuthenticatedClient(outsider.accessToken);
    const { error } = await outsiderClient.rpc("api_create_source_pdf", {
      _workspace_id: owner.workspaceId,
      _title: "outsider.pdf",
    } as never);

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/not a member of workspace/i);
  });

  test("happy path: member RPC call inserts row with correct columns", async () => {
    const owner = await pool.create({ fullName: "PDF Source Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    const title = "research-paper.pdf";
    const { data: sourceId, error } = await ownerClient.rpc(
      "api_create_source_pdf",
      {
        _workspace_id: owner.workspaceId,
        _title: title,
      } as never,
    );

    expect(error).toBeNull();
    expect(sourceId).toBeTypeOf("string");

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
    expect(row?.type).toBe("pdf_extraction");
    expect(row?.content).toBe("");
    expect(row?.status).toBe("processing");
    expect(row?.source_url).toBeNull();
    expect(row?.title).toBe(title);
    expect(row?.error).toBeNull();
    expect(row?.deleted_at).toBeNull();
  });

  test("cross-tenant SELECT isolation: user B cannot see user A's pdf source", async () => {
    const userA = await pool.create({ fullName: "User A" });
    const userB = await pool.create({ fullName: "User B" });

    const userAClient = createAuthenticatedClient(userA.accessToken);
    const { data: sourceId, error: createError } = await userAClient.rpc(
      "api_create_source_pdf",
      {
        _workspace_id: userA.workspaceId,
        _title: "user-a-private.pdf",
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

    const { data: rowsVisibleToA } = await userAClient
      .from("sources")
      .select("id")
      .eq("id", sourceId as string);

    expect(rowsVisibleToA).toHaveLength(1);
  });
});
