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

// One row in the members table. Renders the member's identity + role
// pill + actor-conditional controls:
//   - Role dropdown: visible when the actor can change THIS target.
//     Owner can change any non-owner. Admin can ONLY change editor↔viewer.
//   - Remove button: same matrix as the dropdown.
//   - Leave button: visible only on the actor's own row.
//
// Last-owner protection: if `isLastOwner` is true on the actor's own
// row, the leave button is disabled with a tooltip.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WorkspaceRole } from "@authently/shared";

type AssignableRole = "admin" | "editor" | "viewer";

type Props = {
  workspaceSlug: string;
  workspaceName: string;
  member: {
    userId: string;
    role: WorkspaceRole;
    email: string | null;
    fullName: string | null;
    joinedAt: string;
  };
  /** Role of the user viewing the page (i.e. the "actor"). */
  actorRole: WorkspaceRole;
  /** True when the actor is the user this row represents. */
  isSelf: boolean;
  /** True when the actor is the only owner of this workspace. */
  isLastOwner: boolean;
};

const ROLE_PILL_CLASS: Record<WorkspaceRole, string> = {
  owner: "bg-brand-light text-brand-deep",
  admin: "bg-muted text-foreground",
  editor: "bg-muted text-foreground",
  viewer: "bg-muted text-muted-foreground",
};

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

function canAssign(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  isSelf: boolean,
): { canChangeRole: boolean; canRemove: boolean; allowed: AssignableRole[] } {
  // Self-row never offers role-change or remove (use leave instead).
  if (isSelf) return { canChangeRole: false, canRemove: false, allowed: [] };

  // Owner targets are out of bounds for everyone here — the ownership
  // transfer flow (Sprint 04 A2) handles owner role changes.
  if (targetRole === "owner") {
    return { canChangeRole: false, canRemove: false, allowed: [] };
  }

  if (actorRole === "owner") {
    return {
      canChangeRole: true,
      canRemove: true,
      allowed: ["admin", "editor", "viewer"],
    };
  }

  if (actorRole === "admin") {
    // Admins can only touch editor / viewer.
    if (targetRole === "admin") {
      return { canChangeRole: false, canRemove: false, allowed: [] };
    }
    return {
      canChangeRole: true,
      canRemove: true,
      allowed: ["editor", "viewer"],
    };
  }

  // editor / viewer
  return { canChangeRole: false, canRemove: false, allowed: [] };
}

export function MemberRow({
  workspaceSlug,
  workspaceName,
  member,
  actorRole,
  isSelf,
  isLastOwner,
}: Props) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<
    "role" | "remove" | "leave" | null
  >(null);
  const [currentRole, setCurrentRole] = useState<WorkspaceRole>(member.role);

  const { canChangeRole, canRemove, allowed } = canAssign(
    actorRole,
    currentRole,
    isSelf,
  );

  const displayName = member.fullName ?? member.email ?? "Unknown";

  async function changeRole(next: AssignableRole) {
    if (next === currentRole) return;
    setPendingAction("role");
    try {
      const res = await fetch(
        `/api/ws/${encodeURIComponent(workspaceSlug)}/members/${member.userId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: next }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't change role.");
      }
      setCurrentRole(next);
      toast.success(`${displayName} is now ${ROLE_LABEL[next]}`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't change role.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function remove() {
    setPendingAction("remove");
    try {
      const res = await fetch(
        `/api/ws/${encodeURIComponent(workspaceSlug)}/members/${member.userId}`,
        { method: "DELETE" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't remove member.");
      }
      toast.success(`Removed ${displayName}`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't remove member.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function leave() {
    setPendingAction("leave");
    try {
      const res = await fetch(
        `/api/ws/${encodeURIComponent(workspaceSlug)}/members/me`,
        { method: "DELETE" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't leave workspace.");
      }
      toast.success(`Left ${workspaceName}`);
      router.refresh();
      router.push("/app");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't leave workspace.",
      );
      setPendingAction(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-foreground">
          {displayName}
          {isSelf ? (
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">
              (you)
            </span>
          ) : null}
        </p>
        {member.fullName && member.email ? (
          <p className="truncate text-[12px] text-muted-foreground">
            {member.email}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {canChangeRole && allowed.length > 0 ? (
          <select
            value={currentRole}
            onChange={(e) => changeRole(e.target.value as AssignableRole)}
            disabled={pendingAction !== null}
            className="h-8 rounded-full border border-input bg-background px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
          >
            {allowed.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          <span
            className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.6px] ${ROLE_PILL_CLASS[currentRole]}`}
          >
            {ROLE_LABEL[currentRole]}
          </span>
        )}

        {canRemove ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={pendingAction !== null}
            className="text-[13px] text-muted-foreground hover:text-destructive"
          >
            {pendingAction === "remove" ? "Removing…" : "Remove"}
          </Button>
        ) : null}

        {isSelf ? (
          isLastOwner ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button variant="ghost" size="sm" disabled className="text-[13px]">
                      Leave
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Last owner — transfer ownership first via Workspace settings.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={leave}
              disabled={pendingAction !== null}
              className="text-[13px] text-muted-foreground hover:text-destructive"
            >
              {pendingAction === "leave" ? "Leaving…" : "Leave"}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
