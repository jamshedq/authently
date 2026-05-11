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

import { defineConfig } from "@trigger.dev/sdk";
import { pythonExtension } from "@trigger.dev/python/extension";

// Trigger.dev v4 project configuration. The `project` reference must match a
// project in your Trigger.dev account (cloud or self-hosted) — set it via the
// TRIGGER_PROJECT_REF env var (apps/jobs/.env), or replace the fallback
// below after running `npx trigger.dev@latest login` and creating the
// Authently project.
//
// Sprint 07 C2a inline correction: import path moved from
// `@trigger.dev/sdk/v3` to `@trigger.dev/sdk`. v4 SDK 4.4.4's
// package.json maps both `.` and `./v3` paths to the same source file
// (`./src/v3/index.ts`), so the prior import was not broken — but the
// modern v4 form drops the `/v3` suffix and matches the conventions
// documented in apps/jobs/CLAUDE.md.
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
  // Sprint 07 C2a: Python build extension for B3 (URL/PDF extraction).
  // Bundles apps/jobs/python/*.py into the deployment image and pip-installs
  // the pinned trafilatura + pdfplumber from requirements.txt into a venv at
  // /opt/venv. devPythonBinaryPath points at the local venv used during
  // `pnpm --filter @authently/jobs dev` so the same scripts run locally
  // without rebuilds. Per SPRINT_07_preflight.md Item 1 (Context7-current
  // import path: @trigger.dev/python/extension).
  build: {
    extensions: [
      pythonExtension({
        scripts: ["./python/**/*.py"],
        requirementsFile: "./python/requirements.txt",
        devPythonBinaryPath: "./python/.venv/bin/python",
      }),
    ],
  },
});
