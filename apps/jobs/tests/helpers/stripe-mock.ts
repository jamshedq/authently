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

// In-test recorder for Stripe API calls used inside Trigger.dev tasks.
// Tests assert on `calls.*` arrays to verify the SDK was invoked with the
// right shape (subscription IDs for cancellation, etc.).
//
// Mirrors apps/web/tests/helpers/stripe-mock.ts in pattern; surface
// extended for the cancel/retrieve methods A2 needs. Per the Sprint 05
// A2 pre-flight: extraction to a shared package would warrant a third
// consumer; copy + extend is the right call at two consumers.
//
// Differs from apps/web's helper in one important way: the mock factory
// preserves the real `Stripe.errors` namespace (via vi.importActual) so
// the cancel function's `instanceof Stripe.errors.StripeInvalidRequestError`
// branches work in test. apps/web's tests don't exercise error paths, so
// they didn't need this; A2's classification surface does.

export type StripeMockState = {
  subscriptions: {
    cancel: ReturnType<typeof vi.fn>;
    retrieve: ReturnType<typeof vi.fn>;
  };
};

let state: StripeMockState | null = null;

/**
 * Build a fresh Stripe mock object with `vi.fn()` recorders. Each test
 * builds its own state and calls registerStripeMock so the
 * @stripe/stripe-node default export resolves to it.
 *
 *   const stripeMock = buildStripeMock();
 *   stripeMock.subscriptions.cancel.mockResolvedValue({ id: "sub_xxx", status: "canceled" });
 *   registerStripeMock(stripeMock);
 */
export function buildStripeMock(): StripeMockState {
  return {
    subscriptions: {
      cancel: vi.fn(),
      retrieve: vi.fn(),
    },
  };
}

export function registerStripeMock(mock: StripeMockState): void {
  state = mock;
}

export function getStripeMock(): StripeMockState {
  if (!state) {
    throw new Error(
      "Stripe mock not registered. Call registerStripeMock(buildStripeMock()) before invoking code that uses the Stripe SDK.",
    );
  }
  return state;
}

export function resetStripeMock(): void {
  state = null;
}

// The vi.mock("stripe", factory) call lives in each test file rather
// than here — vi.mock is hoisted to the top of the file before module
// imports run, so its factory cannot reference an export from this
// helper at module top level. The factory body is small (~10 lines);
// duplicating it per test file is the right trade-off vs. the
// `vi.hoisted` ceremony required to share a factory function across
// files. The shared surface stays in this helper: state + recorders.
//
// Reference factory body for new test files:
//
//   vi.mock("stripe", async () => {
//     const actual = await vi.importActual<typeof import("stripe")>("stripe");
//     const { getStripeMock } = await import("../../helpers/stripe-mock");
//     class FakeStripe {
//       static errors = actual.default.errors;
//       subscriptions = {
//         cancel: (...args: unknown[]) =>
//           getStripeMock().subscriptions.cancel(...args),
//         retrieve: (...args: unknown[]) =>
//           getStripeMock().subscriptions.retrieve(...args),
//       };
//     }
//     return { default: FakeStripe };
//   });
