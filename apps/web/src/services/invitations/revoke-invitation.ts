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

// Hard-deletes an invitation. The RPC re-checks the role gate so the
// failure mode is a clean error code (42501) rather than RLS's silent
// 0-rows-affected.

import { AppError, ForbiddenError, NotFoundError } from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";

type SupabaseError = { code?: string; message: string };

export async function revokeInvitation(
  supabase: AuthentlyServerClient,
  invitationId: string,
): Promise<void> {
  const rpc = await (
    supabase.rpc as unknown as (
      fn: "api_revoke_invitation",
      args: { _invitation_id: string },
    ) => Promise<{ data: null; error: SupabaseError | null }>
  )("api_revoke_invitation", { _invitation_id: invitationId });

  if (rpc.error) {
    const err = rpc.error;
    if (err.code === "42501") throw new ForbiddenError();
    if (err.code === "22023") {
      throw new NotFoundError({ resource: "invitation" });
    }
    throw new AppError({
      code: "INVITATION_REVOKE_FAILED",
      message: err.message,
      statusCode: 500,
      cause: err,
    });
  }
}
