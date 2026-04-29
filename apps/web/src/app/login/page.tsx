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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/app");
  }

  return (
    <div className="container">
      <div className="mx-auto max-w-md space-y-8 py-20">
        <div className="space-y-2">
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
            Welcome back
          </p>
          <h1 className="text-[32px] font-semibold tracking-[-0.4px] leading-[1.15] text-foreground">
            Sign in to Authently
          </h1>
        </div>
        <SignInForm />
        <p className="text-[14px] text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/sign-up"
            className="font-medium text-foreground transition hover:text-brand"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
