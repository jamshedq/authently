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

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@authently/db/types";

// Helpers for mocking @/lib/supabase/server in route-handler tests. The real
// module reads cookies via Next's `cookies()` API, which is awkward to mock
// in a vitest environment. We instead mock the whole module to return a
// pre-built client whose Authorization header carries a known test user's
// token (or no token, for unauth tests).

type MockState = {
  accessToken: string | null;
};

let state: MockState = { accessToken: null };

/**
 * Build a Supabase client that behaves as if the given user is signed in.
 * If accessToken is null, returns an anon client so withMembership's
 * supabase.auth.getUser() will return { user: null }.
 */
export function buildSupabaseServerMock(): SupabaseClient<Database> {
  const url = process.env["SUPABASE_URL"]!;
  const anonKey = process.env["SUPABASE_ANON_KEY"]!;
  const headers: Record<string, string> = {};
  if (state.accessToken) {
    headers["Authorization"] = `Bearer ${state.accessToken}`;
  }
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

export function setMockUserToken(token: string | null): void {
  state.accessToken = token;
}

export function clearMockUserToken(): void {
  state.accessToken = null;
}

// Helper for the route-handler test files. They `vi.mock('@/lib/supabase/server')`
// pointing at this module's exports.
export const supabaseServerMockModule = {
  createSupabaseServerClient: async (): Promise<SupabaseClient<Database>> =>
    buildSupabaseServerMock(),
};
