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

import { logger } from "@trigger.dev/sdk";
import { z } from "zod";
import { defineTenantTask } from "../lib/tenant-task.ts";

/**
 * Sprint 01 wiring proof. Validates a workspace_id, confirms the workspace
 * exists in Postgres (via the service-role client), and returns a small
 * receipt. Real tasks (ingestion, remix, publishing) land in later sprints
 * and follow the same shape: defineTenantTask + a small payload schema +
 * a run body that does the actual work.
 */
export const workspaceNoopTask = defineTenantTask({
  id: "workspace-noop",
  payloadSchema: z.object({
    // Optional caller-supplied note, just so we can see the value flow
    // through the logger when triggering manually for debugging.
    note: z.string().min(1).max(280).optional(),
  }),
  run: async (payload, { workspaceId }) => {
    logger.info("workspace-noop fired", {
      workspaceId,
      note: payload.note ?? null,
    });

    // No-op: the workspace existence check inside defineTenantTask is the
    // entire body of this task. Returning a receipt is helpful for
    // verifying invocation end-to-end during local dev.
    return {
      workspaceId,
      note: payload.note ?? null,
      verifiedAt: new Date().toISOString(),
    };
  },
});
