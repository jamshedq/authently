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

// apps/web vitest setup. Validates the env vars route-handler tests need,
// covering both the Supabase fixture path (shared with packages/db) and the
// Stripe-product env vars the checkout/portal handlers read directly.

const REQUIRED = [
  // Shared with packages/db tests
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  // Stripe — reused from apps/web/.env.local. The Stripe SDK is mocked in
  // tests, so the secret-key value is never sent to Stripe; we only need
  // a non-empty string to satisfy the SDK constructor.
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_SOLO",
  "STRIPE_PRICE_STUDIO",
] as const;

// Several Next.js app modules read NEXT_PUBLIC_SUPABASE_URL; mirror it from
// SUPABASE_URL so the same env file works for both.
if (!process.env["NEXT_PUBLIC_SUPABASE_URL"] && process.env["SUPABASE_URL"]) {
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = process.env["SUPABASE_URL"];
}
if (
  !process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] &&
  process.env["SUPABASE_ANON_KEY"]
) {
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = process.env["SUPABASE_ANON_KEY"];
}
// Default the public site URL for the success/cancel callback URLs the
// checkout service builds. Tests don't actually navigate to it.
if (!process.env["NEXT_PUBLIC_SITE_URL"]) {
  process.env["NEXT_PUBLIC_SITE_URL"] = "http://localhost:3000";
}

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  const lines = [
    `Missing required env var(s): ${missing.join(", ")}`,
    "",
    "Local: ensure `supabase start` has run, then either:",
    "       - copy packages/db/.env.test.example to packages/db/.env.test and populate, OR",
    "       - run `supabase status -o env > packages/db/.env.test`",
    "       For Stripe vars, ensure apps/web/.env.local is populated per",
    "       docs/runbooks/stripe-products.md.",
    "",
    "CI:    these are populated by the test:web workflow job.",
  ];
  throw new Error(lines.join("\n"));
}
