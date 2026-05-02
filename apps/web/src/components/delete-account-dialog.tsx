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

// Sprint 04 A3 — delete-account confirmation dialog. Typed-email
// confirmation pattern (matches A1's typed-name dialog, A2's typed-name
// transfer dialog). β-policy gating happens upstream — the account page
// only renders this dialog (via DeleteAccountButton) when there are no
// blocking workspaces. The worker's blocking check remains the security
// floor against TOCTOU.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
};

export function DeleteAccountDialog({ open, onOpenChange, email }: Props) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const canDelete = typed === email && !isPending;

  function reset() {
    setTyped("");
    setError(null);
    setIsPending(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDelete) return;

    setError(null);
    setIsPending(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        redirectTo?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't delete account.");
      }
      toast.success("Account deleted.");
      router.push(body.redirectTo ?? "/");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't delete account.",
      );
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending && !next) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This will permanently delete your Authently account. Workspaces
            you solely own will be removed; you&apos;ll be signed out from
            this browser. This action cannot be undone from the UI.
          </DialogDescription>
        </DialogHeader>
        <div
          role="note"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
        >
          Note: this does not cancel your billing — workspaces you delete
          continue to bill until you cancel them in Stripe.
        </div>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="confirm-account-email">
              Type{" "}
              <span className="font-medium text-foreground">{email}</span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-account-email"
              name="confirmAccountEmail"
              type="email"
              required
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={email}
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
          {error ? (
            <p role="alert" className="text-[14px] text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!canDelete}>
              {isPending ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
