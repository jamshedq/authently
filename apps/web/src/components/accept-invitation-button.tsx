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

// Client-side accept button. Posts to /api/invite/[token]/accept and on
// success redirects to the new workspace's dashboard. Backed by the
// server-side api_accept_invitation RPC, which performs the atomic
// claim and email-match check; this component only owns the click +
// toast UX.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  token: string;
  workspaceName: string;
};

export function AcceptInvitationButton({ token, workspaceName }: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch(
        `/api/invite/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        workspaceSlug?: string;
        workspaceName?: string;
      };
      if (!res.ok || !body.ok || !body.workspaceSlug) {
        throw new Error(body.error ?? "Couldn't accept the invitation.");
      }
      toast.success(`Joined ${body.workspaceName ?? workspaceName}`);
      router.refresh();
      router.push(`/app/${body.workspaceSlug}/dashboard`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't accept the invitation.",
      );
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={handleAccept} disabled={isPending} className="w-full">
        {isPending ? "Joining…" : `Join ${workspaceName}`}
      </Button>
      {error ? (
        <p role="alert" className="text-[14px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
