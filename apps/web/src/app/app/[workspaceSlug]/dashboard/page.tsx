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
import { getWorkspaceBySlug } from "@/services/workspaces/get-workspace-by-slug";

// Always run at request time. The route already opts out of static rendering
// via cookies(), but spelling it out makes the security posture explicit.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ workspaceSlug: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const { workspaceSlug } = await params;
  const supabase = await createSupabaseServerClient();

  // 1. Authentication. getUser() validates the JWT against Supabase Auth —
  // it does not just trust the cookie payload. Anonymous → /login.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  // 2. Authorization. The lookup runs as the authenticated user and is
  // gated by the `workspaces_member_select` RLS policy (which delegates to
  // `private.is_workspace_member`). Non-members get `null` — same response
  // as a workspace that doesn't exist, so we can't accidentally leak the
  // existence of a workspace the user has no business knowing about.
  const workspace = await getWorkspaceBySlug(supabase, workspaceSlug);

  if (!workspace) {
    redirect("/?error=no_workspace_access");
  }

  // 3. Render. Placeholder content; real dashboard surfaces in later sprints.
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Workspace
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to {workspace.name}
        </h1>
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-border p-4">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Slug
          </dt>
          <dd className="mt-1 text-sm font-medium">{workspace.slug}</dd>
        </div>
        <div className="rounded-md border border-border p-4">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Template
          </dt>
          <dd className="mt-1 text-sm font-medium capitalize">
            {workspace.template}
          </dd>
        </div>
        <div className="rounded-md border border-border p-4">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Plan
          </dt>
          <dd className="mt-1 text-sm font-medium capitalize">
            {workspace.planTier}
          </dd>
        </div>
      </dl>

      <p className="text-sm text-muted-foreground">
        This is a Sprint 01 placeholder. Real dashboard widgets land in later
        sprints.
      </p>

      <form action="/api/auth/sign-out" method="post">
        <button
          type="submit"
          className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-secondary"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
