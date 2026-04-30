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

import { getWebhookSupabaseClient } from "./service-role-client";

/**
 * The webhook handler maps Stripe price IDs to our plan_tier values via
 * public.stripe_price_tier_map (see migration 20260430195852). The mapping
 * is auditable in the DB and modifiable without redeploy, but the source
 * of truth for which Stripe price ID corresponds to which tier is the env:
 *
 *   STRIPE_PRICE_SOLO    → plan_tier = 'solo'
 *   STRIPE_PRICE_STUDIO  → plan_tier = 'studio'
 *
 * On webhook handler cold-start, we upsert these into the table once via
 * public.svc_upsert_stripe_price_tier_map, then memoize a "done" flag to skip
 * the work on subsequent invocations within the same Vercel function
 * instance. If the env vars are unset, ensurePriceTierMap throws — the
 * webhook would otherwise process events but record 'unknown_price' for
 * everything, which is silent failure.
 *
 * For tests, the table is seeded directly via service-role and the
 * memoization flag is reset by the test harness if needed.
 */

let ensured = false;

export function _resetEnsuredForTests(): void {
  ensured = false;
}

export async function ensurePriceTierMap(): Promise<void> {
  if (ensured) return;

  const solo = process.env["STRIPE_PRICE_SOLO"];
  const studio = process.env["STRIPE_PRICE_STUDIO"];

  if (!solo || !studio) {
    throw new Error(
      "STRIPE_PRICE_SOLO and STRIPE_PRICE_STUDIO must both be set for the " +
        "Stripe webhook handler to map subscription events to plan_tier. " +
        "See docs/runbooks/stripe-products.md for the dev setup flow.",
    );
  }

  const sb = getWebhookSupabaseClient();
  const { error } = await sb.rpc("svc_upsert_stripe_price_tier_map", {
    _entries: [
      { stripe_price_id: solo, plan_tier: "solo" },
      { stripe_price_id: studio, plan_tier: "studio" },
    ],
  });

  if (error) {
    throw new Error(
      `public.svc_upsert_stripe_price_tier_map failed: ${error.message}`,
    );
  }

  ensured = true;
}
