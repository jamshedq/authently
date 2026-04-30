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
import {
  createAnonClient,
  createAuthenticatedClient,
  createServiceRoleClient,
} from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";
import {
  buildTestPayload,
  freshEventId,
  freshSubscriptionId,
  seedPriceTierMap,
  TEST_PRICE_SOLO,
} from "../helpers/billing-fixtures.ts";

// =============================================================================
// process_stripe_event security perimeter
//
// The function is granted to `service_role` only — anonymous and
// authenticated callers must be rejected. This is the canonical RLS-
// perimeter test for the new private RPCs introduced in Section D Commit 1.
//
// PostgREST surfaces missing-grant rejections as one of:
//   - 401/403 with code '42501' (insufficient_privilege), OR
//   - PGRST202 "function not found" (when the function exists but isn't
//     in the searchable schema for the role)
//
// Both indicate the perimeter held; the test accepts either.
// =============================================================================

describe("process_stripe_event security perimeter", () => {
  const pool = new TestUserPool();
  const admin = createServiceRoleClient();

  beforeAll(async () => {
    await seedPriceTierMap(admin);
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("authenticated client is rejected from calling public.process_stripe_event", async () => {
    const owner = await pool.create({ fullName: "Authed Probe" });
    const userClient = createAuthenticatedClient(owner.accessToken);

    const eventId = freshEventId();
    const subscriptionId = freshSubscriptionId();
    const result = await userClient
      .rpc("svc_process_stripe_event", {
        _event_id: eventId,
        _type: "checkout.session.completed",
        _payload: buildTestPayload({
          event_id: eventId,
          type: "checkout.session.completed",
          customer_id: null,
          subscription_id: subscriptionId,
          price_id: TEST_PRICE_SOLO,
          workspace_id_hint: owner.workspaceId,
        }),
        _customer_id: null,
        _subscription_id: subscriptionId,
        _price_id: TEST_PRICE_SOLO,
        _workspace_id_hint: owner.workspaceId,
        _current_period_end: null,
      } as never);

    expect(result.error).not.toBeNull();
    // Either 42501 (insufficient_privilege) or PGRST202 (not exposed).
    // Both prove the perimeter is intact.
    const code = result.error?.code ?? "";
    expect(["42501", "PGRST202", "PGRST301"]).toContain(code);

    // Belt-and-braces: if somehow the call succeeded, the workspace MUST
    // still be on the default plan_tier — i.e. no actual mutation happened.
    const { data } = await admin
      .from("workspaces")
      .select("plan_tier")
      .eq("id", owner.workspaceId)
      .single();
    expect(data?.plan_tier).toBe("free");
  });

  test("anonymous client is rejected from calling public.process_stripe_event", async () => {
    const anon = createAnonClient();
    const eventId = freshEventId();

    const result = await anon.rpc("svc_process_stripe_event", {
      _event_id: eventId,
      _type: "checkout.session.completed",
      _payload: buildTestPayload({
        event_id: eventId,
        type: "checkout.session.completed",
        customer_id: null,
        subscription_id: null,
        price_id: TEST_PRICE_SOLO,
        workspace_id_hint: null,
      }),
      _customer_id: null,
      _subscription_id: null,
      _price_id: TEST_PRICE_SOLO,
      _workspace_id_hint: null,
      _current_period_end: null,
    } as never);

    expect(result.error).not.toBeNull();
    const code = result.error?.code ?? "";
    expect(["42501", "PGRST202", "PGRST301"]).toContain(code);
  });

  test("authenticated client cannot call grace-period RPCs either", async () => {
    const owner = await pool.create({ fullName: "Authed Grace Probe" });
    const userClient = createAuthenticatedClient(owner.accessToken);

    const findResult = await userClient
      .rpc("svc_find_workspaces_past_due_grace_expired");
    expect(findResult.error).not.toBeNull();

    const downgradeResult = await userClient
      .rpc("svc_downgrade_workspace_to_free", {
        _workspace_id: owner.workspaceId,
      } as never);
    expect(downgradeResult.error).not.toBeNull();
  });

  test("service_role client CAN call public.process_stripe_event (positive control)", async () => {
    // This passes implicitly in the other test files; explicit positive
    // control here keeps the perimeter test self-contained.
    const owner = await pool.create({ fullName: "Service Role Positive" });
    const eventId = freshEventId();
    const subscriptionId = freshSubscriptionId();

    const result = await admin
      .rpc("svc_process_stripe_event", {
        _event_id: eventId,
        _type: "checkout.session.completed",
        _payload: buildTestPayload({
          event_id: eventId,
          type: "checkout.session.completed",
          customer_id: null,
          subscription_id: subscriptionId,
          price_id: TEST_PRICE_SOLO,
          workspace_id_hint: owner.workspaceId,
        }),
        _customer_id: null,
        _subscription_id: subscriptionId,
        _price_id: TEST_PRICE_SOLO,
        _workspace_id_hint: owner.workspaceId,
        _current_period_end: null,
      } as never);

    expect(result.error).toBeNull();
    expect(result.data).toBe("processed");
  });
});
