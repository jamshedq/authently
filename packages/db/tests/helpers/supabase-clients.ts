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
import type { Database } from "../../types.ts";

function readEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`env var ${key} is unset (validated by tests/setup.ts)`);
  }
  return value;
}

const SUPABASE_URL = (): string => readEnv("SUPABASE_URL");
const ANON_KEY = (): string => readEnv("SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = (): string => readEnv("SUPABASE_SERVICE_ROLE_KEY");

export type AuthentlyClient = SupabaseClient<Database>;

/**
 * Service-role client. Bypasses RLS. Use for admin actions (creating users,
 * cleanup) and read-side assertions where the test wants ground truth.
 */
export function createServiceRoleClient(): AuthentlyClient {
  return createClient<Database>(SUPABASE_URL(), SERVICE_ROLE_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Anon client (no user). Used for the email/password sign-in flow that mints
 * an access token. Not used directly by tests.
 */
export function createAnonClient(): AuthentlyClient {
  return createClient<Database>(SUPABASE_URL(), ANON_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Authenticated client acting as a specific user. Subject to RLS, like
 * production traffic from the user's browser.
 */
export function createAuthenticatedClient(accessToken: string): AuthentlyClient {
  return createClient<Database>(SUPABASE_URL(), ANON_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
