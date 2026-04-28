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
import { createServiceRoleClient } from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";

// Atomic sign-up post-condition: the AFTER INSERT trigger on auth.users
// (private.handle_new_user) must, in the same transaction as the user
// creation, produce exactly one workspace + one owner-role membership with
// the expected shape.

describe("sign-up trigger (auth.users → handle_new_user)", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    await pool.cleanup();
  });

  test("creates exactly one owner membership and a creator-template workspace", async () => {
    const user = await pool.create({ fullName: "Ada Lovelace" });
    const admin = createServiceRoleClient();

    // Exactly one membership for the new user, role=owner.
    const memberQuery = await admin
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.userId);
    expect(memberQuery.error).toBeNull();
    expect(memberQuery.data).toHaveLength(1);
    expect(memberQuery.data?.[0]?.role).toBe("owner");
    expect(memberQuery.data?.[0]?.workspace_id).toBe(user.workspaceId);

    // Workspace shape: template, name (from full_name metadata), slug format.
    const wsQuery = await admin
      .from("workspaces")
      .select("id, name, slug, template, plan_tier")
      .eq("id", user.workspaceId)
      .single();
    expect(wsQuery.error).toBeNull();
    expect(wsQuery.data?.template).toBe("creator");
    expect(wsQuery.data?.plan_tier).toBe("free");
    expect(wsQuery.data?.name).toBe("Ada Lovelace's Workspace");

    // Slug: "{kebab-base}-{8-hex}". Base derived from the full_name; suffix
    // is non-deterministic, so we assert shape only.
    expect(wsQuery.data?.slug).toMatch(
      /^ada-lovelace-[a-f0-9]{8}$/,
    );
  });
});
