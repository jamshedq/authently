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

import { createSourcePdf } from "@/services/sources/create-source-pdf";
import { triggerPdfExtraction } from "@/lib/trigger";

const mockTriggerPdf = vi.mocked(triggerPdfExtraction);

const SOURCES_PDF_BUCKET = "sources-pdf";

const FAKE_PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
]);

function makePdfFile(name: string, sizeBytes?: number): File {
  const bytes =
    sizeBytes !== undefined
      ? new Uint8Array(sizeBytes)
      : FAKE_PDF_BYTES.slice();
  return new File([bytes], name, { type: "application/pdf" });
}

describe("createSourcePdf", () => {
  const pool = new TestUserPool();

  beforeEach(() => {
    mockTriggerPdf.mockReset();
  });

  afterEach(async () => {
    clearMockUserToken();
    await pool.cleanup();
  });

  test("happy path: RPC + upload + trigger succeed → row in 'processing', file in Storage", async () => {
    const owner = await pool.create({ fullName: "PDF Source Owner" });
    setMockUserToken(owner.accessToken);
    mockTriggerPdf.mockResolvedValueOnce({ id: "trigger-handle-test" });

    const result = await createSourcePdf({
      workspaceId: owner.workspaceId,
      file: makePdfFile("paper.pdf"),
      title: "Research Paper",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Row landed correctly.
    const admin = serviceRoleClient();
    const { data: row } = await admin
      .from("sources")
      .select("type, status, source_url, content, title, error, deleted_at")
      .eq("id", result.sourceId)
      .maybeSingle();
    expect(row?.type).toBe("pdf_extraction");
    expect(row?.status).toBe("processing");
    expect(row?.source_url).toBeNull();
    expect(row?.content).toBe("");
    expect(row?.title).toBe("Research Paper");
    expect(row?.error).toBeNull();
    expect(row?.deleted_at).toBeNull();

    // Storage object landed at the deterministic path.
    const expectedPath = `ws/${owner.workspaceId}/${result.sourceId}.pdf`;
    const { data: list } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .list(`ws/${owner.workspaceId}`);
    expect(list).toHaveLength(1);
    expect(list?.[0]?.name).toBe(`${result.sourceId}.pdf`);

    // Trigger called with correct payload shape (workspace_id, source_id).
    expect(mockTriggerPdf).toHaveBeenCalledTimes(1);
    expect(mockTriggerPdf).toHaveBeenCalledWith(
      owner.workspaceId,
      result.sourceId,
    );

    // Cleanup the Storage object so it doesn't pollute subsequent tests
    // (workspace deletion via pool.cleanup doesn't cascade to Storage).
    await admin.storage.from(SOURCES_PDF_BUCKET).remove([expectedPath]);
  });

  test("trigger failure: row rolled back, Storage orphan accepted per E6d-Storage", async () => {
    const owner = await pool.create({ fullName: "PDF Trigger-Fail" });
    setMockUserToken(owner.accessToken);
    mockTriggerPdf.mockRejectedValueOnce(
      new Error("trigger: rate limit hit"),
    );

    const result = await createSourcePdf({
      workspaceId: owner.workspaceId,
      file: makePdfFile("orphan.pdf"),
      title: "Will Be Rolled Back",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^trigger_failed: /);
    expect(result.error).toContain("rate limit hit");

    // Row rolled back: no active rows, but a soft-deleted row exists.
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

    // Storage object IS still present — orphan accepted per E6d-Storage.
    // (The deferred Storage sweeper would clean it up; in C2b.2's accepted
    // state, it accrues silently.)
    const sourceId = allRows![0]!.id;
    const orphanPath = `ws/${owner.workspaceId}/${sourceId}.pdf`;
    const { data: list } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .list(`ws/${owner.workspaceId}`);
    expect(list).toHaveLength(1);
    expect(list?.[0]?.name).toBe(`${sourceId}.pdf`);

    // Cleanup so the test doesn't leave stale storage between runs.
    await admin.storage.from(SOURCES_PDF_BUCKET).remove([orphanPath]);
  });

  test("non-member rejected by RPC (42501) → service returns rpc: error, no upload, no trigger", async () => {
    const owner = await pool.create({ fullName: "PDF Owner" });
    const outsider = await pool.create({ fullName: "PDF Outsider" });
    setMockUserToken(outsider.accessToken);

    const result = await createSourcePdf({
      workspaceId: owner.workspaceId,
      file: makePdfFile("attempt.pdf"),
      title: "Cross-tenant attempt",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^rpc: /);
    expect(result.error).toMatch(/not a member of workspace/i);

    expect(mockTriggerPdf).not.toHaveBeenCalled();

    // No Storage object should have been uploaded.
    const admin = serviceRoleClient();
    const { data: list } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .list(`ws/${owner.workspaceId}`);
    expect(list ?? []).toEqual([]);
  });

  test("validation: invalid MIME → returns invalid_mime, no RPC, no upload, no trigger", async () => {
    const owner = await pool.create({ fullName: "PDF Mime Validation" });
    setMockUserToken(owner.accessToken);

    const wrongMimeFile = new File(["text content"], "fake.pdf", {
      type: "text/plain",
    });
    const result = await createSourcePdf({
      workspaceId: owner.workspaceId,
      file: wrongMimeFile,
      title: "Wrong Mime",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("validation: invalid_mime");
    expect(mockTriggerPdf).not.toHaveBeenCalled();
  });

  test("validation: file too large → returns file_too_large, no RPC", async () => {
    const owner = await pool.create({ fullName: "PDF Size Validation" });
    setMockUserToken(owner.accessToken);

    // 50 MiB + 1 byte
    const oversize = new File(
      [new Uint8Array(50 * 1024 * 1024 + 1)],
      "huge.pdf",
      { type: "application/pdf" },
    );
    const result = await createSourcePdf({
      workspaceId: owner.workspaceId,
      file: oversize,
      title: "Too Big",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("validation: file_too_large");
    expect(mockTriggerPdf).not.toHaveBeenCalled();
  });
});
