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

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

type Props = {
  /** Slug for building the cleaned URL after toast dispatch. */
  workspaceSlug: string;
  /** Plan tier the workspace lands on (read server-side and passed in for the success message). */
  planTier: string;
};

/**
 * Reads ?checkout=success or ?checkout=canceled, dispatches the
 * appropriate sonner toast on first render, then strips the query
 * string via router.replace so a refresh doesn't re-fire the toast.
 *
 * Lives on the settings page because Stripe Checkout redirects users
 * back to /app/[slug]/settings?checkout=… per the success_url / cancel_url
 * configured in services/billing/create-checkout-session.
 */
export function CheckoutRedirectToast({
  workspaceSlug,
  planTier,
}: Props): null {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const status = params.get("checkout");
    if (status !== "success" && status !== "canceled") return;

    if (status === "success") {
      const tierLabel = prettyTier(planTier);
      toast.success(`Subscription started — welcome to ${tierLabel}!`);
    } else {
      toast.message("Checkout canceled. You can subscribe anytime.");
    }

    // Strip the query param so a refresh doesn't re-fire the toast.
    router.replace(`/app/${workspaceSlug}/settings`);
  }, [params, planTier, router, workspaceSlug]);

  return null;
}

function prettyTier(tier: string): string {
  if (tier === "solo") return "Solo";
  if (tier === "studio") return "Studio";
  return tier;
}
