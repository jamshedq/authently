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

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  setMockUserToken,
  clearMockUserToken,
  supabaseServerMockModule,
} from "../../helpers/server-client-mock";
import { TestUserPool, serviceRoleClient } from "../../helpers/test-workspace";

vi.mock("@/lib/supabase/server", () => supabaseServerMockModule);

import { deleteSource } from "@/services/sources/delete-source";

describe("deleteSource", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    clearMockUserToken();
    await pool.cleanup();
  });

  test("happy path: member soft-deletes own source; deleted_at set", async () => {
    const owner = await pool.create({ fullName: "Delete Source Owner" });
    setMockUserToken(owner.accessToken);

    // Seed a source row via service-role.
    const admin = serviceRoleClient();
    const { data: sourceRow } = await admin
      .from("sources")
      .insert({
        workspace_id: owner.workspaceId,
        user_id: owner.userId,
        type: "url_extraction",
        content: "",
        status: "processing",
        source_url: "https://example.test/to-delete",
      })
      .select("id")
      .single();
    const sourceId = sourceRow!.id;

    const result = await deleteSource({ sourceId });

    expect(result.ok).toBe(true);

    // deleted_at populated.
    const { data: row } = await admin
      .from("sources")
      .select("deleted_at")
      .eq("id", sourceId)
      .maybeSingle();
    expect(row?.deleted_at).not.toBeNull();
  });

  test("idempotent: deleting an already-soft-deleted source is a silent no-op", async () => {
    const owner = await pool.create({ fullName: "Idempotency Owner" });
    setMockUserToken(owner.accessToken);

    const admin = serviceRoleClient();
    const { data: sourceRow } = await admin
      .from("sources")
      .insert({
        workspace_id: owner.workspaceId,
        user_id: owner.userId,
        type: "url_extraction",
        content: "",
        status: "processing",
        source_url: "https://example.test/idempotent",
      })
      .select("id")
      .single();
    const sourceId = sourceRow!.id;

    const first = await deleteSource({ sourceId });
    expect(first.ok).toBe(true);

    const { data: rowAfterFirst } = await admin
      .from("sources")
      .select("deleted_at")
      .eq("id", sourceId)
      .maybeSingle();
    const firstDeletedAt = rowAfterFirst?.deleted_at;
    expect(firstDeletedAt).not.toBeNull();

    const second = await deleteSource({ sourceId });
    expect(second.ok).toBe(true);

    const { data: rowAfterSecond } = await admin
      .from("sources")
      .select("deleted_at")
      .eq("id", sourceId)
      .maybeSingle();
    // Compare timestamp instants — Postgres timestamptz +00:00 vs JS Z
    // serialization (per packages/db/tests/CLAUDE.md timestamp-assertions).
    expect(new Date(rowAfterSecond?.deleted_at as string).getTime()).toBe(
      new Date(firstDeletedAt as string).getTime(),
    );
  });

  test("validation: invalid sourceId (not a uuid) → validation error, no RPC", async () => {
    const owner = await pool.create({ fullName: "Validation User" });
    setMockUserToken(owner.accessToken);

    const result = await deleteSource({ sourceId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^validation:/);
  });
});
