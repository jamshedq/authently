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

// Skeleton mirroring dashboard/page.tsx — eyebrow + h1 + 3-card stat grid.
// Pulses via animate-pulse to signal "loading" while the Server Component
// runs auth + workspace lookup.
export default function DashboardLoading(): React.ReactElement {
  return (
    <div className="container">
      <div
        className="mx-auto max-w-3xl space-y-10 py-12"
        role="status"
        aria-label="Loading dashboard"
      >
        <header className="space-y-3 animate-pulse">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-9 w-2/3 rounded bg-muted" />
        </header>

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-border bg-card p-6 shadow-[0_2px_4px_rgba(0,0,0,0.03)]"
            >
              <div className="h-3 w-16 rounded bg-muted" />
              <div className="mt-3 h-5 w-3/4 rounded bg-muted" />
            </div>
          ))}
        </dl>

        <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}
