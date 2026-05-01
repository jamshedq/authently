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
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Renders inside the root layout (Header + main), so the brand frame is
// preserved. Server Component — auth state determines which CTA is shown.
// Hit by both notFound() throws from Server Components AND any URL that
// doesn't match a route segment.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Page not found — Authently",
};

export default async function NotFound(): Promise<React.ReactElement> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = Boolean(user);

  return (
    <section className="container mx-auto max-w-2xl px-6 py-24 md:py-32">
      <p className="font-mono text-[12px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
        Page not found
      </p>
      <h1 className="mt-4 text-[40px] font-semibold leading-[1.1] tracking-[-0.8px] text-foreground">
        We can&rsquo;t find that page.
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-[#666666]">
        The link may be broken or the page may have moved. Try heading back to
        your{signedIn ? " dashboard" : " sign-in"}.
      </p>

      <div className="mt-8">
        <Button asChild className="rounded-full">
          {signedIn ? (
            <Link href="/app">Return to dashboard</Link>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </Button>
      </div>
    </section>
  );
}
