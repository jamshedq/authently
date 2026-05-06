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

import { afterEach, describe, expect, test, vi } from "vitest";

// Mock the supabase-client factory so tests inject their own RPC mock.
// vi.mock is hoisted; the factory must be self-contained.
vi.mock("../../../src/lib/supabase.ts", () => {
  const rpc = vi.fn();
  return {
    getJobsSupabaseClient: () => ({ rpc }),
    __getRpcMock: () => rpc,
  };
});

import {
  setSourceStatusFailed,
  setSourceStatusReady,
} from "../../../src/services/sources/update-source-status.ts";
import * as supabaseLib from "../../../src/lib/supabase.ts";

const SOURCE_ID = "11111111-1111-1111-1111-111111111111";

function getRpcMock(): ReturnType<typeof vi.fn> {
  return (supabaseLib as unknown as { __getRpcMock: () => ReturnType<typeof vi.fn> }).__getRpcMock();
}

describe("setSourceStatusReady", () => {
  afterEach(() => {
    getRpcMock().mockReset();
  });

  test("happy path passes content + title to svc_update_source_status", async () => {
    getRpcMock().mockResolvedValue({ error: null });

    await setSourceStatusReady(SOURCE_ID, "extracted content", "Page Title");

    expect(getRpcMock()).toHaveBeenCalledTimes(1);
    expect(getRpcMock()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "ready",
      _content: "extracted content",
      _title: "Page Title",
    });
  });

  test("happy path with null title omits _title from RPC args", async () => {
    getRpcMock().mockResolvedValue({ error: null });

    await setSourceStatusReady(SOURCE_ID, "extracted content", null);

    expect(getRpcMock()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "ready",
      _content: "extracted content",
    });
  });

  test("empty content throws before RPC fires (state machine contract)", async () => {
    getRpcMock().mockResolvedValue({ error: null });

    await expect(
      setSourceStatusReady(SOURCE_ID, "", "title"),
    ).rejects.toThrow(/content must be non-empty/);

    expect(getRpcMock()).not.toHaveBeenCalled();
  });

  test("RPC error surfaces as thrown Error", async () => {
    getRpcMock().mockResolvedValue({
      error: { message: "illegal status transition", code: "22023" },
    });

    await expect(
      setSourceStatusReady(SOURCE_ID, "content", null),
    ).rejects.toThrow(/illegal status transition/);
  });
});

describe("setSourceStatusFailed", () => {
  afterEach(() => {
    getRpcMock().mockReset();
  });

  test("happy path passes error to svc_update_source_status", async () => {
    getRpcMock().mockResolvedValue({ error: null });

    await setSourceStatusFailed(SOURCE_ID, "network: timeout");

    expect(getRpcMock()).toHaveBeenCalledWith("svc_update_source_status", {
      _source_id: SOURCE_ID,
      _status: "failed",
      _error: "network: timeout",
    });
  });

  test("empty error throws before RPC fires (state machine contract)", async () => {
    getRpcMock().mockResolvedValue({ error: null });

    await expect(setSourceStatusFailed(SOURCE_ID, "")).rejects.toThrow(
      /error must be non-empty/,
    );
    expect(getRpcMock()).not.toHaveBeenCalled();
  });
});
