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

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  UpdateEmailSchema,
  UpdateFullNameSchema,
} from "@/lib/schemas/account";

type Props = {
  initialFullName: string;
  initialEmail: string;
};

export function AccountForm({ initialFullName, initialEmail }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialFullName);
  const [email, setEmail] = useState(initialEmail);
  const [emailPendingNotice, setEmailPendingNotice] = useState<string | null>(
    null,
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [namePending, setNamePending] = useState(false);
  const [emailPending, setEmailPending] = useState(false);

  async function handleNameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameError(null);

    const parsed = UpdateFullNameSchema.safeParse({ fullName });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }

    setNamePending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({
        data: { full_name: parsed.data.fullName },
      });
      if (error) throw error;
      toast.success("Name updated");
      // Refresh so the header avatar/initials reflect the new name.
      router.refresh();
    } catch (err) {
      setNameError(
        err instanceof Error ? err.message : "Couldn't update name.",
      );
    } finally {
      setNamePending(false);
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError(null);
    setEmailPendingNotice(null);

    const parsed = UpdateEmailSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? "Invalid email");
      return;
    }

    if (parsed.data.email === initialEmail) {
      setEmailError("That's already your current email.");
      return;
    }

    setEmailPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({
        email: parsed.data.email,
      });
      if (error) throw error;
      setEmailPendingNotice(parsed.data.email);
      toast.success("Confirmation email sent");
    } catch (err) {
      setEmailError(
        err instanceof Error ? err.message : "Couldn't update email.",
      );
    } finally {
      setEmailPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleNameSubmit}
        className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-[0_2px_4px_rgba(0,0,0,0.03)]"
        noValidate
      >
        <div className="space-y-1">
          <h2 className="text-[16px] font-medium text-foreground">
            Display name
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Shown in your avatar initials and anywhere your name appears in
            the app.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        {nameError ? (
          <p role="alert" className="text-[14px] text-destructive">
            {nameError}
          </p>
        ) : null}
        <Button type="submit" disabled={namePending}>
          {namePending ? "Saving…" : "Save name"}
        </Button>
      </form>

      <form
        onSubmit={handleEmailSubmit}
        className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-[0_2px_4px_rgba(0,0,0,0.03)]"
        noValidate
      >
        <div className="space-y-1">
          <h2 className="text-[16px] font-medium text-foreground">Email</h2>
          <p className="text-[13px] text-muted-foreground">
            Changing your email sends a confirmation link to the new
            address. Your sign-in email stays the same until you click it.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {emailPendingNotice ? (
          <p
            role="status"
            className="rounded-2xl border border-border bg-muted/40 p-4 text-[13px] text-foreground"
          >
            Check your inbox at <strong>{emailPendingNotice}</strong> to
            confirm the change. Your sign-in email stays as{" "}
            <strong>{initialEmail}</strong> until then.
          </p>
        ) : null}
        {emailError ? (
          <p role="alert" className="text-[14px] text-destructive">
            {emailError}
          </p>
        ) : null}
        <Button type="submit" disabled={emailPending}>
          {emailPending ? "Saving…" : "Update email"}
        </Button>
      </form>
    </div>
  );
}
