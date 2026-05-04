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

// vi.mock is hoisted to the top of the file before all imports, so the
// factory must be self-contained — it cannot import from
// ../../helpers/openai-mock at module top-level. We dynamically import
// the helper's getOpenAIMock inside the factory body, and import the
// real openai module via importActual so the OpenAI.* error subclass
// namespace (used by the service module's instanceof checks) survives
// the mock.
vi.mock("openai", async () => {
  const actual = await vi.importActual<typeof import("openai")>("openai");
  const { getOpenAIMock } = await import("../../helpers/openai-mock");
  class FakeOpenAI {
    static APIError = actual.default.APIError;
    static BadRequestError = actual.default.BadRequestError;
    static NotFoundError = actual.default.NotFoundError;
    static UnprocessableEntityError = actual.default.UnprocessableEntityError;
    static AuthenticationError = actual.default.AuthenticationError;
    static PermissionDeniedError = actual.default.PermissionDeniedError;
    static RateLimitError = actual.default.RateLimitError;
    static InternalServerError = actual.default.InternalServerError;
    static APIConnectionError = actual.default.APIConnectionError;
    static APIConnectionTimeoutError = actual.default.APIConnectionTimeoutError;
    audio = {
      transcriptions: {
        create: (...args: unknown[]) =>
          getOpenAIMock().audio.transcriptions.create(...args),
      },
    };
  }
  return { default: FakeOpenAI };
});

import OpenAI from "openai";
import {
  buildOpenAIMock,
  registerOpenAIMock,
  resetOpenAIMock,
  type OpenAIMockState,
} from "../../helpers/openai-mock";

// Force a non-empty OPENAI_API_KEY for the SDK constructor in
// getOpenAIClient. The mock doesn't actually call OpenAI; the key
// just needs to be present.
process.env["OPENAI_API_KEY"] = "sk-test-dummy-for-unit-tests";

import { transcribeAudio } from "@/services/transcription/openai-whisper";
import { __resetClientForTests } from "@/services/transcription/openai-client";

function buildAudioFile(opts: {
  size?: number;
  type?: string;
  name?: string;
}): File {
  const size = opts.size ?? 1024;
  const type = opts.type ?? "audio/mpeg";
  const name = opts.name ?? "test.mp3";
  // Construct a File of the requested size; content doesn't matter
  // because the SDK is mocked.
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

// Build an APIError-shaped object the service's `instanceof` branches
// will match. The OpenAI SDK's error constructors take an opaque
// internal shape; for tests we instantiate via Object.create + Error
// chain to set the prototype that `err instanceof OpenAI.X` checks
// against, then layer the message.
function buildSdkError<T extends Error>(
  ErrorClass: new (...args: never[]) => T,
  message: string,
): T {
  const err = Object.create(ErrorClass.prototype) as T;
  Object.defineProperty(err, "message", { value: message });
  Object.defineProperty(err, "name", { value: ErrorClass.name });
  return err;
}

describe("transcribeAudio", () => {
  let openai: OpenAIMockState;

  beforeEach(() => {
    openai = buildOpenAIMock();
    registerOpenAIMock(openai);
    __resetClientForTests();
    process.env["OPENAI_API_KEY"] = "sk-test-dummy-for-unit-tests";
  });

  afterEach(() => {
    resetOpenAIMock();
    vi.restoreAllMocks();
  });

  test("happy path: valid file + active key → audio.transcriptions.create called → ok with transcript", async () => {
    openai.audio.transcriptions.create.mockResolvedValue({
      text: "hello world",
    });

    const file = buildAudioFile({});
    const result = await transcribeAudio({ file, fileName: "test.mp3" });

    expect(result).toEqual({ ok: true, transcript: "hello world" });
    expect(openai.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    const callArgs = openai.audio.transcriptions.create.mock.calls[0]![0];
    expect(callArgs.file).toBe(file);
    expect(callArgs.model).toBe("whisper-1");
  });

  test("openai-client throws when OPENAI_API_KEY is missing", async () => {
    delete process.env["OPENAI_API_KEY"];
    __resetClientForTests();

    const file = buildAudioFile({});
    await expect(transcribeAudio({ file, fileName: "test.mp3" })).rejects.toThrow(
      /OPENAI_API_KEY is not set/,
    );

    expect(openai.audio.transcriptions.create).not.toHaveBeenCalled();
  });

  test("validation: oversize file → validation: size_exceeded (no SDK call)", async () => {
    const file = buildAudioFile({ size: 26 * 1024 * 1024 });

    const result = await transcribeAudio({ file, fileName: "huge.mp3" });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^validation: size_exceeded/),
    });
    expect(openai.audio.transcriptions.create).not.toHaveBeenCalled();
  });

  test("validation: unsupported MIME → validation: unsupported_format (no SDK call)", async () => {
    const file = buildAudioFile({ type: "application/pdf" });

    const result = await transcribeAudio({ file, fileName: "doc.pdf" });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^validation: unsupported_format/),
    });
    expect(openai.audio.transcriptions.create).not.toHaveBeenCalled();
  });

  test("openai_rejected: BadRequestError (400) → openai_rejected: <message>", async () => {
    openai.audio.transcriptions.create.mockRejectedValue(
      buildSdkError(OpenAI.BadRequestError, "Audio is not in a recognized format"),
    );

    const file = buildAudioFile({});
    const result = await transcribeAudio({ file, fileName: "test.mp3" });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^openai_rejected:/),
    });
  });

  test("transient: InternalServerError (5xx) → transient: <message>", async () => {
    openai.audio.transcriptions.create.mockRejectedValue(
      buildSdkError(OpenAI.InternalServerError, "Server error"),
    );

    const file = buildAudioFile({});
    const result = await transcribeAudio({ file, fileName: "test.mp3" });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^transient:/),
    });
  });

  test("transient: APIConnectionError (network) → transient: <message>", async () => {
    openai.audio.transcriptions.create.mockRejectedValue(
      buildSdkError(OpenAI.APIConnectionError, "Connection refused"),
    );

    const file = buildAudioFile({});
    const result = await transcribeAudio({ file, fileName: "test.mp3" });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^transient:/),
    });
  });

  test("auth: AuthenticationError (401) → auth: <message>", async () => {
    openai.audio.transcriptions.create.mockRejectedValue(
      buildSdkError(OpenAI.AuthenticationError, "Invalid API key"),
    );

    const file = buildAudioFile({});
    const result = await transcribeAudio({ file, fileName: "test.mp3" });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^auth:/),
    });
  });

  test("timeout: APIConnectionTimeoutError → timeout: <message>", async () => {
    openai.audio.transcriptions.create.mockRejectedValue(
      buildSdkError(
        OpenAI.APIConnectionTimeoutError,
        "Request timed out",
      ),
    );

    const file = buildAudioFile({});
    const result = await transcribeAudio({ file, fileName: "test.mp3" });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^timeout:/),
    });
  });
});
