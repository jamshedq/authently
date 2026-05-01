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

import { silentMembershipLookup } from "@/lib/api/silent-membership";
import { getBillingState } from "@/services/billing/get-billing-state";
import { formatGracePeriodLabel } from "@/lib/billing/grace-period";
import { ManageBillingButton } from "./manage-billing-button";

type Props = {
  workspaceSlug: string;
};

/**
 * Site-wide nag banner for past_due workspaces. Lives in the workspace
 * layout so it appears across dashboard, settings, members, etc. Returns
 * null in all the "not actionable" cases so layouts can render it
 * unconditionally.
 *
 * Edge case: a past_due workspace with no stripe_customer_id has no
 * Customer Portal to redirect to — Stripe rejects portal-session creation
 * without a customer. This shouldn't happen in normal flow (customer is
 * pre-created at first checkout, see services/billing/create-checkout-session),
 * but data could exist from a Sprint 01 manual seed or an interrupted
 * flow. Surface a "contact support" CTA in that case so the user has SOME
 * recovery path. Real support email is Sprint 12 prep; placeholder mailto
 * for now.
 */
export async function PastDueBanner({ workspaceSlug }: Props): Promise<React.ReactElement | null> {
  const ctx = await silentMembershipLookup(workspaceSlug);
  if (!ctx) return null;

  const billing = await getBillingState(ctx.supabase, ctx.workspace.id);
  if (!billing || billing.subscription_status !== "past_due") return null;

  const remaining = formatGracePeriodLabel(
    billing.past_due_since ? new Date(billing.past_due_since) : null,
  );
  const hasCustomer = Boolean(billing.stripe_customer_id);

  return (
    <div
      className="border-b border-red-200 bg-red-50 px-6 py-3 text-[13px] text-red-900"
      role="status"
      aria-live="polite"
    >
      <div className="container flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="leading-snug">
          <strong>Payment failed.</strong> Update your billing to keep your
          subscription. <strong>Auto-downgrades to Free {remaining === "today" ? "today" : `in ${remaining}`}</strong>{" "}
          if not resolved.
          <span
            className="ml-1 cursor-help underline-offset-2 hover:underline"
            title="Calculated from the day your payment first failed"
          >
            (?)
          </span>
        </p>
        {hasCustomer ? (
          <ManageBillingButton
            workspaceSlug={workspaceSlug}
            variant="banner"
            className="shrink-0"
          />
        ) : (
          <a
            href="mailto:support@authently.io?subject=Past-due%20workspace%20without%20Stripe%20customer"
            className="shrink-0 rounded-full bg-red-900 px-4 py-1.5 text-[13px] font-medium text-white transition hover:opacity-90"
          >
            Contact support
          </a>
        )}
      </div>
    </div>
  );
}
