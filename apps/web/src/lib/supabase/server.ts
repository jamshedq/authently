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

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@authently/db";
import { getServerEnv } from "@/lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Server-side Supabase client. Reads the user's auth cookies via Next's
 * `cookies()` helper. Subject to RLS — every query runs with the user's
 * `auth.uid()` if they're signed in, otherwise as `anon`.
 *
 * Use this for: Server Components, Server Actions, Route Handlers, and
 * anywhere else server code needs to act on behalf of the requesting user.
 *
 * Do NOT use this for trusted server-only operations that need to bypass
 * RLS (use a service-role client for that — added when needed).
 */
export async function createSupabaseServerClient() {
  const env = getServerEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          // In Server Components, cookies are read-only. Setting throws,
          // which we swallow — the middleware refresh path uses a writable
          // cookie store and is the source of truth for token rotation.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component context — read-only cookies. Ignore.
          }
        },
      },
    },
  );
}

export type AuthentlyServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
