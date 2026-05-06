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
// Sprint 07 C1 — public.svc_update_source_status perimeter + transition
// behavior.
//
// svc_* perimeter shape (distinct from api_* perimeter shape):
//   - GRANT layer enforces; PostgREST rejects anon + authenticated callers
//     with 42501 (or PGRST202/PGRST301 in some Supabase configs) BEFORE
//     reaching the wrapper body. No defensive auth.uid() check inside.
//   - Workspace membership does NOT grant access — the function is
//     service-role-only. An authenticated workspace owner attempting to
//     call svc_update_source_status on a row in their own workspace is
//     rejected at the GRANT layer just like any other authenticated user.
//
// Transition contract (locked in private.update_source_status_impl):
//   - processing → ready    (with content + optional title; clears error)
//   - processing → failed   (with error; preserves title from insert)
//   - any other transition  rejected with errcode 22023.
//   - ready transition without content      rejected with errcode 22023.
//   - failed transition without error       rejected with errcode 22023.
// =============================================================================

describe("public.svc_update_source_status", () => {
  const pool = new TestUserPool();
  const admin = createServiceRoleClient();

  afterEach(async () => {
    await pool.cleanup();
  });

  // Helper: create a processing-state source row directly via service-role.
  // Bypasses RLS. Stand-in for api_create_source_url / api_create_source_pdf
  // which land in C2; C1 needs a way to seed a 'processing' row to test
  // status transitions in isolation.
  async function createProcessingSource(
    workspaceId: string,
    userId: string,
    type: "url_extraction" | "pdf_extraction",
  ): Promise<string> {
    const { data, error } = await admin
      .from("sources")
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        type,
        content: "",
        status: "processing",
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(`createProcessingSource: ${error.message}`);
    return (data as { id: string }).id;
  }

  test("anon caller rejected at GRANT layer", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("svc_update_source_status", {
      _source_id: "00000000-0000-0000-0000-000000000000",
      _status: "ready",
      _content: "anon attempt",
    } as never);
    expect(error).not.toBeNull();
    const code = error?.code ?? "";
    expect(["42501", "PGRST202", "PGRST301"]).toContain(code);
  });

  test("authenticated non-member rejected at GRANT layer", async () => {
    const outsider = await pool.create({ fullName: "Outsider" });
    const outsiderClient = createAuthenticatedClient(outsider.accessToken);

    const { error } = await outsiderClient.rpc("svc_update_source_status", {
      _source_id: "00000000-0000-0000-0000-000000000000",
      _status: "ready",
      _content: "outsider attempt",
    } as never);
    expect(error).not.toBeNull();
    const code = error?.code ?? "";
    expect(["42501", "PGRST202", "PGRST301"]).toContain(code);
  });

  test("authenticated workspace member ALSO rejected (membership doesn't grant access)", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const sourceId = await createProcessingSource(
      owner.workspaceId,
      owner.userId,
      "url_extraction",
    );
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    const { error } = await ownerClient.rpc("svc_update_source_status", {
      _source_id: sourceId,
      _status: "ready",
      _content: "owner attempt to mutate own source's status",
    } as never);
    expect(error).not.toBeNull();
    const code = error?.code ?? "";
    expect(["42501", "PGRST202", "PGRST301"]).toContain(code);

    // Defense-in-depth: source row state was NOT mutated.
    const { data } = await admin
      .from("sources")
      .select("status, content")
      .eq("id", sourceId)
      .single();
    expect((data as { status: string; content: string } | null)?.status).toBe("processing");
    expect((data as { status: string; content: string } | null)?.content).toBe("");
  });

  test("service-role: processing → ready transitions row with content + title", async () => {
    const owner = await pool.create({ fullName: "Ready Transition" });
    const sourceId = await createProcessingSource(
      owner.workspaceId,
      owner.userId,
      "url_extraction",
    );

    const { error } = await admin.rpc("svc_update_source_status", {
      _source_id: sourceId,
      _status: "ready",
      _content: "extracted article content",
      _title: "Example Article",
    } as never);
    expect(error).toBeNull();

    const { data } = await admin
      .from("sources")
      .select("status, content, title, error")
      .eq("id", sourceId)
      .single();
    const row = data as {
      status: string;
      content: string;
      title: string | null;
      error: string | null;
    } | null;
    expect(row?.status).toBe("ready");
    expect(row?.content).toBe("extracted article content");
    expect(row?.title).toBe("Example Article");
    expect(row?.error).toBeNull();
  });

  test("service-role: processing → failed transitions row with error", async () => {
    const owner = await pool.create({ fullName: "Failed Transition" });
    const sourceId = await createProcessingSource(
      owner.workspaceId,
      owner.userId,
      "url_extraction",
    );

    const { error } = await admin.rpc("svc_update_source_status", {
      _source_id: sourceId,
      _status: "failed",
      _error: "network: timeout",
    } as never);
    expect(error).toBeNull();

    const { data } = await admin
      .from("sources")
      .select("status, error")
      .eq("id", sourceId)
      .single();
    const row = data as { status: string; error: string | null } | null;
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("network: timeout");
  });

  test("service-role: illegal transition (ready → ready) rejected with 22023", async () => {
    const owner = await pool.create({ fullName: "Illegal Transition" });
    const sourceId = await createProcessingSource(
      owner.workspaceId,
      owner.userId,
      "url_extraction",
    );

    // First transition: processing → ready (succeeds)
    await admin.rpc("svc_update_source_status", {
      _source_id: sourceId,
      _status: "ready",
      _content: "first transition content",
    } as never);

    // Second transition: ready → ready (rejected)
    const { error } = await admin.rpc("svc_update_source_status", {
      _source_id: sourceId,
      _status: "ready",
      _content: "second transition content",
    } as never);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toMatch(/illegal status transition/i);
  });

  test("service-role: ready transition without content rejected with 22023", async () => {
    const owner = await pool.create({ fullName: "Ready Missing Content" });
    const sourceId = await createProcessingSource(
      owner.workspaceId,
      owner.userId,
      "url_extraction",
    );

    const { error } = await admin.rpc("svc_update_source_status", {
      _source_id: sourceId,
      _status: "ready",
      // _content omitted — defaults to null
    } as never);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toMatch(/content is required/i);
  });

  test("service-role: failed transition without error rejected with 22023", async () => {
    const owner = await pool.create({ fullName: "Failed Missing Error" });
    const sourceId = await createProcessingSource(
      owner.workspaceId,
      owner.userId,
      "pdf_extraction",
    );

    const { error } = await admin.rpc("svc_update_source_status", {
      _source_id: sourceId,
      _status: "failed",
      // _error omitted — defaults to null
    } as never);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toMatch(/error is required/i);
  });
});
