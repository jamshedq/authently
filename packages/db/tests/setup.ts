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

// Global Vitest setup. Validates required env vars before any test runs so
// failures surface as a single readable error rather than a stack of
// confusing PostgREST 401s.

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0) {
  const lines = [
    `Missing required env var(s): ${missing.join(", ")}`,
    "",
    "Local: copy packages/db/.env.test.example to packages/db/.env.test and",
    "       populate it. With Supabase running, the values come from:",
    "         supabase status -o env",
    "",
    "CI:    these are populated by the rls workflow job.",
  ];
  throw new Error(lines.join("\n"));
}
