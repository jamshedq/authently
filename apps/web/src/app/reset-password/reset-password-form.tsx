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

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResetPasswordSchema } from "@/lib/schemas/account";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Phase = "processing" | "ready" | "invalid";

export function ResetPasswordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("processing");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Bootstrap: read tokens from URL fragment (Supabase default email
  // template uses implicit flow), establish a session via setSession,
  // then clean the URL so the tokens don't linger in the address bar.
  // If no fragment is present, fall through to checking for an existing
  // session — handles the "user reloaded the page" case.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");

    let cancelled = false;

    async function run() {
      if (accessToken && refreshToken && type === "recovery") {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (setSessionError) {
          setPhase("invalid");
          return;
        }
        // Clear the fragment so tokens aren't sitting in the address bar.
        window.history.replaceState({}, "", window.location.pathname);
        setPhase("ready");
        return;
      }

      // No fragment — maybe the user reloaded after a successful exchange.
      const { data, error: getUserError } = await supabase.auth.getUser();
      if (cancelled) return;
      setPhase(getUserError || !data.user ? "invalid" : "ready");
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = ResetPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't update password.");
      }
      toast.success("Password updated. You're signed in.");
      router.refresh();
      router.push("/app");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't update password.",
      );
      setIsPending(false);
    }
  }

  if (phase === "processing") {
    return (
      <p className="text-[14px] text-muted-foreground">Verifying link…</p>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="space-y-4">
        <p className="text-[14px] text-muted-foreground">
          This reset link is no longer valid — it may have expired or
          already been used. Request a new one to try again.
        </p>
        <Link
          href="/forgot-password"
          className="inline-flex h-9 items-center rounded-full bg-foreground px-4 text-[14px] font-medium text-background transition hover:opacity-90"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <p className="text-[14px] text-muted-foreground">
        Pick something at least 8 characters long. You&apos;ll be signed in
        once it&apos;s saved.
      </p>
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-[14px] text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
