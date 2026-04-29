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
            Permanently delete your Authently account and all data.
            Available in a future release.
          </p>
          <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
            Coming soon
          </span>
        </section>
      </div>
    </div>
  );
}
