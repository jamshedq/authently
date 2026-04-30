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

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@authently/db/types";

/**
 * Service-role Supabase client for the Stripe webhook handler.
 *
 * SECURITY BOUNDARY (per CLAUDE.md rule 6):
 *   "Service-role DB access is allowed only inside Trigger.dev tasks that
 *    explicitly assert workspace context."
 *
 * The webhook handler is the SECOND blessed service-role usage in apps/web
 * (the first being the auth post-signup reconcile). It is justified because:
 *
 *   1. Stripe webhooks have no authenticated user — they originate from
 *      Stripe's infrastructure and are authenticated by HMAC, not JWT.
 *   2. The mutations are scoped exclusively through SECURITY DEFINER RPCs
 *      (public.process_stripe_event, public.upsert_stripe_price_tier_map)
 *      which the webhook caller cannot subvert. The functions themselves
 *      enforce all business invariants (workspace lookup, plan-tier mapping).
 *   3. The functions are granted to service_role only — `anon` and
 *      `authenticated` cannot reach them via PostgREST. (See
 *      tests/billing/process-stripe-event-rls.test.ts for the perimeter test.)
 *
 * If a future sprint introduces another service-role usage in apps/web,
 * justify it the same way: name the boundary, name the SECURITY DEFINER
 * function that enforces invariants, and add a perimeter test.
 *
 * Module-level memoization: a single client per process. Stripe webhook
 * traffic is low-volume but bursty; one client lasts the whole instance.
 */

type WebhookSupabaseClient = SupabaseClient<Database>;

let cached: WebhookSupabaseClient | null = null;

export function getWebhookSupabaseClient(): WebhookSupabaseClient {
  if (cached) return cached;

  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. The Stripe webhook handler " +
        "requires it to issue service-role calls to the database. See " +
        "apps/web/.env.local.example.",
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. The Stripe webhook handler " +
        "requires it (this is the canonical service-role boundary; see file " +
        "header). For local dev, copy from `supabase status -o env`. See " +
        "apps/web/.env.local.example.",
    );
  }

  cached = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Default schema 'public'. The handle-event module calls public.svc_*
  // wrappers (which delegate to private workers; see migration
  // 20260430231812_billing_rpc_pattern_refactor for the pattern).
  return cached;
}
