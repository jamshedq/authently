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

// Skeleton mirroring account/page.tsx — eyebrow + h1 + form fields stack.
export default function AccountLoading(): React.ReactElement {
  return (
    <div className="container">
      <div
        className="mx-auto max-w-2xl space-y-10 py-12"
        role="status"
        aria-label="Loading account"
      >
        <header className="space-y-3 animate-pulse">
          <div className="h-3 w-16 rounded bg-muted" />
          <div className="h-9 w-1/2 rounded bg-muted" />
        </header>

        <div className="space-y-6 rounded-2xl border border-border bg-card p-6 animate-pulse">
          <div className="space-y-2">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-10 w-full rounded-md bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-10 w-full rounded-md bg-muted" />
          </div>
          <div className="h-9 w-32 rounded-full bg-muted" />
        </div>
      </div>
    </div>
  );
}
