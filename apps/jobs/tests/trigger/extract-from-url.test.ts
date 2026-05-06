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

// vi.mock is hoisted; factories must be self-contained. The python and
// supabase-client mocks are installed before the task module imports
// them, so the in-task references resolve to the mocks.
vi.mock("@trigger.dev/python", () => {
  const runScript = vi.fn();
  return {
    python: { runScript },
    __getRunScript: () => runScript,
  };
});

vi.mock("../../src/lib/supabase.ts", () => {
  const rpc = vi.fn();
  return {
    getJobsSupabaseClient: () => ({ rpc }),
    __getRpcMock: () => rpc,
  };
});

import { runExtractFromUrl } from "../../src/trigger/extract-from-url.ts";
import * as pythonMod from "@trigger.dev/python";
import * as supabaseMod from "../../src/lib/supabase.ts";

function getRunScript(): ReturnType<typeof vi.fn> {
  return (pythonMod as unknown as { __getRunScript: () => ReturnType<typeof vi.fn> }).__getRunScript();
}
function getRpc(): ReturnType<typeof vi.fn> {
  return (supabaseMod as unknown as { __getRpcMock: () => ReturnType<typeof vi.fn> }).__getRpcMock();
}

const SOURCE_ID = "11111111-1111-1111-1111-111111111111";
const URL_HTML = "https://example.com/article";

// Helper: build a fake HEAD response matching the WHATWG fetch Response
// interface as the task uses it (just `ok` and `headers.get`).
function fakeHeadResponse(opts: {
  ok: boolean;
  status?: number;
  contentType?: string;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "content-type" ? (opts.contentType ?? null) : null,
    },
  } as unknown as Response;
}

describe("runExtractFromUrl — HEAD branch + state machine satisfaction", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    getRunScript().mockReset();
    getRpc().mockReset();
  });

  test("happy path — text/html → trafilatura → ready RPC fired with content+title", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeHeadResponse({ ok: true, contentType: "text/html;charset=utf-8" }),
    );
    getRunScript().mockResolvedValueOnce({
      stdout: '{"ok": true, "content": "Article body", "title": "Headline"}\n',
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromUrl({
      source_id: SOURCE_ID,
      source_url: URL_HTML,
    });

    expect(result).toEqual({ ok: true, source_id: SOURCE_ID });
    // Python invoked with [url, content_type] — content_type lowercased + stripped
    expect(getRunScript()).toHaveBeenCalledWith(
      "./python/extract_from_url.py",
      [URL_HTML, "text/html"],
    );
    // RPC: ready transition with non-empty content (state machine contract satisfied)
    expect(getRpc()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "ready",
      _content: "Article body",
      _title: "Headline",
    });
  });

  test("HEAD non-2xx → failed RPC with network: prefix; Python NOT invoked", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeHeadResponse({ ok: false, status: 404 }),
    );
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromUrl({
      source_id: SOURCE_ID,
      source_url: URL_HTML,
    });

    expect(result).toEqual({
      ok: false,
      source_id: SOURCE_ID,
      error: "network: http_404",
    });
    expect(getRunScript()).not.toHaveBeenCalled();
    expect(getRpc()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "failed",
      _error: "network: http_404",
    });
  });

  test("HEAD unsupported Content-Type → failed RPC with extraction_failed: prefix", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeHeadResponse({ ok: true, contentType: "image/jpeg" }),
    );
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromUrl({
      source_id: SOURCE_ID,
      source_url: URL_HTML,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "extraction_failed: unsupported_content_type:image/jpeg",
      );
    }
    expect(getRunScript()).not.toHaveBeenCalled();
    expect(getRpc()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "failed",
      _error: "extraction_failed: unsupported_content_type:image/jpeg",
    });
  });

  test("HEAD application/pdf → Python invoked with content_type=application/pdf", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeHeadResponse({ ok: true, contentType: "application/pdf" }),
    );
    getRunScript().mockResolvedValueOnce({
      stdout: '{"ok": true, "content": "PDF body", "title": null}\n',
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });

    await runExtractFromUrl({ source_id: SOURCE_ID, source_url: URL_HTML });

    expect(getRunScript()).toHaveBeenCalledWith(
      "./python/extract_from_url.py",
      [URL_HTML, "application/pdf"],
    );
  });

  test("Python script returns failure shape → failed RPC with error class preserved", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeHeadResponse({ ok: true, contentType: "text/html" }),
    );
    getRunScript().mockResolvedValueOnce({
      stdout: '{"ok": false, "error": "extraction_failed: no_content"}\n',
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromUrl({
      source_id: SOURCE_ID,
      source_url: URL_HTML,
    });

    expect(result).toEqual({
      ok: false,
      source_id: SOURCE_ID,
      error: "extraction_failed: no_content",
    });
    expect(getRpc()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "failed",
      _error: "extraction_failed: no_content",
    });
  });

  test("HEAD AbortController fires (5s timeout) → failed RPC with timeout: prefix; Python NOT invoked", async () => {
    // Simulate AbortController-triggered fetch rejection. Real timeout
    // path inside headAndClassify: setTimeout fires controller.abort(),
    // fetch rejects with AbortError. We mock fetch to reject directly
    // with the AbortError shape so we don't have to wait 5s in the test.
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    fetchSpy.mockRejectedValueOnce(abortError);
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromUrl({
      source_id: SOURCE_ID,
      source_url: URL_HTML,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("timeout: head_request");
    }
    expect(getRunScript()).not.toHaveBeenCalled();
    expect(getRpc()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "failed",
      _error: "timeout: head_request",
    });
  });

  test("python.runScript throws → failed RPC with transient: python_runtime: prefix", async () => {
    fetchSpy.mockResolvedValueOnce(
      fakeHeadResponse({ ok: true, contentType: "text/html" }),
    );
    const sdkError = new Error("ENOENT: python not found");
    sdkError.name = "Error";
    getRunScript().mockRejectedValueOnce(sdkError);
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromUrl({
      source_id: SOURCE_ID,
      source_url: URL_HTML,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("transient: python_runtime:Error");
    }
    expect(getRpc()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "failed",
      _error: "transient: python_runtime:Error",
    });
  });
});
