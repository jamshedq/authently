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

// Section B1 — workspace creation dialog. Reused by:
//   - UserMenu (Header) via the "+ Create new workspace" item
//   - EmptyWorkspaceState (/app empty branch) via the primary CTA
//
// State is fully local: open/closed is controlled by the parent via
// `open` + `onOpenChange`. On submit, POSTs to /api/workspaces and on
// success navigates to /app/{newSlug}/dashboard, then router.refresh()
// so the Header's server-component memberships fetch picks up the new
// workspace on next render.

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
import { CreateWorkspaceSchema } from "@/lib/schemas/workspaces";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateWorkspaceDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function reset() {
    setName("");
    setError(null);
    setIsPending(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = CreateWorkspaceSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        workspace?: { slug?: string; name?: string };
      };
      if (!res.ok || !body.ok || !body.workspace?.slug) {
        throw new Error(body.error ?? "Couldn't create workspace.");
      }
      toast.success(`Created "${body.workspace.name ?? parsed.data.name}"`);
      onOpenChange(false);
      reset();
      router.push(`/app/${body.workspace.slug}/dashboard`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't create workspace.",
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
          <DialogTitle>Create new workspace</DialogTitle>
          <DialogDescription>
            Workspaces keep content, settings, and members separate.
            You&apos;ll be the owner of the new workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              name="name"
              type="text"
              required
              maxLength={80}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Studio"
              autoComplete="off"
            />
            <p className="text-[12px] text-muted-foreground">
              Up to 80 characters. The URL will be generated automatically.
            </p>
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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
