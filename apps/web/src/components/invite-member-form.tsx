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

// Section C — invite-member form. Owner/admin only; rendered
// conditionally by the members page. Posts to
// /api/ws/[slug]/invitations and triggers a server-component refresh
// so the new pending invitation appears in the list immediately.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreateInvitationSchema } from "@/lib/schemas/invitations";

type Role = "admin" | "editor" | "viewer";

type Props = {
  workspaceSlug: string;
  /** The actor's role — gates which roles they can grant in the form. */
  actorRole: "owner" | "admin";
};

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

export function InviteMemberForm({ workspaceSlug, actorRole }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  // Default role: admins can't grant admin → start at editor for them.
  const [role, setRole] = useState<Role>(actorRole === "admin" ? "editor" : "editor");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Admins can ONLY grant editor / viewer (per spec).
  const allowedRoles =
    actorRole === "admin"
      ? ROLE_OPTIONS.filter((r) => r.value !== "admin")
      : ROLE_OPTIONS;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = CreateInvitationSchema.safeParse({ email, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch(
        `/api/ws/${encodeURIComponent(workspaceSlug)}/invitations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        emailDelivered?: boolean;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't send the invitation.");
      }
      const delivered = body.emailDelivered === false ? " (email send failed — share the link manually)" : "";
      toast.success(`Invitation sent to ${parsed.data.email}${delivered}`);
      setEmail("");
      router.refresh();
      setIsPending(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't send the invitation.",
      );
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-[1fr,auto,auto]">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email" className="sr-only">
            Email
          </Label>
          <Input
            id="invite-email"
            type="email"
            required
            placeholder="teammate@example.com"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role" className="sr-only">
            Role
          </Label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="h-10 rounded-full border border-input bg-background px-4 text-[14px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
          >
            {allowedRoles.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Sending…" : "Invite"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[14px] text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
