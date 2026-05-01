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

import { AppError, ForbiddenError } from "@authently/shared";
import type { Tables, TablesUpdate } from "@authently/db";
import type { AuthentlyServerClient } from "@/lib/supabase/server";
import { typedUpdate } from "@/lib/supabase/typed-update";
import type { WorkspaceForDashboard } from "./get-workspace-by-slug.ts";

type WorkspaceRow = Pick<
  Tables<"workspaces">,
  "id" | "name" | "slug" | "template" | "plan_tier"
>;

// `string | undefined` (rather than `string?`) so the patch composes with
// zod's parse output, which inserts `undefined` for absent optional fields
// under exactOptionalPropertyTypes.
export type UpdateWorkspacePatch = {
  name?: string | undefined;
  template?: WorkspaceForDashboard["template"] | undefined;
};

/**
 * Apply an owner/admin-authorised update to a workspace.
 *
 * Authorisation is enforced by the `workspaces_owner_admin_update` RLS
 * policy from migration 20260429213717 (uses `private.has_workspace_role`),
 * combined with column-level GRANTs that restrict authenticated callers to
 * (name, template). The route handler runs `withMembership` with a
 * `requireRole` gate so editors/viewers receive 403 before reaching here;
 * this layer is defence-in-depth.
 *
 * If RLS hides the row, supabase-js returns `null` data with no error. We
 * surface that as ForbiddenError to keep the response shape consistent
 * with route handlers that throw the same class for non-membership.
 */
export async function updateWorkspace(
  supabase: AuthentlyServerClient,
  workspaceId: string,
  patch: UpdateWorkspacePatch,
): Promise<WorkspaceForDashboard> {
  const updateBody: TablesUpdate<"workspaces"> = {};
  if (patch.name !== undefined) updateBody.name = patch.name;
  if (patch.template !== undefined) updateBody.template = patch.template;

  if (Object.keys(updateBody).length === 0) {
    throw new AppError({
      code: "WORKSPACE_UPDATE_EMPTY",
      message: "No update fields provided",
      statusCode: 422,
    });
  }

  const { data, error } = await typedUpdate(supabase, "workspaces", updateBody)
    .eq("id", workspaceId)
    .select("id, name, slug, template, plan_tier")
    .maybeSingle<WorkspaceRow>();

  if (error) throw error;
  if (!data) {
    // RLS hid the row from the UPDATE result set. Either the workspace
    // doesn't exist or the user isn't owner/admin. Either way, 403.
    throw new ForbiddenError();
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    template: data.template as WorkspaceForDashboard["template"],
    planTier: data.plan_tier,
  };
}
