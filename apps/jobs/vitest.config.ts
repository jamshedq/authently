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

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// apps/jobs vitest harness — spun up in Sprint 05 A2 C1 to support the
// Stripe cancellation service rewrite landing in C2. Carryover entry
// "apps/jobs test infrastructure setup" in SPRINT_05_carryovers.md is
// the planning record; A2's Stripe SDK integration is the named revisit
// trigger that fired this setup.
//
// Scope today: TypeScript service modules and Trigger.dev task wrappers
// that don't require a live Supabase connection. Stripe SDK calls are
// mocked at the module boundary (see tests/helpers/stripe-mock.ts).
//
// If a future test needs a live DB, mirror packages/db/vitest.config.ts:
// add a setupFiles entry that loads packages/db/.env.test, declare the
// SUPABASE_* env vars as required, and document the dependency in the
// test header. Don't reach for live DB casually — db-layer tests
// (packages/db/tests/) cover the RPC contract surface.

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(here, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: ["default"],
  },
});
