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
  createAnonClient,
  createServiceRoleClient,
} from "./supabase-clients.ts";

const TEST_PASSWORD = "TestPassword123!";

export type TestUser = {
  userId: string;
  email: string;
  workspaceId: string;
  accessToken: string;
};

function freshEmail(): string {
  return `test-${Date.now()}-${randomBytes(4).toString("hex")}@authently.test`;
}

/**
 * Create a confirmed user via the auth admin API. The migration's
 * `on_auth_user_created` trigger fires synchronously and creates a workspace
 * + an owner membership; we read those back so callers can assert against
 * them and so cleanup can target the workspace explicitly (FK cascade from
 * auth.users only covers workspace_members, not workspaces).
 */
export async function createTestUser(opts: {
  fullName?: string;
} = {}): Promise<TestUser> {
  const admin = createServiceRoleClient();
  const email = freshEmail();
  const fullName = opts.fullName ?? "Test User";

  const created = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error) {
    throw new Error(`auth.admin.createUser failed: ${created.error.message}`);
  }
  const user = created.data.user;
  if (!user) {
    throw new Error("auth.admin.createUser returned no user");
  }

  // Trigger has fired — fetch the membership/workspace it created.
  const memberQuery = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id);
  if (memberQuery.error) {
    throw new Error(
      `failed to read workspace_members for new user: ${memberQuery.error.message}`,
    );
  }
  const rows = memberQuery.data ?? [];
  if (rows.length !== 1) {
    throw new Error(
      `expected exactly 1 workspace_member row after sign-up, got ${rows.length}`,
    );
  }
  const workspaceId = rows[0]!.workspace_id;

  // Sign in to mint an access token. Required for RLS-subject calls.
  const anon = createAnonClient();
  const session = await anon.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (session.error) {
    throw new Error(`signInWithPassword failed: ${session.error.message}`);
  }
  const accessToken = session.data.session?.access_token;
  if (!accessToken) {
    throw new Error("signInWithPassword returned no access token");
  }

  return { userId: user.id, email, workspaceId, accessToken };
}

/**
 * Tear down a test user: delete their workspace (cascades to memberships
 * and any per-workspace child rows like smoke_test), then delete the user.
 *
 * We delete the workspace first because the FK from workspace_members to
 * auth.users cascades on user delete, which would orphan the workspace.
 */
export async function deleteTestUser(user: Pick<TestUser, "userId" | "workspaceId">): Promise<void> {
  const admin = createServiceRoleClient();

  const wsDelete = await admin
    .from("workspaces")
    .delete()
    .eq("id", user.workspaceId);
  if (wsDelete.error) {
    throw new Error(
      `cleanup: failed to delete workspace ${user.workspaceId}: ${wsDelete.error.message}`,
    );
  }

  const userDelete = await admin.auth.admin.deleteUser(user.userId);
  if (userDelete.error) {
    throw new Error(
      `cleanup: failed to delete user ${user.userId}: ${userDelete.error.message}`,
    );
  }
}

/**
 * Manages the lifecycle of TestUsers within a single test/file. Tests call
 * `pool.create()` for each user they need; the `afterEach` hook calls
 * `pool.cleanup()` to tear all of them down regardless of test outcome.
 */
export class TestUserPool {
  private users: TestUser[] = [];

  async create(opts?: { fullName?: string }): Promise<TestUser> {
    const user = await createTestUser(opts ?? {});
    this.users.push(user);
    return user;
  }

  async cleanup(): Promise<void> {
    const errors: unknown[] = [];
    // Drain in LIFO order so failures on one user don't block others.
    while (this.users.length > 0) {
      const user = this.users.pop()!;
      try {
        await deleteTestUser(user);
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "test user cleanup encountered errors");
    }
  }
}
