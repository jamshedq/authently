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

import { AppError } from "@authently/shared";
import type { AuthentlyServerClient } from "@/lib/supabase/server";

export type WorkspaceSettingsView = {
  id: string;
  name: string;
  slug: string;
  template: "creator" | "smb" | "community";
  planTier: string;
  createdAt: string;
  memberCount: number;
  subscriptionStatus: "active" | "past_due" | "canceled";
  subscriptionCurrentPeriodEnd: string | null;
  pastDueSince: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

/**
 * Read the extra columns the settings page needs on top of what
 * `requireMembership` already returned: the timestamp, member count, and
 * the billing-state fields used to drive the Section D billing UI.
 *
 * `count: 'exact'` runs a separate COUNT(*) under the same RLS predicate;
 * it's cheap because workspace_members has the user_id index from
 * migration 1.
 */
export async function getWorkspaceForSettings(
  supabase: AuthentlyServerClient,
  workspaceId: string,
): Promise<{
  createdAt: string;
  memberCount: number;
  subscriptionStatus: "active" | "past_due" | "canceled";
  subscriptionCurrentPeriodEnd: string | null;
  pastDueSince: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}> {
  const [workspaceRes, memberRes] = await Promise.all([
    supabase
      .from("workspaces")
      .select(
        "created_at, subscription_status, subscription_current_period_end, past_due_since, stripe_customer_id, stripe_subscription_id",
      )
      .eq("id", workspaceId)
      .maybeSingle<{
        created_at: string;
        subscription_status: "active" | "past_due" | "canceled";
        subscription_current_period_end: string | null;
        past_due_since: string | null;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
      }>(),
    supabase
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);

  if (workspaceRes.error) throw workspaceRes.error;
  if (!workspaceRes.data) {
    throw new AppError({
      code: "WORKSPACE_NOT_VISIBLE",
      message: "Workspace not visible to caller",
      statusCode: 403,
    });
  }
  if (memberRes.error) throw memberRes.error;

  const w = workspaceRes.data;
  return {
    createdAt: w.created_at,
    memberCount: memberRes.count ?? 0,
    subscriptionStatus: w.subscription_status,
    subscriptionCurrentPeriodEnd: w.subscription_current_period_end,
    pastDueSince: w.past_due_since,
    stripeCustomerId: w.stripe_customer_id,
    stripeSubscriptionId: w.stripe_subscription_id,
  };
}
