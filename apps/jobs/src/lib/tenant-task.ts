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

import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { uuidSchema } from "@authently/shared";
import { verifyWorkspaceExists } from "../services/workspaces/verify-workspace-exists.ts";

/**
 * Authently's canonical Trigger.dev task constructor. Enforces the two
 * multi-tenant invariants from CLAUDE.md:
 *
 *   1. Every task takes `workspace_id` as the first payload field. The
 *      helper prepends it to the user's payload schema so the merged
 *      runtime shape is always { workspace_id: uuid, ...userFields }.
 *
 *   2. Every task asserts workspace context before running business logic.
 *      The helper invokes `verifyWorkspaceExists(workspace_id)` immediately
 *      after schema validation, so a stale or fabricated id is rejected
 *      with NotFoundError before the task body runs.
 *
 * Use this instead of `task(...)` from `@trigger.dev/sdk/v3` for any task
 * scoped to a workspace (i.e. all of them).
 *
 * @example
 *   export const exampleTask = defineTenantTask({
 *     id: "example",
 *     payloadSchema: z.object({ sourceUrl: z.string().url() }),
 *     run: async (payload, { workspaceId }) => {
 *       // payload: { workspace_id: string; sourceUrl: string }
 *       // workspaceId: string  (== payload.workspace_id)
 *       return { ok: true };
 *     },
 *   });
 */
export function defineTenantTask<
  TId extends string,
  TExtraSchema extends z.ZodObject<z.ZodRawShape>,
  TOutput = unknown,
>(opts: {
  id: TId;
  payloadSchema: TExtraSchema;
  run: (
    payload: z.infer<TExtraSchema> & { workspace_id: string },
    ctx: { workspaceId: string },
  ) => Promise<TOutput>;
}) {
  // Merge workspace_id into the user's schema. zod handles the runtime
  // validation; the inferred payload type at the schemaTask boundary is
  // { workspace_id: string } & z.infer<TExtraSchema>.
  const schema = z.object({
    workspace_id: uuidSchema,
    ...opts.payloadSchema.shape,
  });

  return schemaTask({
    id: opts.id,
    schema,
    run: async (payload) => {
      const workspaceId = payload.workspace_id;
      await verifyWorkspaceExists(workspaceId);
      return opts.run(
        payload as z.infer<TExtraSchema> & { workspace_id: string },
        { workspaceId },
      );
    },
  });
}
