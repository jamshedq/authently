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

// Creates a new SQL migration file at packages/db/migrations/<TS>_<slug>.sql
// where <TS> is the current UTC timestamp in YYYYMMDDHHMMSS form.
//
// Usage:
//   pnpm db:new add_invitations_table
//   pnpm --filter @authently/db new add_invitations_table
//
// The slug is lowercased, non-alphanumeric runs collapse to underscores, and
// leading/trailing underscores are stripped. Empty slug after normalization
// is rejected.

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

const rawName = process.argv[2];
if (!rawName) {
  console.error(
    "[db:new] Usage: pnpm db:new <migration_name>\n" +
      "  Example: pnpm db:new add_invitations_table",
  );
  process.exit(1);
}

const slug = rawName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

if (!slug) {
  console.error(
    `[db:new] '${rawName}' normalized to an empty slug. Use letters, digits, and underscores.`,
  );
  process.exit(1);
}

// UTC timestamp in YYYYMMDDHHMMSS form. UTC keeps ordering stable across
// contributor timezones and avoids DST collisions twice a year.
const now = new Date();
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const stamp =
  `${now.getUTCFullYear()}` +
  pad(now.getUTCMonth() + 1) +
  pad(now.getUTCDate()) +
  pad(now.getUTCHours()) +
  pad(now.getUTCMinutes()) +
  pad(now.getUTCSeconds());

const filename = `${stamp}_${slug}.sql`;
const path = join(MIGRATIONS_DIR, filename);

if (existsSync(path)) {
  console.error(
    `[db:new] Refusing to overwrite existing file: ${path}\n` +
      `  Wait one second and try again, or pick a different name.`,
  );
  process.exit(1);
}

const stub =
  `-- =============================================================================\n` +
  `-- Authently migration\n` +
  `-- Created: ${now.toISOString()}\n` +
  `-- Slug: ${slug}\n` +
  `--\n` +
  `-- Multi-tenant rules (per CLAUDE.md):\n` +
  `--   - Every business table has \`workspace_id uuid not null references workspaces(id)\`\n` +
  `--   - Every business table has RLS enabled in this same migration\n` +
  `--   - Every policy is scoped to workspace membership\n` +
  `--\n` +
  `-- Run \`pnpm --filter @authently/db gen:types\` after applying.\n` +
  `-- =============================================================================\n` +
  `\n`;

writeFileSync(path, stub, "utf8");
console.log(`[db:new] Created ${filename}`);
console.log(`         Path: ${path}`);
