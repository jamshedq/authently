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

import { AuthError } from "@authently/shared";
import { withErrorHandling } from "@/lib/api/handler";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensurePrimaryWorkspace } from "@/services/workspaces/ensure-primary-workspace";

/**
 * POST /api/auth/post-signup
 *
 * Reconciliation fallback. The on_auth_user_created trigger
 * (migration 20260428000001) is the primary path that bootstraps a
 * workspace + owner membership for a new user — it fires inside the
 * auth.users insert transaction, so by the time signUp() returns, the
 * workspace already exists.
 *
 * This endpoint exists for the edge cases:
 *   - the trigger failed (e.g. transient slug collision exhausting retries)
 *   - the trigger hasn't run yet (migrations applied out of order)
 *   - manual reconciliation from an admin tool
 *
 * Idempotency contract:
 *   - 0 memberships → creates one and returns the workspace
 *   - ≥1 memberships → returns the user's primary workspace, no error,
 *     no duplicate created. Repeated calls always converge on the same
 *     workspace.
 *
 * Idempotency lives in the DB (public.api_ensure_my_workspace, SECURITY
 * DEFINER, idempotent by construction). apps/web does not need
 * SUPABASE_SERVICE_ROLE_KEY for this path — the user's authenticated JWT
 * is enough to invoke the RPC.
 */
export const POST = withErrorHandling(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new AuthError();
  }

  const workspace = await ensurePrimaryWorkspace(supabase);
  return Response.json({ workspace });
});
