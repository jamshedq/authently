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

// Post-auth landing. Three branches:
//   - unauthenticated      → /login
//   - zero memberships     → render <EmptyWorkspaceState/> (Section B3)
//   - one+ memberships     → cookie-aware redirect to a dashboard
//
// Cookie-aware redirect:
//   1. Read `authently_last_workspace_slug` (set by the workspace
//      layout on every visit to /app/[slug]/*).
//   2. If the slug names a workspace the caller is still a member of,
//      redirect there.
//   3. Otherwise, redirect to the first membership in the list. Order
//      is whatever Postgres returns; we don't track "most-recently-
//      active" yet (Sprint 03+).
//
// The cookie does NOT grant access — even if it's tampered with, the
// membership-list check before redirect ensures the user only ever
// lands on a workspace they belong to.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { EmptyWorkspaceState } from "@/components/empty-workspace-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserWithMemberships } from "@/services/users/get-current-user-with-memberships";

export const dynamic = "force-dynamic";

const LAST_WORKSPACE_COOKIE = "authently_last_workspace_slug";

export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { memberships } = await getCurrentUserWithMemberships(supabase);

  if (memberships.length === 0) {
    return (
      <>
        <Header />
        <main className="container">
          <EmptyWorkspaceState />
        </main>
      </>
    );
  }

  const cookieStore = await cookies();
  const last = cookieStore.get(LAST_WORKSPACE_COOKIE)?.value;
  const slugs = new Set(memberships.map((m) => m.workspace.slug));

  const target =
    last && slugs.has(last) ? last : memberships[0]!.workspace.slug;

  redirect(`/app/${target}/dashboard`);
}
