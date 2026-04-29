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

// Section C — invitation creation. The token is generated in Node so the
// raw value never leaves app memory; only the SHA-256 hash is persisted
// in workspace_invitations.token_hash. The route handler sends the raw
// token to the email layer, where it's embedded in the accept link.
//
// The INSERT runs through the user's RLS-subject client. The
// `invitations_owner_admin_insert` policy from migration 20260429230559
// gates the write; combined with the `withMembership({ requireRole:
// ['owner', 'admin'] })` API gate this is defence-in-depth.

import { createHash, randomBytes } from "node:crypto";
import { ConflictError } from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";
import type { CreateInvitationInput } from "@/lib/schemas/invitations";

export type CreatedInvitation = {
  id: string;
  email: string;
  role: CreateInvitationInput["role"];
  expiresAt: string;
  rawToken: string; // emailed only, never stored
};

type Args = {
  workspaceId: string;
  invitedBy: string;
} & CreateInvitationInput;

/**
 * Mints a 32-byte (256-bit) random token, hashes it with SHA-256, and
 * inserts the invitation row. Returns the raw token alongside the row
 * identity columns so the caller can email it.
 *
 * Concurrency: token_hash is UNIQUE; on the astronomically-unlikely
 * collision (or the practically-impossible second case where the same
 * pending invite already exists) the INSERT raises 23505 and we surface
 * it as ConflictError.
 */
export async function createInvitation(
  supabase: AuthentlyServerClient,
  { workspaceId, invitedBy, email, role }: Args,
): Promise<CreatedInvitation> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest();

  const { data, error } = await supabase
    .from("workspace_invitations")
    // bytea binary insertion via supabase-js: pass as `\x` hex string.
    // This is the wire-protocol shape PostgREST accepts for bytea.
    .insert({
      workspace_id: workspaceId,
      email,
      role,
      token_hash: `\\x${tokenHash.toString("hex")}`,
      invited_by: invitedBy,
    } as never)
    .select("id, email, role, expires_at")
    .single<{ id: string; email: string; role: CreateInvitationInput["role"]; expires_at: string }>();

  if (error) {
    if (error.code === "23505") {
      throw new ConflictError({
        message: "A pending invitation for this email already exists.",
      });
    }
    throw error;
  }

  return {
    id: data.id,
    email: data.email,
    role: data.role,
    expiresAt: data.expires_at,
    rawToken,
  };
}
