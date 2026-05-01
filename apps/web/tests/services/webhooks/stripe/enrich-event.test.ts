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

import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildStripeMock,
  registerStripeMock,
  resetStripeMock,
  stripeMockModule,
  type StripeMockState,
} from "../../../helpers/stripe-mock";

vi.mock("stripe", () => stripeMockModule);

import { enrichEventForExtraction } from "@/services/webhooks/stripe/enrich-event";
import { extractEventFields } from "@/services/webhooks/stripe/extract-event-fields";

// =============================================================================
// enrichEventForExtraction — fetches checkout.session with line_items expanded
//
// Regression coverage for the bug surfaced in Section D Commit 2's manual
// smoke test: checkout.session.completed webhook payloads do not include
// line_items by default, so price_id extraction returned null and the RPC
// returned 'unknown_price'. The fix wraps the event through this helper so
// downstream extraction sees a populated session.
// =============================================================================

function makeCheckoutEvent(
  object: Partial<Stripe.Checkout.Session>,
): Stripe.Event {
  return {
    id: "evt_test_checkout_completed",
    object: "event",
    type: "checkout.session.completed",
    api_version: "2020-03-02",
    created: 0,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: { object: object as Stripe.Checkout.Session },
  } as unknown as Stripe.Event;
}

describe("enrichEventForExtraction", () => {
  let stripe: StripeMockState;

  beforeEach(() => {
    stripe = buildStripeMock();
    registerStripeMock(stripe);
  });

  afterEach(() => {
    resetStripeMock();
  });

  test("checkout.session.completed → calls stripe.checkout.sessions.retrieve with expand: ['line_items']", async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_test_session_xyz",
      customer: "cus_test_xyz",
      subscription: "sub_test_xyz",
      metadata: { workspace_id: "00000000-0000-4000-8000-000000000001" },
      line_items: {
        data: [{ price: { id: "price_solo_real" } }],
      },
    });

    const event = makeCheckoutEvent({
      id: "cs_test_session_xyz",
      customer: "cus_test_xyz",
      subscription: "sub_test_xyz",
      metadata: { workspace_id: "00000000-0000-4000-8000-000000000001" },
    });

    await enrichEventForExtraction(event);

    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
      "cs_test_session_xyz",
      { expand: ["line_items"] },
    );
  });

  test("after enrichment, extractEventFields produces the price_id from line_items", async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_test_session_xyz",
      customer: "cus_test_xyz",
      subscription: "sub_test_xyz",
      metadata: { workspace_id: "00000000-0000-4000-8000-000000000001" },
      line_items: {
        data: [{ price: { id: "price_studio_real" } }],
      },
    });

    const event = makeCheckoutEvent({
      id: "cs_test_session_xyz",
      customer: "cus_test_xyz",
      subscription: "sub_test_xyz",
      metadata: { workspace_id: "00000000-0000-4000-8000-000000000001" },
    });

    const enriched = await enrichEventForExtraction(event);
    const extracted = extractEventFields(enriched);

    expect(extracted.price_id).toBe("price_studio_real");
    expect(extracted.customer_id).toBe("cus_test_xyz");
    expect(extracted.subscription_id).toBe("sub_test_xyz");
    expect(extracted.workspace_id_hint).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  test("non-checkout events pass through without calling stripe.checkout.sessions.retrieve", async () => {
    const subscriptionEvent = {
      id: "evt_test_sub_updated",
      object: "event",
      type: "customer.subscription.updated",
      api_version: "2020-03-02",
      created: 0,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: {
        object: {
          id: "sub_test_xyz",
          customer: "cus_test_xyz",
          items: { data: [{ price: { id: "price_solo_real" } }] },
        },
      },
    } as unknown as Stripe.Event;

    const result = await enrichEventForExtraction(subscriptionEvent);

    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(result).toBe(subscriptionEvent);
  });
});
