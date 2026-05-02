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

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

// Sprint 04 B1 — server-side gate. The session is established by
// /auth/confirm's verifyOtp() before this page renders, so a valid
// arrival has a logged-in user. No session = no valid recovery link;
// send the user back to /forgot-password with the same `?error=invalid_link`
// signal /auth/confirm uses for malformed/expired arrivals.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/forgot-password?error=invalid_link");
  }

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
