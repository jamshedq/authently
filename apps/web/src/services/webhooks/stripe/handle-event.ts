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

/**
 * Handle a Stripe webhook event. The route handler has already verified
 * the signature, so the event object is trusted; this function dispatches
 * on `event.type` to the appropriate domain handler.
 *
 * Sprint 01 ships this as an explicit no-op skeleton. Future sprints (S12+)
 * fill in the switch:
 *
 *   - checkout.session.completed         → mark workspace plan_tier
 *   - customer.subscription.created      → activate plan, link customer id
 *   - customer.subscription.updated      → reflect plan/status changes
 *   - customer.subscription.deleted      → downgrade workspace
 *   - invoice.paid                       → reset usage counters
 *   - invoice.payment_failed             → flag billing problem
 *
 * Throws are caught by the route handler and surface as a 500, which
 * causes Stripe to retry. Idempotency is the caller's responsibility (see
 * seen-events.ts for the in-process tracker; the persistent dedup table
 * arrives with billing logic).
 */
export async function handleStripeEvent(_event: Stripe.Event): Promise<void> {
  // Intentionally empty in S01 — the route logs the event type and id
  // before calling this. Future code goes in a switch on `_event.type`.
  return;
}
