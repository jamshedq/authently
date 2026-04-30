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
import { safeNext } from "@/lib/auth/safe-next";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeNext(params.next ?? null);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    // Already signed in — honour the `next` redirect (e.g. coming from
    // /invite/[token] with the user pre-authed from a different tab).
    redirect(next);
  }

  // Sign-up link preserves `next` so the flow survives the user
  // bouncing between login and sign-up screens.
  const signUpHref = `/sign-up?next=${encodeURIComponent(next)}`;

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
        <SignInForm next={next} />
        <div className="space-y-2 text-[14px] text-muted-foreground">
          <p>
            <Link
              href="/forgot-password"
              className="font-medium text-foreground transition hover:text-brand"
            >
              Forgot password?
            </Link>
          </p>
          <p>
            Don&apos;t have an account?{" "}
            <Link
              href={signUpHref}
              className="font-medium text-foreground transition hover:text-brand"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
