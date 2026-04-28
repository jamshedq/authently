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

import type { User } from "@supabase/supabase-js";
import { AuthError, ForbiddenError, type WorkspaceRole } from "@authently/shared";
import {
  createSupabaseServerClient,
  type AuthentlyServerClient,
} from "@/lib/supabase/server";
import {
  getWorkspaceBySlug,
  type WorkspaceForDashboard,
} from "@/services/workspaces/get-workspace-by-slug";
import { errorResponse } from "./error-response.ts";

/**
 * Membership-gated route handler context. The handler receives the
 * authenticated user, the workspace, the user's role within it, and a
 * request-scoped server client (RLS-subject — same client that passed the
 * auth + membership check).
 */
export type MembershipContext<P extends Record<string, string>> = {
  request: Request;
  supabase: AuthentlyServerClient;
  user: User;
  workspace: WorkspaceForDashboard;
  role: WorkspaceRole;
  params: P;
};

/**
 * Wraps a route handler under /api/ws/[workspaceSlug]/* with the canonical
 * authentication + membership gate.
 *
 * Failure responses:
 *   - Unauthenticated → 401 AUTH_REQUIRED
 *   - Authenticated but workspace doesn't exist OR user is not a member
 *     → 403 FORBIDDEN. Both cases collapse to the same response, by design:
 *     a 404-vs-403 distinction would let an attacker probe whether a slug
 *     belongs to a workspace they don't have access to.
 *
 * The membership lookup runs through the user's RLS-subject client: the
 * SELECT on `workspaces` is filtered by the `workspaces_member_select`
 * policy, which already encodes "is the caller a member?" — so a non-member
 * receives `null` for any slug, real or fake. The follow-up role lookup
 * exists only to read the role for the route handler's use (and would
 * succeed only if the workspace lookup did, since the same RLS predicate
 * applies to workspace_members).
 */
export function withMembership<P extends Record<string, string> = Record<string, string>>(
  handler: (ctx: MembershipContext<P & { workspaceSlug: string }>) => Promise<Response>,
) {
  return async (
    request: Request,
    routeCtx: { params: Promise<P & { workspaceSlug: string }> },
  ): Promise<Response> => {
    try {
      const params = await routeCtx.params;
      const supabase = await createSupabaseServerClient();

      // 1. Authentication.
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new AuthError();
      }

      // 2. Workspace visibility (RLS-gated; non-members get null).
      const workspace = await getWorkspaceBySlug(supabase, params.workspaceSlug);
      if (!workspace) {
        throw new ForbiddenError();
      }

      // 3. Role lookup. RLS lets the user see their own membership row.
      const { data: membership, error: memberError } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", user.id)
        .maybeSingle<{ role: WorkspaceRole }>();
      if (memberError) throw memberError;
      if (!membership) {
        // Defense-in-depth: workspace was visible (so user is a member per
        // the RLS predicate), but the role row didn't materialize. Collapse
        // to 403 rather than leak the inconsistency.
        throw new ForbiddenError();
      }

      return await handler({
        request,
        supabase,
        user,
        workspace,
        role: membership.role,
        params,
      });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
