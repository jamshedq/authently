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

// =============================================================================
// Sprint 08 B2 — extractFromYoutubeTask unit tests.
//
// Mirrors extract-from-url.test.ts's mock-and-test-runX pattern. Four
// surfaces mocked:
//   - @trigger.dev/python                  (python.runScript)
//   - ../../src/lib/supabase.ts            (getJobsSupabaseClient → rpc)
//   - @authently/ai/transcription          (transcribeAudio from B0)
//   - node:fs/promises                     (readFile of audio bytes)
//
// node:fs/promises mock replaces only readFile + rm (the task's
// disk-touching calls); mkdtempSync from node:fs and tmpdir() from
// node:os run for real because they just produce a string path that
// the test doesn't care about (rm is mocked to swallow cleanup).
//
// Coverage:
//   1. Happy path: Python emits audio_path → readFile returns bytes →
//      transcribeAudio returns transcript → setSourceStatusReady fires
//      with content + title (from yt-dlp metadata per A3.5).
//   2. Python emits failure: each of the four YouTube prefixes
//      (youtube_unavailable, youtube_age_restricted, youtube_invalid_url,
//      transient) flows through setSourceStatusFailed with the prefix
//      preserved.
//   3. python.runScript throws: surfaces as `transient: python_runtime:...`.
//   4. transcribeAudio fails: error prefix from openai-whisper preserved
//      through setSourceStatusFailed (A4.1 outcome preservation).
// =============================================================================

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

vi.mock("@authently/ai/transcription", () => {
  const transcribeAudio = vi.fn();
  return {
    transcribeAudio,
    __getTranscribeMock: () => transcribeAudio,
  };
});

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  const readFile = vi.fn();
  const rm = vi.fn(async () => {});
  return {
    ...actual,
    readFile,
    rm,
    __getReadFile: () => readFile,
  };
});

import { runExtractFromYoutube } from "../../src/trigger/extract-from-youtube.ts";
import * as pythonMod from "@trigger.dev/python";
import * as supabaseMod from "../../src/lib/supabase.ts";
import * as transcriptionMod from "@authently/ai/transcription";
import * as fsMod from "node:fs/promises";

function getRunScript(): ReturnType<typeof vi.fn> {
  return (pythonMod as unknown as { __getRunScript: () => ReturnType<typeof vi.fn> }).__getRunScript();
}
function getRpc(): ReturnType<typeof vi.fn> {
  return (supabaseMod as unknown as { __getRpcMock: () => ReturnType<typeof vi.fn> }).__getRpcMock();
}
function getTranscribe(): ReturnType<typeof vi.fn> {
  return (transcriptionMod as unknown as { __getTranscribeMock: () => ReturnType<typeof vi.fn> }).__getTranscribeMock();
}
function getReadFile(): ReturnType<typeof vi.fn> {
  return (fsMod as unknown as { __getReadFile: () => ReturnType<typeof vi.fn> }).__getReadFile();
}

const SOURCE_ID = "22222222-2222-2222-2222-222222222222";
const SOURCE_URL = "https://www.youtube.com/watch?v=test123";

describe("runExtractFromYoutube — happy path + error classification", () => {
  beforeEach(() => {
    getRunScript().mockReset();
    getRpc().mockReset();
    getTranscribe().mockReset();
    getReadFile().mockReset();
  });

  afterEach(() => {
    // mocks reset in beforeEach; nothing to restore here.
  });

  test("happy path — Python → readFile → transcribeAudio → ready RPC with content + title", async () => {
    getRunScript().mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        audio_path: "/tmp/youtube-fake/test123.m4a",
        title: "Test Video Title",
        duration: 90,
      }),
      stderr: "",
      exitCode: 0,
    });
    getReadFile().mockResolvedValueOnce(Buffer.from("fake-audio-bytes"));
    getTranscribe().mockResolvedValueOnce({
      ok: true,
      transcript: "transcribed text",
      duration: 90,
    });
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromYoutube({
      source_id: SOURCE_ID,
      source_url: SOURCE_URL,
    });

    expect(result).toEqual({ ok: true, source_id: SOURCE_ID });

    // Python invoked with [source_url, tmpDir]
    const runScriptCall = getRunScript().mock.calls[0];
    expect(runScriptCall?.[0]).toBe("./python/extract_from_youtube.py");
    expect(runScriptCall?.[1]?.[0]).toBe(SOURCE_URL);
    expect(typeof runScriptCall?.[1]?.[1]).toBe("string"); // tmpDir

    // transcribeAudio invoked with a File whose type=audio/m4a + the
    // fileName (per A4.1 outcome-preservation mechanism).
    const transcribeCall = getTranscribe().mock.calls[0];
    const inputArg = transcribeCall?.[0] as {
      file: File;
      fileName: string;
    };
    expect(inputArg.fileName).toBe("test123.m4a");
    expect(inputArg.file.type).toBe("audio/m4a");

    // svc_update_source_status called with 'ready' + transcript content
    // + video title.
    const rpcCall = getRpc().mock.calls[0];
    expect(rpcCall?.[0]).toBe("svc_update_source_status");
    expect(rpcCall?.[1]).toMatchObject({
      _source_id: SOURCE_ID,
      _status: "ready",
      _content: "transcribed text",
      _title: "Test Video Title",
    });
  });

  test("Python emits youtube_unavailable: → setSourceStatusFailed with prefix preserved", async () => {
    getRunScript().mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: false,
        error: "youtube_unavailable: Private video",
      }),
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromYoutube({
      source_id: SOURCE_ID,
      source_url: SOURCE_URL,
    });

    expect(result).toMatchObject({
      ok: false,
      source_id: SOURCE_ID,
      error: "youtube_unavailable: Private video",
    });

    const rpcCall = getRpc().mock.calls[0];
    expect(rpcCall?.[1]).toMatchObject({
      _source_id: SOURCE_ID,
      _status: "failed",
      _error: "youtube_unavailable: Private video",
    });

    expect(getTranscribe()).not.toHaveBeenCalled();
    expect(getReadFile()).not.toHaveBeenCalled();
  });

  test("Python emits youtube_age_restricted: → setSourceStatusFailed", async () => {
    getRunScript().mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: false,
        error:
          "youtube_age_restricted: Sign in to confirm your age",
      }),
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromYoutube({
      source_id: SOURCE_ID,
      source_url: SOURCE_URL,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^youtube_age_restricted:/),
    });
  });

  test("Python emits youtube_invalid_url: → setSourceStatusFailed", async () => {
    getRunScript().mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: false,
        error: "youtube_invalid_url: Unsupported URL",
      }),
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromYoutube({
      source_id: SOURCE_ID,
      source_url: SOURCE_URL,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^youtube_invalid_url:/),
    });
  });

  test("python.runScript throws → transient: python_runtime:<name>", async () => {
    getRunScript().mockRejectedValueOnce(
      Object.assign(new Error("crash"), { name: "PythonRuntimeError" }),
    );
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromYoutube({
      source_id: SOURCE_ID,
      source_url: SOURCE_URL,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^transient: python_runtime:/),
    });
  });

  test("transcribeAudio fails → openai-whisper error prefix preserved (A4.1 outcome preservation)", async () => {
    getRunScript().mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        audio_path: "/tmp/youtube-fake/test123.webm",
        title: "Some Title",
        duration: 60,
      }),
      stderr: "",
      exitCode: 0,
    });
    getReadFile().mockResolvedValueOnce(Buffer.from("fake-audio-bytes"));
    getTranscribe().mockResolvedValueOnce({
      ok: false,
      error: "validation: size_exceeded (file is 30000000 bytes, max 26214400)",
    });
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromYoutube({
      source_id: SOURCE_ID,
      source_url: SOURCE_URL,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^validation: size_exceeded/),
    });

    // svc_update_source_status fired with 'failed' + the Whisper error
    // string unchanged.
    const rpcCall = getRpc().mock.calls[0];
    expect(rpcCall?.[1]).toMatchObject({
      _status: "failed",
      _error: expect.stringMatching(/^validation: size_exceeded/),
    });
  });

  test("Python emits unrecognized audio extension → transient: audio_format_unrecognized", async () => {
    getRunScript().mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        audio_path: "/tmp/youtube-fake/test123.opus",
        title: "Some Title",
        duration: 60,
      }),
      stderr: "",
      exitCode: 0,
    });
    getRpc().mockResolvedValueOnce({ error: null });

    const result = await runExtractFromYoutube({
      source_id: SOURCE_ID,
      source_url: SOURCE_URL,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^transient: audio_format_unrecognized:opus/),
    });

    expect(getTranscribe()).not.toHaveBeenCalled();
    expect(getReadFile()).not.toHaveBeenCalled();
  });
});
