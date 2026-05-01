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

// Workspace-scoped 404. Renders inside the workspace layout so the header
// and past-due banner remain in place — the user stays oriented in their
// workspace context. Hit by unmatched sub-routes under /app/[workspaceSlug]/*
// or by notFound() throws from workspace-scoped Server Components.
//
// Next.js App Router does not pass `params` to not-found.tsx, so the CTA
// can't deep-link to the current workspace's dashboard with a slug. The
// fallback /app uses the existing cookie-aware redirect at
// apps/web/src/app/app/page.tsx — that re-resolves to the user's last
// workspace, which for this caller is virtually always the one they were
// just in.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Page not found — Authently",
};

export default function WorkspaceNotFound(): React.ReactElement {
  return (
    <section className="container mx-auto max-w-2xl px-6 py-24 md:py-32">
      <p className="font-mono text-[12px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
        Page not found
      </p>
      <h1 className="mt-4 text-[40px] font-semibold leading-[1.1] tracking-[-0.8px] text-foreground">
        We can&rsquo;t find that page.
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-[#666666]">
        That route doesn&rsquo;t exist in this workspace. The link may be broken
        or the page may have moved.
      </p>

      <div className="mt-8">
        <Button asChild className="rounded-full">
          <Link href="/app">Return to your workspace</Link>
        </Button>
      </div>
    </section>
  );
}
