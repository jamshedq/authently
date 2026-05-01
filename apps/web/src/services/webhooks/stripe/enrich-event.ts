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

import type Stripe from "stripe";
import { getStripeClient } from "./stripe-client";

/**
 * Stripe's `checkout.session.completed` webhook payload does not include
 * `line_items` by default; the API requires an explicit `expand` to populate
 * them. Without line_items, the price_id can't be extracted and
 * `process_stripe_event` returns 'unknown_price' for the initial subscription
 * event.
 *
 * This helper retrieves the session with line_items expanded for
 * `checkout.session.completed` events and returns an event whose
 * `data.object` is the enriched session. All other event types are returned
 * unchanged — only checkout sessions need this round-trip.
 *
 * Cost: one Stripe API call per checkout completion. Acceptable: Stripe
 * Checkout traffic is sparse (one event per paid signup) and the call is
 * idempotent server-side.
 */
export async function enrichEventForExtraction(
  event: Stripe.Event,
): Promise<Stripe.Event> {
  if (event.type !== "checkout.session.completed") {
    return event;
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const stripe = getStripeClient();
  const expanded = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items"],
  });

  // Stripe.Event.data.object is a discriminated union; cast via unknown
  // because we're substituting a same-shape session whose only difference
  // is that line_items is populated. Downstream code reads only the
  // structural fields the extractor declares.
  return {
    ...event,
    data: {
      ...event.data,
      object: expanded as unknown as typeof event.data.object,
    },
  };
}
