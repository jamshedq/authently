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

vi.mock("stripe", () => stripeMockModule);

import { createPortalSession } from "@/services/billing/create-portal-session";

describe("createPortalSession", () => {
  let stripe: StripeMockState;

  beforeEach(() => {
    stripe = buildStripeMock();
    registerStripeMock(stripe);
  });

  afterEach(() => {
    resetStripeMock();
  });

  test("happy path: returns the portal URL", async () => {
    stripe.billingPortal.sessions.create.mockResolvedValue({
      id: "bps_test_portal_xyz",
      url: "https://billing.stripe.com/p/session/bps_test_portal_xyz",
    });

    const result = await createPortalSession({
      customerId: "cus_test_001",
      workspaceSlug: "my-workspace-abc12345",
    });

    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_test_001",
      return_url: expect.stringContaining("/app/my-workspace-abc12345/settings"),
    });
    expect(result.url).toBe("https://billing.stripe.com/p/session/bps_test_portal_xyz");
  });

  test("throws when Stripe returns a session without a URL", async () => {
    stripe.billingPortal.sessions.create.mockResolvedValue({
      id: "bps_test_no_url",
      url: null,
    });

    await expect(
      createPortalSession({
        customerId: "cus_test_002",
        workspaceSlug: "ws-no-url",
      }),
    ).rejects.toThrow("returned no URL");
  });
});
