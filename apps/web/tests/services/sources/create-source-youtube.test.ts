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

// Sprint 08 B2 — createSourceYoutube service tests. Mirrors
// create-source-url.test.ts shape (real Supabase + real RPC; Trigger.dev
// SDK mocked). Per A5.2 forward-coupling lock, the test shape is
// identical to the URL test so B4's eventual caller migration to the
// unified createSource() function will see uniform test refactoring.

vi.mock("@/lib/supabase/server", () => supabaseServerMockModule);
vi.mock("@/lib/trigger", () => ({
  triggerUrlExtraction: vi.fn(),
  triggerPdfExtraction: vi.fn(),
  triggerYoutubeExtraction: vi.fn(),
}));

import { createSourceYoutube } from "@/services/sources/create-source-youtube";
import { triggerYoutubeExtraction } from "@/lib/trigger";

const mockTriggerYoutube = vi.mocked(triggerYoutubeExtraction);

const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("createSourceYoutube", () => {
  const pool = new TestUserPool();

  beforeEach(() => {
    mockTriggerYoutube.mockReset();
  });

  afterEach(async () => {
    clearMockUserToken();
    await pool.cleanup();
  });

  test("happy path: RPC + trigger succeed → row in 'processing', returns sourceId", async () => {
    const owner = await pool.create({ fullName: "YouTube Source Owner" });
    setMockUserToken(owner.accessToken);
    mockTriggerYoutube.mockResolvedValueOnce({ id: "trigger-handle-test" });

    const result = await createSourceYoutube({
      workspaceId: owner.workspaceId,
      sourceUrl: YOUTUBE_URL,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceId).toBeTypeOf("string");

    const admin = serviceRoleClient();
    const { data: row } = await admin
      .from("sources")
      .select("type, status, source_url, content, title, error, deleted_at")
      .eq("id", result.sourceId)
      .maybeSingle();
    expect(row?.type).toBe("youtube_transcript");
    expect(row?.status).toBe("processing");
    expect(row?.source_url).toBe(YOUTUBE_URL);
    expect(row?.content).toBe("");
    expect(row?.title).toBeNull();
    expect(row?.error).toBeNull();
    expect(row?.deleted_at).toBeNull();

    expect(mockTriggerYoutube).toHaveBeenCalledTimes(1);
    expect(mockTriggerYoutube).toHaveBeenCalledWith(
      owner.workspaceId,
      result.sourceId,
      YOUTUBE_URL,
    );
  });

  test("trigger failure: row rolled back via api_delete_source (best-effort)", async () => {
    const owner = await pool.create({ fullName: "YouTube Trigger-Fail" });
    setMockUserToken(owner.accessToken);
    mockTriggerYoutube.mockRejectedValueOnce(
      new Error("trigger: network blip"),
    );

    const result = await createSourceYoutube({
      workspaceId: owner.workspaceId,
      sourceUrl: YOUTUBE_URL,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^trigger_failed: /);
    expect(result.error).toContain("network blip");

    const admin = serviceRoleClient();
    const { data: activeRows } = await admin
      .from("sources")
      .select("id, deleted_at")
      .eq("workspace_id", owner.workspaceId)
      .is("deleted_at", null);
    expect(activeRows).toEqual([]);

    const { data: allRows } = await admin
      .from("sources")
      .select("id, deleted_at")
      .eq("workspace_id", owner.workspaceId);
    expect(allRows).toHaveLength(1);
    expect(allRows?.[0]?.deleted_at).not.toBeNull();
  });

  test("validation: invalid sourceUrl → validation error, no RPC call", async () => {
    const owner = await pool.create({ fullName: "YouTube Validation" });
    setMockUserToken(owner.accessToken);

    const result = await createSourceYoutube({
      workspaceId: owner.workspaceId,
      sourceUrl: "not-a-url",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^validation:/);

    expect(mockTriggerYoutube).not.toHaveBeenCalled();

    const admin = serviceRoleClient();
    const { data: rows } = await admin
      .from("sources")
      .select("id")
      .eq("workspace_id", owner.workspaceId);
    expect(rows).toEqual([]);
  });

  test("non-member rejected by RPC (42501) → service returns rpc: error", async () => {
    const owner = await pool.create({ fullName: "YouTube Owner" });
    const outsider = await pool.create({ fullName: "YouTube Outsider" });
    setMockUserToken(outsider.accessToken);

    const result = await createSourceYoutube({
      workspaceId: owner.workspaceId,
      sourceUrl: YOUTUBE_URL,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^rpc: /);
    expect(result.error).toMatch(/not a member of workspace/i);

    expect(mockTriggerYoutube).not.toHaveBeenCalled();
  });
});
