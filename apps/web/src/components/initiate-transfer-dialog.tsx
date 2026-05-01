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

// Sprint 04 A2 — initiate-ownership-transfer dialog. Owner-only entry
// point at the route layer; this dialog is the single canonical UI for
// picking a target. Pattern: typed-name confirmation (matches A1's
// delete-workspace-dialog for parity), with a target <select> populated
// from the workspace's non-owner members.

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

export type TransferCandidate = {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: "admin" | "editor" | "viewer";
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  workspaceName: string;
  candidates: readonly TransferCandidate[];
};

function candidateLabel(c: TransferCandidate): string {
  const name = c.fullName ?? c.email ?? "Unknown member";
  return c.email && c.fullName ? `${c.fullName} (${c.email})` : name;
}

export function InitiateTransferDialog({
  open,
  onOpenChange,
  workspaceSlug,
  workspaceName,
  candidates,
}: Props) {
  const router = useRouter();
  const [toUserId, setToUserId] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const canSubmit = toUserId !== "" && typed === workspaceName && !isPending;

  function reset() {
    setToUserId("");
    setTyped("");
    setError(null);
    setIsPending(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setIsPending(true);
    try {
      const res = await fetch(
        `/api/ws/${workspaceSlug}/ownership-transfer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ toUserId }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't initiate transfer.");
      }
      toast.success("Transfer initiated. The target must accept to complete.");
      onOpenChange(false);
      reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't initiate transfer.",
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
          <DialogTitle>Transfer workspace ownership</DialogTitle>
          <DialogDescription>
            The target must accept to complete the transfer. You&apos;ll be
            demoted to admin once they accept. You can cancel at any time
            before they accept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="transfer-target">Transfer to</Label>
            {candidates.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No other members yet. Invite someone first, then transfer.
              </p>
            ) : (
              <select
                id="transfer-target"
                value={toUserId}
                onChange={(e) => setToUserId(e.target.value)}
                required
                className="h-10 w-full rounded-full border border-input bg-background px-4 text-[14px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              >
                <option value="" disabled>
                  Pick a member
                </option>
                {candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {candidateLabel(c)} · {c.role}
                  </option>
                ))}
              </select>
            )}
          </div>

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
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={workspaceName}
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={candidates.length === 0}
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
            <Button type="submit" disabled={!canSubmit}>
              {isPending ? "Initiating…" : "Initiate transfer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
