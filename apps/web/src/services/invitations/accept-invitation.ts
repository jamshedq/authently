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

// Wraps the SECURITY DEFINER api_accept_invitation RPC. Maps Postgres
// error codes raised by the RPC into typed AppError subclasses so the
// route handler can return clean HTTP statuses.
//
// PG errcode → app status:
//   42501  →  401 (auth required) / 403 (insufficient privileges)
//   22023  →  410 GONE  (expired / not found / wrong email)
//   23505  →  409 CONFLICT (already accepted)

import {
  AppError,
  AuthError,
  ConflictError,
  NotFoundError,
} from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";

export type AcceptInvitationResult = {
  workspaceSlug: string;
  workspaceName: string;
};

type RpcRow = { workspace_slug: string; workspace_name: string };

type SupabaseError = { code?: string; message: string };

export async function acceptInvitation(
  supabase: AuthentlyServerClient,
  rawToken: string,
): Promise<AcceptInvitationResult> {
  // Same supabase-js v2.105 typed-RPC workaround as the other
  // args-bearing RPC call sites (see docs/retrospectives/SPRINT_02.md).
  const rpc = await (
    supabase.rpc as unknown as (
      fn: "api_accept_invitation",
      args: { _token: string },
    ) => Promise<{ data: RpcRow[] | null; error: SupabaseError | null }>
  )("api_accept_invitation", { _token: rawToken });

  if (rpc.error) {
    const err = rpc.error;
    if (err.code === "42501") {
      throw new AuthError();
    }
    if (err.code === "23505") {
      throw new ConflictError({
        message: "This invitation has already been accepted.",
      });
    }
    if (err.code === "22023") {
      // Expired / not found / wrong email all collapse to NotFoundError
      // for the UI; the precise message comes from the RPC and is safe
      // to surface (it doesn't leak workspace-existence info — the
      // lookup envelope already does anti-enumeration).
      throw new NotFoundError({ message: err.message });
    }
    throw new AppError({
      code: "INVITATION_ACCEPT_FAILED",
      message: err.message,
      statusCode: 500,
      cause: err,
    });
  }

  const row = rpc.data?.[0];
  if (!row) {
    throw new AppError({
      code: "INVITATION_ACCEPT_INCONSISTENT",
      message: "Invitation accepted but workspace identity not returned",
      statusCode: 500,
    });
  }
  return {
    workspaceSlug: row.workspace_slug,
    workspaceName: row.workspace_name,
  };
}
