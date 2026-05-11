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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteSourceAction } from "./delete-action";

// Sprint 07 C3.3 — delete confirmation modal. Pattern follows
// delete-workspace-dialog.tsx + delete-account-dialog.tsx (Sprint 04 A1/A3
// precedents) minus the typed-name confirmation gate — spec E6b doesn't
// require typed-name confirmation, just a confirmation modal.
//
// Refresh discipline: on successful delete, call router.refresh() so the
// list page server component re-fetches and the soft-deleted row drops
// out (via the `deleted_at IS NULL` filter in listSources). This is the
// same router.refresh() primitive C3.2's polling effect uses; the spec's
// "Row disappears from list on next refresh" line (SPRINT_07.md:404) is
// satisfied immediately rather than via the polling tick.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: string;
  sourceTitle: string;
};

export function DeleteSourceDialog({
  open,
  onOpenChange,
  sourceId,
  sourceTitle,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function reset() {
    setError(null);
    setIsPending(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const result = await deleteSourceAction(formData);

    if (!result.ok) {
      setError(result.error);
      setIsPending(false);
      return;
    }

    onOpenChange(false);
    reset();
    router.refresh();
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
          <DialogTitle>Delete source</DialogTitle>
          <DialogDescription>
            This will remove{" "}
            <span className="font-medium text-foreground">{sourceTitle}</span>{" "}
            from your sources. This action cannot be undone from the UI.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <input type="hidden" name="sourceId" value={sourceId} />
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
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
