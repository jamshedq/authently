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

import { cookies } from "next/headers";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UpgradeCta, type WorkspaceOption } from "./_components/upgrade-cta";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pricing — Authently",
  description: "Authently pricing — Free, Solo, and Studio tiers.",
};

const REPO_URL = "https://github.com/jamshedq/authently";
const LAST_WORKSPACE_COOKIE = "authently_last_workspace_slug";

type Tier = {
  slug: "free" | "solo" | "studio";
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: readonly string[];
  highlight?: boolean;
};

const TIERS: readonly Tier[] = [
  {
    slug: "free",
    name: "Free",
    price: "$0",
    cadence: "self-host or hosted with limits",
    blurb: "The full open-source engine. Bring your own keys. AGPL-3.0.",
    features: [
      "Voice profiles and Authenticity Engine",
      "Self-host the entire stack",
      "Open-source under AGPL-3.0",
      "Community support",
    ],
  },
  {
    slug: "solo",
    name: "Solo",
    price: "$49",
    cadence: "per month",
    blurb: "For individual creators who want hosted convenience without giving up control.",
    features: [
      "Hosted infrastructure, no self-host required",
      "Voice profiles and Authenticity Engine",
      "Email support",
      "Cancel anytime",
    ],
    highlight: true,
  },
  {
    slug: "studio",
    name: "Studio",
    price: "$129",
    cadence: "per month",
    blurb: "For creator teams and SMBs that need shared workspaces and approval workflows.",
    features: [
      "Everything in Solo",
      "Up to 5 team members per workspace",
      "Approval workflows and review queues",
      "Priority email support",
    ],
  },
];

async function loadOwnerContext(): Promise<{
  signedIn: boolean;
  ownerWorkspaces: WorkspaceOption[];
  defaultWorkspaceSlug: string | null;
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { signedIn: false, ownerWorkspaces: [], defaultWorkspaceSlug: null };
  }

  const { data: members } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .eq("role", "owner")
    .returns<Array<{ workspace_id: string; role: string }>>();

  const ownerWorkspaceIds = (members ?? []).map((m) => m.workspace_id);
  let ownerWorkspaces: WorkspaceOption[] = [];
  if (ownerWorkspaceIds.length > 0) {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id, slug, name, plan_tier")
      .in("id", ownerWorkspaceIds)
      .returns<
        Array<{ id: string; slug: string; name: string; plan_tier: string }>
      >();
    ownerWorkspaces = (ws ?? []).map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      role: "owner",
      planTier: w.plan_tier,
    }));
  }

  const cookieStore = await cookies();
  const cookieSlug = cookieStore.get(LAST_WORKSPACE_COOKIE)?.value ?? null;
  const defaultWorkspaceSlug = ownerWorkspaces.find((w) => w.slug === cookieSlug)?.slug ?? null;

  return {
    signedIn: true,
    ownerWorkspaces,
    defaultWorkspaceSlug,
  };
}

export default async function PricingPage(): Promise<React.ReactElement> {
  const { signedIn, ownerWorkspaces, defaultWorkspaceSlug } = await loadOwnerContext();

  return (
    <main className="min-h-screen bg-white">
      {/* Atmospheric green-white gradient hero per DESIGN.md */}
      <div className="bg-gradient-to-b from-emerald-50/60 via-white to-white pb-16 pt-20 md:pb-24 md:pt-28">
        <div className="container mx-auto max-w-5xl px-6 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
            Pricing
          </p>
          <h1 className="mt-4 text-[40px] font-semibold leading-[1.10] tracking-[-0.8px] text-foreground md:text-[56px] md:tracking-[-1.12px]">
            Simple pricing for creators who care about their voice.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[18px] leading-relaxed text-[#666666]">
            Open-source under AGPL-3.0. Hosted by us if you want, self-hosted if
            you don&rsquo;t. Pay only for the convenience, never for the engine.
          </p>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {TIERS.map((tier) => (
            <PricingCard
              key={tier.slug}
              tier={tier}
              signedIn={signedIn}
              ownerWorkspaces={ownerWorkspaces}
              defaultWorkspaceSlug={defaultWorkspaceSlug}
            />
          ))}
        </div>

        <p className="mt-12 text-center text-[13px] text-muted-foreground">
          All paid plans are billed via Stripe. Cancel anytime from your
          workspace settings — no contract, no salespeople.
        </p>
      </div>
    </main>
  );
}

function PricingCard({
  tier,
  signedIn,
  ownerWorkspaces,
  defaultWorkspaceSlug,
}: {
  tier: Tier;
  signedIn: boolean;
  ownerWorkspaces: WorkspaceOption[];
  defaultWorkspaceSlug: string | null;
}): React.ReactElement {
  const isHighlight = Boolean(tier.highlight);

  return (
    <div
      className={`flex flex-col rounded-2xl border bg-white p-6 ${
        isHighlight ? "border-emerald-200 shadow-[rgba(0,0,0,0.03)_0px_2px_8px]" : "border-border/60"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-[20px] font-semibold tracking-[-0.2px] text-foreground">
          {tier.name}
        </h2>
        {isHighlight ? (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.6px] text-emerald-800">
            Most popular
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[36px] font-semibold leading-none tracking-[-0.6px] text-foreground">
          {tier.price}
        </span>
        <span className="text-[13px] text-muted-foreground">{tier.cadence}</span>
      </div>
      <p className="mt-3 text-[14px] leading-snug text-muted-foreground">
        {tier.blurb}
      </p>

      <div className="mt-6">
        {tier.slug === "free" ? (
          <Button asChild variant="ghost" className="w-full rounded-full">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              Self-host on GitHub
            </a>
          </Button>
        ) : (
          <UpgradeCta
            tier={tier.slug}
            tierLabel={tier.name}
            signedIn={signedIn}
            ownerWorkspaces={ownerWorkspaces}
            defaultWorkspaceSlug={defaultWorkspaceSlug}
          />
        )}
      </div>

      <ul className="mt-8 space-y-2 border-t border-border/40 pt-6">
        {tier.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-[14px] leading-snug text-foreground"
          >
            <span aria-hidden className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
