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

// Header user menu (Section A3 + Section B1). Avatar trigger drops a
// dropdown of:
//   - user info (name + email)
//   - WORKSPACES label + list of memberships (current one check-marked)
//   - "+ Create new workspace" → opens CreateWorkspaceDialog
//   - divider
//   - "Account settings" link
//   - "Sign out" item
//
// Section A fix preserved: sign-out (and "Create new workspace") use
// onSelect rather than nested forms — Radix unmounts the dropdown on
// close, which would cancel any in-flight form submission.
//
// The dialog state lives on this component (not inside DropdownMenuContent),
// because Radix unmounts content on close. Opening the dialog from inside
// the dropdown closes the dropdown first; the dialog renders into a portal
// and is unaffected.

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";
import { cn } from "@/lib/utils";
import { colorFromUserId } from "@/lib/avatar/color-from-user-id";
import { initialsFromUser } from "@/lib/avatar/initials-from-user";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Membership = {
  role: "owner" | "admin" | "editor" | "viewer";
  workspaceSlug: string;
  workspaceName: string;
};

type Props = {
  userId: string;
  email: string;
  fullName: string | null;
  memberships: readonly Membership[];
};

// Extract the workspace slug from /app/[slug]/... — null when the user
// isn't inside a workspace-scoped route (e.g. on /, /app, or /pricing).
function currentSlugFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "app" || !parts[1]) return null;
  return parts[1];
}

export function UserMenu({ userId, email, fullName, memberships }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const initials = initialsFromUser({ fullName, email });
  const colorClasses = colorFromUserId(userId);
  const displayName = fullName ?? email;
  const currentSlug = currentSlugFromPath(pathname);
  const [createOpen, setCreateOpen] = useState(false);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Sign-out failed. Try again.");
      return;
    }
    toast.success("Signed out");
    // router.refresh() flushes any cached Server Component output
    // (including the Header's user-vs-anonymous branch) before we
    // navigate. Mirrors the sign-in form's post-auth pattern.
    router.refresh();
    router.push("/");
  }

  function handleSwitchWorkspace(slug: string) {
    if (slug === currentSlug) return;
    router.push(`/app/${slug}/dashboard`);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Open user menu"
          className="rounded-full outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <Avatar className="h-9 w-9">
            <AvatarFallback
              className={cn(
                "text-[13px] font-medium leading-none",
                colorClasses,
              )}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-72 rounded-2xl border-border/60 bg-popover p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
        >
          <div className="px-3 py-2.5">
            <p className="truncate text-[14px] font-medium text-foreground">
              {displayName}
            </p>
            <p className="truncate text-[12px] text-muted-foreground">
              {email}
            </p>
          </div>

          {memberships.length > 0 ? (
            <>
              <div className="px-3 pb-1.5 pt-2">
                <p className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
                  Workspaces
                </p>
              </div>
              {memberships.map((m) => {
                const isCurrent = m.workspaceSlug === currentSlug;
                return (
                  <DropdownMenuItem
                    key={m.workspaceSlug}
                    className="cursor-pointer rounded-lg px-3 py-2 text-[14px]"
                    onSelect={() => handleSwitchWorkspace(m.workspaceSlug)}
                  >
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="truncate">{m.workspaceName}</span>
                      {isCurrent ? (
                        <Check
                          aria-label="Current workspace"
                          className="h-4 w-4 shrink-0 text-brand-deep"
                        />
                      ) : null}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </>
          ) : null}

          <DropdownMenuItem
            className="cursor-pointer rounded-lg px-3 py-2 text-[14px] text-muted-foreground"
            onSelect={() => setCreateOpen(true)}
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create new workspace
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild className="cursor-pointer rounded-lg px-3 py-2 text-[14px]">
            <Link href="/app/account">Account settings</Link>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="cursor-pointer rounded-lg px-3 py-2 text-[14px]"
            onSelect={handleSignOut}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
