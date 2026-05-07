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
// Sprint 07 C2b.3 — Rollback-edges integration tests (Checkpoint 2 of 4).
//
// Verifies the rollback-itself-fails fallback for both URL and PDF flows.
// C2b.2's tests already cover trigger-fails-but-rollback-succeeds (the
// happy rollback path) for both flows, including the E6d-Storage orphan
// acceptance for PDFs (create-source-pdf.test.ts:115-162). This file
// covers the deeper edge: when the rollback ITSELF fails, the row stays
// in 'processing' as the E6d accept-orphan state surfacing as designed.
//
// === Why "stays in processing" is correct (not a bug) ===
//
// The C1 state machine (private.update_source_status_impl) rejects
// transitions to 'failed' without a non-empty error string and rejects
// 'ready' without non-empty content. The service module's rollback path
// calls api_delete_source (soft-delete via deleted_at = now()), NOT a
// status transition — so when api_delete_source fails, no state change
// happens at all. The row remains in its initial 'processing' status.
//
// This IS the E6d accept-orphan state by design: the row is stuck until
// (a) a future sweeper cleans it up (deferred per SPRINT_07_carryovers.md
// entry #2), or (b) the user observes and uses delete-and-resubmit per
// E6a. The discipline is to recognize 'processing' as the correct state
// for this failure mode, not to assert "row should be in 'failed'."
//
// === Mock strategy ===
//
// Mocks @/lib/supabase/typed-rpc at module level so we can selectively
// fail specific RPC names (api_delete_source) while passing through
// others (api_create_source_url, api_create_source_pdf). This is one
// level deeper than C2b.2's tests (which mock @/lib/supabase/server only)
// because C2b.2 doesn't need to discriminate between RPCs — its rollback
// tests just let api_delete_source succeed normally.
// =============================================================================

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  setMockUserToken,
  clearMockUserToken,
  supabaseServerMockModule,
} from "../../helpers/server-client-mock";
import { TestUserPool, serviceRoleClient } from "../../helpers/test-workspace";

vi.mock("@/lib/supabase/server", () => supabaseServerMockModule);
vi.mock("@/lib/trigger", () => ({
  triggerUrlExtraction: vi.fn(),
  triggerPdfExtraction: vi.fn(),
}));

// Mock typed-rpc with the actual implementation as default; tests can
// override mockImplementation to selectively fail specific RPCs.
vi.mock("@/lib/supabase/typed-rpc", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/supabase/typed-rpc")>(
      "@/lib/supabase/typed-rpc",
    );
  return {
    ...actual,
    typedRpc: vi.fn(actual.typedRpc),
  };
});

import { createSourceUrl } from "@/services/sources/create-source-url";
import { createSourcePdf } from "@/services/sources/create-source-pdf";
import { triggerUrlExtraction, triggerPdfExtraction } from "@/lib/trigger";
import { typedRpc } from "@/lib/supabase/typed-rpc";

const mockTriggerUrl = vi.mocked(triggerUrlExtraction);
const mockTriggerPdf = vi.mocked(triggerPdfExtraction);
const mockTypedRpc = vi.mocked(typedRpc);

const SOURCES_PDF_BUCKET = "sources-pdf";

const FAKE_PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
]);

function makePdfFile(name: string): File {
  return new File([FAKE_PDF_BYTES.slice()], name, { type: "application/pdf" });
}

function simulatedRollbackFailure(): PostgrestError {
  return {
    name: "PostgrestError",
    message: "simulated rollback failure",
    code: "PGRST000",
    details: "",
    hint: "",
  } as PostgrestError;
}

/**
 * Configure mockTypedRpc to pass through all RPCs to the real
 * implementation EXCEPT api_delete_source, which is forced to fail with
 * a PostgrestError. This simulates the rollback-itself-fails edge after
 * the trigger has already thrown — the service module catches the
 * trigger error, calls api_delete_source for rollback, and the rollback
 * call fails too.
 */
async function failOnlyApiDeleteSource(): Promise<void> {
  const actual =
    await vi.importActual<typeof import("@/lib/supabase/typed-rpc")>(
      "@/lib/supabase/typed-rpc",
    );
  mockTypedRpc.mockImplementation(
    (async (sb: unknown, fn: string, args?: unknown) => {
      if (fn === "api_delete_source") {
        return { data: null, error: simulatedRollbackFailure() };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.typedRpc as any)(sb, fn, args);
    }) as typeof typedRpc,
  );
}

describe("rollback-edges: rollback-itself-fails fallback to E6d accept-orphan", () => {
  const pool = new TestUserPool();

  beforeEach(() => {
    mockTriggerUrl.mockReset();
    mockTriggerPdf.mockReset();
    mockTypedRpc.mockReset();
  });

  afterEach(async () => {
    clearMockUserToken();
    await pool.cleanup();
  });

  test("URL flow: trigger fails AND rollback fails → row stays in 'processing' (E6d accept-orphan)", async () => {
    const owner = await pool.create({
      fullName: "URL Rollback-Itself-Fails",
    });
    setMockUserToken(owner.accessToken);
    mockTriggerUrl.mockRejectedValueOnce(new Error("trigger: SDK throw"));
    await failOnlyApiDeleteSource();

    const result = await createSourceUrl({
      workspaceId: owner.workspaceId,
      sourceUrl: "https://example.test/orphan",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Service surfaces the compound failure with both messages.
    expect(result.error).toMatch(/^trigger_failed_rollback_failed: /);
    expect(result.error).toContain("SDK throw");
    expect(result.error).toContain("simulated rollback failure");

    // The row stays in 'processing' — NOT 'failed', NOT soft-deleted.
    // This is the E6d accept-orphan state surfacing as designed: no
    // status transition happened (rollback uses api_delete_source, not
    // svc_update_source_status), so the row is stuck at its initial
    // insert state. The C1 state machine wouldn't admit a 'failed'
    // transition without a non-empty error anyway.
    const admin = serviceRoleClient();
    const { data: rows } = await admin
      .from("sources")
      .select("id, status, deleted_at, type, source_url")
      .eq("workspace_id", owner.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.status).toBe("processing");
    expect(rows?.[0]?.deleted_at).toBeNull();
    expect(rows?.[0]?.type).toBe("url_extraction");
    expect(rows?.[0]?.source_url).toBe("https://example.test/orphan");
  });

  test("PDF flow: trigger fails AND rollback fails → row stays in 'processing' AND Storage object still present (E6d-Storage accept-orphan)", async () => {
    const owner = await pool.create({
      fullName: "PDF Rollback-Itself-Fails",
    });
    setMockUserToken(owner.accessToken);
    mockTriggerPdf.mockRejectedValueOnce(new Error("trigger: SDK throw"));
    await failOnlyApiDeleteSource();

    const result = await createSourcePdf({
      workspaceId: owner.workspaceId,
      file: makePdfFile("orphan.pdf"),
      title: "Stuck In Processing",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^trigger_failed_rollback_failed: /);
    expect(result.error).toContain("SDK throw");
    expect(result.error).toContain("simulated rollback failure");

    // Row stays in 'processing' (DB orphan).
    const admin = serviceRoleClient();
    const { data: rows } = await admin
      .from("sources")
      .select("id, status, deleted_at, type, title")
      .eq("workspace_id", owner.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.status).toBe("processing");
    expect(rows?.[0]?.deleted_at).toBeNull();
    expect(rows?.[0]?.type).toBe("pdf_extraction");
    expect(rows?.[0]?.title).toBe("Stuck In Processing");

    // Storage object still present (Storage orphan, accepted per
    // E6d-Storage in SPRINT_07_carryovers.md entry #2). The deferred
    // sweeper would clean both the DB row and the Storage object; in
    // current Sprint 07 scope, both accrue silently.
    const sourceId = rows![0]!.id;
    const orphanPath = `ws/${owner.workspaceId}/${sourceId}.pdf`;
    const { data: list } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .list(`ws/${owner.workspaceId}`);
    expect(list).toHaveLength(1);
    expect(list?.[0]?.name).toBe(`${sourceId}.pdf`);

    // Cleanup so the orphan doesn't accumulate across test runs.
    await admin.storage.from(SOURCES_PDF_BUCKET).remove([orphanPath]);
  });
});
