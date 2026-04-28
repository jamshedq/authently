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
import type { Database } from "@authently/db";

export type AuthentlyJobsClient = SupabaseClient<Database>;

let cached: AuthentlyJobsClient | null = null;

/**
 * Service-role Supabase client used inside Trigger.dev tasks.
 *
 * Bypasses RLS, which is the whole reason this file is fenced behind
 * `defineTenantTask` callers — every task must explicitly assert workspace
 * context before issuing any read or write through this client. See
 * services/workspaces/verify-workspace-exists.ts for the canonical assertion.
 *
 * Memoized so a single task run reuses one client across multiple queries.
 */
export function getJobsSupabaseClient(): AuthentlyJobsClient {
  if (cached) return cached;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "Trigger.dev tasks require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. " +
        "Local dev: populate apps/jobs/.env from `supabase status -o env`. " +
        "Deployed: set these as project env vars in the Trigger.dev dashboard.",
    );
  }

  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
