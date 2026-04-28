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

// Server Component. Real auth UI lands in Sprint 01 Step 5 alongside the
// post-signup flow. This placeholder satisfies the redirect target from the
// dashboard route.
export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-sm text-muted-foreground">
        Sign-in flow lands in Sprint 01 Step 5. For now, this page exists so
        the dashboard route has somewhere to redirect unauthenticated users.
      </p>
    </div>
  );
}
