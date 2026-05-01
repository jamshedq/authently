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

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

export type WorkspaceOption = {
  id: string;
  slug: string;
  name: string;
  role: string;
  planTier: string;
};

type Props = {
  tier: "solo" | "studio";
  /** Pretty name for the CTA copy ("Solo" / "Studio"). */
  tierLabel: string;
  /** True if the user is signed in. */
  signedIn: boolean;
  /** The user's owner-role workspaces. Used to drive the cookie-default + dialog flow. */
  ownerWorkspaces: WorkspaceOption[];
  /** Slug from the authently_last_workspace_slug cookie, if it points at a workspace the user owns. */
  defaultWorkspaceSlug: string | null;
};

/**
 * The /pricing CTA for paid tiers. Behaviour:
 *
 *   - Signed out → router.push('/sign-up?next=/pricing') (deferred to plan).
 *   - Signed in + 0 owner workspaces → toast asking to create a workspace
 *     first; we can't create a sub on a workspace the user doesn't own.
 *   - Signed in + exactly 1 owner workspace → POST checkout immediately.
 *   - Signed in + 2+ owner workspaces → open the picker dialog,
 *     pre-selecting the cookie-default if any. Picker requires explicit
 *     submit (not auto-submit on default) so the user always confirms
 *     which workspace they're upgrading.
 *
 * Loading state: button shows "Redirecting…" and is disabled across the
 * Stripe-session round-trip (per UX guidance). Disabled-after-click
 * idempotency prevents double-submission.
 */
export function UpgradeCta({
  tier,
  tierLabel,
  signedIn,
  ownerWorkspaces,
  defaultWorkspaceSlug,
}: Props): React.ReactElement {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string>(
    defaultWorkspaceSlug && ownerWorkspaces.some((w) => w.slug === defaultWorkspaceSlug)
      ? defaultWorkspaceSlug
      : ownerWorkspaces[0]?.slug ?? "",
  );

  async function startCheckout(slug: string): Promise<void> {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ws/${slug}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as { planTier?: string };
        toast.message(`This workspace is already on ${prettyTier(body.planTier)}.`, {
          description: "Use Manage billing in workspace settings to change plans.",
        });
        setLoading(false);
        return;
      }
      if (!res.ok) {
        toast.error("Could not start checkout. Please try again.");
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
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
      setLoading(false);
    }
  }

  async function handlePrimaryClick(): Promise<void> {
    if (!signedIn) {
      router.push("/sign-up?next=/pricing");
      return;
    }
    if (ownerWorkspaces.length === 0) {
      toast.message("Create a workspace first.", {
        description: "You need to be the owner of a workspace to subscribe.",
      });
      return;
    }
    if (ownerWorkspaces.length === 1) {
      await startCheckout(ownerWorkspaces[0]!.slug);
      return;
    }
    // 2+ workspaces — open the picker dialog. Pre-selected from cookie default.
    setDialogOpen(true);
  }

  const ctaLabel = signedIn && ownerWorkspaces.length > 0
    ? `Continue with ${tierLabel}`
    : `Get started`;

  return (
    <>
      <Button
        type="button"
        onClick={handlePrimaryClick}
        disabled={loading}
        className="w-full rounded-full"
      >
        {loading ? "Redirecting…" : ctaLabel}
      </Button>

      {ownerWorkspaces.length > 1 ? (
        <p className="mt-2 text-center text-[12px] text-muted-foreground">
          Will subscribe{" "}
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => setDialogOpen(true)}
            disabled={loading}
          >
            choose workspace
          </button>
        </p>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a workspace</DialogTitle>
            <DialogDescription>
              Subscribe {tierLabel} for one of the workspaces you own.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={selectedSlug}
            onValueChange={setSelectedSlug}
            className="space-y-2"
          >
            {ownerWorkspaces.map((w) => (
              <Label
                key={w.id}
                htmlFor={`ws-${w.id}`}
                className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 hover:bg-muted/50"
              >
                <RadioGroupItem id={`ws-${w.id}`} value={w.slug} />
                <span className="flex flex-col">
                  <span className="text-[14px] font-medium text-foreground">{w.name}</span>
                  <span className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
                    {w.role} · {w.planTier}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setDialogOpen(false);
                if (selectedSlug) await startCheckout(selectedSlug);
              }}
              disabled={loading || !selectedSlug}
            >
              {loading ? "Redirecting…" : `Subscribe ${tierLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function prettyTier(tier?: string): string {
  if (tier === "solo") return "Solo";
  if (tier === "studio") return "Studio";
  if (tier === "free") return "Free";
  return tier ?? "another tier";
}
