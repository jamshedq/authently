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

// vi.mock hoists, so the factory runs before any other module evaluation.
// The factory returns a class whose instance proxies to the per-test
// state. Tests do `vi.mock("stripe", () => stripeMockModule)` and import
// this constant from the helper to keep the wiring identical across files.
export const stripeMockModule = {
  default: class FakeStripe {
    subscriptions = {
      cancel: (...args: unknown[]) =>
        getStripeMock().subscriptions.cancel(...args),
      retrieve: (...args: unknown[]) =>
        getStripeMock().subscriptions.retrieve(...args),
    };
  },
};
