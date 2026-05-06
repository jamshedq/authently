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
// Sprint 07 C2b.1 — public.api_delete_source.
//
// Coverage (mirrors api_create_source_audio test shape, adjusted for delete):
//   1. Perimeter: anon rejected (22023, auth.uid() defensive check).
//   2. Cross-tenant perimeter: authenticated non-member rejected (42501)
//      when attempting to delete a source from a workspace they are not
//      a member of. This is the cross-tenant write-path test — analogous
//      to the cross-tenant SELECT isolation test in api_create_source_*
//      but exercising the wrapper's membership check on a write.
//   3. Happy path: member soft-deletes their own source; deleted_at is
//      set on the row; the row is no longer visible via the SELECT RLS
//      policy (which filters deleted_at IS NULL).
//   4. Idempotent: calling api_delete_source on an already-soft-deleted
//      row is a silent no-op (no error). Same behavior for a non-existent
//      source_id, by design — see migration header for the side-channel
//      mitigation rationale.
// =============================================================================

describe("public.api_delete_source", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("perimeter: anon rejected with 22023 (auth.uid() defensive check)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_delete_source", {
      _source_id: "00000000-0000-0000-0000-000000000000",
    } as never);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toMatch(/user id is required/i);
  });

  test("cross-tenant perimeter: non-member cannot delete another workspace's source (42501)", async () => {
    const owner = await pool.create({ fullName: "Source Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });

    // Owner creates a source in their own workspace.
    const ownerClient = createAuthenticatedClient(owner.accessToken);
    const { data: sourceId, error: createError } = await ownerClient.rpc(
      "api_create_source_url",
      {
        _workspace_id: owner.workspaceId,
        _source_url: "https://example.test/owner-resource",
      } as never,
    );
    expect(createError).toBeNull();
    expect(sourceId).toBeTypeOf("string");

    // Outsider tries to delete the owner's source — must be rejected with 42501.
    const outsiderClient = createAuthenticatedClient(outsider.accessToken);
    const { error: deleteError } = await outsiderClient.rpc(
      "api_delete_source",
      {
        _source_id: sourceId as string,
      } as never,
    );

    expect(deleteError).not.toBeNull();
    expect(deleteError?.code).toBe("42501");
    expect(deleteError?.message).toMatch(/not a member of workspace/i);

    // Verify the row was NOT deleted (sanity check on the perimeter holding).
    const admin = createServiceRoleClient();
    const { data: row } = await admin
      .from("sources")
      .select("id, deleted_at")
      .eq("id", sourceId as string)
      .maybeSingle();
    expect(row?.deleted_at).toBeNull();
  });

  test("happy path: member soft-deletes own source; deleted_at set; row hidden by RLS", async () => {
    const owner = await pool.create({ fullName: "Delete Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    const { data: sourceId, error: createError } = await ownerClient.rpc(
      "api_create_source_url",
      {
        _workspace_id: owner.workspaceId,
        _source_url: "https://example.test/to-be-deleted",
      } as never,
    );
    expect(createError).toBeNull();
    expect(sourceId).toBeTypeOf("string");

    // Sanity: row visible to owner before delete.
    const { data: visibleBefore } = await ownerClient
      .from("sources")
      .select("id")
      .eq("id", sourceId as string);
    expect(visibleBefore).toHaveLength(1);

    // Delete.
    const { error: deleteError } = await ownerClient.rpc("api_delete_source", {
      _source_id: sourceId as string,
    } as never);
    expect(deleteError).toBeNull();

    // Verify deleted_at set via service-role read (RLS would hide the row otherwise).
    const admin = createServiceRoleClient();
    const { data: row } = await admin
      .from("sources")
      .select("id, deleted_at")
      .eq("id", sourceId as string)
      .maybeSingle();
    expect(row).not.toBeNull();
    expect(row?.deleted_at).not.toBeNull();

    // Verify the SELECT RLS policy now filters this row from the owner's view.
    const { data: visibleAfter } = await ownerClient
      .from("sources")
      .select("id")
      .eq("id", sourceId as string);
    expect(visibleAfter).toEqual([]);
  });

  test("idempotent: second delete on already-deleted source is a silent no-op", async () => {
    const owner = await pool.create({ fullName: "Idempotency Owner" });
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    const { data: sourceId, error: createError } = await ownerClient.rpc(
      "api_create_source_url",
      {
        _workspace_id: owner.workspaceId,
        _source_url: "https://example.test/idempotent",
      } as never,
    );
    expect(createError).toBeNull();
    expect(sourceId).toBeTypeOf("string");

    // First delete.
    const { error: firstError } = await ownerClient.rpc("api_delete_source", {
      _source_id: sourceId as string,
    } as never);
    expect(firstError).toBeNull();

    // Capture deleted_at after first delete.
    const admin = createServiceRoleClient();
    const { data: rowAfterFirst } = await admin
      .from("sources")
      .select("deleted_at")
      .eq("id", sourceId as string)
      .maybeSingle();
    const firstDeletedAt = rowAfterFirst?.deleted_at;
    expect(firstDeletedAt).not.toBeNull();

    // Second delete — silent no-op (no error, deleted_at unchanged because the
    // worker's WHERE clause filters already-deleted rows).
    const { error: secondError } = await ownerClient.rpc("api_delete_source", {
      _source_id: sourceId as string,
    } as never);
    expect(secondError).toBeNull();

    const { data: rowAfterSecond } = await admin
      .from("sources")
      .select("deleted_at")
      .eq("id", sourceId as string)
      .maybeSingle();
    // Compare instants via getTime() — Postgres timestamptz +00:00 vs JS Z
    // serialization (per packages/db/tests/CLAUDE.md timestamp-assertions note).
    expect(new Date(rowAfterSecond?.deleted_at as string).getTime()).toBe(
      new Date(firstDeletedAt as string).getTime(),
    );
  });
});
