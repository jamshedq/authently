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
import {
  extractEventFields,
  isHandledType,
} from "./extract-event-fields";
import { ensurePriceTierMap } from "./price-tier-map";
import { getWebhookSupabaseClient } from "./service-role-client";

/**
 * Outcome strings returned by public.svc_process_stripe_event. Keep in sync
 * with the function header in 20260430200155_billing_event_processor.sql.
 */
export type ProcessOutcome =
  | "processed"
  | "deduplicated"
  | "unknown_event_type"
  | "unknown_price"
  | "workspace_not_found"
  | "subscription_mismatch";

const VALID_OUTCOMES: ReadonlySet<ProcessOutcome> = new Set([
  "processed",
  "deduplicated",
  "unknown_event_type",
  "unknown_price",
  "workspace_not_found",
  "subscription_mismatch",
]);

/**
 * Dispatch a verified Stripe.Event to public.svc_process_stripe_event.
 *
 * The route handler has already verified the signature, so the event is
 * trusted. This function:
 *   1. Ensures the price-tier map is seeded for this process (idempotent).
 *   2. Extracts the curated field set the RPC expects.
 *   3. Calls public.svc_process_stripe_event via service-role client.
 *   4. Returns the outcome string for the caller to log.
 *
 * Events outside the handled set are skipped here without touching the DB —
 * we don't want to flood stripe_events with `customer.created` or other
 * forwarded events. The route's `--events` filter on `stripe listen`
 * narrows the wire-level traffic; this is the second line of defence.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
): Promise<ProcessOutcome | "skipped_unhandled_type"> {
  if (!isHandledType(event.type)) {
    return "skipped_unhandled_type";
  }

  await ensurePriceTierMap();

  const extracted = extractEventFields(event);
  const sb = getWebhookSupabaseClient();

  // The supabase-js generated type treats all RPC args as non-null `string`,
  // even when the underlying Postgres function declares them nullable (a
  // known limitation of `supabase gen types`). Several of our args ARE
  // legitimately nullable for event types that don't carry a value
  // (e.g. invoice events have no `current_period_end`). Cast via `as never`
  // to bypass — same workaround used by tests/rls/last-owner-protection.test.ts.
  const { data, error } = await sb
    .rpc("svc_process_stripe_event", {
      _event_id: extracted.event_id,
      _type: extracted.type,
      _payload: extracted.payload,
      _customer_id: extracted.customer_id,
      _subscription_id: extracted.subscription_id,
      _price_id: extracted.price_id,
      _workspace_id_hint: extracted.workspace_id_hint,
      _current_period_end: extracted.current_period_end,
    } as never);

  if (error) {
    throw new Error(
      `public.svc_process_stripe_event failed: ${error.message} (event_id=${extracted.event_id})`,
    );
  }

  if (typeof data !== "string" || !VALID_OUTCOMES.has(data as ProcessOutcome)) {
    throw new Error(
      `public.svc_process_stripe_event returned unexpected outcome: ${JSON.stringify(data)} (event_id=${extracted.event_id})`,
    );
  }

  return data as ProcessOutcome;
}
