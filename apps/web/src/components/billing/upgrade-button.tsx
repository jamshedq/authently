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

type Props = {
  workspaceSlug: string;
  tier: "solo" | "studio";
  /** Optional className passthrough for the settings page vs pricing page styling. */
  className?: string;
  children?: React.ReactNode;
};

/**
 * Posts to /api/ws/[slug]/billing/checkout with the requested tier and
 * redirects to Stripe Checkout. On 409 ALREADY_SUBSCRIBED the body
 * indicates the workspace's current planTier — we surface a tailored
 * toast pointing at the Customer Portal.
 */
export function UpgradeButton({
  workspaceSlug,
  tier,
  className,
  children,
}: Props): React.ReactElement {
  const [loading, setLoading] = useState(false);

  async function handleClick(): Promise<void> {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ws/${workspaceSlug}/billing/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        },
      );
      if (res.status === 409) {
        const body = (await res.json()) as {
          planTier?: string;
          portalAvailable?: boolean;
        };
        toast.message(
          `You're already on ${prettyTier(body.planTier)}.`,
          {
            description: body.portalAvailable
              ? "Use Manage billing to change plans."
              : "Manage your subscription via the Customer Portal.",
          },
        );
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const body = await safeJson(res);
        toast.error(
          (body && body.message) ??
            "Could not start checkout. Please try again.",
        );
        setLoading(false);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        toast.error("Checkout returned no URL. Please try again.");
        setLoading(false);
        return;
      }
      window.location.href = body.url;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not start checkout. Please try again.",
      );
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? "Redirecting…" : (children ?? `Upgrade to ${prettyTier(tier)}`)}
    </Button>
  );
}

function prettyTier(tier?: string): string {
  if (tier === "solo") return "Solo";
  if (tier === "studio") return "Studio";
  if (tier === "free") return "Free";
  return tier ?? "the plan";
}

async function safeJson(res: Response): Promise<{ message?: string } | null> {
  try {
    return (await res.json()) as { message?: string };
  } catch {
    return null;
  }
}
