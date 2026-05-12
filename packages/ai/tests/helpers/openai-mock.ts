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

import { vi } from "vitest";

// In-test recorder for OpenAI SDK calls. Tests assert on `calls.*` to
// verify the SDK was invoked with the right shape (file, model name,
// etc.).
//
// Pattern divergence note: the older apps/web stripe-mock.ts uses a
// sync object-literal factory that does NOT preserve Stripe.errors.*
// for instanceof checks. That pattern was sufficient for apps/web's
// existing tests because they don't exercise error classes.
//
// This helper follows the A2 async-factory pattern from
// apps/jobs/tests/helpers/stripe-mock.ts instead — vi.importActual
// on the real `openai` module preserves OpenAI.APIError + all its
// subclasses (BadRequestError, AuthenticationError, RateLimitError,
// InternalServerError, APIConnectionError, APIConnectionTimeoutError,
// PermissionDeniedError, UnprocessableEntityError, NotFoundError) so
// the transcription service's `instanceof` branches work in test.
// B1 explicitly exercises all of these via the error classification
// surface, hence the pattern divergence within apps/web.

export type OpenAIMockState = {
  audio: {
    transcriptions: {
      create: ReturnType<typeof vi.fn>;
    };
  };
};

let state: OpenAIMockState | null = null;

/**
 * Build a fresh OpenAI mock object with `vi.fn()` recorders. Each test
 * builds its own state and calls registerOpenAIMock so the `openai`
 * default export resolves to it.
 *
 *   const openai = buildOpenAIMock();
 *   openai.audio.transcriptions.create.mockResolvedValue({
 *     text: "hello world",
 *   });
 *   registerOpenAIMock(openai);
 */
export function buildOpenAIMock(): OpenAIMockState {
  return {
    audio: {
      transcriptions: {
        create: vi.fn(),
      },
    },
  };
}

export function registerOpenAIMock(mock: OpenAIMockState): void {
  state = mock;
}

export function getOpenAIMock(): OpenAIMockState {
  if (!state) {
    throw new Error(
      "OpenAI mock not registered. Call registerOpenAIMock(buildOpenAIMock()) before invoking code that uses the OpenAI SDK.",
    );
  }
  return state;
}

export function resetOpenAIMock(): void {
  state = null;
}

// The vi.mock("openai", factory) call lives in each test file rather
// than here — vi.mock is hoisted to the top of the file before module
// imports run, so its factory cannot reference an export from this
// helper at module top level. The factory body is small (~10 lines);
// duplicating it per test file is the right trade-off vs. the
// `vi.hoisted` ceremony. The shared surface stays in this helper:
// state + recorders. Same constraint A2's apps/jobs stripe-mock hit.
//
// Reference factory body for new test files:
//
//   vi.mock("openai", async () => {
//     const actual = await vi.importActual<typeof import("openai")>("openai");
//     const { getOpenAIMock } = await import("../../helpers/openai-mock");
//     class FakeOpenAI {
//       static APIError = actual.default.APIError;
//       static BadRequestError = actual.default.BadRequestError;
//       static NotFoundError = actual.default.NotFoundError;
//       static UnprocessableEntityError = actual.default.UnprocessableEntityError;
//       static AuthenticationError = actual.default.AuthenticationError;
//       static PermissionDeniedError = actual.default.PermissionDeniedError;
//       static RateLimitError = actual.default.RateLimitError;
//       static InternalServerError = actual.default.InternalServerError;
//       static APIConnectionError = actual.default.APIConnectionError;
//       static APIConnectionTimeoutError = actual.default.APIConnectionTimeoutError;
//       audio = {
//         transcriptions: {
//           create: (...args: unknown[]) =>
//             getOpenAIMock().audio.transcriptions.create(...args),
//         },
//       };
//     }
//     return { default: FakeOpenAI };
//   });
