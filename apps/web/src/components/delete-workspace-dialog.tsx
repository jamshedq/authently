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

// Sprint 04 A1 — workspace soft-delete confirmation dialog. Typed-name
// confirmation pattern (the user types the workspace name to enable the
// destructive button). The billing disclosure copy is locked verbatim
// per Sprint 04 spec §"Decisions locked at pre-flight" #6: soft-delete
// does NOT cancel active Stripe subscriptions, and the user must be
// told before they confirm.

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
  workspaceSlug: string;
  workspaceName: string;
};

export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspaceSlug,
  workspaceName,
}: Props) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const canDelete = typed === workspaceName && !isPending;

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
      const res = await fetch(`/api/ws/${workspaceSlug}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't delete workspace.");
      }
      toast.success(`Deleted "${workspaceName}"`);
      // /app handles both no-memberships (renders EmptyWorkspaceState)
      // and N-memberships (cookie-aware redirect via last_active_at) cases.
      // No need for a separate /app/no-workspace route.
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't delete workspace.",
      );
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't let the user close mid-submit (no orphaned in-flight request).
        if (isPending && !next) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete workspace</DialogTitle>
          <DialogDescription>
            This will remove{" "}
            <span className="font-medium text-foreground">
              {workspaceName}
            </span>{" "}
            and revoke access for all members. This action cannot be undone
            from the UI.
          </DialogDescription>
        </DialogHeader>
        <div
          role="note"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
        >
          Note: this does not cancel your billing — you remain subscribed
          until you manage that separately.
        </div>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="confirm-workspace-name">
              Type{" "}
              <span className="font-medium text-foreground">
                {workspaceName}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-workspace-name"
              name="confirmWorkspaceName"
              type="text"
              required
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={workspaceName}
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
              {isPending ? "Deleting…" : "Delete workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
