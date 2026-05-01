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

// Self-leave: the calling user removes their own membership row. RLS
// gate `workspace_members_delete` allows DELETE WHERE user_id =
// auth.uid(). Last-owner protection trigger (`private.prevent_last_owner_loss`)
// blocks the leave attempt with 23514 if the caller is the only owner;
// the API layer translates that to a 409 with a clear message so the
// UI can render the "transfer ownership first" state.

import { AppError } from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";

type Args = {
  workspaceId: string;
  userId: string;
};

export async function leaveWorkspace(
  supabase: AuthentlyServerClient,
  { workspaceId, userId }: Args,
): Promise<void> {
  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) {
    if (error.code === "23514") {
      throw new AppError({
        code: "LAST_OWNER",
        message:
          "You're the last owner. Transfer ownership before leaving — see Workspace settings.",
        statusCode: 409,
      });
    }
    throw error;
  }
}
