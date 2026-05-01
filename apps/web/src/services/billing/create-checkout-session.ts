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

import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getStripeClient } from "@/services/webhooks/stripe/stripe-client";
import { getWebhookSupabaseClient } from "@/services/webhooks/stripe/service-role-client";

export type Tier = "solo" | "studio";

export type CreateCheckoutSessionArgs = {
  workspace: { id: string; slug: string };
  tier: Tier;
  /** Existing stripe_customer_id on the workspace, if any. */
  existingCustomerId: string | null;
  /** auth.users.id of the owner initiating checkout. Stored in metadata for support debugging. */
  userId: string;
};

export type CreateCheckoutSessionResult = {
  url: string;
  customerId: string;
};

/**
 * Build the Stripe Checkout session for a workspace upgrade.
 *
 * Customer-creation strategy: pre-create the Stripe customer with
 * workspace_id metadata if the workspace doesn't already have one. This
 * makes the customer record self-describing in the Stripe Dashboard
 * without requiring a cross-reference to a session/subscription that
 * carries the workspace_id metadata. We persist the new customer ID via
 * public.svc_set_workspace_stripe_customer (see migration
 * 20260430234723_set_workspace_stripe_customer) so a retry of the same
 * checkout doesn't double-create.
 *
 * Metadata contract with the webhook handler:
 *   session.metadata.workspace_id  → process_stripe_event reads this on
 *                                    checkout.session.completed via
 *                                    extract-event-fields.readWorkspaceIdHint.
 *                                    THE LOAD-BEARING LINK between checkout
 *                                    and workspace mutation; do not remove.
 *   session.metadata.plan_tier     → forensic only; the tier is also
 *                                    derivable from the price_id via
 *                                    stripe_price_tier_map.
 *   session.metadata.owner_user_id → forensic only; useful for support.
 *   subscription_data.metadata.workspace_id → mirrored onto the resulting
 *                                    Subscription object so future
 *                                    customer.subscription.* events can
 *                                    self-resolve a workspace_id without
 *                                    needing a session lookup.
 */
export async function createCheckoutSession(
  args: CreateCheckoutSessionArgs,
): Promise<CreateCheckoutSessionResult> {
  const stripe = getStripeClient();

  const priceId = priceIdForTier(args.tier);
  const siteUrl = readSiteUrl();

  let customerId = args.existingCustomerId;
  if (!customerId) {
    // Pre-create the Stripe customer with workspace metadata. Persist the
    // ID before opening the Checkout session so a retry (network blip,
    // double-click, etc.) reuses the same customer.
    const customer = await stripe.customers.create({
      metadata: { workspace_id: args.workspace.id },
    });
    customerId = customer.id;

    const sb = getWebhookSupabaseClient();
    const { error } = await typedRpc(sb, "svc_set_workspace_stripe_customer", {
      _workspace_id: args.workspace.id,
      _stripe_customer_id: customerId,
    });
    if (error) {
      throw new Error(
        `svc_set_workspace_stripe_customer failed for workspace ${args.workspace.id}: ${error.message}`,
      );
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      workspace_id: args.workspace.id,
      plan_tier: args.tier,
      owner_user_id: args.userId,
    },
    subscription_data: {
      metadata: { workspace_id: args.workspace.id },
    },
    success_url: `${siteUrl}/app/${args.workspace.slug}/settings?checkout=success`,
    cancel_url: `${siteUrl}/app/${args.workspace.slug}/settings?checkout=canceled`,
    automatic_tax: { enabled: false },
  });

  if (!session.url) {
    throw new Error(
      `stripe.checkout.sessions.create returned no URL (session ${session.id})`,
    );
  }

  return { url: session.url, customerId };
}

function priceIdForTier(tier: Tier): string {
  const key = tier === "solo" ? "STRIPE_PRICE_SOLO" : "STRIPE_PRICE_STUDIO";
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} is not set. The checkout route cannot build a Stripe Checkout session without it. See docs/runbooks/stripe-products.md.`,
    );
  }
  return value;
}

function readSiteUrl(): string {
  return (
    process.env["NEXT_PUBLIC_SITE_URL"] ?? "http://localhost:3000"
  ).replace(/\/+$/, "");
}
