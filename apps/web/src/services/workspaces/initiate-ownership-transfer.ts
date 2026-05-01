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
 * Initiate an ownership transfer (Sprint 04 A2). Owner-only at the route
 * layer (`withMembership({ requireRole: ['owner'] })`); the SECURITY
 * DEFINER worker re-checks owner role + verifies the target is a non-owner
 * member of the workspace.
 *
 * Returns the new transfer id so the client can construct an accept/cancel
 * URL or render the pending-transfer banner without a follow-up query.
 */
export async function initiateOwnershipTransfer(
  supabase: AuthentlyServerClient,
  workspaceId: string,
  toUserId: string,
): Promise<string> {
  const { data, error } = await typedRpc(
    supabase,
    "api_initiate_ownership_transfer",
    { _workspace_id: workspaceId, _to_user_id: toUserId },
  );

  if (!error) {
    if (typeof data !== "string") {
      throw new AppError({
        code: "OWNERSHIP_TRANSFER_NO_ID",
        message: "RPC returned no transfer id",
        statusCode: 500,
      });
    }
    return data;
  }

  if (error.code === "42501") throw new ForbiddenError();
  if (error.code === "22023") {
    throw new AppError({
      code: "OWNERSHIP_TRANSFER_REJECTED",
      message: error.message,
      statusCode: 422,
    });
  }
  throw error;
}
