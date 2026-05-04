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

import { typedRpc } from "@/lib/supabase/typed-rpc";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Sprint 06 B5 — service module wrapping public.api_create_source_audio.
// Mirrors the apps/web/src/services/billing/ pattern: RLS-subject server
// client + typedRpc; no service-role privilege.

export type CreateSourceAudioInput = {
  workspaceId: string;
  content: string;
};

export type CreateSourceAudioResult =
  | { ok: true; sourceId: string }
  | { ok: false; error: string };

export async function createSourceAudio(
  input: CreateSourceAudioInput,
): Promise<CreateSourceAudioResult> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await typedRpc(sb, "api_create_source_audio", {
    _workspace_id: input.workspaceId,
    _content: input.content,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  if (typeof data !== "string") {
    return {
      ok: false,
      error: `api_create_source_audio returned unexpected payload: ${JSON.stringify(data)}`,
    };
  }
  return { ok: true, sourceId: data };
}
