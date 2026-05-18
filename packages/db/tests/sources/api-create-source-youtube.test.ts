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
// Sprint 08 B2 — public.api_create_source_youtube.
//
// Coverage (mirrors api_create_source_url shape; matches the api_*
// perimeter convention from packages/db/tests/CLAUDE.md):
//   1. Perimeter: anon rejected (22023, auth.uid() defensive check).
//   2. Perimeter: authenticated non-member rejected (42501 from
//      private.is_workspace_member check).
//   3. Happy path: member calls RPC; row inserted with workspace_id,
//      user_id, type='youtube_transcript', content='',
//      status='processing', source_url (original user-pasted form
//      per A3.4), title=null, error=null, deleted_at=null.
//   4. Cross-tenant SELECT isolation: user A's youtube_transcript
//      source is not visible to user B. Confirms the shared
//      sources_select RLS policy applies cleanly to the new type
//      (third widening of the type CHECK constraint — Sprint 06
//      added audio_transcript, Sprint 07 added url_extraction +
//      pdf_extraction, Sprint 08 B2 adds youtube_transcript).
// =============================================================================

describe("public.api_create_source_youtube", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("perimeter: anon rejected with 22023 (auth.uid() defensive check)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_create_source_youtube", {
      _workspace_id: "00000000-0000-0000-0000-000000000000",
      _source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    } as never);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toMatch(/user id is required/i);
  });

  test("perimeter: authenticated non-member rejected with 42501", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });

    const outsiderClient = createAuthenticatedClient(outsider.accessToken);
    const { error } = await outsiderClient.rpc("api_create_source_youtube", {
      _workspace_id: owner.workspaceId,
      _source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    } as never);

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/not a member of workspace/i);
  });

  test("happy path: member RPC call inserts row with correct columns", async () => {
    const owner = await pool.create({ fullName: "YouTube Source Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    // Original user-pasted URL preserved per A3.4 — yt-dlp normalizes
    // the ~8 single-video URL forms internally at extraction time, but
    // the row stores what the user submitted.
    const sourceUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const { data: sourceId, error } = await ownerClient.rpc(
      "api_create_source_youtube",
      {
        _workspace_id: owner.workspaceId,
        _source_url: sourceUrl,
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
    expect(row?.type).toBe("youtube_transcript");
    expect(row?.content).toBe("");
    expect(row?.status).toBe("processing");
    expect(row?.source_url).toBe(sourceUrl);
    expect(row?.title).toBeNull();
    expect(row?.error).toBeNull();
    expect(row?.deleted_at).toBeNull();
  });

  test("cross-tenant SELECT isolation: user B cannot see user A's youtube source", async () => {
    const userA = await pool.create({ fullName: "User A" });
    const userB = await pool.create({ fullName: "User B" });

    const userAClient = createAuthenticatedClient(userA.accessToken);
    const { data: sourceId, error: createError } = await userAClient.rpc(
      "api_create_source_youtube",
      {
        _workspace_id: userA.workspaceId,
        _source_url: "https://www.youtube.com/watch?v=private-video-id",
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
