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

export type BlockingWorkspace = {
  id: string;
  name: string;
  slug: string;
};

/**
 * SSR helper — returns the workspaces blocking the caller's account
 * deletion (β policy: workspaces the caller owns that have other members,
 * excluding soft-deleted). Calls `public.api_my_blocking_workspaces`
 * which dispatches to `private.account_blocking_workspaces` — the SAME
 * predicate the delete worker uses. Drift between this list and the
 * worker's blocking check is structurally impossible.
 */
export async function getMyBlockingWorkspaces(
  supabase: AuthentlyServerClient,
): Promise<BlockingWorkspace[]> {
  const { data, error } = await typedRpc(
    supabase,
    "api_my_blocking_workspaces",
  );
  if (error) {
    if (error.code === "42501") throw new ForbiddenError();
    throw error;
  }
  return (data as BlockingWorkspace[] | null) ?? [];
}

/**
 * Delete the calling user's account (Sprint 04 A3). β policy: blocked
 * if caller owns workspaces with other members. On a clear path:
 * cascade soft-deletes sole-member workspaces, sets
 * `user_profiles.deleted_at = now()`. All atomic inside the worker.
 *
 * After this returns successfully, the route handler is responsible
 * for calling `supabase.auth.signOut()` to invalidate the session
 * cookies on the response.
 */
export async function deleteAccount(
  supabase: AuthentlyServerClient,
): Promise<void> {
  const { error } = await typedRpc(supabase, "api_delete_account");
  if (!error) return;

  if (error.code === "42501") throw new ForbiddenError();
  if (error.code === "22023") {
    throw new AppError({
      code: "ACCOUNT_DELETION_BLOCKED_OR_TERMINAL",
      message: error.message,
      statusCode: 422,
    });
  }
  throw error;
}
