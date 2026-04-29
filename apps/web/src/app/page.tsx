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

// Server Component. Sprint 01 placeholder landing page styled per DESIGN.md
// §4 "Atmospheric Hero" — green-to-white radial wash behind the headline,
// dark pill primary + ghost pill secondary CTAs, tight display tracking.
type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function HomePage({ searchParams }: Props) {
  const { error } = await searchParams;

  return (
    <section className="relative overflow-hidden">
      {/* Atmospheric green-white radial gradient (DESIGN.md §4) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,hsl(var(--brand)/0.12)_0%,hsl(var(--brand)/0.04)_30%,transparent_70%)]"
      />

      <div className="container">
        <div className="mx-auto max-w-2xl space-y-8 pb-24 pt-24 lg:pt-32">
          {/* Mono section label */}
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
            Sprint 01 — Foundation
          </p>

          <div className="space-y-5">
            <h1 className="text-[40px] font-semibold tracking-[-0.8px] leading-[1.1] text-foreground lg:text-[64px] lg:tracking-[-1.28px] lg:leading-[1.15]">
              Authently
            </h1>
            <p className="max-w-xl text-[18px] leading-[1.5] text-muted-foreground">
              Your voice, your platforms, your keys.
            </p>
            <p className="max-w-xl text-[16px] leading-[1.5] text-muted-foreground">
              Open-source, multi-tenant AI content engine for technical
              creators. Built in public, AGPL core, no vendor lock-in.
            </p>
          </div>

          {error === "no_workspace_access" ? (
            <div
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-[14px] text-destructive"
            >
              You&apos;re not a member of that workspace, or it doesn&apos;t exist.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/sign-up">Sign up</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
