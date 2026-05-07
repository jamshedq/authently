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

// =============================================================================
// Sprint 07 C2b.3 — Trigger-boundary cross-tenant isolation (Checkpoint 4
// of 4).
//
// The trigger-boundary family was originally scoped at ~2-3 tests covering
// payload schema match + cross-tenant isolation + required-fields-per-merge.
// Two of those concerns turned out to be fully covered by Checkpoint 1's
// wire-boundary parse assertions:
//   - Payload schema match → wire-boundary local-mirror parse
//   - Required fields per merge → schema parse implicitly checks presence
//
// Cross-tenant isolation is the unique angle that wire-boundary doesn't
// cover: verifying that distinct workspace inputs across SUCCESSIVE calls
// produce distinct wire payloads (i.e., no shared state leaks between
// calls). The trigger functions are pure constructors today, but explicit
// verification is cheap and the test catches any future regression to
// shared state (e.g., if someone mistakenly memoizes the payload object).
// =============================================================================

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@trigger.dev/sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@trigger.dev/sdk")>(
      "@trigger.dev/sdk",
    );
  return {
    ...actual,
    tasks: { trigger: vi.fn() },
  };
});

import { tasks } from "@trigger.dev/sdk";
import { triggerPdfExtraction, triggerUrlExtraction } from "@/lib/trigger";

const mockTasksTrigger = vi.mocked(tasks.trigger);

type CapturedPayload = Record<string, unknown>;

describe("trigger-boundary: cross-tenant isolation between successive calls", () => {
  beforeEach(() => {
    mockTasksTrigger.mockReset();
    mockTasksTrigger.mockResolvedValue({
      id: "trigger-boundary-handle",
    } as never);
  });

  test("triggerUrlExtraction: distinct workspace inputs produce distinct wire payloads", async () => {
    const workspaceA = crypto.randomUUID();
    const workspaceB = crypto.randomUUID();
    const sourceA = crypto.randomUUID();
    const sourceB = crypto.randomUUID();
    const urlA = "https://example.test/a";
    const urlB = "https://example.test/b";

    await triggerUrlExtraction(workspaceA, sourceA, urlA);
    await triggerUrlExtraction(workspaceB, sourceB, urlB);

    expect(mockTasksTrigger).toHaveBeenCalledTimes(2);
    const [callA, callB] = mockTasksTrigger.mock.calls;
    const payloadA = callA?.[1] as CapturedPayload;
    const payloadB = callB?.[1] as CapturedPayload;

    // Each captured payload carries its own workspace's identifier — no
    // leakage from the prior call. Defense against any shared-state
    // regression in the trigger client wrapper.
    expect(payloadA["workspace_id"]).toBe(workspaceA);
    expect(payloadA["source_id"]).toBe(sourceA);
    expect(payloadA["source_url"]).toBe(urlA);
    expect(payloadB["workspace_id"]).toBe(workspaceB);
    expect(payloadB["source_id"]).toBe(sourceB);
    expect(payloadB["source_url"]).toBe(urlB);

    // Sanity: A's identifier should not appear in B's payload, and vice
    // versa. Catches the failure mode where a stale closure or memoized
    // reference leaks one tenant's data into another tenant's wire call.
    expect(payloadB["workspace_id"]).not.toBe(workspaceA);
    expect(payloadA["workspace_id"]).not.toBe(workspaceB);
  });

  test("triggerPdfExtraction: distinct workspace inputs produce distinct wire payloads", async () => {
    const workspaceA = crypto.randomUUID();
    const workspaceB = crypto.randomUUID();
    const sourceA = crypto.randomUUID();
    const sourceB = crypto.randomUUID();

    await triggerPdfExtraction(workspaceA, sourceA);
    await triggerPdfExtraction(workspaceB, sourceB);

    expect(mockTasksTrigger).toHaveBeenCalledTimes(2);
    const [callA, callB] = mockTasksTrigger.mock.calls;
    const payloadA = callA?.[1] as CapturedPayload;
    const payloadB = callB?.[1] as CapturedPayload;

    expect(payloadA["workspace_id"]).toBe(workspaceA);
    expect(payloadA["source_id"]).toBe(sourceA);
    expect(payloadB["workspace_id"]).toBe(workspaceB);
    expect(payloadB["source_id"]).toBe(sourceB);

    expect(payloadB["workspace_id"]).not.toBe(workspaceA);
    expect(payloadA["workspace_id"]).not.toBe(workspaceB);
  });
});
