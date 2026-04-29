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

// Anti-enumeration token lookup. Calls the SECURITY DEFINER
// `api_lookup_invitation` RPC, which returns the same envelope on
// invalid / expired / accepted tokens. The accept page renders
// "this link is no longer valid" for the `invalid` case regardless
// of which underlying state caused it.

import type { AuthentlyServerClient } from "@/lib/supabase/server";

export type InvitationLookupResult =
  | { status: "valid"; workspaceName: string; workspaceSlug: string; role: "admin" | "editor" | "viewer"; emailHint: string }
  | { status: "invalid" };

type RpcRow = {
  status: "valid" | "invalid";
  workspace_name: string | null;
  workspace_slug: string | null;
  role: "admin" | "editor" | "viewer" | null;
  email_hint: string | null;
};

export async function lookupInvitation(
  supabase: AuthentlyServerClient,
  rawToken: string,
): Promise<InvitationLookupResult> {
  // supabase-js v2.105 + exactOptionalPropertyTypes mis-infers args-bearing
  // RPC overloads. Same pattern as create-workspace.ts; tracked in
  // docs/retrospectives/SPRINT_02.md (typed-RPC helper consolidation).
  const rpc = await (
    supabase.rpc as unknown as (
      fn: "api_lookup_invitation",
      args: { _token: string },
    ) => Promise<{ data: RpcRow[] | null; error: { message: string } | null }>
  )("api_lookup_invitation", { _token: rawToken });

  if (rpc.error) throw new Error(rpc.error.message);

  const row = rpc.data?.[0];
  if (!row || row.status !== "valid" || !row.workspace_name || !row.workspace_slug || !row.role || !row.email_hint) {
    return { status: "invalid" };
  }
  return {
    status: "valid",
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    role: row.role,
    emailHint: row.email_hint,
  };
}
