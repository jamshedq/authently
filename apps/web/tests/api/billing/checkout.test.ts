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
  setMockUserToken,
  clearMockUserToken,
  supabaseServerMockModule,
} from "../../helpers/server-client-mock";
import {
  TestUserPool,
  serviceRoleClient,
  setWorkspaceBillingFixture,
  type TestUser,
} from "../../helpers/test-workspace";

vi.mock("stripe", () => stripeMockModule);
vi.mock("@/lib/supabase/server", () => supabaseServerMockModule);

import { POST } from "@/app/api/ws/[workspaceSlug]/billing/checkout/route";

function buildRequest(slug: string, body: unknown): {
  request: Request;
  routeCtx: { params: Promise<{ workspaceSlug: string }> };
} {
  const request = new Request(
    `http://localhost:3000/api/ws/${slug}/billing/checkout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return {
    request,
    routeCtx: { params: Promise.resolve({ workspaceSlug: slug }) },
  };
}

describe("POST /api/ws/[slug]/billing/checkout", () => {
  const pool = new TestUserPool();
  let stripe: StripeMockState;

  beforeEach(() => {
    stripe = buildStripeMock();
    registerStripeMock(stripe);
    stripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_test_route_xyz",
      url: "https://checkout.stripe.com/pay/cs_test_route_xyz",
    });
  });

  afterEach(async () => {
    resetStripeMock();
    clearMockUserToken();
    await pool.cleanup();
  });

  test("401 when unauthenticated", async () => {
    setMockUserToken(null);
    const owner = await pool.create();

    const { request, routeCtx } = buildRequest(owner.workspaceSlug, { tier: "solo" });
    const res = await POST(request, routeCtx);

    expect(res.status).toBe(401);
  });

  test("403 when authenticated but not a member of the workspace", async () => {
    const owner = await pool.create();
    const stranger = await pool.create();
    setMockUserToken(stranger.accessToken);

    const { request, routeCtx } = buildRequest(owner.workspaceSlug, { tier: "solo" });
    const res = await POST(request, routeCtx);

    expect(res.status).toBe(403);
  });

  test("422 when body has an invalid tier", async () => {
    const owner = await pool.create();
    setMockUserToken(owner.accessToken);

    const { request, routeCtx } = buildRequest(owner.workspaceSlug, {
      tier: "enterprise",
    });
    const res = await POST(request, routeCtx);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("INVALID_TIER");
  });

  test("200 happy path: workspace has no customer → pre-creates and returns session URL", async () => {
    const owner = await pool.create();
    setMockUserToken(owner.accessToken);
    stripe.customers.create.mockResolvedValue({ id: "cus_route_precreated" });

    const { request, routeCtx } = buildRequest(owner.workspaceSlug, { tier: "solo" });
    const res = await POST(request, routeCtx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://checkout.stripe.com/pay/cs_test_route_xyz");
    expect(body.customerId).toBe("cus_route_precreated");
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
  });

  test("200 happy path: workspace has existing customer → reuses, no customers.create", async () => {
    const owner = await pool.create();
    setMockUserToken(owner.accessToken);
    await setWorkspaceBillingFixture(owner.workspaceId, {
      stripe_customer_id: "cus_route_existing",
    });

    const { request, routeCtx } = buildRequest(owner.workspaceSlug, { tier: "studio" });
    const res = await POST(request, routeCtx);

    expect(res.status).toBe(200);
    expect(stripe.customers.create).not.toHaveBeenCalled();
    const callArgs = stripe.checkout.sessions.create.mock.calls[0]![0];
    expect(callArgs.customer).toBe("cus_route_existing");
  });

  test("409 ALREADY_SUBSCRIBED with current planTier when workspace has an active subscription", async () => {
    const owner: TestUser = await pool.create();
    setMockUserToken(owner.accessToken);
    await setWorkspaceBillingFixture(owner.workspaceId, {
      plan_tier: "studio",
      subscription_status: "active",
      stripe_customer_id: "cus_already_sub",
      stripe_subscription_id: "sub_already_sub",
    });

    const { request, routeCtx } = buildRequest(owner.workspaceSlug, { tier: "solo" });
    const res = await POST(request, routeCtx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ALREADY_SUBSCRIBED");
    expect(body.planTier).toBe("studio");
    expect(body.portalAvailable).toBe(true);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test("409 ALREADY_SUBSCRIBED also fires for past_due subscriptions (route to portal)", async () => {
    const owner = await pool.create();
    setMockUserToken(owner.accessToken);
    await setWorkspaceBillingFixture(owner.workspaceId, {
      plan_tier: "solo",
      subscription_status: "past_due",
      stripe_customer_id: "cus_past_due",
      stripe_subscription_id: "sub_past_due",
      past_due_since: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });

    const { request, routeCtx } = buildRequest(owner.workspaceSlug, { tier: "solo" });
    const res = await POST(request, routeCtx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.planTier).toBe("solo");
    expect(body.portalAvailable).toBe(true);
  });

  test("non-owner (admin) member is rejected with 403", async () => {
    const owner = await pool.create();
    const adminUser = await pool.create();
    setMockUserToken(adminUser.accessToken);

    const admin = serviceRoleClient();
    await admin.from("workspace_members").insert({
      workspace_id: owner.workspaceId,
      user_id: adminUser.userId,
      role: "admin",
    });

    const { request, routeCtx } = buildRequest(owner.workspaceSlug, { tier: "solo" });
    const res = await POST(request, routeCtx);
    expect(res.status).toBe(403);
  });
});
