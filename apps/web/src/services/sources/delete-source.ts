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

import { z } from "zod";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Sprint 07 C2b.2 — service module wrapping public.api_delete_source.
//
// Soft-delete via deleted_at = now() (RPC convention from C2b.1). The
// RPC is idempotent: calling on an already-deleted or non-existent
// source is a silent no-op. Storage objects are NOT cleaned up here —
// soft-deleted rows logically still exist; Storage orphans only surface
// from failed extractions or upload-without-row races, accepted per
// SPRINT_07_carryovers.md entry #2 [E6d-Storage addendum].
//
// Note on scope: per C2b.2 prompt lock, this service module ships in
// C2b.2 (with its tests) but the consuming server action lands in C3
// alongside the sources list page UI. Service is testable independent
// of UI; the action is testable when the UI surface exists.

export type DeleteSourceInput = {
  sourceId: string;
};

export type DeleteSourceResult =
  | { ok: true }
  | { ok: false; error: string };

const inputSchema = z.object({
  sourceId: z.string().uuid(),
});

export async function deleteSource(
  input: DeleteSourceInput,
): Promise<DeleteSourceResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "input";
    return { ok: false, error: `validation: ${path}: ${issue?.message}` };
  }

  const sb = await createSupabaseServerClient();
  const { error } = await typedRpc(sb, "api_delete_source", {
    _source_id: parsed.data.sourceId,
  });
  if (error) {
    return { ok: false, error: `rpc: ${error.message}` };
  }
  return { ok: true };
}
