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

// /app/[workspaceSlug]/settings — owners + admins only. Editor/viewer
// hit `requireMembership(slug, { roles: ['owner', 'admin'] })` and get
// redirected back to /app/[slug]/dashboard.
//
// Layout is intentionally vertical-prose, not a sidebar. Sprint 02
// scope is small (rename, template, member-count read-out, billing
// placeholder); a sidebar would be premature.

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspaceSettingsForm } from "@/components/workspace-settings-form";
import { CheckoutRedirectToast } from "@/components/billing/checkout-redirect-toast";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { formatGracePeriodLabel } from "@/lib/billing/grace-period";
import { requireMembership } from "@/lib/api/require-membership";
import { getWorkspaceForSettings } from "@/services/workspaces/get-workspace-for-settings";

export const dynamic = "force-dynamic";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  solo: "Solo",
  studio: "Studio",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { supabase, workspace, role } = await requireMembership(workspaceSlug, {
    roles: ["owner", "admin"],
  });

  const stats = await getWorkspaceForSettings(supabase, workspace.id);
  const planLabel = PLAN_LABELS[workspace.planTier] ?? workspace.planTier;
  const isOwner = role === "owner";

  return (
    <main className="container max-w-2xl py-12">
      <div className="space-y-1.5">
        <p className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
          Workspace settings
        </p>
        <h1 className="text-[24px] font-medium leading-tight tracking-[-0.24px] text-foreground">
          {workspace.name}
        </h1>
      </div>

      <div className="mt-10 space-y-12">
        <section className="space-y-6">
          <div>
            <h2 className="text-[18px] font-medium tracking-[-0.18px] text-foreground">
              General
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Update the workspace name and template. The URL slug stays
              the same when you rename.
            </p>
          </div>
          <WorkspaceSettingsForm
            workspaceSlug={workspace.slug}
            initialName={workspace.name}
            initialTemplate={workspace.template}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-[18px] font-medium tracking-[-0.18px] text-foreground">
            Details
          </h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-2xl border border-border/60 bg-muted/30 px-5 py-4 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Workspace ID</dt>
              <dd className="mt-0.5 font-mono text-[12px] text-foreground">
                {workspace.id}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-0.5 text-foreground">
                {formatDate(stats.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Members</dt>
              <dd className="mt-0.5 text-foreground">
                {stats.memberCount}
                {stats.memberCount === 1 ? " member" : " members"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="mt-0.5 text-foreground">{planLabel}</dd>
            </div>
          </dl>
        </section>

        <section className="space-y-3">
          <h2 className="text-[18px] font-medium tracking-[-0.18px] text-foreground">
            Billing
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Manage your subscription, payment method, and invoices.
          </p>

          {stats.subscriptionStatus === "past_due" ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-900">
              <p className="font-medium">Payment failed.</p>
              <p className="mt-1 leading-snug">
                Update your billing to keep your subscription. Auto-downgrades
                to Free{" "}
                {(() => {
                  const label = formatGracePeriodLabel(
                    stats.pastDueSince ? new Date(stats.pastDueSince) : null,
                  );
                  return label === "today" ? "today" : `in ${label}`;
                })()}{" "}
                if not resolved.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
              Current plan: {planLabel}
            </span>
            {stats.subscriptionStatus === "canceled" ? (
              <span className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
                Status: Canceled
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            {stats.stripeCustomerId ? (
              <ManageBillingButton workspaceSlug={workspace.slug} variant="default" />
            ) : (
              <UpgradeButton workspaceSlug={workspace.slug} tier="solo">
                Upgrade to Solo
              </UpgradeButton>
            )}
            {workspace.planTier === "free" && stats.stripeCustomerId ? (
              <UpgradeButton workspaceSlug={workspace.slug} tier="solo">
                Subscribe to Solo
              </UpgradeButton>
            ) : null}
          </div>

          <CheckoutRedirectToast
            workspaceSlug={workspace.slug}
            planTier={workspace.planTier}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-[18px] font-medium tracking-[-0.18px] text-foreground">
            Danger zone
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Workspace deletion and ownership transfer ship in Sprint 03.
          </p>
          <TooltipProvider delayDuration={150}>
            <div className="flex flex-wrap gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button variant="destructive" disabled>
                      Delete workspace
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Available in Sprint 03.</TooltipContent>
              </Tooltip>
              {isOwner ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button variant="ghost" disabled>
                        Transfer ownership
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Available in Sprint 03.</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </TooltipProvider>
        </section>
      </div>
    </main>
  );
}
