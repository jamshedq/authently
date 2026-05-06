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

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  setMockUserToken,
  clearMockUserToken,
  supabaseServerMockModule,
} from "../../helpers/server-client-mock";
import { TestUserPool, serviceRoleClient } from "../../helpers/test-workspace";

vi.mock("@/lib/supabase/server", () => supabaseServerMockModule);
vi.mock("@/lib/trigger", () => ({
  triggerUrlExtraction: vi.fn(),
  triggerPdfExtraction: vi.fn(),
}));

import { createSourceUrl } from "@/services/sources/create-source-url";
import { triggerUrlExtraction } from "@/lib/trigger";

const mockTriggerUrl = vi.mocked(triggerUrlExtraction);

describe("createSourceUrl", () => {
  const pool = new TestUserPool();

  beforeEach(() => {
    mockTriggerUrl.mockReset();
  });

  afterEach(async () => {
    clearMockUserToken();
    await pool.cleanup();
  });

  test("happy path: RPC + trigger succeed → row in 'processing', returns sourceId", async () => {
    const owner = await pool.create({ fullName: "URL Source Owner" });
    setMockUserToken(owner.accessToken);
    mockTriggerUrl.mockResolvedValueOnce({ id: "trigger-handle-test" });

    const result = await createSourceUrl({
      workspaceId: owner.workspaceId,
      sourceUrl: "https://example.test/article",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceId).toBeTypeOf("string");

    // Verify row landed in 'processing' with correct columns.
    const admin = serviceRoleClient();
    const { data: row } = await admin
      .from("sources")
      .select("type, status, source_url, content, title, error, deleted_at")
      .eq("id", result.sourceId)
      .maybeSingle();
    expect(row?.type).toBe("url_extraction");
    expect(row?.status).toBe("processing");
    expect(row?.source_url).toBe("https://example.test/article");
    expect(row?.content).toBe("");
    expect(row?.title).toBeNull();
    expect(row?.error).toBeNull();
    expect(row?.deleted_at).toBeNull();

    // Verify the trigger was called with the right payload shape.
    expect(mockTriggerUrl).toHaveBeenCalledTimes(1);
    expect(mockTriggerUrl).toHaveBeenCalledWith(
      owner.workspaceId,
      result.sourceId,
      "https://example.test/article",
    );
  });

  test("trigger failure: row rolled back via api_delete_source (best-effort)", async () => {
    const owner = await pool.create({ fullName: "URL Source Trigger-Fail" });
    setMockUserToken(owner.accessToken);
    mockTriggerUrl.mockRejectedValueOnce(new Error("trigger: network blip"));

    const result = await createSourceUrl({
      workspaceId: owner.workspaceId,
      sourceUrl: "https://example.test/article",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^trigger_failed: /);
    expect(result.error).toContain("network blip");

    // Verify the row was soft-deleted by the rollback (deleted_at set).
    // We can't query by sourceId because it's not surfaced on failure;
    // instead verify there are no NON-soft-deleted url_extraction rows in
    // the workspace (the row we created should now be soft-deleted).
    const admin = serviceRoleClient();
    const { data: activeRows } = await admin
      .from("sources")
      .select("id, deleted_at")
      .eq("workspace_id", owner.workspaceId)
      .is("deleted_at", null);
    expect(activeRows).toEqual([]);

    // Verify a soft-deleted row does exist (rollback happened, not just no-row).
    const { data: allRows } = await admin
      .from("sources")
      .select("id, deleted_at")
      .eq("workspace_id", owner.workspaceId);
    expect(allRows).toHaveLength(1);
    expect(allRows?.[0]?.deleted_at).not.toBeNull();
  });

  test("validation: invalid sourceUrl → validation error, no RPC call", async () => {
    const owner = await pool.create({ fullName: "URL Validation" });
    setMockUserToken(owner.accessToken);

    const result = await createSourceUrl({
      workspaceId: owner.workspaceId,
      sourceUrl: "not-a-url",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^validation:/);

    // Trigger must NOT have been called — validation precedes RPC + trigger.
    expect(mockTriggerUrl).not.toHaveBeenCalled();

    // No row should exist in the workspace.
    const admin = serviceRoleClient();
    const { data: rows } = await admin
      .from("sources")
      .select("id")
      .eq("workspace_id", owner.workspaceId);
    expect(rows).toEqual([]);
  });

  test("non-member rejected by RPC (42501) → service returns rpc: error", async () => {
    const owner = await pool.create({ fullName: "Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });
    setMockUserToken(outsider.accessToken);

    const result = await createSourceUrl({
      workspaceId: owner.workspaceId,
      sourceUrl: "https://example.test/another-article",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^rpc: /);
    expect(result.error).toMatch(/not a member of workspace/i);

    // Trigger must NOT have been called — RPC failure precedes trigger.
    expect(mockTriggerUrl).not.toHaveBeenCalled();
  });
});
