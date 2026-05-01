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
 * The shape of fields the route handler extracts from a verified Stripe.Event
 * before calling public.process_stripe_event. Pure data — no Stripe SDK
 * types leak past this boundary, which keeps the RPC parameter contract and
 * the SQL function in lockstep.
 *
 * `payload` is a CURATED ALLOWLIST stored in stripe_events.payload for
 * forensics. The allowlist is enforced in this file (see buildPayload below).
 *
 * ABSOLUTE EXCLUSION (no PII): customer email and any other personally-
 * identifiable field never go into stripe_events.payload. Stripe's
 * session.customer_details and customer.email are present on these events;
 * we deliberately drop them. If a future audit needs an email, look it up
 * in Stripe Dashboard via the customer_id stored in workspaces — don't
 * mirror it into our database.
 */
export type ExtractedEvent = {
  event_id: string;
  type: string;
  payload: Record<string, unknown>;
  customer_id: string | null;
  subscription_id: string | null;
  price_id: string | null;
  workspace_id_hint: string | null;
  current_period_end: string | null; // ISO timestamp; null when event has none
};

/**
 * The five event types Sprint 02 D Commit 1 handles. The route handler
 * filters Stripe events to these before extraction; unknown types
 * still flow through to public.process_stripe_event which records
 * 'unknown_event_type' for forensics.
 */
const HANDLED_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
] as const);

export type HandledStripeEventType = typeof HANDLED_TYPES extends Set<infer T>
  ? T
  : never;

export function isHandledType(type: string): boolean {
  return HANDLED_TYPES.has(type as HandledStripeEventType);
}

export function extractEventFields(event: Stripe.Event): ExtractedEvent {
  // Stripe's Event.data.object is a wide union (every API resource);
  // cast via unknown for a structural-shape probe of just the fields we
  // need. Field readers below all defensively check types, so a
  // mis-typed cast does not propagate runtime errors.
  const obj = event.data.object as unknown as Record<string, unknown>;

  const customer_id = readString(obj["customer"]);
  const subscription_id = readSubscriptionId(event.type, obj);
  const price_id = readPriceId(event.type, obj);
  const workspace_id_hint = readWorkspaceIdHint(event.type, obj);
  const current_period_end = readPeriodEnd(event.type, obj);

  return {
    event_id: event.id,
    type: event.type,
    payload: buildPayload({
      event,
      customer_id,
      subscription_id,
      price_id,
      workspace_id_hint,
    }),
    customer_id,
    subscription_id,
    price_id,
    workspace_id_hint,
    current_period_end,
  };
}

// ---------------------------------------------------------------------------
// Field readers (pure; defensive against Stripe payload shape variation)
// ---------------------------------------------------------------------------

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readSubscriptionId(
  type: string,
  obj: Record<string, unknown>,
): string | null {
  if (
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted"
  ) {
    // event.data.object IS the subscription
    return readString(obj["id"]);
  }
  if (type === "checkout.session.completed") {
    return readString(obj["subscription"]);
  }
  if (type === "invoice.payment_failed" || type === "invoice.payment_succeeded") {
    return readString(obj["subscription"]);
  }
  return null;
}

function readPriceId(
  type: string,
  obj: Record<string, unknown>,
): string | null {
  // Subscription events: items.data[0].price.id
  if (
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted"
  ) {
    const items = (obj["items"] as { data?: Array<{ price?: { id?: string } }> } | undefined)
      ?.data;
    return readString(items?.[0]?.price?.id);
  }
  // Checkout session: line_items.data[0].price.id. The handler routes the
  // event through enrichEventForExtraction first, which calls
  // stripe.checkout.sessions.retrieve with expand: ['line_items'] so the
  // price is reliably present here. (See ../enrich-event.ts.)
  if (type === "checkout.session.completed") {
    const lineItems = (
      obj["line_items"] as
        | { data?: Array<{ price?: { id?: string } }> }
        | undefined
    )?.data;
    return readString(lineItems?.[0]?.price?.id);
  }
  // Invoice events: lines.data[0].price.id (legacy) or lines.data[0].pricing.price_details.price
  if (type === "invoice.payment_failed" || type === "invoice.payment_succeeded") {
    const lines = (
      obj["lines"] as
        | {
            data?: Array<{
              price?: { id?: string };
              pricing?: { price_details?: { price?: string } };
            }>;
          }
        | undefined
    )?.data;
    const first = lines?.[0];
    return readString(first?.price?.id ?? first?.pricing?.price_details?.price);
  }
  return null;
}

function readWorkspaceIdHint(
  type: string,
  obj: Record<string, unknown>,
): string | null {
  if (type !== "checkout.session.completed") return null;
  const metadata = obj["metadata"] as Record<string, unknown> | undefined;
  const value = metadata?.["workspace_id"];
  if (typeof value !== "string") return null;
  // Reject obviously-malformed hints. The RPC will validate against
  // workspaces.id when it tries to mutate; this is a cheap pre-filter.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_RE.test(value) ? value : null;
}

function readPeriodEnd(
  type: string,
  obj: Record<string, unknown>,
): string | null {
  // Subscription events have current_period_end at the top level
  if (
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted"
  ) {
    const ts = obj["current_period_end"];
    if (typeof ts === "number") return new Date(ts * 1000).toISOString();
  }
  // checkout.session.completed: pull period_end from items if present;
  // otherwise leave null and rely on the subsequent
  // customer.subscription.updated event Stripe sends right after.
  return null;
}

/**
 * Build the curated allowlist payload for stripe_events.payload.
 *
 * INVARIANT: NO PII. The fields below are intentionally scoped:
 *   - event_id, type, livemode  → identification
 *   - customer_id, subscription_id, price_id  → opaque Stripe identifiers
 *   - workspace_id_hint  → our own workspace id; not PII
 *
 * Explicitly NOT included (review before adding):
 *   - customer email (session.customer_details.email, customer.email)
 *   - billing address, shipping address
 *   - cardholder name, last4, full payment method details
 *   - any free-text fields (descriptions, statement descriptors)
 *
 * If a future event type carries a field that might be PII, default to
 * excluding it and add an item to docs/runbooks/stripe-products.md before
 * widening this allowlist.
 */
function buildPayload(args: {
  event: Stripe.Event;
  customer_id: string | null;
  subscription_id: string | null;
  price_id: string | null;
  workspace_id_hint: string | null;
}): Record<string, unknown> {
  return {
    event_id: args.event.id,
    type: args.event.type,
    livemode: args.event.livemode,
    customer_id: args.customer_id,
    subscription_id: args.subscription_id,
    price_id: args.price_id,
    workspace_id_hint: args.workspace_id_hint,
  };
}
