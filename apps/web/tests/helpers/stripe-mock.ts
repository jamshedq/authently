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

// In-test recorder for Stripe API calls. Tests assert on `calls.*` arrays
// to verify the SDK was invoked with the right shape (line_items, metadata,
// success/cancel URLs, customer reuse).

export type StripeMockState = {
  customers: {
    create: ReturnType<typeof vi.fn>;
  };
  checkout: {
    sessions: {
      create: ReturnType<typeof vi.fn>;
    };
  };
  billingPortal: {
    sessions: {
      create: ReturnType<typeof vi.fn>;
    };
  };
};

let state: StripeMockState | null = null;

/**
 * Build a fresh Stripe mock object with `vi.fn()` recorders. Each test
 * builds its own state and calls registerStripeMock so the @stripe/stripe-node
 * default export resolves to it.
 *
 * Tests configure return values per-call (see usage in
 * services/billing/*.test.ts):
 *
 *   const stripeMock = buildStripeMock();
 *   stripeMock.customers.create.mockResolvedValue({ id: "cus_test_xyz" });
 *   stripeMock.checkout.sessions.create.mockResolvedValue({
 *     id: "cs_test_abc",
 *     url: "https://checkout.stripe.com/pay/cs_test_abc",
 *   });
 *   registerStripeMock(stripeMock);
 */
export function buildStripeMock(): StripeMockState {
  return {
    customers: {
      create: vi.fn(),
    },
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
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
// The factory returns a class whose instance proxies to the per-test state.
// Tests do `vi.mock("stripe", () => stripeMockModule)` and import this
// constant from the helper to keep the wiring identical across files.
export const stripeMockModule = {
  default: class FakeStripe {
    customers = {
      create: (...args: unknown[]) => getStripeMock().customers.create(...args),
    };
    checkout = {
      sessions: {
        create: (...args: unknown[]) =>
          getStripeMock().checkout.sessions.create(...args),
      },
    };
    billingPortal = {
      sessions: {
        create: (...args: unknown[]) =>
          getStripeMock().billingPortal.sessions.create(...args),
      },
    };
    webhooks = {
      // The webhook signature-verification path runs inside the handler
      // we're not testing in apps/web — those tests live at the DB layer
      // (packages/db/tests/billing). Stub it out so any accidental import
      // doesn't blow up.
      constructEvent: () => {
        throw new Error("constructEvent is not stubbed in apps/web tests");
      },
    };
  },
};
