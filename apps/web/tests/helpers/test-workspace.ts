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
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "@authently/db/types";

// apps/web tests reuse the same fixture pattern that packages/db established
// (createTestUser → workspace_members trigger → sign-in for access token).
// We re-implement here rather than importing from packages/db because that
// would couple apps/web's typecheck to a peer package's test directory.

const TEST_PASSWORD = "TestPassword123!";

export type TestUser = {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceSlug: string;
  accessToken: string;
};

function readEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`env var ${key} is unset (validated by tests/setup.ts)`);
  }
  return value;
}

function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(readEnv("SUPABASE_URL"), readEnv("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function freshEmail(): string {
  return `test-web-${Date.now()}-${randomBytes(4).toString("hex")}@authently.test`;
}

export async function createTestUser(opts: { fullName?: string } = {}): Promise<TestUser> {
  const admin = adminClient();
  const email = freshEmail();
  const fullName = opts.fullName ?? "Web Test User";

  const created = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error) throw new Error(`createUser failed: ${created.error.message}`);
  const user = created.data.user!;

  const member = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id);
  if (member.error || !member.data || member.data.length !== 1) {
    throw new Error(
      `expected 1 workspace_member row, got ${member.data?.length ?? "error"}`,
    );
  }
  const workspaceId = member.data[0]!.workspace_id;

  const ws = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .single();
  if (ws.error || !ws.data) throw new Error(`workspace lookup failed`);
  const workspaceSlug = ws.data.slug;

  const session = await anonClient().auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (session.error || !session.data.session) {
    throw new Error(`signInWithPassword failed: ${session.error?.message}`);
  }

  return {
    userId: user.id,
    email,
    workspaceId,
    workspaceSlug,
    accessToken: session.data.session.access_token,
  };
}

export async function deleteTestUser(user: Pick<TestUser, "userId" | "workspaceId">): Promise<void> {
  const admin = adminClient();
  await admin.from("stripe_events").delete().eq("workspace_id", user.workspaceId);
  await admin.from("workspaces").delete().eq("id", user.workspaceId);
  await admin.auth.admin.deleteUser(user.userId);
}

export class TestUserPool {
  private users: TestUser[] = [];

  async create(opts?: { fullName?: string }): Promise<TestUser> {
    const u = await createTestUser(opts ?? {});
    this.users.push(u);
    return u;
  }

  async cleanup(): Promise<void> {
    while (this.users.length > 0) {
      const u = this.users.pop()!;
      try {
        await deleteTestUser(u);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

/**
 * Service-role client for direct DB assertions / fixture mutation. Borrowed
 * from packages/db/tests/helpers — re-exported here so tests can build on it
 * without cross-package imports.
 */
export function serviceRoleClient(): SupabaseClient<Database> {
  return adminClient();
}

/**
 * Sets a workspace's billing fields directly via service-role for fixture
 * setup. Use this to put a test workspace in a specific state (e.g.
 * past_due with stripe_customer_id) before invoking a route handler.
 */
export async function setWorkspaceBillingFixture(
  workspaceId: string,
  fixture: Partial<{
    plan_tier: "free" | "solo" | "studio";
    subscription_status: "active" | "past_due" | "canceled";
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    past_due_since: string | null;
    subscription_current_period_end: string | null;
  }>,
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("workspaces")
    .update(fixture as never)
    .eq("id", workspaceId);
  if (error) throw new Error(`setWorkspaceBillingFixture failed: ${error.message}`);
}
