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
  setWorkspaceBillingFixture,
} from "../../helpers/test-workspace";

vi.mock("stripe", () => stripeMockModule);
vi.mock("@/lib/supabase/server", () => supabaseServerMockModule);

import { POST } from "@/app/api/ws/[workspaceSlug]/billing/portal/route";

function buildRequest(slug: string): {
  request: Request;
  routeCtx: { params: Promise<{ workspaceSlug: string }> };
} {
  const request = new Request(
    `http://localhost:3000/api/ws/${slug}/billing/portal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  return {
    request,
    routeCtx: { params: Promise.resolve({ workspaceSlug: slug }) },
  };
}

describe("POST /api/ws/[slug]/billing/portal", () => {
  const pool = new TestUserPool();
  let stripe: StripeMockState;

  beforeEach(() => {
    stripe = buildStripeMock();
    registerStripeMock(stripe);
    stripe.billingPortal.sessions.create.mockResolvedValue({
      id: "bps_test_route_xyz",
      url: "https://billing.stripe.com/p/session/bps_test_route_xyz",
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
    await setWorkspaceBillingFixture(owner.workspaceId, {
      stripe_customer_id: "cus_unauth_test",
    });

    const { request, routeCtx } = buildRequest(owner.workspaceSlug);
    const res = await POST(request, routeCtx);
    expect(res.status).toBe(401);
  });

  test("403 when not a member", async () => {
    const owner = await pool.create();
    await setWorkspaceBillingFixture(owner.workspaceId, {
      stripe_customer_id: "cus_member_test",
    });
    const stranger = await pool.create();
    setMockUserToken(stranger.accessToken);

    const { request, routeCtx } = buildRequest(owner.workspaceSlug);
    const res = await POST(request, routeCtx);
    expect(res.status).toBe(403);
  });

  test("400 NOT_SUBSCRIBED when workspace has no stripe_customer_id", async () => {
    const owner = await pool.create();
    setMockUserToken(owner.accessToken);

    const { request, routeCtx } = buildRequest(owner.workspaceSlug);
    const res = await POST(request, routeCtx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("NOT_SUBSCRIBED");
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("200 happy path: returns portal URL", async () => {
    const owner = await pool.create();
    setMockUserToken(owner.accessToken);
    await setWorkspaceBillingFixture(owner.workspaceId, {
      stripe_customer_id: "cus_happy_path_001",
      stripe_subscription_id: "sub_happy_path_001",
      plan_tier: "solo",
      subscription_status: "active",
    });

    const { request, routeCtx } = buildRequest(owner.workspaceSlug);
    const res = await POST(request, routeCtx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://billing.stripe.com/p/session/bps_test_route_xyz");
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_happy_path_001",
      return_url: expect.stringContaining(`/app/${owner.workspaceSlug}/settings`),
    });
  });
});
