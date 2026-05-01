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
  freshCustomerId,
  freshSubscriptionId,
  getWorkspaceBilling,
  seedPriceTierMap,
  TEST_PRICE_SOLO,
} from "../helpers/billing-fixtures.ts";

// =============================================================================
// customer_id fallback resolution — defense-in-depth for events that arrive
// when stripe_subscription_id was never written to the workspace.
//
// Migration 20260501025654_billing_customer_id_fallback.sql added a fallback
// in the four subscription-bound branches: if the SELECT by
// stripe_subscription_id misses, fall back to a SELECT by stripe_customer_id
// guarded by stripe_subscription_id IS NULL. The IS NULL guard prevents
// matching a workspace that's already linked to a different active
// subscription.
//
// Companion fix in apps/web (enrichEventForExtraction) addresses the
// upstream cause; these tests cover the fallback path itself.
// =============================================================================

async function preLinkCustomer(
  admin: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  customerId: string,
  subscriptionId?: string,
): Promise<void> {
  const updates: Record<string, string | null> = {
    stripe_customer_id: customerId,
  };
  if (subscriptionId !== undefined) {
    updates["stripe_subscription_id"] = subscriptionId;
  }
  const { error } = await admin
    .from("workspaces")
    .update(updates as never)
    .eq("id", workspaceId);
  if (error) throw new Error(`preLinkCustomer failed: ${error.message}`);
}

describe("customer_id fallback (process_stripe_event)", () => {
  const pool = new TestUserPool();
  const admin = createServiceRoleClient();

  beforeAll(async () => {
    await seedPriceTierMap(admin);
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("subscription.updated with NULL stripe_subscription_id but matching customer_id → resolves via fallback and links subscription_id", async () => {
    const owner = await pool.create({ fullName: "Fallback Linker" });
    const customerId = freshCustomerId();
    const subscriptionId = freshSubscriptionId();
    // Workspace has the customer_id (set during checkout pre-creation) but
    // not the subscription_id (because checkout.session.completed dropped on
    // 'unknown_price'). This is the deadlock the smoke test surfaced.
    await preLinkCustomer(admin, owner.workspaceId, customerId);

    const { outcome } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(outcome).toBe("processed");

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.stripe_subscription_id).toBe(subscriptionId);
    expect(w.stripe_customer_id).toBe(customerId);
    expect(w.plan_tier).toBe("solo");
  });

  test("subscription.updated with customer_id matching but workspace already linked to a DIFFERENT subscription_id → does NOT resolve (IS NULL guard)", async () => {
    const owner = await pool.create({ fullName: "Different Subscription" });
    const customerId = freshCustomerId();
    const existingSub = freshSubscriptionId();
    const newSub = freshSubscriptionId();

    // Workspace already has BOTH a customer_id and an active subscription.
    await preLinkCustomer(admin, owner.workspaceId, customerId, existingSub);

    // Event arrives for a DIFFERENT subscription (e.g. someone created a
    // second subscription on the same customer via Stripe Dashboard).
    const { outcome } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      customer_id: customerId,
      subscription_id: newSub,
      price_id: TEST_PRICE_SOLO,
    });

    // The fallback's IS NULL guard prevents matching a workspace already
    // linked to a different sub. Since the primary SELECT also misses
    // (newSub doesn't match existingSub), the outcome is workspace_not_found.
    expect(outcome).toBe("workspace_not_found");

    // Workspace state unchanged.
    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.stripe_subscription_id).toBe(existingSub);
  });

  test("invoice.payment_failed with NULL stripe_subscription_id but matching customer_id → fallback resolves and sets past_due_since", async () => {
    const owner = await pool.create({ fullName: "Fallback Past-Due" });
    const customerId = freshCustomerId();
    const subscriptionId = freshSubscriptionId();
    await preLinkCustomer(admin, owner.workspaceId, customerId);

    const before = Date.now();
    const { outcome } = await callProcessEvent(admin, {
      type: "invoice.payment_failed",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    const after = Date.now();
    expect(outcome).toBe("processed");

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.subscription_status).toBe("past_due");
    expect(w.stripe_subscription_id).toBe(subscriptionId);
    expect(w.past_due_since).not.toBeNull();
    const ts = new Date(w.past_due_since!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  test("invoice.payment_succeeded with NULL stripe_subscription_id but matching customer_id → fallback resolves, links sub, status='active'", async () => {
    const owner = await pool.create({ fullName: "Fallback Recovery" });
    const customerId = freshCustomerId();
    const subscriptionId = freshSubscriptionId();
    await preLinkCustomer(admin, owner.workspaceId, customerId);

    const { outcome } = await callProcessEvent(admin, {
      type: "invoice.payment_succeeded",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    expect(outcome).toBe("processed");

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.stripe_subscription_id).toBe(subscriptionId);
    expect(w.subscription_status).toBe("active");
    expect(w.past_due_since).toBeNull();
  });

  test("checkout.session.completed with null _current_period_end → preserves existing period_end (race-safe vs. subscription.updated arriving first)", async () => {
    // Real-wire scenario: customer.subscription.updated finishes before
    // checkout.session.completed (because the latter does an extra Stripe
    // API call for line_items expansion). subscription.updated sets
    // period_end to a real date via the customer_id fallback. Then
    // checkout.session.completed runs — its UPDATE must NOT clobber the
    // period_end with null.
    const owner = await pool.create({ fullName: "Race Safe" });
    const customerId = freshCustomerId();
    const subscriptionId = freshSubscriptionId();
    const periodEndIso = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await preLinkCustomer(admin, owner.workspaceId, customerId);

    // Step 1: simulate subscription.updated arriving first (fallback path).
    await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      current_period_end: periodEndIso,
    });
    const wMid = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(wMid.subscription_current_period_end).not.toBeNull();
    const setPeriodEnd = wMid.subscription_current_period_end;

    // Step 2: checkout.session.completed arrives second with no period_end.
    const { outcome } = await callProcessEvent(admin, {
      type: "checkout.session.completed",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      workspace_id_hint: owner.workspaceId,
      current_period_end: null,
    });
    expect(outcome).toBe("processed");

    // The period_end set in step 1 must survive step 2's UPDATE.
    const wFinal = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(wFinal.subscription_current_period_end).toBe(setPeriodEnd);
    expect(wFinal.plan_tier).toBe("solo");
    expect(wFinal.subscription_status).toBe("active");
  });

  test("subscription.updated with no customer_id and no matching subscription_id → workspace_not_found (fallback skipped, no degenerate match)", async () => {
    const owner = await pool.create({ fullName: "No Customer" });
    // No pre-link — workspace has neither customer_id nor subscription_id.

    const { outcome } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      customer_id: null,
      subscription_id: freshSubscriptionId(),
      price_id: TEST_PRICE_SOLO,
    });
    expect(outcome).toBe("workspace_not_found");

    // Confirm workspace state unchanged.
    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.stripe_subscription_id).toBeNull();
    expect(w.plan_tier).toBe("free");
  });
});
