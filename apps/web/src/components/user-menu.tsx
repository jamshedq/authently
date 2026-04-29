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

// Header user menu (Section A3). Avatar trigger + dropdown of user info,
// account settings link, and sign-out. Workspace switcher (Section B1)
// will land between the user-info block and the divider; the comment
// below marks the insertion point.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { colorFromUserId } from "@/lib/avatar/color-from-user-id";
import { initialsFromUser } from "@/lib/avatar/initials-from-user";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Props = {
  userId: string;
  email: string;
  fullName: string | null;
};

export function UserMenu({ userId, email, fullName }: Props) {
  const router = useRouter();
  const initials = initialsFromUser({ fullName, email });
  const colorClasses = colorFromUserId(userId);
  const displayName = fullName ?? email;

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

  return (
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
        className="w-64 rounded-2xl border-border/60 bg-popover p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
      >
        <div className="px-3 py-2.5">
          <p className="truncate text-[14px] font-medium text-foreground">
            {displayName}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            {email}
          </p>
        </div>

        {/* TODO(sprint-02-B1): workspace switcher inserts here — list of
            memberships from /api/me, plus "Create new workspace" trigger. */}

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
  );
}
