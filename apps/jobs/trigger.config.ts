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

import { defineConfig } from "@trigger.dev/sdk/v3";

// Trigger.dev v3 project configuration. The `project` reference must match a
// project in your Trigger.dev account (cloud or self-hosted) — set it via the
// TRIGGER_PROJECT_REF env var (apps/jobs/.env), or replace the fallback
// below after running `npx trigger.dev@latest login` and creating the
// Authently project.
export default defineConfig({
  project: process.env["TRIGGER_PROJECT_REF"] ?? "proj_authently_placeholder",
  runtime: "node",
  logLevel: "info",
  // Hard cap on a single task's wall-clock — protects against runaway jobs.
  // Real workloads will override per-task in later sprints.
  maxDuration: 300,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },
  // Discovery roots for task definitions.
  dirs: ["./src/trigger"],
});
