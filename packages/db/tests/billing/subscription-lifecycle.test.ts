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
  linkWorkspaceToSubscription,
  seedPriceTierMap,
  TEST_PRICE_SOLO,
  TEST_PRICE_STUDIO,
} from "../helpers/billing-fixtures.ts";

// =============================================================================
// Subscription lifecycle — five Stripe event types → workspace state
//
// Verifies public.process_stripe_event applies the documented mutations
// for each handled event type, and that the recovery path
// (invoice.payment_succeeded) clears past_due_since cleanly.
// =============================================================================

describe("subscription lifecycle (process_stripe_event dispatch)", () => {
  const pool = new TestUserPool();
  const admin = createServiceRoleClient();

  beforeAll(async () => {
    await seedPriceTierMap(admin);
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("checkout.session.completed → plan_tier set to mapped value, status='active', subscription linked", async () => {
    const owner = await pool.create({ fullName: "Checkout Solo" });
    const subscriptionId = freshSubscriptionId();
    const customerId = freshCustomerId();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { outcome } = await callProcessEvent(admin, {
      type: "checkout.session.completed",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      workspace_id_hint: owner.workspaceId,
      current_period_end: periodEnd,
    });
    expect(outcome).toBe("processed");

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.plan_tier).toBe("solo");
    expect(w.subscription_status).toBe("active");
    expect(w.stripe_subscription_id).toBe(subscriptionId);
    expect(w.stripe_customer_id).toBe(customerId);
    expect(w.past_due_since).toBeNull();
    expect(w.subscription_current_period_end).not.toBeNull();
  });

  test("customer.subscription.updated → plan_tier flips when price_id changes", async () => {
    const owner = await pool.create({ fullName: "Tier Upgrader" });
    const subscriptionId = freshSubscriptionId();
    const customerId = freshCustomerId();

    // Establish baseline: workspace on Solo.
    await callProcessEvent(admin, {
      type: "checkout.session.completed",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      workspace_id_hint: owner.workspaceId,
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });

    // Upgrade to Studio via subscription.updated.
    const newPeriodEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const { outcome } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_STUDIO,
      current_period_end: newPeriodEnd,
    });
    expect(outcome).toBe("processed");

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.plan_tier).toBe("studio");
    expect(w.subscription_status).toBe("active");
  });

  test("customer.subscription.deleted → plan_tier='free', status='canceled', subscription cleared", async () => {
    const owner = await pool.create({ fullName: "Canceler" });
    const subscriptionId = freshSubscriptionId();
    await linkWorkspaceToSubscription(admin, owner.workspaceId, subscriptionId);

    const { outcome } = await callProcessEvent(admin, {
      type: "customer.subscription.deleted",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    expect(outcome).toBe("processed");

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.plan_tier).toBe("free");
    expect(w.subscription_status).toBe("canceled");
    expect(w.stripe_subscription_id).toBeNull();
    expect(w.subscription_current_period_end).toBeNull();
    expect(w.past_due_since).toBeNull();
  });

  test("invoice.payment_failed → status='past_due', past_due_since set", async () => {
    const owner = await pool.create({ fullName: "Failed Payer" });
    const subscriptionId = freshSubscriptionId();
    await linkWorkspaceToSubscription(admin, owner.workspaceId, subscriptionId);

    const before = Date.now();
    const { outcome } = await callProcessEvent(admin, {
      type: "invoice.payment_failed",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    const after = Date.now();
    expect(outcome).toBe("processed");

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.subscription_status).toBe("past_due");
    expect(w.past_due_since).not.toBeNull();
    const ts = new Date(w.past_due_since!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  test("invoice.payment_failed twice → past_due_since stays anchored at first failure", async () => {
    const owner = await pool.create({ fullName: "Repeat Failer" });
    const subscriptionId = freshSubscriptionId();
    await linkWorkspaceToSubscription(admin, owner.workspaceId, subscriptionId);

    await callProcessEvent(admin, {
      type: "invoice.payment_failed",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    const w1 = await getWorkspaceBilling(admin, owner.workspaceId);
    const firstTs = w1.past_due_since!;
    expect(firstTs).not.toBeNull();

    // Brief delay so a "if naive overwrite" bug would surface as a different ts.
    await new Promise((r) => setTimeout(r, 50));

    await callProcessEvent(admin, {
      type: "invoice.payment_failed",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    const w2 = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w2.past_due_since).toBe(firstTs);
  });

  test("invoice.payment_succeeded after past_due → status='active', past_due_since cleared (recovery path)", async () => {
    const owner = await pool.create({ fullName: "Recoverer" });
    const subscriptionId = freshSubscriptionId();
    await linkWorkspaceToSubscription(admin, owner.workspaceId, subscriptionId);

    // Enter past_due
    await callProcessEvent(admin, {
      type: "invoice.payment_failed",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    const wPastDue = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(wPastDue.subscription_status).toBe("past_due");
    expect(wPastDue.past_due_since).not.toBeNull();

    // Recover via invoice.payment_succeeded
    const { outcome } = await callProcessEvent(admin, {
      type: "invoice.payment_succeeded",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    expect(outcome).toBe("processed");

    const wRecovered = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(wRecovered.subscription_status).toBe("active");
    expect(wRecovered.past_due_since).toBeNull();
  });

  test("invoice.payment_succeeded on already-active workspace is a no-op (idempotent)", async () => {
    const owner = await pool.create({ fullName: "Renewal Payer" });
    const subscriptionId = freshSubscriptionId();
    await linkWorkspaceToSubscription(admin, owner.workspaceId, subscriptionId);

    // Workspace stays at default 'active' / past_due_since=null.
    const { outcome } = await callProcessEvent(admin, {
      type: "invoice.payment_succeeded",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    expect(outcome).toBe("processed");

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.subscription_status).toBe("active");
    expect(w.past_due_since).toBeNull();
  });

  test("unknown event type → outcome='unknown_event_type', state unchanged", async () => {
    const owner = await pool.create({ fullName: "Mystery Event" });
    const w0 = await getWorkspaceBilling(admin, owner.workspaceId);

    const { outcome } = await callProcessEvent(admin, {
      type: "customer.created", // not in our switch
      customer_id: freshCustomerId(),
    });
    expect(outcome).toBe("unknown_event_type");

    const w1 = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w1).toEqual(w0);
  });
});
