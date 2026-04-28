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

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@authently/db";

/**
 * Client-side Supabase client. Reads NEXT_PUBLIC_* values inlined by Next at
 * build time. Subject to RLS — same security boundary as the server client,
 * just running in the browser with a fetch-based transport and document
 * cookies.
 *
 * Use this for: Client Components, browser-side auth flows.
 */
export function createSupabaseBrowserClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set at build time.",
    );
  }
  return createBrowserClient<Database>(url, anonKey);
}

export type AuthentlyBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;
