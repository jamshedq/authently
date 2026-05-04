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
loadDotenv({ path: resolve(here, ".env.test") });

// Sprint 03 A5 — vitest projects feature (3.x). The three test suites
// (rls, auth, billing) are independent at the DB level: each test creates
// its own users + workspaces via TestUserPool, the seedPriceTierMap helper
// is idempotent (UPSERT), and freshEmail() guarantees per-user uniqueness
// via timestamp + random bytes. Cross-suite contention is effectively nil.
//
// Sprint 02's pre-A5 config set `fileParallelism: false` defensively for
// debuggability ("avoid concurrent file execution to keep auth.users
// state observable when something goes wrong"). That guard is dropped
// here on purpose: A5's measured wall-clock proves test isolation
// already holds at the file level (TestUserPool's per-test UUIDs +
// idempotent seeders), and the runtime savings are substantial. If a
// future test introduces shared state, surface that in test design,
// not in a global parallelism kill switch.
//
// Vitest runs declared projects in parallel by default; within a
// project, files also run in parallel by default. `pnpm test:db` (root
// + db package) runs all three projects concurrently with no filter.
// Per-suite scripts (`test:rls`, `test:auth`, `test:billing`) pass
// `--project <name>` so their gate semantics are unchanged — they still
// run only their respective suite, but now also benefit from internal
// file-level parallelism.

const sharedTestConfig = {
  setupFiles: ["./tests/setup.ts"],
  testTimeout: 20_000,
  hookTimeout: 20_000,
  reporters: ["default"],
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...sharedTestConfig,
          name: "rls",
          include: ["tests/rls/**/*.test.ts"],
        },
      },
      {
        test: {
          ...sharedTestConfig,
          name: "auth",
          include: ["tests/auth/**/*.test.ts"],
        },
      },
      {
        test: {
          ...sharedTestConfig,
          name: "billing",
          include: ["tests/billing/**/*.test.ts"],
        },
      },
      {
        test: {
          ...sharedTestConfig,
          name: "sources",
          include: ["tests/sources/**/*.test.ts"],
        },
      },
    ],
  },
});
