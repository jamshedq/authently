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

// =============================================================================
// Sprint 07 C3.1 — listSources service module integration tests
// (Checkpoint 3 of 4).
//
// Real Supabase + TestUserPool + RLS-subject queries. Verifies:
//   1. Workspace member sees their rows in created_at DESC order, with
//      soft-deleted rows filtered out (the `WHERE deleted_at IS NULL`
//      clause + the `sources_select` RLS policy from Sprint 06 working
//      together).
//   2. Cross-workspace isolation via RLS — calling listSources from
//      user A's auth context with workspace B's id returns empty
//      (`sources_select` policy hides rows from non-members).
//
// Sort order (created_at DESC) is verified at the SERVICE tier here
// because that's where the SQL ORDER BY lives. SourcesList component
// just renders whatever array it receives — verified at component tier
// in tests/app/sources/sources-list.test.tsx.
// =============================================================================

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  setMockUserToken,
  clearMockUserToken,
  supabaseServerMockModule,
} from "../../helpers/server-client-mock";
import { TestUserPool, serviceRoleClient } from "../../helpers/test-workspace";

vi.mock("@/lib/supabase/server", () => supabaseServerMockModule);

import { listSources } from "@/services/sources/list-sources";
import { createSupabaseServerClient } from "@/lib/supabase/server";

describe("listSources", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    clearMockUserToken();
    await pool.cleanup();
  });

  test("workspace member sees their rows in created_at DESC order; soft-deleted rows excluded", async () => {
    const owner = await pool.create({ fullName: "List Sources Owner" });
    setMockUserToken(owner.accessToken);

    // Seed three rows via service-role with controlled timestamps:
    //   - oldest: 2026-05-01 (active)
    //   - middle: 2026-05-04 (soft-deleted; should NOT appear)
    //   - newest: 2026-05-07 (active)
    const admin = serviceRoleClient();
    const oldestId = crypto.randomUUID();
    const middleSoftDeletedId = crypto.randomUUID();
    const newestId = crypto.randomUUID();

    const { error: insertError } = await admin.from("sources").insert([
      {
        id: oldestId,
        workspace_id: owner.workspaceId,
        user_id: owner.userId,
        type: "url_extraction",
        content: "old content",
        source_url: "https://example.test/old",
        title: "Oldest",
        status: "ready",
        created_at: "2026-05-01T00:00:00.000Z",
      },
      {
        id: middleSoftDeletedId,
        workspace_id: owner.workspaceId,
        user_id: owner.userId,
        type: "url_extraction",
        content: "middle content",
        source_url: "https://example.test/middle",
        title: "Middle (soft-deleted)",
        status: "ready",
        created_at: "2026-05-04T00:00:00.000Z",
        deleted_at: "2026-05-05T00:00:00.000Z",
      },
      {
        id: newestId,
        workspace_id: owner.workspaceId,
        user_id: owner.userId,
        type: "pdf_extraction",
        content: "",
        title: "Newest",
        status: "processing",
        created_at: "2026-05-07T00:00:00.000Z",
      },
    ]);
    expect(insertError).toBeNull();

    const supabase = await createSupabaseServerClient();
    const rows = await listSources(supabase, owner.workspaceId);

    expect(rows).toHaveLength(2);
    // Newer first (DESC).
    expect(rows[0]?.id).toBe(newestId);
    expect(rows[0]?.title).toBe("Newest");
    expect(rows[0]?.type).toBe("pdf_extraction");
    expect(rows[0]?.status).toBe("processing");
    expect(rows[1]?.id).toBe(oldestId);
    expect(rows[1]?.title).toBe("Oldest");
    expect(rows[1]?.type).toBe("url_extraction");
    expect(rows[1]?.status).toBe("ready");

    // The soft-deleted row must NOT appear.
    expect(rows.some((r) => r.id === middleSoftDeletedId)).toBe(false);
  });

  test("cross-workspace isolation via RLS: non-member calling listSources for another workspace gets empty result", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });

    // Seed a row in owner's workspace via service-role.
    const admin = serviceRoleClient();
    const { error: insertError } = await admin.from("sources").insert({
      workspace_id: owner.workspaceId,
      user_id: owner.userId,
      type: "url_extraction",
      content: "owner-only content",
      source_url: "https://example.test/private",
      title: "Owner Only",
      status: "ready",
    });
    expect(insertError).toBeNull();

    // Outsider authenticates and calls listSources with owner's workspace id.
    // RLS (sources_select policy from Sprint 06) hides rows from non-members.
    setMockUserToken(outsider.accessToken);
    const supabase = await createSupabaseServerClient();
    const rows = await listSources(supabase, owner.workspaceId);

    expect(rows).toEqual([]);

    // Sanity: from owner's auth context the same call surfaces the row.
    setMockUserToken(owner.accessToken);
    const ownerSupabase = await createSupabaseServerClient();
    const ownerRows = await listSources(ownerSupabase, owner.workspaceId);
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]?.title).toBe("Owner Only");
  });
});
