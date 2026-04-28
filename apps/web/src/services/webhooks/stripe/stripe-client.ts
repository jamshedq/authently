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

import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * Memoized Stripe SDK instance. Used by the webhook route for signature
 * verification (`stripe.webhooks.constructEvent`) and reserved for future
 * outbound API calls in S12+ (checkout, customer portal).
 *
 * The constructor requires an API key, but signature verification itself
 * does NOT use it — verification HMACs the request body against
 * STRIPE_WEBHOOK_SECRET. We still require STRIPE_SECRET_KEY here so the
 * misconfiguration surfaces early rather than at first outbound call.
 */
export function getStripeClient(): Stripe {
  if (cached) return cached;

  const apiKey = process.env["STRIPE_SECRET_KEY"];
  if (!apiKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Stripe API calls and webhook " +
        "signature verification both require it. See apps/web/.env.local.example.",
    );
  }

  cached = new Stripe(apiKey, {
    // Pin once we start making outbound calls in S12+. The SDK default is
    // fine for signature verification (which doesn't hit the API).
    typescript: true,
  });
  return cached;
}
