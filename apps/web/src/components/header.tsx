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

// Server Component — no nav yet (S02 brings the workspace switcher).
export function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="text-sm font-medium tracking-tight">
          Authently
        </Link>
        <span className="text-xs text-muted-foreground">alpha</span>
      </div>
    </header>
  );
}
