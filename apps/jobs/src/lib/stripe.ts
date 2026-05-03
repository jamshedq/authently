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
 * Memoized Stripe SDK instance for apps/jobs. Mirrors the pattern in
 * apps/web/src/services/webhooks/stripe/stripe-client.ts.
 *
 * Used by Sprint 05 A2's Stripe subscription cancellation service inside
 * the hard-delete sweeper. Could be reused by future outbound Stripe
 * calls from Trigger.dev tasks; for now the cancel service is the sole
 * caller.
 *
 * `STRIPE_SECRET_KEY` is required. apps/jobs doesn't run a zod env
 * schema (yet) — env validation is inline at access time, mirroring
 * `getJobsSupabaseClient` in `./supabase.ts`. If apps/jobs accumulates
 * more env vars in future sprints, hoisting to a shared zod schema
 * becomes the right move.
 */
export function getJobsStripeClient(): Stripe {
  if (cached) return cached;

  const apiKey = process.env["STRIPE_SECRET_KEY"];
  if (!apiKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. apps/jobs Stripe API calls require " +
        "it. Local: add to apps/jobs/.env. Deployed: set as a project env " +
        "var in the Trigger.dev dashboard.",
    );
  }

  cached = new Stripe(apiKey, {
    typescript: true,
  });
  return cached;
}
