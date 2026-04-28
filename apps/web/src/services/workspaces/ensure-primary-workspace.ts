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

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { AppError } from "@authently/shared";
import type { Tables } from "@authently/db";
import type { AuthentlyServerClient } from "@/lib/supabase/server";
import type { WorkspaceForDashboard } from "./get-workspace-by-slug.ts";

type WorkspaceRow = Pick<
  Tables<"workspaces">,
  "id" | "name" | "slug" | "template" | "plan_tier"
>;

/**
 * Idempotent reconciliation: ensure the calling user has at least one
 * workspace + owner membership, returning the primary one.
 *
 * Implementation defers to `public.api_ensure_my_workspace`, a SECURITY
 * DEFINER RPC defined in migration 20260428000002. The RPC:
 *   - reads the calling user via auth.uid()
 *   - if the user already has memberships, returns the oldest workspace_id
 *   - otherwise creates a workspace + owner membership and returns its id
 *
 * Bypassing RLS for the bootstrap insert happens entirely inside the DB.
 * apps/web does NOT need SUPABASE_SERVICE_ROLE_KEY for this path — the
 * authenticated client's JWT is enough to invoke the RPC.
 */
export async function ensurePrimaryWorkspace(
  supabase: AuthentlyServerClient,
): Promise<WorkspaceForDashboard> {
  // supabase-js v2.105 + exactOptionalPropertyTypes mis-infers the chain
  // to `never` for parameterless RPCs. Runtime behavior is correct; cast
  // pins the response type to what the SQL function actually returns.
  const rpc = (await supabase.rpc(
    "api_ensure_my_workspace",
  )) as PostgrestSingleResponse<string>;
  if (rpc.error || !rpc.data) {
    throw new AppError({
      code: "WORKSPACE_BOOTSTRAP_FAILED",
      message: "Failed to ensure user workspace",
      statusCode: 500,
      ...(rpc.error ? { cause: rpc.error } : {}),
    });
  }

  const workspaceId = rpc.data;

  // The RPC returned a workspace the user owns; the SELECT below succeeds
  // under RLS because the user is now a member of it.
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, slug, template, plan_tier")
    .eq("id", workspaceId)
    .maybeSingle<WorkspaceRow>();
  if (error) throw error;
  if (!data) {
    throw new AppError({
      code: "WORKSPACE_BOOTSTRAP_INCONSISTENT",
      message: "Workspace was reconciled but cannot be read",
      statusCode: 500,
    });
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    // CHECK constraint guarantees the union; see get-workspace-by-slug.ts.
    template: data.template as WorkspaceForDashboard["template"],
    planTier: data.plan_tier,
  };
}
