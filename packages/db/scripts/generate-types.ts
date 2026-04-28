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

// Wrapper around `supabase gen types typescript`. Writes the result to
// packages/db/types.ts with a generated-file banner.
//
// Behavior:
//   - With SUPABASE_PROJECT_REF set, targets that hosted project.
//   - Without it, targets the local Supabase instance (requires
//     `supabase start` to be running).
//
// Usage:
//   pnpm --filter @authently/db gen:types
//   SUPABASE_PROJECT_REF=abcdef pnpm --filter @authently/db gen:types

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES_OUTPUT = join(__dirname, "..", "types.ts");
const SCHEMAS = ["public", "private"];

const projectRef = process.env["SUPABASE_PROJECT_REF"];
const args = ["gen", "types", "typescript"];
if (projectRef) {
  args.push("--project-id", projectRef);
} else {
  args.push("--local");
}
for (const schema of SCHEMAS) {
  args.push("--schema", schema);
}

const target = projectRef ? `project ${projectRef}` : "local Supabase";
console.log(`[gen:types] targeting ${target} (schemas: ${SCHEMAS.join(", ")})`);
console.log(`[gen:types] running: supabase ${args.join(" ")}`);

const result = spawnSync("supabase", args, { encoding: "utf8" });
if (result.error) {
  console.error(
    `[gen:types] failed to spawn 'supabase'. Is the Supabase CLI installed and on PATH?`,
  );
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[gen:types] supabase exited with status ${result.status}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(result.status ?? 1);
}

const banner = `/*
 * THIS FILE IS GENERATED — DO NOT EDIT BY HAND.
 *
 * Source:    packages/db/scripts/generate-types.ts
 * Generator: supabase gen types typescript
 * Schemas:   ${SCHEMAS.join(", ")}
 *
 * Regenerate with: pnpm db:gen-types
 *
 * Authently is licensed AGPL-3.0-or-later. See LICENSE at the repo root.
 */

`;

writeFileSync(TYPES_OUTPUT, banner + result.stdout, "utf8");
console.log(
  `[gen:types] wrote ${TYPES_OUTPUT} (${result.stdout.length} bytes).`,
);
