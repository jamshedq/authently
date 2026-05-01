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

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ButtonVariant = "default" | "ghost" | "destructive";

type Props = {
  workspaceSlug: string;
  /** Visual variant. 'default' for settings page; 'banner' for past-due banner inline use. */
  variant?: ButtonVariant | "banner";
  className?: string;
  children?: React.ReactNode;
};

/**
 * Posts to /api/ws/[slug]/billing/portal and redirects to the returned
 * Stripe Customer Portal URL. Disabled while the request is in flight to
 * prevent double-submit; the spinner-style label is per the UX guideline
 * "Redirecting..." during the 1-2s round-trip while Stripe builds the session.
 */
export function ManageBillingButton({
  workspaceSlug,
  variant = "default",
  className,
  children,
}: Props): React.ReactElement {
  const [loading, setLoading] = useState(false);

  const buttonVariant: ButtonVariant = variant === "banner" ? "default" : variant;

  async function handleClick(): Promise<void> {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ws/${workspaceSlug}/billing/portal`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      if (!res.ok) {
        const body = await safeJson(res);
        if (body && body.error === "NOT_SUBSCRIBED") {
          toast.error("Subscribe to a paid plan first.");
        } else {
          toast.error(
            (body && body.message) ??
              "Could not open the billing portal. Please try again.",
          );
        }
        setLoading(false);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        toast.error("Billing portal returned no URL. Please try again.");
        setLoading(false);
        return;
      }
      window.location.href = body.url;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not open the billing portal. Please try again.",
      );
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant={buttonVariant}
      className={className}
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? "Redirecting…" : (children ?? "Manage billing")}
    </Button>
  );
}

async function safeJson(res: Response): Promise<{ error?: string; message?: string } | null> {
  try {
    return (await res.json()) as { error?: string; message?: string };
  } catch {
    return null;
  }
}
