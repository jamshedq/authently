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
// ../../helpers/stripe-mock at module top-level. We dynamically import
// the helper's getStripeMock inside the factory body, and import the
// real Stripe module via importActual so the `Stripe.errors.*` namespace
// (used by the cancel function's instanceof checks) survives the mock.
vi.mock("stripe", async () => {
  const actual = await vi.importActual<typeof import("stripe")>("stripe");
  const { getStripeMock } = await import("../../helpers/stripe-mock");
  class FakeStripe {
    static errors = actual.default.errors;
    subscriptions = {
      cancel: (...args: unknown[]) =>
        getStripeMock().subscriptions.cancel(...args),
      retrieve: (...args: unknown[]) =>
        getStripeMock().subscriptions.retrieve(...args),
    };
  }
  return { default: FakeStripe };
});

import Stripe from "stripe";
import {
  buildStripeMock,
  registerStripeMock,
  resetStripeMock,
  type StripeMockState,
} from "../../helpers/stripe-mock";

// Force a fresh STRIPE_SECRET_KEY for the SDK constructor in
// getJobsStripeClient. The mock doesn't actually call Stripe; the key
// just needs to be non-empty.
process.env["STRIPE_SECRET_KEY"] = "sk_test_dummy_for_unit_tests";

import { cancelWorkspaceSubscription } from "../../../src/services/billing/cancel-workspace-subscription.ts";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const SUB_ID = "sub_test_xxx";
const CUSTOMER_ID = "cus_test_xxx";

// Build a StripeInvalidRequestError with the given code/message. Uses
// the constructor signature from stripe-node — passing a raw payload
// shape that mirrors what the SDK builds internally on a 4xx response.
function buildInvalidRequestError(
  code: string,
  message: string,
): Stripe.errors.StripeInvalidRequestError {
  return new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code,
    message,
  });
}

describe("cancelWorkspaceSubscription", () => {
  let stripe: StripeMockState;

  beforeEach(() => {
    stripe = buildStripeMock();
    registerStripeMock(stripe);
  });

  afterEach(() => {
    resetStripeMock();
    vi.restoreAllMocks();
  });

  test("happy path: active subscription → retrieve + cancel called → ok", async () => {
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: SUB_ID,
      status: "active",
    });
    stripe.subscriptions.cancel.mockResolvedValue({
      id: SUB_ID,
      status: "canceled",
    });

    const result = await cancelWorkspaceSubscription({
      workspaceId: WORKSPACE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUB_ID,
    });

    expect(result).toEqual({ ok: true });
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(SUB_ID);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(SUB_ID);
  });

  test("already-canceled: retrieve returns status 'canceled' → cancel NOT called → ok + warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: SUB_ID,
      status: "canceled",
    });

    const result = await cancelWorkspaceSubscription({
      workspaceId: WORKSPACE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUB_ID,
    });

    expect(result).toEqual({ ok: true });
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(SUB_ID);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("subscription already canceled in Stripe"),
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    );
  });

  test("no stripe_subscription_id → no Stripe call → ok", async () => {
    const result = await cancelWorkspaceSubscription({
      workspaceId: WORKSPACE_ID,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });

    expect(result).toEqual({ ok: true });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  test("customer set but sub null → no Stripe call → ok (sweeper does not audit Stripe state)", async () => {
    const result = await cancelWorkspaceSubscription({
      workspaceId: WORKSPACE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: null,
    });

    expect(result).toEqual({ ok: true });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  test("subscription truly missing on Stripe (resource_missing on retrieve) → ok + warn (data inconsistency log trail)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripe.subscriptions.retrieve.mockRejectedValue(
      buildInvalidRequestError(
        "resource_missing",
        `No such subscription: '${SUB_ID}'`,
      ),
    );

    const result = await cancelWorkspaceSubscription({
      workspaceId: WORKSPACE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUB_ID,
    });

    expect(result).toEqual({ ok: true });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("subscription not found in Stripe"),
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        stripeCode: "resource_missing",
      }),
    );
  });

  test("transient connection error (network) → { ok: false, error: connection: ... } (retry-eligible)", async () => {
    stripe.subscriptions.retrieve.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({
        type: "api_connection_error",
        message: "Network unreachable",
      }),
    );

    const result = await cancelWorkspaceSubscription({
      workspaceId: WORKSPACE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUB_ID,
    });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^connection:/),
    });
  });

  test("auth error (401/403) → { ok: false, error: 'auth: ...' } (intentionally retry-then-sentinel)", async () => {
    stripe.subscriptions.retrieve.mockRejectedValue(
      new Stripe.errors.StripeAuthenticationError({
        type: "authentication_error",
        message: "Invalid API Key provided",
      }),
    );

    const result = await cancelWorkspaceSubscription({
      workspaceId: WORKSPACE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUB_ID,
    });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^auth:/),
    });
  });

  test("rate limit (429) → { ok: false, error: 'rate_limit: ...' } (retry-eligible)", async () => {
    stripe.subscriptions.retrieve.mockRejectedValue(
      new Stripe.errors.StripeRateLimitError({
        type: "rate_limit_error",
        message: "Too many requests",
      }),
    );

    const result = await cancelWorkspaceSubscription({
      workspaceId: WORKSPACE_ID,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUB_ID,
    });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^rate_limit:/),
    });
  });
});
