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
 * Accept an ownership transfer (Sprint 04 A2). The route layer requires
 * workspace membership; the SECURITY DEFINER worker enforces target-only
 * (caller must equal `to_user_id`) and the full state-machine guards.
 *
 * On success the role swap (previous owner → admin; target → owner) and
 * the `accepted_at` write happen atomically inside the plpgsql worker.
 */
export async function acceptOwnershipTransfer(
  supabase: AuthentlyServerClient,
  transferId: string,
): Promise<void> {
  const { error } = await typedRpc(supabase, "api_accept_ownership_transfer", {
    _transfer_id: transferId,
  });

  if (!error) return;

  if (error.code === "42501") throw new ForbiddenError();
  if (error.code === "22023") {
    throw new AppError({
      code: "OWNERSHIP_TRANSFER_NOT_PENDING",
      message: error.message,
      statusCode: 422,
    });
  }
  throw error;
}
