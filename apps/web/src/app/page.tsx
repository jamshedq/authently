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

// Server Component. No-op landing for Sprint 01 — sign-up flow lands in S02.
type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function HomePage({ searchParams }: Props) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Authently</h1>
      <p className="text-muted-foreground">
        Open-source, multi-tenant AI content engine. Sprint 01 — foundation in
        progress.
      </p>
      {error === "no_workspace_access" && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          You&apos;re not a member of that workspace, or it doesn&apos;t exist.
        </div>
      )}
    </div>
  );
}
