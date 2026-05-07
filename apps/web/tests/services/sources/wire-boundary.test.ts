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
// Sprint 07 C2b.3 — Wire-boundary integration test (Checkpoint 1 of 4).
//
// Verifies that the wire payload apps/web sends to Trigger.dev parses
// successfully against a local mirror of apps/jobs's expected wire schema.
// "Wire boundary" = the seam between apps/web/src/lib/trigger.ts and the
// Trigger.dev SDK's tasks.trigger() — what apps/web puts ON the wire vs
// what apps/jobs's defineTenantTask would VALIDATE off the wire.
//
// === Verification mechanism: parallel-mirror, NOT direct-schema-drift ===
//
// The local schema below mirrors apps/jobs's actual wire schema. If the
// mirror parses the captured payload, the payload structure is what
// apps/jobs would accept — AS LONG AS the mirror itself is in sync with
// apps/jobs's source. Drift defense is convention-enforced via
// bidirectional cross-reference comments (this file points to apps/jobs
// source lines; apps/jobs source files point back to this test). When
// apps/jobs schemas change, this mirror MUST be updated in lockstep.
//
// Choice locked at C2b.3 Checkpoint 1 (2026-05-07): Option B over Option A.
// Option A would have refactored apps/jobs to expose its actual schemas
// for direct cross-package parsing — mechanism-enforced drift detection.
// Option B accepts the parallel-mirror approach with convention-enforced
// drift defense, conserving scope (no apps/jobs refactor in C2b.3) at the
// cost of a weaker but defensible verification mechanism. Test names below
// reflect what the test ACTUALLY verifies (payload parses local mirror),
// not what a direct-schema-drift mechanism would verify.
//
// === Cross-package coupling ===
//
// This test imports `uuidSchema` from @authently/shared (a package both
// apps/web and apps/jobs depend on) — no cross-package reach there. The
// schema mirrors below are LOCAL definitions; they're not imported from
// apps/jobs. The "cross-package contract" being verified is between the
// mirror's structure and apps/jobs's actual schema, with the mirror's
// fidelity defended by the bidirectional comment convention. Runtime
// apps/web stays type-decoupled from apps/jobs as locked at C2b.2.
// =============================================================================

import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { uuidSchema } from "@authently/shared";

// Mock @trigger.dev/sdk's tasks.trigger to capture the wire payload.
// We mock one level deeper than C2b.2's tests (which mock @/lib/trigger):
// the wire payload is constructed inside triggerUrlExtraction /
// triggerPdfExtraction and passed to tasks.trigger; capturing at the SDK
// boundary surfaces what actually goes on the wire.
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

// === LOCAL MIRROR: extract-from-url wire schema ==============================
//
// MIRRORS:
//   - apps/jobs/src/trigger/extract-from-url.ts:181-184 (user payloadSchema)
//   - apps/jobs/src/lib/tenant-task.ts:67-72 (defineTenantTask schema-merge
//     that prepends workspace_id to the user schema before the wire)
//
// Source files at the apps/jobs side carry comments pointing back to this
// test as the drift-detection layer. Bidirectional cross-references are
// the convention-enforced drift defense (C2b.3 Checkpoint 1 lock).
//
// CRITICAL — if either of those apps/jobs source locations changes its
// schema definition, this mirror MUST be updated in lockstep.
const extractFromUrlWireMirror = z.object({
  workspace_id: uuidSchema,
  source_id: uuidSchema,
  source_url: z.string().url(),
});

// === LOCAL MIRROR: extract-from-pdf wire schema ==============================
//
// MIRRORS:
//   - apps/jobs/src/trigger/extract-from-pdf.ts:150-152 (user payloadSchema)
//   - apps/jobs/src/lib/tenant-task.ts:67-72 (defineTenantTask schema-merge)
//
// Same bidirectional cross-reference convention as the URL mirror above.
// PDF wire payload deliberately omits source_url (Storage path is
// computed-not-passed per the C2a/C2b.2 lock); the mirror reflects that.
const extractFromPdfWireMirror = z.object({
  workspace_id: uuidSchema,
  source_id: uuidSchema,
});

describe("wire-boundary: apps/web payload parses locally-mirrored apps/jobs wire schema", () => {
  beforeEach(() => {
    mockTasksTrigger.mockReset();
    // Real tasks.trigger returns a handle with `id` plus other fields; the
    // apps/web wrapper only uses .id. Cast keeps the mock minimal without
    // dragging in the full Trigger.dev RunHandle type surface.
    mockTasksTrigger.mockResolvedValue({ id: "wire-boundary-test-handle" } as never);
  });

  test("triggerUrlExtraction wire payload parses extract-from-url local mirror", async () => {
    const workspaceId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const sourceUrl = "https://example.test/article";

    await triggerUrlExtraction(workspaceId, sourceId, sourceUrl);

    expect(mockTasksTrigger).toHaveBeenCalledTimes(1);
    const call = mockTasksTrigger.mock.calls[0];
    expect(call?.[0]).toBe("extract-from-url");

    // Parse the captured wire payload through the local mirror. If the
    // mirror is out of sync with apps/jobs's actual schema (drift), this
    // test catches mismatches against the MIRROR — not against apps/jobs's
    // runtime schema. That's the known limit of the convention-based
    // verification mechanism.
    const parsed = extractFromUrlWireMirror.safeParse(call?.[1]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.workspace_id).toBe(workspaceId);
    expect(parsed.data.source_id).toBe(sourceId);
    expect(parsed.data.source_url).toBe(sourceUrl);
  });

  test("triggerPdfExtraction wire payload parses extract-from-pdf local mirror", async () => {
    const workspaceId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();

    await triggerPdfExtraction(workspaceId, sourceId);

    expect(mockTasksTrigger).toHaveBeenCalledTimes(1);
    const call = mockTasksTrigger.mock.calls[0];
    expect(call?.[0]).toBe("extract-from-pdf");

    const parsed = extractFromPdfWireMirror.safeParse(call?.[1]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.workspace_id).toBe(workspaceId);
    expect(parsed.data.source_id).toBe(sourceId);
    // PDF wire payload deliberately excludes source_url — the Storage path
    // is computed-not-passed (apps/web and apps/jobs both derive
    // ws/{workspace_id}/{source_id}.pdf independently). Verify the
    // captured payload reflects this design lock at the wire.
    expect(call?.[1]).not.toHaveProperty("source_url");
  });
});
