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

"use server";

import { deleteSource } from "@/services/sources/delete-source";

// Sprint 07 C3.3 — server action for source deletion. Thin route per
// CLAUDE.md: validate FormData → delegate to service module → return.
// The deleteSource service (C2b.2) wraps `api_delete_source` RPC (C2b.1)
// which performs the soft-delete (sets deleted_at). Storage cleanup is
// NOT cascaded — soft-deleted rows logically still exist per
// SPRINT_07_carryovers.md entry #2 [E6d-Storage addendum].

export type DeleteSourceActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteSourceAction(
  formData: FormData,
): Promise<DeleteSourceActionResult> {
  const sourceId = formData.get("sourceId");

  if (typeof sourceId !== "string" || sourceId.length === 0) {
    return { ok: false, error: "validation: source_id_missing" };
  }

  return deleteSource({ sourceId });
}
