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

import type { AuthentlyServerClient } from "@/lib/supabase/server";

export type BillingState = {
  plan_tier: "free" | "solo" | "studio";
  subscription_status: "active" | "past_due" | "canceled";
  subscription_current_period_end: string | null;
  past_due_since: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

/**
 * Read the billing-relevant columns for a workspace via the caller's
 * RLS-subject client. Used by the settings page, the past-due banner,
 * and the checkout/portal route handlers (after withMembership has
 * already authorized the caller).
 *
 * RLS gating: members of the workspace can SELECT it via the
 * `workspaces_member_select` policy from migration 1, and the column
 * grants in migration 20260429213717 expose all six fields below to
 * authenticated readers. Service-role bypasses RLS as usual.
 */
export async function getBillingState(
  supabase: AuthentlyServerClient,
  workspaceId: string,
): Promise<BillingState | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select(
      "plan_tier, subscription_status, subscription_current_period_end, past_due_since, stripe_customer_id, stripe_subscription_id",
    )
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return data as BillingState;
}
