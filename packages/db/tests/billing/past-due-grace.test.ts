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

import { afterEach, describe, expect, test } from "vitest";
import {
  createServiceRoleClient,
  type AuthentlyClient,
} from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";
import { getWorkspaceBilling } from "../helpers/billing-fixtures.ts";

// =============================================================================
// Past-due grace period RPCs
//
//   public.find_workspaces_past_due_grace_expired()
//   public.downgrade_workspace_to_free(_workspace_id)
//
// (Schema is `public` because the daily Trigger.dev task invokes these via
// PostgREST. The security perimeter is the GRANT — service_role only — see
// process-stripe-event-rls.test.ts.)
//
// These tests directly manipulate the past_due_since column to time-travel
// the workspace into the grace-expiry zone, then assert the RPCs behave.
// =============================================================================

async function setPastDue(
  admin: AuthentlyClient,
  workspaceId: string,
  pastDueSince: Date,
): Promise<void> {
  const { error } = await admin
    .from("workspaces")
    .update(
      {
        subscription_status: "past_due",
        past_due_since: pastDueSince.toISOString(),
      } as never,
    )
    .eq("id", workspaceId);
  if (error) throw new Error(`setPastDue failed: ${error.message}`);
}

async function findGraceExpired(admin: AuthentlyClient): Promise<string[]> {
  const { data, error } = await admin
    .rpc("find_workspaces_past_due_grace_expired");
  if (error) throw new Error(`find_ RPC failed: ${error.message}`);
  return ((data ?? []) as Array<{ workspace_id: string }>).map(
    (r) => r.workspace_id,
  );
}

async function downgrade(
  admin: AuthentlyClient,
  workspaceId: string,
): Promise<void> {
  const { error } = await admin.rpc(
    "downgrade_workspace_to_free",
    { _workspace_id: workspaceId } as never,
  );
  if (error) throw new Error(`downgrade RPC failed: ${error.message}`);
}

describe("past-due grace period RPCs", () => {
  const pool = new TestUserPool();
  const admin = createServiceRoleClient();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("workspace past_due for 6 days is NOT returned by find_grace_expired", async () => {
    const owner = await pool.create({ fullName: "Within Grace" });
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    await setPastDue(admin, owner.workspaceId, sixDaysAgo);

    const ids = await findGraceExpired(admin);
    expect(ids).not.toContain(owner.workspaceId);
  });

  test("workspace past_due for 8 days IS returned by find_grace_expired", async () => {
    const owner = await pool.create({ fullName: "Outside Grace" });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await setPastDue(admin, owner.workspaceId, eightDaysAgo);

    const ids = await findGraceExpired(admin);
    expect(ids).toContain(owner.workspaceId);
  });

  test("active workspace (no past_due_since) is never returned", async () => {
    const owner = await pool.create({ fullName: "Healthy Subscriber" });
    // Default state: subscription_status='active', past_due_since=null.
    const ids = await findGraceExpired(admin);
    expect(ids).not.toContain(owner.workspaceId);
  });

  test("downgrade_workspace_to_free flips plan_tier and clears state; preserves workspace identity", async () => {
    const owner = await pool.create({ fullName: "Going Free" });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await setPastDue(admin, owner.workspaceId, eightDaysAgo);

    // Pre-condition: name + slug + members exist.
    const before = await admin
      .from("workspaces")
      .select("name, slug, template")
      .eq("id", owner.workspaceId)
      .single();
    expect(before.error).toBeNull();

    await downgrade(admin, owner.workspaceId);

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.plan_tier).toBe("free");
    expect(w.subscription_status).toBe("canceled");
    expect(w.past_due_since).toBeNull();
    expect(w.subscription_current_period_end).toBeNull();
    expect(w.stripe_subscription_id).toBeNull();

    // Workspace identity preserved (name, slug, template unchanged).
    const after = await admin
      .from("workspaces")
      .select("name, slug, template")
      .eq("id", owner.workspaceId)
      .single();
    expect(after.data).toEqual(before.data);

    // Membership preserved (the owner is still in the workspace).
    const member = await admin
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", owner.userId)
      .single();
    expect(member.data?.role).toBe("owner");
  });

  test("downgrade is race-safe: workspace that recovered to 'active' is left alone", async () => {
    const owner = await pool.create({ fullName: "Race Recovery" });
    // Simulate: find_ returned this workspace_id when past_due, but between
    // find_ and downgrade_ a webhook flipped the workspace back to active.
    // The downgrade_ WHERE clause asserts past_due → no-op.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await setPastDue(admin, owner.workspaceId, eightDaysAgo);

    // Workspace recovers (e.g., invoice.payment_succeeded came in).
    await admin
      .from("workspaces")
      .update(
        {
          subscription_status: "active",
          past_due_since: null,
          plan_tier: "solo",
        } as never,
      )
      .eq("id", owner.workspaceId);

    // Now the cron task calls downgrade_. It should be a no-op.
    await downgrade(admin, owner.workspaceId);

    const w = await getWorkspaceBilling(admin, owner.workspaceId);
    expect(w.subscription_status).toBe("active");
    expect(w.plan_tier).toBe("solo"); // not downgraded
  });
});
