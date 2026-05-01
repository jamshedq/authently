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
import { typedRpc } from "@/lib/supabase/typed-rpc";

// Verifies the helper preserves the call shape it's wrapping. The runtime
// path is the bug-free part of the supabase-js inference; we're just
// confirming the typedRpc wrapper doesn't reorder or drop arguments.
//
// Behavior parity is the entire point of this commit — if the wrapper
// reorders/mutates anything, every migrated call site silently breaks.

describe("typedRpc", () => {
  test("parameterless RPC: forwards fnName, no args, returns the response object", async () => {
    const expected = { data: "ws-uuid-123", error: null };
    const rpc = vi.fn().mockResolvedValue(expected);
    const client = { rpc };

    const result = await typedRpc(client, "api_ensure_my_workspace");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("api_ensure_my_workspace", undefined);
    expect(result).toEqual(expected);
  });

  test("args-bearing RPC returning a row array: forwards fnName + args", async () => {
    const expected = {
      data: [
        {
          id: "ws-1",
          name: "Foo",
          slug: "foo",
          template: "solo_creator",
          plan_tier: "free",
        },
      ],
      error: null,
    };
    const rpc = vi.fn().mockResolvedValue(expected);
    const client = { rpc };

    const result = await typedRpc(client, "api_create_workspace", {
      _name: "Foo",
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("api_create_workspace", { _name: "Foo" });
    expect(result).toEqual(expected);
  });

  test("args-bearing RPC returning void: forwards fnName + args, surfaces error", async () => {
    const expected = {
      data: null,
      error: {
        code: "42501",
        message: "permission denied",
        details: "",
        hint: "",
      },
    };
    const rpc = vi.fn().mockResolvedValue(expected);
    const client = { rpc };

    const result = await typedRpc(client, "svc_set_workspace_stripe_customer", {
      _workspace_id: "ws-1",
      _stripe_customer_id: "cus_test_xyz",
    });

    expect(rpc).toHaveBeenCalledWith("svc_set_workspace_stripe_customer", {
      _workspace_id: "ws-1",
      _stripe_customer_id: "cus_test_xyz",
    });
    expect(result).toEqual(expected);
  });

  test("propagates a thrown error from the underlying rpc method", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network boom"));
    const client = { rpc };

    await expect(
      typedRpc(client, "api_create_workspace", { _name: "x" }),
    ).rejects.toThrow("network boom");
  });
});
