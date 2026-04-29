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

import { AppError } from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";
import type { WorkspaceForDashboard } from "./get-workspace-by-slug.ts";

type CreateWorkspaceRpcRow = {
  id: string;
  name: string;
  slug: string;
  template: string;
  plan_tier: string;
};

/**
 * Create a new workspace + owner membership for the calling user.
 *
 * Defers to `public.api_create_workspace`, the SECURITY DEFINER RPC defined
 * in migration 20260429213717. The RPC:
 *   - reads the calling user via auth.uid()
 *   - validates the name (1..80 chars after trim)
 *   - generates a slug via private.generate_workspace_slug
 *   - inserts the workspace + an owner membership atomically
 *   - returns the new row's identity columns
 *
 * Privilege elevation lives entirely inside the DB. apps/web does NOT use
 * SUPABASE_SERVICE_ROLE_KEY for this path — the authenticated client's JWT
 * is enough to invoke the RPC.
 */
export async function createWorkspace(
  supabase: AuthentlyServerClient,
  name: string,
): Promise<WorkspaceForDashboard> {
  // supabase-js v2.105 + exactOptionalPropertyTypes mis-infers args-bearing
  // RPC overloads. Runtime behaviour is correct; the typed wrapper just
  // pins the response type to what the SQL function actually returns
  // (an array because plpgsql `returns table(...)`).
  // TODO(sprint-02-debt): one of three sites with the same workaround;
  // see also ensure-primary-workspace.ts (parameterless RPC variant) and
  // update-workspace.ts (`.update()` parameter variant). Consolidate into
  // a shared typed helper — tracked in docs/retrospectives/SPRINT_02.md.
  const rpc = await (
    supabase.rpc as unknown as (
      fn: "api_create_workspace",
      args: { _name: string },
    ) => Promise<{
      data: CreateWorkspaceRpcRow[] | null;
      error: { message: string } | null;
    }>
  )("api_create_workspace", { _name: name });

  if (rpc.error) {
    throw new AppError({
      code: "WORKSPACE_CREATE_FAILED",
      message: "Failed to create workspace",
      statusCode: 500,
      cause: rpc.error,
    });
  }

  const row = rpc.data?.[0];
  if (!row) {
    throw new AppError({
      code: "WORKSPACE_CREATE_INCONSISTENT",
      message: "Workspace was created but no row was returned",
      statusCode: 500,
    });
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    template: row.template as WorkspaceForDashboard["template"],
    planTier: row.plan_tier,
  };
}
