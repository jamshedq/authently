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

import { ResetPasswordForm } from "./reset-password-form";

// The form Client Component handles the full state machine — reading
// tokens from the URL fragment, bootstrapping the session, rendering
// the form, and the invalid-link branch. The page is just the layout
// shell so the Mintlify chrome (header, container, hero spacing) is
// consistent with /forgot-password and /login.
export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <div className="container">
      <div className="mx-auto max-w-md space-y-8 py-20">
        <div className="space-y-2">
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
            Reset password
          </p>
          <h1 className="text-[32px] font-semibold tracking-[-0.4px] leading-[1.15] text-foreground">
            Choose a new password
          </h1>
        </div>
        <ResetPasswordForm />
      </div>
    </div>
  );
}
