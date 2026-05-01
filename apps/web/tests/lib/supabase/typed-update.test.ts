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

import { describe, expect, test, vi } from "vitest";
import { typedUpdate } from "@/lib/supabase/typed-update";

// Verifies the helper preserves the call shape it's wrapping. The runtime
// path is the bug-free part of supabase-js; we're just confirming the
// typedUpdate wrapper doesn't reorder or drop arguments and returns the
// query builder unchanged so callers can keep their fluent chain.

describe("typedUpdate", () => {
  test("forwards table name + body to .from().update(); returns the chainable builder", () => {
    const updateChain = { __chain: true };
    const update = vi.fn().mockReturnValue(updateChain);
    const fromBuilder = { update };
    const from = vi.fn().mockReturnValue(fromBuilder);
    const client = { from };

    const result = typedUpdate(client, "workspaces", { name: "New name" });

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("workspaces");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ name: "New name" });
    expect(result).toBe(updateChain);
  });

  test("body with multiple fields is forwarded as-is (no key rename, no field drop)", () => {
    const update = vi.fn().mockReturnValue({});
    const from = vi.fn().mockReturnValue({ update });
    const client = { from };

    typedUpdate(client, "workspaces", {
      name: "Multi",
      template: "solo_creator",
    });

    expect(update).toHaveBeenCalledWith({
      name: "Multi",
      template: "solo_creator",
    });
  });

  test("empty body object is forwarded (route-handler validates emptiness; helper is permissive)", () => {
    const update = vi.fn().mockReturnValue({});
    const from = vi.fn().mockReturnValue({ update });
    const client = { from };

    typedUpdate(client, "workspaces", {});

    expect(update).toHaveBeenCalledWith({});
  });
});
