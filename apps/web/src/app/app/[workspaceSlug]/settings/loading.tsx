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

// Skeleton mirroring settings/page.tsx — eyebrow + h1 + workspace-info card +
// billing card.
export default function SettingsLoading(): React.ReactElement {
  return (
    <div className="container">
      <div
        className="mx-auto max-w-3xl space-y-10 py-12"
        role="status"
        aria-label="Loading workspace settings"
      >
        <header className="space-y-3 animate-pulse">
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="h-9 w-2/3 rounded bg-muted" />
        </header>

        <div className="space-y-6 animate-pulse">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="space-y-4 rounded-2xl border border-border bg-card p-6"
            >
              <div className="h-5 w-1/3 rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-5/6 rounded bg-muted" />
              <div className="h-9 w-32 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
