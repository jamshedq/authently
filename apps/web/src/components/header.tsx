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

import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UserMenu } from "@/components/user-menu";

// Server Component. Sticky white header with backdrop-blur (DESIGN.md §4
// Navigation). Decides which right-side cluster to render based on auth:
//   - signed in     → UserMenu (avatar dropdown, see Section A3 spec)
//   - anonymous     → "alpha" Mintlify-style mono-badge
// Auth check uses the same `supabase.auth.getUser()` pattern as the
// dashboard route — JWT-validated, not just cookie-trusted.
export async function Header() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const fullName =
    typeof user?.user_metadata?.["full_name"] === "string"
      ? (user.user_metadata["full_name"] as string)
      : null;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md backdrop-saturate-150">
      <div className="container flex h-14 items-center justify-between">
        <Link
          href="/"
          className="text-[15px] font-medium tracking-tight text-foreground transition hover:text-brand"
        >
          Authently
        </Link>
        {user ? (
          <UserMenu
            userId={user.id}
            email={user.email ?? ""}
            fullName={fullName}
          />
        ) : (
          <span className="rounded-full bg-brand-light px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.6px] text-brand-deep">
            alpha
          </span>
        )}
      </div>
    </header>
  );
}
