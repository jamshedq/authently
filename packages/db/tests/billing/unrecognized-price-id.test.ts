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

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createServiceRoleClient } from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";
import {
  callProcessEvent,
  freshSubscriptionId,
  getWorkspaceBilling,
  linkWorkspaceToSubscription,
  seedPriceTierMap,
  TEST_PRICE_SOLO,
  TEST_PRICE_UNKNOWN,
} from "../helpers/billing-fixtures.ts";

// =============================================================================
// Unrecognized price IDs
//
// Per docs/runbooks/stripe-products.md (Step 8), price IDs not in the
// stripe_price_tier_map MUST surface as a 'unknown_price' outcome. The
// function emits RAISE WARNING but does NOT throw — workspace state is
// left intact. Stripe should not retry these (we recognized the event,
// we just didn't have a tier mapping).
// =============================================================================

describe("unrecognized price ID handling", () => {
  const pool = new TestUserPool();
  const admin = createServiceRoleClient();

  beforeAll(async () => {
    await seedPriceTierMap(admin);
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("checkout.session.completed with unknown price_id → outcome='unknown_price', plan_tier unchanged", async () => {
    const owner = await pool.create({ fullName: "Unknown Price Checkout" });
    const before = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(before.plan_tier).toBe("free");

    const { outcome } = await callProcessEvent(admin, {
      type: "checkout.session.completed",
      subscription_id: freshSubscriptionId(),
      price_id: TEST_PRICE_UNKNOWN,
      workspace_id_hint: owner.workspaceId,
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(outcome).toBe("unknown_price");

    const after = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(after.plan_tier).toBe("free");
    expect(after.subscription_status).toBe("active");
    expect(after.stripe_subscription_id).toBeNull();
  });

  test("customer.subscription.updated with unknown price_id → outcome='unknown_price', plan_tier unchanged", async () => {
    const owner = await pool.create({ fullName: "Unknown Price Update" });
    const subscriptionId = freshSubscriptionId();

    // Establish baseline on Solo.
    await callProcessEvent(admin, {
      type: "checkout.session.completed",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      workspace_id_hint: owner.workspaceId,
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const baseline = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(baseline.plan_tier).toBe("solo");

    // Update event arrives with a price ID we've never seen.
    const { outcome } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_UNKNOWN,
      current_period_end: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    });
    expect(outcome).toBe("unknown_price");

    const after = await getWorkspaceBilling(admin, owner.workspaceId);
    // plan_tier unchanged: workspace still on Solo.
    expect(after.plan_tier).toBe("solo");
  });

  test("checkout.session.completed with no workspace match → 'workspace_not_found', no mutation", async () => {
    // Random subscription_id that doesn't match any workspace, no
    // workspace_id_hint either.
    const { outcome } = await callProcessEvent(admin, {
      type: "checkout.session.completed",
      subscription_id: freshSubscriptionId(),
      price_id: TEST_PRICE_SOLO,
      // no workspace_id_hint, no pre-linked subscription
    });
    expect(outcome).toBe("workspace_not_found");
  });

  test("invoice.payment_failed for unknown subscription → 'workspace_not_found', no mutation", async () => {
    // Verify the warning-and-return path: we don't error, we don't crash,
    // we just log and let Stripe move on. This test exists because Stripe
    // can send events for subscriptions we've never seen if a webhook is
    // re-pointed at a different account.
    const { outcome } = await callProcessEvent(admin, {
      type: "invoice.payment_failed",
      subscription_id: freshSubscriptionId(),
      price_id: TEST_PRICE_SOLO,
    });
    expect(outcome).toBe("workspace_not_found");
  });

  test("unknown_price still records to stripe_events for forensics", async () => {
    const owner = await pool.create({ fullName: "Forensic Trace" });
    const subscriptionId = freshSubscriptionId();
    await linkWorkspaceToSubscription(admin, owner.workspaceId, subscriptionId);

    const { event_id } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_UNKNOWN,
    });

    const row = await admin
      .from("stripe_events")
      .select("event_id, type, processed_outcome")
      .eq("event_id", event_id)
      .single();
    expect(row.error).toBeNull();
    expect(row.data?.processed_outcome).toBe("unknown_price");
  });
});
