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

vi.mock("@trigger.dev/python", () => {
  const runScript = vi.fn();
  return {
    python: { runScript },
    __getRunScript: () => runScript,
  };
});

vi.mock("../../src/lib/supabase.ts", () => {
  const rpc = vi.fn();
  const createSignedUrl = vi.fn();
  const remove = vi.fn();
  return {
    getJobsSupabaseClient: () => ({
      rpc,
      storage: { from: () => ({ createSignedUrl, remove }) },
    }),
    __getRpc: () => rpc,
    __getCreateSignedUrl: () => createSignedUrl,
    __getRemove: () => remove,
  };
});

import { runExtractFromPdf } from "../../src/trigger/extract-from-pdf.ts";
import * as pythonMod from "@trigger.dev/python";
import * as supabaseMod from "../../src/lib/supabase.ts";

function getRunScript(): ReturnType<typeof vi.fn> {
  return (pythonMod as unknown as { __getRunScript: () => ReturnType<typeof vi.fn> }).__getRunScript();
}
function getRpc(): ReturnType<typeof vi.fn> {
  return (supabaseMod as unknown as { __getRpc: () => ReturnType<typeof vi.fn> }).__getRpc();
}
function getCreateSignedUrl(): ReturnType<typeof vi.fn> {
  return (supabaseMod as unknown as { __getCreateSignedUrl: () => ReturnType<typeof vi.fn> }).__getCreateSignedUrl();
}
function getRemove(): ReturnType<typeof vi.fn> {
  return (supabaseMod as unknown as { __getRemove: () => ReturnType<typeof vi.fn> }).__getRemove();
}

const SOURCE_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const SIGNED_URL = "https://supabase.local/sign?token=abc";
const EXPECTED_PATH = `ws/${WORKSPACE_ID}/${SOURCE_ID}.pdf`;

describe("runExtractFromPdf — Storage signed URL + state machine satisfaction", () => {
  afterEach(() => {
    getRunScript().mockReset();
    getRpc().mockReset();
    getCreateSignedUrl().mockReset();
    getRemove().mockReset();
  });

  test("happy path — signed URL → Python → ready RPC; cleanup fires", async () => {
    getCreateSignedUrl().mockResolvedValueOnce({
      data: { signedUrl: SIGNED_URL },
      error: null,
    });
    getRunScript().mockResolvedValueOnce({
      stdout: '{"ok": true, "content": "PDF text", "title": "Title"}\n',
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });
    getRemove().mockResolvedValueOnce({ data: [], error: null });

    const result = await runExtractFromPdf({
      source_id: SOURCE_ID,
      workspace_id: WORKSPACE_ID,
    });

    expect(result).toEqual({ ok: true, source_id: SOURCE_ID });
    // Storage path follows the ws/{workspace_id}/{source_id}.pdf convention
    expect(getCreateSignedUrl()).toHaveBeenCalledWith(EXPECTED_PATH, 120);
    expect(getRunScript()).toHaveBeenCalledWith(
      "./python/extract_pdfplumber.py",
      [SIGNED_URL],
    );
    // State machine: ready transition with non-empty content
    expect(getRpc()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "ready",
      _content: "PDF text",
      _title: "Title",
    });
    // Cleanup fired with same path
    expect(getRemove()).toHaveBeenCalledWith([EXPECTED_PATH]);
  });

  test("signed URL generation fails → failed RPC with network: prefix; Python NOT invoked", async () => {
    getCreateSignedUrl().mockResolvedValueOnce({
      data: null,
      error: { message: "object not found" },
    });
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromPdf({
      source_id: SOURCE_ID,
      workspace_id: WORKSPACE_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("network: signed_url:object not found");
    }
    expect(getRunScript()).not.toHaveBeenCalled();
    expect(getRpc()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "failed",
      _error: "network: signed_url:object not found",
    });
    // No cleanup attempted on this failure path — there's nothing to clean.
    expect(getRemove()).not.toHaveBeenCalled();
  });

  test("Python returns failure shape → failed RPC with error class preserved; cleanup fires", async () => {
    getCreateSignedUrl().mockResolvedValueOnce({
      data: { signedUrl: SIGNED_URL },
      error: null,
    });
    getRunScript().mockResolvedValueOnce({
      stdout:
        '{"ok": false, "error": "extraction_failed: pdfplumber:PDFSyntaxError"}\n',
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });
    getRemove().mockResolvedValueOnce({ data: [], error: null });

    const result = await runExtractFromPdf({
      source_id: SOURCE_ID,
      workspace_id: WORKSPACE_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "extraction_failed: pdfplumber:PDFSyntaxError",
      );
    }
    expect(getRpc()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "failed",
      _error: "extraction_failed: pdfplumber:PDFSyntaxError",
    });
    expect(getRemove()).toHaveBeenCalledWith([EXPECTED_PATH]);
  });

  test("cleanup failure does NOT fail the task (best-effort delete)", async () => {
    getCreateSignedUrl().mockResolvedValueOnce({
      data: { signedUrl: SIGNED_URL },
      error: null,
    });
    getRunScript().mockResolvedValueOnce({
      stdout: '{"ok": true, "content": "PDF text", "title": null}\n',
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });
    getRemove().mockResolvedValueOnce({
      data: null,
      error: { message: "stale lock" },
    });

    const result = await runExtractFromPdf({
      source_id: SOURCE_ID,
      workspace_id: WORKSPACE_ID,
    });

    // Extraction still succeeded; cleanup error is non-fatal.
    expect(result).toEqual({ ok: true, source_id: SOURCE_ID });
  });
});
