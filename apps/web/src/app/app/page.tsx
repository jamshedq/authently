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

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensurePrimaryWorkspace } from "@/services/workspaces/ensure-primary-workspace";

export const dynamic = "force-dynamic";

// Post-auth landing. The sign-up / sign-in forms drop the user here, and we
// route them to their primary workspace dashboard. ensurePrimaryWorkspace
// is idempotent: if the on_auth_user_created trigger fired during signUp
// (the normal case), this just returns the existing workspace; if it
// didn't, the same call creates one.
export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const workspace = await ensurePrimaryWorkspace(supabase);
  redirect(`/app/${workspace.slug}/dashboard`);
}
