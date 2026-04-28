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

import { withErrorHandling } from "@/lib/api/handler";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserWithMemberships } from "@/services/users/get-current-user-with-memberships";

/**
 * GET /api/me
 *
 * Returns the authenticated user and the workspaces they're a member of.
 *
 * RLS-only: the request-scoped server client carries the user's session
 * cookies, and every SELECT on workspace_members / workspaces is gated by
 * the policies from migration 20260428000001. Non-members can never appear
 * in the response. There is no service-role escape hatch in this path.
 */
export const GET = withErrorHandling(async () => {
  const supabase = await createSupabaseServerClient();
  const result = await getCurrentUserWithMemberships(supabase);
  return Response.json(result);
});
