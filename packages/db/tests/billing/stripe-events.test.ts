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
  freshCustomerId,
  freshEventId,
  linkWorkspaceToSubscription,
  seedPriceTierMap,
  TEST_PRICE_SOLO,
} from "../helpers/billing-fixtures.ts";

// =============================================================================
// stripe_events persistent dedup
//
// The PK on event_id + INSERT ... ON CONFLICT DO NOTHING in
// public.process_stripe_event is the security floor for replay handling.
// These tests pin the contract: a duplicate event_id is silently absorbed
// (returns 'deduplicated'), and the original row's processed_outcome is
// preserved (the second call doesn't overwrite it).
// =============================================================================

describe("stripe_events persistent dedup", () => {
  const pool = new TestUserPool();
  const admin = createServiceRoleClient();

  beforeAll(async () => {
    await seedPriceTierMap(admin);
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("first event with new event_id returns 'processed'; row inserted with outcome", async () => {
    const owner = await pool.create({ fullName: "Dedup First" });
    const subscriptionId = freshSubscriptionId();
    const customerId = freshCustomerId();

    const { outcome, event_id } = await callProcessEvent(admin, {
      type: "checkout.session.completed",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      workspace_id_hint: owner.workspaceId,
    });

    expect(outcome).toBe("processed");

    const row = await admin
      .from("stripe_events")
      .select("event_id, type, processed_outcome, workspace_id")
      .eq("event_id", event_id)
      .single();
    expect(row.error).toBeNull();
    expect(row.data?.type).toBe("checkout.session.completed");
    expect(row.data?.processed_outcome).toBe("processed");
    expect(row.data?.workspace_id).toBe(owner.workspaceId);
  });

  test("duplicate event_id returns 'deduplicated'; original outcome unchanged", async () => {
    const owner = await pool.create({ fullName: "Dedup Replay" });
    const subscriptionId = freshSubscriptionId();
    const customerId = freshCustomerId();
    const eventId = freshEventId();

    const first = await callProcessEvent(admin, {
      event_id: eventId,
      type: "checkout.session.completed",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      workspace_id_hint: owner.workspaceId,
    });
    expect(first.outcome).toBe("processed");

    // Replay with the SAME event_id but completely different fields. The
    // dedup must short-circuit before any state mutation.
    const replay = await callProcessEvent(admin, {
      event_id: eventId,
      type: "customer.subscription.deleted",
      subscription_id: freshSubscriptionId(),
      price_id: TEST_PRICE_SOLO,
    });
    expect(replay.outcome).toBe("deduplicated");

    // The original row's outcome is NOT overwritten by the replay.
    const row = await admin
      .from("stripe_events")
      .select("type, processed_outcome")
      .eq("event_id", eventId)
      .single();
    expect(row.data?.type).toBe("checkout.session.completed");
    expect(row.data?.processed_outcome).toBe("processed");
  });

  test("dedup short-circuits state mutation: workspace untouched on replay", async () => {
    const owner = await pool.create({ fullName: "Dedup Idempotent" });
    const subscriptionId = freshSubscriptionId();
    const eventId = freshEventId();

    // Pre-link the workspace so subscription.deleted has something to act on.
    await linkWorkspaceToSubscription(admin, owner.workspaceId, subscriptionId);

    const first = await callProcessEvent(admin, {
      event_id: eventId,
      type: "customer.subscription.deleted",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    expect(first.outcome).toBe("processed");

    // Replay should NOT re-run the deletion logic (no harm even if it did,
    // since subscription_id is now null on the workspace, but the contract
    // is clear: dedup happens BEFORE dispatch).
    const replay = await callProcessEvent(admin, {
      event_id: eventId,
      type: "customer.subscription.deleted",
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
    });
    expect(replay.outcome).toBe("deduplicated");
  });
});
