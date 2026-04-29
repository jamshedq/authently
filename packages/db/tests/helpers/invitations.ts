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

// Test helpers for the workspace_invitations flow. The Sprint 02
// Section C tests need to:
//   - INSERT an invitation as a specific actor (RLS-gated)
//   - Generate the raw + hashed token the same way createInvitation
//     does in apps/web (so the api_accept_invitation RPC can find it)

import { createHash, randomBytes } from "node:crypto";
import type { AuthentlyClient } from "./supabase-clients.ts";

export type InvitationFixture = {
  id: string;
  rawToken: string;
  tokenHashHex: string;
};

type InsertArgs = {
  workspaceId: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  invitedBy: string;
  expiresAt?: Date | null;
};

/**
 * Insert an invitation through a specific (RLS-subject) client. Returns
 * the row id, raw token, and hex token-hash so tests can drive the
 * accept flow without needing service-role bypass.
 *
 * If `expiresAt` is omitted the DB default (now() + 7 days) applies. Pass
 * a past Date to test the "expired" path.
 */
export async function insertInvitationViaRls(
  client: AuthentlyClient,
  args: InsertArgs,
): Promise<InvitationFixture> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHashHex = createHash("sha256").update(rawToken).digest("hex");

  const insert: Record<string, string | null> = {
    workspace_id: args.workspaceId,
    email: args.email,
    role: args.role,
    token_hash: `\\x${tokenHashHex}`,
    invited_by: args.invitedBy,
  };
  if (args.expiresAt !== undefined) {
    insert["expires_at"] = args.expiresAt === null ? null : args.expiresAt.toISOString();
  }

  const { data, error } = await client
    .from("workspace_invitations")
    .insert(insert as never)
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw new Error(`insertInvitationViaRls failed: ${error.message}`);
  }
  return { id: data.id, rawToken, tokenHashHex };
}
