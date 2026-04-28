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

import * as Sentry from "@sentry/nextjs";
import { Logger } from "next-axiom";
import { headers } from "next/headers";
import type Stripe from "stripe";
import { handleStripeEvent } from "@/services/webhooks/stripe/handle-event";
import { recordSeenEvent } from "@/services/webhooks/stripe/seen-events";
import { getStripeClient } from "@/services/webhooks/stripe/stripe-client";

// Stripe needs the unparsed request body for HMAC signature verification.
// Run on the Node.js runtime so `request.text()` returns the raw bytes
// faithfully (Edge runtime decoding can normalize line endings, which
// breaks the signature).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe
 *
 * Order of operations is security-critical:
 *
 *   1. Validate config (STRIPE_WEBHOOK_SECRET present) — fail closed.
 *   2. Read the stripe-signature header — fail closed if missing.
 *   3. Read the raw body. Never JSON.parse before verification — an
 *      attacker-controlled payload should not flow through any parser
 *      that could throw or coerce.
 *   4. Verify the signature with the Stripe SDK. Failure → 400, no
 *      logging of body contents (could be attacker payload), only the
 *      bare fact that verification failed.
 *   5. Only after verification: log event type + id, dispatch to the
 *      domain handler.
 *
 * Idempotency: see services/webhooks/stripe/seen-events.ts. In-process
 * only for Sprint 01; persistent dedup ships with the billing flow.
 *
 * Rate limiting: deferred. Stripe traffic is low-volume and bursty; we'll
 * revisit when real subscription logic ships (Phase 2).
 */
export async function POST(request: Request): Promise<Response> {
  const log = new Logger({ source: "webhook.stripe" });

  try {
    const secret = process.env["STRIPE_WEBHOOK_SECRET"];
    if (!secret) {
      log.error("STRIPE_WEBHOOK_SECRET unset; rejecting webhook");
      return new Response("Misconfigured", { status: 500 });
    }

    const signature = (await headers()).get("stripe-signature");
    if (!signature) {
      log.warn("missing stripe-signature header");
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    const rawBody = await request.text();
    const stripe = getStripeClient();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      // Don't echo the raw body or the signature. Log only the failure
      // shape — repeated 400s here likely indicate scanning or a
      // misconfigured stripe CLI.
      Sentry.captureMessage("stripe webhook signature verification failed", {
        level: "warning",
      });
      log.warn("invalid signature", {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response("Invalid signature", { status: 400 });
    }

    // Verified from here. event is trusted.

    if (recordSeenEvent(event.id)) {
      log.warn("duplicate stripe event id (in-memory dedup)", {
        eventId: event.id,
        type: event.type,
      });
      return Response.json({ received: true, deduped: true });
    }

    Sentry.addBreadcrumb({
      category: "webhook.stripe",
      message: `received ${event.type}`,
      data: { eventId: event.id, type: event.type },
      level: "info",
    });
    log.info("stripe event received", {
      eventId: event.id,
      type: event.type,
    });

    try {
      await handleStripeEvent(event);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { source: "webhook.stripe", eventType: event.type },
      });
      log.error("stripe event handler failed", {
        eventId: event.id,
        type: event.type,
        error: err instanceof Error ? err.message : String(err),
      });
      // Returning 5xx tells Stripe to retry. The in-memory dedup will
      // catch the retry only if it lands on the same instance.
      return Response.json(
        { received: true, handled: false },
        { status: 500 },
      );
    }

    return Response.json({ received: true });
  } finally {
    await log.flush();
  }
}
