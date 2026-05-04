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
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

// apps/web tests share the local Supabase env with packages/db tests:
// run `supabase start` once, then `supabase status -o env > packages/db/.env.test`.
// We point dotenv at that same file rather than maintaining a duplicate.
loadDotenv({ path: resolve(here, "..", "..", "packages", "db", ".env.test") });
// Also load apps/web/.env.local for STRIPE_PRICE_SOLO/STUDIO and the
// webhook secret. Tests that exercise route handlers need these because
// the handlers read them directly from process.env.
loadDotenv({ path: resolve(here, ".env.local") });

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(here, "src"),
    },
  },
  // Modern JSX transform — no React import required in .tsx files. Next
  // uses jsx: "preserve" in tsconfig because next/swc handles the
  // transform during build; vitest goes through esbuild and needs this
  // to auto-import the JSX runtime. Sprint 06 B5 C1 spin-up.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    setupFiles: ["./tests/setup.ts"],
    // happy-dom for component tests (Sprint 06 B5 C1 spin-up). Service /
    // route / lib tests run fine here too — happy-dom is a no-op for code
    // that doesn't touch DOM globals.
    environment: "happy-dom",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Tests create real users in Supabase Auth and clean up after themselves;
    // sequential file execution mirrors packages/db/vitest.config.ts so the
    // two test gates can share env state without contention.
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ["default"],
  },
});
