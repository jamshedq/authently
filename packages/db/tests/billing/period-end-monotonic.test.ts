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
} from "../helpers/billing-fixtures.ts";

// =============================================================================
// Sprint 03 A2 — forward-only `subscription_current_period_end` predicate
// on customer.subscription.updated.
//
// Migration 20260501171326 added a WHERE-clause predicate to that branch:
//   and (subscription_current_period_end is null
//        or subscription_current_period_end < _current_period_end)
//
// Defends against Stripe's "object snapshot" delivery semantics: each
// subscription.updated event carries the full subscription state, so an
// older event arriving after a newer one would otherwise overwrite the
// newer state. The predicate makes period_end monotonically forward —
// when it fails, the entire UPDATE is skipped and the function returns
// `subscription_mismatch` (broadened semantics; ops disambiguates via
// the SQL warning message which now reads
// "subscription_mismatch_or_stale_period_end").
//
// Per the locked spec at docs/specs/SPRINT_CURRENT.md, two tests
// exercise both branches of the predicate:
//   - reverse-order arrival → IS NULL branch + < branch
//   - same-date arrival → < branch (false on equality, idempotent)
// =============================================================================

describe("forward-only period_end predicate (process_stripe_event)", () => {
  const pool = new TestUserPool();
  const admin = createServiceRoleClient();

  beforeAll(async () => {
    await seedPriceTierMap(admin);
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("subscription.updated arrives twice in reverse order → workspace ends with newer date", async () => {
    const owner = await pool.create({ fullName: "Out Of Order" });
    const subscriptionId = freshSubscriptionId();
    const customerId = freshCustomerId();
    await linkWorkspaceToSubscription(
      admin,
      owner.workspaceId,
      subscriptionId,
      customerId,
    );

    const olderPeriodEnd = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const newerPeriodEnd = new Date(
      Date.now() + 60 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Newer event processes first.
    const { outcome: outcomeNewer } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      current_period_end: newerPeriodEnd,
    });
    expect(outcomeNewer).toBe("processed");

    const wMid = await getWorkspaceBilling(admin, owner.workspaceId);
    // Compare instants, not literal strings — Postgres serialises
    // timestamptz with `+00:00`, JS toISOString uses `Z`.
    // (See packages/db/tests/CLAUDE.md.)
    expect(new Date(wMid.subscription_current_period_end!).getTime()).toBe(
      new Date(newerPeriodEnd).getTime(),
    );

    // Older event arrives second (out of order). The predicate fails;
    // the whole UPDATE skips; outcome is subscription_mismatch (broadened
    // semantics — see migration 20260501171326).
    const { outcome: outcomeOlder } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      current_period_end: olderPeriodEnd,
    });
    expect(outcomeOlder).toBe("subscription_mismatch");

    // Workspace state stays at the newer date.
    const wFinal = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(new Date(wFinal.subscription_current_period_end!).getTime()).toBe(
      new Date(newerPeriodEnd).getTime(),
    );
  });

  test("subscription.updated arrives twice with the same date → second is a no-op (idempotent on retry)", async () => {
    const owner = await pool.create({ fullName: "Idempotent Replay" });
    const subscriptionId = freshSubscriptionId();
    const customerId = freshCustomerId();
    await linkWorkspaceToSubscription(
      admin,
      owner.workspaceId,
      subscriptionId,
      customerId,
    );

    const periodEnd = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // First call — moves period_end from null to `periodEnd`.
    const { outcome: outcomeFirst } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      current_period_end: periodEnd,
    });
    expect(outcomeFirst).toBe("processed");

    // Second call — same period_end. Predicate `existing < incoming`
    // evaluates to false on equality; UPDATE matches 0 rows; outcome
    // is subscription_mismatch.
    const { outcome: outcomeSecond } = await callProcessEvent(admin, {
      type: "customer.subscription.updated",
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: TEST_PRICE_SOLO,
      current_period_end: periodEnd,
    });
    expect(outcomeSecond).toBe("subscription_mismatch");

    // Workspace state unchanged.
    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(new Date(w.subscription_current_period_end!).getTime()).toBe(
      new Date(periodEnd).getTime(),
    );
  });
});
