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

// Sprint 04 A2 — cancel-pending-transfer client trigger. Reused by:
//   - Owner cancelling their own outgoing transfer (settings page status)
//   - Target declining an incoming transfer (settings page status; the
//     full-width banner has its own decline button alongside the accept)

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  workspaceSlug: string;
  label: string;
  successMessage: string;
  variant?: "destructive" | "ghost";
};

export function CancelTransferButton({
  workspaceSlug,
  label,
  successMessage,
  variant = "ghost",
}: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function onClick() {
    setIsPending(true);
    try {
      const res = await fetch(
        `/api/ws/${workspaceSlug}/ownership-transfer/cancel`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't cancel transfer.");
      }
      toast.success(successMessage);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't cancel transfer.",
      );
      setIsPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={isPending}
    >
      {isPending ? "Working…" : label}
    </Button>
  );
}
