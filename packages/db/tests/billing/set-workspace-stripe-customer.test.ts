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
  createAnonClient,
  createAuthenticatedClient,
  createServiceRoleClient,
} from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";

// =============================================================================
// public.svc_set_workspace_stripe_customer perimeter + idempotency
//
// Used by apps/web's checkout route to persist a pre-created Stripe customer
// ID onto a workspace BEFORE handing off to Stripe Checkout. The pattern
// supports the customer-metadata-cleanliness goal (every Stripe customer
// has workspace_id metadata) and is idempotent — a retry of the same
// pre-creation flow is a no-op if the workspace already has a customer ID.
// =============================================================================

describe("public.svc_set_workspace_stripe_customer", () => {
  const pool = new TestUserPool();
  const admin = createServiceRoleClient();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("happy path: workspace with null stripe_customer_id is updated", async () => {
    const owner = await pool.create({ fullName: "SetCustomer First" });

    const { error } = await admin.rpc("svc_set_workspace_stripe_customer", {
      _workspace_id: owner.workspaceId,
      _stripe_customer_id: "cus_test_first_001",
    } as never);
    expect(error).toBeNull();

    const { data } = await admin
      .from("workspaces")
      .select("stripe_customer_id")
      .eq("id", owner.workspaceId)
      .single();
    expect(data?.stripe_customer_id).toBe("cus_test_first_001");
  });

  test("idempotent: workspace with existing stripe_customer_id is NOT overwritten", async () => {
    const owner = await pool.create({ fullName: "SetCustomer Idempotent" });

    // First call sets the value.
    await admin.rpc("svc_set_workspace_stripe_customer", {
      _workspace_id: owner.workspaceId,
      _stripe_customer_id: "cus_test_original_001",
    } as never);

    // Second call with a different value should NOT overwrite.
    const { error } = await admin.rpc("svc_set_workspace_stripe_customer", {
      _workspace_id: owner.workspaceId,
      _stripe_customer_id: "cus_test_racing_002",
    } as never);
    expect(error).toBeNull();

    const { data } = await admin
      .from("workspaces")
      .select("stripe_customer_id")
      .eq("id", owner.workspaceId)
      .single();
    expect(data?.stripe_customer_id).toBe("cus_test_original_001");
  });

  test("authenticated client is rejected with 42501", async () => {
    const owner = await pool.create({ fullName: "SetCustomer Authed Probe" });
    const userClient = createAuthenticatedClient(owner.accessToken);

    const result = await userClient.rpc("svc_set_workspace_stripe_customer", {
      _workspace_id: owner.workspaceId,
      _stripe_customer_id: "cus_unauthorized_attempt",
    } as never);

    expect(result.error).not.toBeNull();
    const code = result.error?.code ?? "";
    expect(["42501", "PGRST202", "PGRST301"]).toContain(code);

    // Belt-and-braces: workspace's customer_id is unchanged (still null).
    const { data } = await admin
      .from("workspaces")
      .select("stripe_customer_id")
      .eq("id", owner.workspaceId)
      .single();
    expect(data?.stripe_customer_id).toBeNull();
  });

  test("anonymous client is rejected", async () => {
    const owner = await pool.create({ fullName: "SetCustomer Anon Probe" });
    const anon = createAnonClient();

    const result = await anon.rpc("svc_set_workspace_stripe_customer", {
      _workspace_id: owner.workspaceId,
      _stripe_customer_id: "cus_anon_attempt",
    } as never);

    expect(result.error).not.toBeNull();
  });

  test("rejects null _workspace_id with errcode 22023", async () => {
    const result = await admin.rpc("svc_set_workspace_stripe_customer", {
      _workspace_id: null,
      _stripe_customer_id: "cus_null_workspace",
    } as never);
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe("22023");
  });

  test("rejects null _stripe_customer_id with errcode 22023", async () => {
    const owner = await pool.create({ fullName: "SetCustomer Null CustId" });
    const result = await admin.rpc("svc_set_workspace_stripe_customer", {
      _workspace_id: owner.workspaceId,
      _stripe_customer_id: null,
    } as never);
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe("22023");
  });
});
