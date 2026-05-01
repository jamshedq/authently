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
import type { AuthentlyServerClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";

/**
 * Soft-delete a workspace via `public.api_delete_workspace` (Sprint 04 A1).
 *
 * Authorisation is enforced inside the SECURITY DEFINER RPC: the worker
 * calls `private.has_workspace_role(_, array['owner'])` and raises 42501
 * if the caller isn't the owner. Already-deleted retries raise 22023.
 *
 * The route handler in `/api/ws/[workspaceSlug]/route.ts` runs
 * `withMembership` with `requireRole: ['owner']` as defence-in-depth —
 * editors/admins/viewers receive 403 before reaching this service.
 *
 * Soft-delete does NOT cancel active Stripe subscriptions; that's a
 * Sprint 05+ scheduled-cleanup task. The deletion-confirm modal in the
 * settings UI surfaces this disclosure to the user.
 */
export async function deleteWorkspace(
  supabase: AuthentlyServerClient,
  workspaceId: string,
): Promise<void> {
  const { error } = await typedRpc(supabase, "api_delete_workspace", {
    _workspace_id: workspaceId,
  });

  if (!error) return;

  // 42501 — caller isn't owner (or wasn't authenticated, but withMembership
  // gated that already; defence-in-depth).
  if (error.code === "42501") {
    throw new ForbiddenError();
  }

  // 22023 — already deleted. Treat as a 409 so the UI can show "this
  // workspace was already removed" rather than a generic error.
  if (error.code === "22023") {
    throw new AppError({
      code: "WORKSPACE_ALREADY_DELETED",
      message: "Workspace is already deleted",
      statusCode: 409,
    });
  }

  throw error;
}
