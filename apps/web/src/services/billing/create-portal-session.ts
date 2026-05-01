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

import { getStripeClient } from "@/services/webhooks/stripe/stripe-client";

export type CreatePortalSessionArgs = {
  customerId: string;
  workspaceSlug: string;
};

export type CreatePortalSessionResult = {
  url: string;
};

/**
 * Build a Stripe Customer Portal session that returns the user to the
 * workspace settings page when they're done. The portal handles plan
 * changes (upgrade/downgrade), payment-method updates, and cancellations
 * — all of which fire webhooks the Commit 1 handler processes.
 *
 * Authorization: the route handler enforces owner-only access via
 * withMembership; this service does no role check of its own. It assumes
 * the caller has already verified that the customerId belongs to a
 * workspace the requester owns.
 */
export async function createPortalSession(
  args: CreatePortalSessionArgs,
): Promise<CreatePortalSessionResult> {
  const stripe = getStripeClient();
  const siteUrl = readSiteUrl();

  const session = await stripe.billingPortal.sessions.create({
    customer: args.customerId,
    return_url: `${siteUrl}/app/${args.workspaceSlug}/settings`,
  });

  if (!session.url) {
    throw new Error(
      `stripe.billingPortal.sessions.create returned no URL (session ${session.id})`,
    );
  }

  return { url: session.url };
}

function readSiteUrl(): string {
  return (
    process.env["NEXT_PUBLIC_SITE_URL"] ?? "http://localhost:3000"
  ).replace(/\/+$/, "");
}
