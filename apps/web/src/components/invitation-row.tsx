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

// Pending invitation row. Rendered for all workspace members; the
// "Revoke" button is conditional on owner/admin.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  workspaceSlug: string;
  invitation: {
    id: string;
    email: string;
    role: "admin" | "editor" | "viewer";
    expiresAt: string;
    createdAt: string;
  };
  canRevoke: boolean;
};

const ROLE_LABEL: Record<Props["invitation"]["role"], string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

function formatRelativeFuture(iso: string): string {
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days >= 1) return `Expires in ${days}d`;
  const hours = Math.round(ms / (1000 * 60 * 60));
  if (hours >= 1) return `Expires in ${hours}h`;
  return "Expires soon";
}

export function InvitationRow({ workspaceSlug, invitation, canRevoke }: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function revoke() {
    setIsPending(true);
    try {
      const res = await fetch(
        `/api/ws/${encodeURIComponent(workspaceSlug)}/invitations/${invitation.id}`,
        { method: "DELETE" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't revoke invitation.");
      }
      toast.success(`Revoked invitation to ${invitation.email}`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't revoke invitation.",
      );
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-foreground">
          {invitation.email}
        </p>
        <p className="truncate text-[12px] text-muted-foreground">
          {ROLE_LABEL[invitation.role]} · {formatRelativeFuture(invitation.expiresAt)}
        </p>
      </div>
      {canRevoke ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={revoke}
          disabled={isPending}
          className="text-[13px] text-muted-foreground hover:text-destructive"
        >
          {isPending ? "Revoking…" : "Revoke"}
        </Button>
      ) : null}
    </div>
  );
}
