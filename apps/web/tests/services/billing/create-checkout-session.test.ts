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
import {
  buildStripeMock,
  registerStripeMock,
  resetStripeMock,
  stripeMockModule,
  type StripeMockState,
} from "../../helpers/stripe-mock";
import {
  TestUserPool,
  serviceRoleClient,
} from "../../helpers/test-workspace";

vi.mock("stripe", () => stripeMockModule);

import { createCheckoutSession } from "@/services/billing/create-checkout-session";

describe("createCheckoutSession", () => {
  const pool = new TestUserPool();
  let stripe: StripeMockState;

  beforeEach(() => {
    stripe = buildStripeMock();
    registerStripeMock(stripe);
    stripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_test_session_xyz",
      url: "https://checkout.stripe.com/pay/cs_test_session_xyz",
    });
  });

  afterEach(async () => {
    resetStripeMock();
    await pool.cleanup();
  });

  test("happy path: workspace has no customer → pre-creates Stripe customer with workspace_id metadata", async () => {
    const owner = await pool.create({ fullName: "Pre-create Customer" });
    stripe.customers.create.mockResolvedValue({ id: "cus_test_precreated_001" });

    const result = await createCheckoutSession({
      workspace: { id: owner.workspaceId, slug: owner.workspaceSlug },
      tier: "solo",
      existingCustomerId: null,
      userId: owner.userId,
    });

    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(stripe.customers.create).toHaveBeenCalledWith({
      metadata: { workspace_id: owner.workspaceId },
    });
    expect(result.customerId).toBe("cus_test_precreated_001");
    expect(result.url).toBe("https://checkout.stripe.com/pay/cs_test_session_xyz");
  });

  test("workspace.stripe_customer_id is persisted via svc_set_workspace_stripe_customer", async () => {
    const owner = await pool.create({ fullName: "Persist Customer" });
    stripe.customers.create.mockResolvedValue({ id: "cus_test_persist_001" });

    await createCheckoutSession({
      workspace: { id: owner.workspaceId, slug: owner.workspaceSlug },
      tier: "solo",
      existingCustomerId: null,
      userId: owner.userId,
    });

    const admin = serviceRoleClient();
    const { data } = await admin
      .from("workspaces")
      .select("stripe_customer_id")
      .eq("id", owner.workspaceId)
      .single();
    expect(data?.stripe_customer_id).toBe("cus_test_persist_001");
  });

  test("workspace already has a customer → reuses, does NOT call customers.create", async () => {
    const owner = await pool.create({ fullName: "Reuse Customer" });

    const result = await createCheckoutSession({
      workspace: { id: owner.workspaceId, slug: owner.workspaceSlug },
      tier: "studio",
      existingCustomerId: "cus_existing_xyz_999",
      userId: owner.userId,
    });

    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(result.customerId).toBe("cus_existing_xyz_999");
  });

  test("session.metadata.workspace_id is set for the webhook handler to consume", async () => {
    const owner = await pool.create({ fullName: "Metadata Contract" });
    stripe.customers.create.mockResolvedValue({ id: "cus_meta_001" });

    await createCheckoutSession({
      workspace: { id: owner.workspaceId, slug: owner.workspaceSlug },
      tier: "solo",
      existingCustomerId: null,
      userId: owner.userId,
    });

    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const callArgs = stripe.checkout.sessions.create.mock.calls[0]![0];
    expect(callArgs.metadata.workspace_id).toBe(owner.workspaceId);
    expect(callArgs.metadata.plan_tier).toBe("solo");
    expect(callArgs.metadata.owner_user_id).toBe(owner.userId);
    // subscription_data.metadata also carries workspace_id (belt-and-braces
    // for customer.subscription.* events that don't traverse session metadata).
    expect(callArgs.subscription_data.metadata.workspace_id).toBe(owner.workspaceId);
  });

  test("line_items use the env-configured price ID for the requested tier", async () => {
    const owner = await pool.create({ fullName: "Price Lookup" });
    stripe.customers.create.mockResolvedValue({ id: "cus_price_001" });

    await createCheckoutSession({
      workspace: { id: owner.workspaceId, slug: owner.workspaceSlug },
      tier: "studio",
      existingCustomerId: null,
      userId: owner.userId,
    });

    const callArgs = stripe.checkout.sessions.create.mock.calls[0]![0];
    expect(callArgs.line_items).toEqual([
      { price: process.env["STRIPE_PRICE_STUDIO"], quantity: 1 },
    ]);
    expect(callArgs.mode).toBe("subscription");
    expect(callArgs.automatic_tax).toEqual({ enabled: false });
  });

  test("success_url and cancel_url include workspace slug", async () => {
    const owner = await pool.create({ fullName: "URLs" });

    await createCheckoutSession({
      workspace: { id: owner.workspaceId, slug: owner.workspaceSlug },
      tier: "solo",
      existingCustomerId: "cus_urls_001",
      userId: owner.userId,
    });

    const callArgs = stripe.checkout.sessions.create.mock.calls[0]![0];
    expect(callArgs.success_url).toContain(`/app/${owner.workspaceSlug}/settings`);
    expect(callArgs.success_url).toContain("checkout=success");
    expect(callArgs.cancel_url).toContain(`/app/${owner.workspaceSlug}/settings`);
    expect(callArgs.cancel_url).toContain("checkout=canceled");
  });
});
