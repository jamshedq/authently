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
import { redirect } from "next/navigation";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMyBlockingWorkspaces } from "@/services/users/delete-account";
import { AccountForm } from "./account-form";

// User-scoped, not workspace-scoped — sits alongside /app/[workspaceSlug]
// rather than under it. The literal "account" segment resolves before
// the dynamic [workspaceSlug] segment, so there's no routing conflict.
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const fullName =
    typeof user.user_metadata?.["full_name"] === "string"
      ? (user.user_metadata["full_name"] as string)
      : "";

  // Sprint 04 A3 — server-render the β-policy blocking list. Same
  // predicate the worker uses (private.account_blocking_workspaces, called
  // via public.api_my_blocking_workspaces). When the list is empty, the
  // delete button is shown; otherwise we render an inline "you must
  // resolve these first" block with per-workspace settings links.
  const blockingWorkspaces = await getMyBlockingWorkspaces(supabase);
  const email = user.email ?? "";

  return (
    <div className="container">
      <div className="mx-auto max-w-2xl space-y-10 py-12">
        <header className="space-y-3">
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
            Account
          </p>
          <h1 className="text-[40px] font-semibold tracking-[-0.8px] leading-[1.1] text-foreground">
            Account settings
          </h1>
        </header>

        <AccountForm
          initialFullName={fullName}
          initialEmail={user.email ?? ""}
        />

        <section className="space-y-3 rounded-2xl border border-border bg-card p-6 shadow-[0_2px_4px_rgba(0,0,0,0.03)]">
          <h2 className="text-[16px] font-medium text-foreground">
            Delete account
          </h2>
          <p className="text-[14px] text-muted-foreground">
            Permanently delete your Authently account. Workspaces you solely
            own will be removed; shared workspaces you own must be transferred
            or have other members removed first.
          </p>
          {blockingWorkspaces.length > 0 ? (
            <div
              role="note"
              className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-[13px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <p className="font-medium">
                Resolve these workspaces before deleting your account:
              </p>
              <ul className="space-y-1">
                {blockingWorkspaces.map((ws) => (
                  <li key={ws.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">{ws.name}</span>
                    <Link
                      href={`/app/${ws.slug}/settings`}
                      className="shrink-0 text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
                    >
                      Open settings →
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-amber-900/80 dark:text-amber-200/80">
                Either transfer ownership to another member or remove the
                other members. Once each listed workspace is resolved, this
                section will offer the delete button.
              </p>
            </div>
          ) : (
            <DeleteAccountButton email={email} />
          )}
        </section>
      </div>
    </div>
  );
}
