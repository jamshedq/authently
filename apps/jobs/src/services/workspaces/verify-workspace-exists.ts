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

import { NotFoundError } from "@authently/shared";
import { getJobsSupabaseClient } from "../../lib/supabase.ts";

/**
 * Confirm a workspace exists. Throws NotFoundError if the row is absent so
 * tasks can refuse to do work for a stale or fabricated workspace_id.
 *
 * Reads `id` only — the goal is existence, not data exposure. Future task-
 * specific lookups should still scope to `workspace_id = ...` after this
 * check has passed.
 */
export async function verifyWorkspaceExists(workspaceId: string): Promise<void> {
  const supabase = getJobsSupabaseClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle<{ id: string }>();

  if (error) throw error;
  if (!data) {
    throw new NotFoundError({
      resource: "workspace",
      meta: { workspaceId },
    });
  }
}
