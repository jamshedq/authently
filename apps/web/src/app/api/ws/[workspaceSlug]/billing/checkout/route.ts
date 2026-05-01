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

// POST /api/ws/[workspaceSlug]/billing/checkout
//
// Owner-only. Accepts { tier: 'solo' | 'studio' } and returns a Stripe
// Checkout session URL the client can redirect to. Pre-creates a Stripe
// customer with workspace_id metadata if the workspace doesn't already
// have one (see services/billing/create-checkout-session.ts).
//
// Returns:
//   200 { url, customerId } — happy path; client redirects to url
//   409 { error: "ALREADY_SUBSCRIBED", planTier, portalAvailable }
//        — workspace already has an active or past_due subscription;
//          client should route to the Customer Portal instead
//   422 { error: "INVALID_TIER" } — body validation failed
//   401 / 403 — surfaced by withMembership / errorResponse

import { z } from "zod";
import { withMembership } from "@/lib/api/with-membership";
import { errorResponse } from "@/lib/api/error-response";
import { createCheckoutSession } from "@/services/billing/create-checkout-session";
import { getBillingState } from "@/services/billing/get-billing-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CheckoutBodySchema = z.object({
  tier: z.enum(["solo", "studio"]),
});

export const POST = withMembership(
  async (ctx) => {
    let parsed: z.infer<typeof CheckoutBodySchema>;
    try {
      const json = await ctx.request.json();
      parsed = CheckoutBodySchema.parse(json);
    } catch {
      return Response.json(
        { error: "INVALID_TIER", message: "Body must be { tier: 'solo' | 'studio' }." },
        { status: 422 },
      );
    }

    let billing;
    try {
      billing = await getBillingState(ctx.supabase, ctx.workspace.id);
    } catch (err) {
      return errorResponse(err);
    }
    if (!billing) {
      // The workspace was visible to withMembership but disappeared from
      // the billing read. Treat as 403 — same anti-enumeration collapse
      // as withMembership uses for missing workspaces.
      return Response.json(
        { error: "FORBIDDEN", message: "Workspace not accessible." },
        { status: 403 },
      );
    }

    // Block re-checkout on a workspace that already has a subscription
    // (active or past_due). Stripe Customer Portal is the canonical
    // tier-change flow; allowing checkout here would create duplicate
    // subscriptions on a single workspace.
    if (
      billing.stripe_subscription_id &&
      billing.subscription_status !== "canceled"
    ) {
      return Response.json(
        {
          error: "ALREADY_SUBSCRIBED",
          message:
            "This workspace already has a subscription. Use the Customer Portal to change plans.",
          planTier: billing.plan_tier,
          portalAvailable: Boolean(billing.stripe_customer_id),
        },
        { status: 409 },
      );
    }

    try {
      const result = await createCheckoutSession({
        workspace: { id: ctx.workspace.id, slug: ctx.workspace.slug },
        tier: parsed.tier,
        existingCustomerId: billing.stripe_customer_id,
        userId: ctx.user.id,
      });
      return Response.json({ url: result.url, customerId: result.customerId });
    } catch (err) {
      return errorResponse(err);
    }
  },
  { requireRole: ["owner"] },
);
