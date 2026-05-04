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

import { z } from "zod";

// Environment validated at first access on the server. Optional fields are
// genuinely optional at S01 — observability SDKs no-op without them, and the
// service-role key is only required by code paths that opt in (none in S01).
const ServerEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Public origin used to construct absolute callback URLs (password-reset
  // emails, future invitation links, OAuth callbacks). Required, with a
  // dev-friendly default so local pnpm dev "just works"; production sets
  // this explicitly via the platform's env config.
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  SENTRY_ORG: z.string().min(1).optional(),
  SENTRY_PROJECT: z.string().min(1).optional(),
  AXIOM_TOKEN: z.string().min(1).optional(),
  AXIOM_DATASET: z.string().min(1).optional(),
  // Stripe — both the webhook route and any outbound call refuse to start
  // without these. Schema marks them optional because the webhook route
  // surfaces a clear error when invoked without them set, and code paths
  // that don't touch Stripe (most of the app) shouldn't fail to boot just
  // because billing isn't configured locally.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Recurring price IDs for the Solo / Studio tiers. Webhook handler maps
  // these to plan_tier values via stripe_price_tier_map (seeded lazily on
  // first webhook invocation per process). See
  // services/webhooks/stripe/price-tier-map.ts and
  // docs/runbooks/stripe-products.md for the dev setup flow.
  STRIPE_PRICE_SOLO: z.string().min(1).optional(),
  STRIPE_PRICE_STUDIO: z.string().min(1).optional(),
  // OpenAI — required by the transcription service (Sprint 06 B1).
  // Optional in the schema for the same reason as STRIPE_SECRET_KEY:
  // code paths that don't touch transcription shouldn't fail to boot
  // because OpenAI isn't configured locally. The transcription service
  // throws a clear error when invoked without it set.
  OPENAI_API_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Invalid environment configuration:\n  ${issues}\n\nSee apps/web/.env.local.example for the required variables.`,
    );
  }
  cached = parsed.data;
  return cached;
}

// Browser-safe subset. NEXT_PUBLIC_* values are inlined by Next at build time;
// referencing them on the client is safe.
export type BrowserEnv = Pick<
  ServerEnv,
  "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY" | "NEXT_PUBLIC_SENTRY_DSN"
>;
