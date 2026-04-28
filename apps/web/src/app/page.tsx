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

// Server Component. Sprint 01 placeholder landing page — minimal copy plus
// sign-in / sign-up CTAs so users coming back via /api/auth/sign-out (which
// redirects here) have an obvious path back into the app.
type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function HomePage({ searchParams }: Props) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-12">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Authently</h1>
        <p className="text-base text-muted-foreground">
          Your voice, your platforms, your keys.
        </p>
        <p className="text-sm text-muted-foreground">
          Open-source, multi-tenant AI content engine. Sprint 01 — foundation
          in progress.
        </p>
      </div>

      {error === "no_workspace_access" ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          You&apos;re not a member of that workspace, or it doesn&apos;t exist.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/login"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
