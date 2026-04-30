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

import { randomBytes } from "node:crypto";
import type { AuthentlyClient } from "./supabase-clients.ts";

// Synthetic Stripe IDs for test mode. Match the prefix conventions Stripe
// uses so tests are self-documenting; the values themselves are arbitrary.
export const TEST_PRICE_SOLO = "price_test_solo_aaaaaaaaaaaaaa";
export const TEST_PRICE_STUDIO = "price_test_studio_bbbbbbbbbbbb";
export const TEST_PRICE_UNKNOWN = "price_test_unknown_xxxxxxxxxx";

export function freshEventId(): string {
  return `evt_test_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export function freshSubscriptionId(): string {
  return `sub_test_${randomBytes(8).toString("hex")}`;
}

export function freshCustomerId(): string {
  return `cus_test_${randomBytes(8).toString("hex")}`;
}

/**
 * Seed `stripe_price_tier_map` with the two paid tiers. Idempotent.
 * Tests that exercise process_stripe_event need this seeded so the
 * function can map TEST_PRICE_SOLO → 'solo' and TEST_PRICE_STUDIO → 'studio'.
 */
export async function seedPriceTierMap(admin: AuthentlyClient): Promise<void> {
  const { error } = await admin.rpc(
    "upsert_stripe_price_tier_map",
    {
      _entries: [
        { stripe_price_id: TEST_PRICE_SOLO, plan_tier: "solo" },
        { stripe_price_id: TEST_PRICE_STUDIO, plan_tier: "studio" },
      ],
    },
  );
  if (error) {
    throw new Error(`seedPriceTierMap failed: ${error.message}`);
  }
}

/**
 * Curated payload allowlist matching what apps/web's
 * services/webhooks/stripe/extract-event-fields.ts produces. NO PII.
 */
export function buildTestPayload(args: {
  event_id: string;
  type: string;
  customer_id: string | null;
  subscription_id: string | null;
  price_id: string | null;
  workspace_id_hint: string | null;
}): Record<string, unknown> {
  return {
    event_id: args.event_id,
    type: args.type,
    livemode: false,
    customer_id: args.customer_id,
    subscription_id: args.subscription_id,
    price_id: args.price_id,
    workspace_id_hint: args.workspace_id_hint,
  };
}

export type ProcessOutcome =
  | "processed"
  | "deduplicated"
  | "unknown_event_type"
  | "unknown_price"
  | "workspace_not_found"
  | "subscription_mismatch";

/**
 * Call public.process_stripe_event with sensible defaults. Each event-type
 * convenience exists to keep test bodies short.
 */
export async function callProcessEvent(
  admin: AuthentlyClient,
  args: {
    event_id?: string;
    type: string;
    customer_id?: string | null;
    subscription_id?: string | null;
    price_id?: string | null;
    workspace_id_hint?: string | null;
    current_period_end?: string | null;
  },
): Promise<{ outcome: ProcessOutcome; event_id: string }> {
  const event_id = args.event_id ?? freshEventId();
  const customer_id = args.customer_id ?? null;
  const subscription_id = args.subscription_id ?? null;
  const price_id = args.price_id ?? null;
  const workspace_id_hint = args.workspace_id_hint ?? null;
  const current_period_end = args.current_period_end ?? null;

  const payload = buildTestPayload({
    event_id,
    type: args.type,
    customer_id,
    subscription_id,
    price_id,
    workspace_id_hint,
  });

  const { data, error } = await admin
    .rpc("process_stripe_event", {
      _event_id: event_id,
      _type: args.type,
      _payload: payload,
      _customer_id: customer_id,
      _subscription_id: subscription_id,
      _price_id: price_id,
      _workspace_id_hint: workspace_id_hint,
      _current_period_end: current_period_end,
    } as never);

  if (error) {
    throw new Error(
      `process_stripe_event RPC error: ${error.message} (event_id=${event_id}, type=${args.type})`,
    );
  }
  if (typeof data !== "string") {
    throw new Error(
      `process_stripe_event returned non-string: ${JSON.stringify(data)}`,
    );
  }
  return { outcome: data as ProcessOutcome, event_id };
}

/**
 * Set the `stripe_subscription_id` on a workspace. The webhook flow does
 * this via process_stripe_event for checkout.session.completed; tests for
 * subsequent events need to pre-link the workspace to a subscription_id.
 */
export async function linkWorkspaceToSubscription(
  admin: AuthentlyClient,
  workspaceId: string,
  subscriptionId: string,
  customerId?: string,
): Promise<void> {
  const updates: Record<string, unknown> = {
    stripe_subscription_id: subscriptionId,
  };
  if (customerId) updates["stripe_customer_id"] = customerId;
  const { error } = await admin
    .from("workspaces")
    .update(updates as never)
    .eq("id", workspaceId);
  if (error) {
    throw new Error(`linkWorkspaceToSubscription failed: ${error.message}`);
  }
}

/**
 * Read a workspace's billing-relevant columns for assertions.
 */
export async function getWorkspaceBilling(
  admin: AuthentlyClient,
  workspaceId: string,
): Promise<{
  plan_tier: string;
  subscription_status: string;
  subscription_current_period_end: string | null;
  past_due_since: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
}> {
  const { data, error } = await admin
    .from("workspaces")
    .select(
      "plan_tier, subscription_status, subscription_current_period_end, past_due_since, stripe_subscription_id, stripe_customer_id",
    )
    .eq("id", workspaceId)
    .single();
  if (error) {
    throw new Error(`getWorkspaceBilling failed: ${error.message}`);
  }
  return data as never;
}
