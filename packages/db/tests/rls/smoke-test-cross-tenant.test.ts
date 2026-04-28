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
import { createAuthenticatedClient } from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";

// Cross-tenant isolation contract for `public.smoke_test`.
// User B is never a member of user A's workspace; every attempt to read,
// write, or update A's data must fail or be filtered to nothing.

describe("smoke_test cross-tenant RLS", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("INSERT into another tenant's workspace is blocked by WITH CHECK", async () => {
    const a = await pool.create({ fullName: "Alice" });
    const b = await pool.create({ fullName: "Bob" });

    const bClient = createAuthenticatedClient(b.accessToken);
    const result = await bClient
      .from("smoke_test")
      .insert({ workspace_id: a.workspaceId, note: "pwn" })
      .select();

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    // PostgREST surfaces RLS violations as code "42501" (insufficient privilege)
    // with a "row-level security" message.
    expect(result.error?.code).toBe("42501");
  });

  test("SELECT of another tenant's rows returns an empty result", async () => {
    const a = await pool.create({ fullName: "Alice" });
    const b = await pool.create({ fullName: "Bob" });

    // A inserts a row in their own workspace (allowed: A is a member of W_A).
    const aClient = createAuthenticatedClient(a.accessToken);
    const aInsert = await aClient
      .from("smoke_test")
      .insert({ workspace_id: a.workspaceId, note: "alice's secret" })
      .select()
      .single();
    expect(aInsert.error).toBeNull();
    expect(aInsert.data).not.toBeNull();

    // B queries A's workspace — RLS USING filters every row out.
    const bClient = createAuthenticatedClient(b.accessToken);
    const bRead = await bClient
      .from("smoke_test")
      .select("*")
      .eq("workspace_id", a.workspaceId);

    expect(bRead.error).toBeNull();
    expect(bRead.data).toEqual([]);
  });

  test("UPDATE of another tenant's row affects no rows; original value unchanged", async () => {
    const a = await pool.create({ fullName: "Alice" });
    const b = await pool.create({ fullName: "Bob" });

    // A inserts and captures the row id.
    const aClient = createAuthenticatedClient(a.accessToken);
    const aInsert = await aClient
      .from("smoke_test")
      .insert({ workspace_id: a.workspaceId, note: "alice's row" })
      .select("id")
      .single();
    expect(aInsert.error).toBeNull();
    const rowId = aInsert.data?.id;
    expect(typeof rowId).toBe("string");

    // B attempts to update by id. RLS USING filters the row out, so the
    // UPDATE matches zero rows — no error, no rows returned.
    const bClient = createAuthenticatedClient(b.accessToken);
    const bUpdate = await bClient
      .from("smoke_test")
      .update({ note: "pwn" })
      .eq("id", rowId!)
      .select();

    expect(bUpdate.error).toBeNull();
    expect(bUpdate.data).toEqual([]);

    // A reads back to confirm the value is untouched.
    const aRead = await aClient
      .from("smoke_test")
      .select("note")
      .eq("id", rowId!)
      .single();
    expect(aRead.error).toBeNull();
    expect(aRead.data?.note).toBe("alice's row");
  });
});
