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

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createAnonClient,
  createAuthenticatedClient,
  createServiceRoleClient,
  type AuthentlyClient,
} from "../helpers/supabase-clients.ts";
import { TestUserPool, type TestUser } from "../helpers/test-user.ts";

// Sprint 03 A1 — RPC perimeter + behavior contract for the activity bump.
//
// Migration 20260501150157 added:
//   - workspace_members.last_active_at timestamptz not null default now()
//   - private.touch_workspace_member_activity_impl(_workspace_id uuid)
//   - public.api_touch_workspace_member_activity(_workspace_id uuid)
//
// The wrapper is granted to `authenticated`; the worker is reachable only
// through the wrapper (SECURITY DEFINER). The 60-second debounce + the
// `user_id = auth.uid()` predicate live in SQL so no app-layer logic can
// bypass them.

async function addMember(
  workspaceId: string,
  userId: string,
  role: "owner" | "admin" | "editor" | "viewer",
): Promise<void> {
  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role });
  if (error) throw error;
}

async function readLastActiveAt(
  client: AuthentlyClient,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const { data, error } = await client
    .from("workspace_members")
    .select("last_active_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .single<{ last_active_at: string }>();
  if (error) throw error;
  return data.last_active_at;
}

async function setLastActiveAt(
  workspaceId: string,
  userId: string,
  iso: string,
): Promise<void> {
  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("workspace_members")
    .update({ last_active_at: iso } as never)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw error;
}

describe("api_touch_workspace_member_activity (Sprint 03 A1)", () => {
  const pool = new TestUserPool();
  let owner: TestUser;
  let workspaceId: string;

  beforeEach(async () => {
    owner = await pool.create({ fullName: "Owner" });
    workspaceId = owner.workspaceId;
  });

  afterEach(async () => {
    await pool.cleanup();
  });

  test("anonymous client is rejected with 42501 (no execute grant on anon)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("api_touch_workspace_member_activity", {
      _workspace_id: workspaceId,
    } as never);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  test("authenticated member can call RPC; last_active_at moves forward", async () => {
    // Plant a baseline well outside the 60-second debounce window.
    const baselineIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await setLastActiveAt(workspaceId, owner.userId, baselineIso);

    const client = createAuthenticatedClient(owner.accessToken);
    const before = await readLastActiveAt(client, workspaceId, owner.userId);
    // Postgres serialises timestamptz with `+00:00`, JS toISOString uses `Z`;
    // compare instants, not literal strings.
    expect(new Date(before).getTime()).toBe(new Date(baselineIso).getTime());

    const { error } = await client.rpc("api_touch_workspace_member_activity", {
      _workspace_id: workspaceId,
    } as never);
    expect(error).toBeNull();

    const after = await readLastActiveAt(client, workspaceId, owner.userId);
    expect(new Date(after).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );
  });

  test("authenticated non-member call returns success but bumps NOTHING (user_id = auth.uid() predicate)", async () => {
    // A second user, not a member of `workspaceId`. They shouldn't be able
    // to bump someone else's activity row, AND shouldn't be able to bump a
    // row that doesn't exist for them in this workspace.
    const stranger = await pool.create({ fullName: "Stranger" });
    const baselineIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await setLastActiveAt(workspaceId, owner.userId, baselineIso);

    const strangerClient = createAuthenticatedClient(stranger.accessToken);
    const { error } = await strangerClient.rpc(
      "api_touch_workspace_member_activity",
      { _workspace_id: workspaceId } as never,
    );
    // RPC succeeds (no permission error); the WHERE clause just matches
    // 0 rows because there's no membership for stranger in this workspace.
    expect(error).toBeNull();

    const admin = createServiceRoleClient();
    const ownerRow = await readLastActiveAt(admin, workspaceId, owner.userId);
    expect(new Date(ownerRow).getTime()).toBe(new Date(baselineIso).getTime());
  });

  test("60-second debounce: second call within the window does NOT update", async () => {
    const client = createAuthenticatedClient(owner.accessToken);

    // First call — moves last_active_at to "now".
    const { error: firstError } = await client.rpc(
      "api_touch_workspace_member_activity",
      { _workspace_id: workspaceId } as never,
    );
    expect(firstError).toBeNull();
    const afterFirst = await readLastActiveAt(client, workspaceId, owner.userId);

    // Brief delay so a "naive overwrite" bug would surface as a different ts.
    await new Promise((r) => setTimeout(r, 50));

    // Second call — well within 60s; debounce predicate filters it out.
    const { error: secondError } = await client.rpc(
      "api_touch_workspace_member_activity",
      { _workspace_id: workspaceId } as never,
    );
    expect(secondError).toBeNull();
    const afterSecond = await readLastActiveAt(client, workspaceId, owner.userId);

    expect(afterSecond).toBe(afterFirst);
  });

  test("debounce releases: call after 61+ seconds stale baseline DOES update", async () => {
    // Plant a baseline outside the 60s window so the next call moves the timestamp.
    const baselineIso = new Date(Date.now() - 61 * 1000).toISOString();
    await setLastActiveAt(workspaceId, owner.userId, baselineIso);

    const client = createAuthenticatedClient(owner.accessToken);
    const { error } = await client.rpc("api_touch_workspace_member_activity", {
      _workspace_id: workspaceId,
    } as never);
    expect(error).toBeNull();

    const after = await readLastActiveAt(client, workspaceId, owner.userId);
    expect(new Date(after).getTime()).toBeGreaterThan(
      new Date(baselineIso).getTime(),
    );
  });
});
