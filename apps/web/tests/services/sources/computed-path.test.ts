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
// Sprint 07 C2b.3 — Computed-path convergence tests (Checkpoint 3 of 4).
//
// Verifies the architectural-choice obligation locked at C2a/C2b.2:
// apps/web and apps/jobs both compute the Storage path
//   ws/{workspace_id}/{source_id}.pdf
// independently from the same inputs (workspaceId, sourceId). Convergence
// is by construction at the type level only — both sides have separate
// `storagePathFor` functions with the same body. This test verifies the
// runtime equivalence of those two definitions.
//
// === Cross-package import (testing-only) ===
//
// Imports apps/jobs's `storagePathFor` via relative path. Both functions
// were exported in C2b.3 (Resolution 4 Option A) for test enablement;
// production code keeps them module-private in spirit. Runtime apps/web
// stays type-decoupled from apps/jobs (no @authently/jobs dep in
// apps/web/package.json). The relative path's visual ugliness is
// deliberate documentation that this is testing-only coupling reaching
// across the package boundary.
//
// === If either test fails ===
//
// One side has changed its path computation. The fix is to align both
// sides: either revert the unintended change or update both consumers
// simultaneously (apps/web upload action + apps/jobs signed-URL fetch +
// any future tooling that constructs paths). Divergent path computation
// breaks the PDF extraction pipeline at runtime — apps/web uploads to
// one path, apps/jobs's signed-URL fetch attempts another path, the
// fetch fails (`network: signed_url:Object not found`-equivalent).
// =============================================================================

import { describe, expect, test } from "vitest";
import { storagePathFor as appsWebStoragePathFor } from "@/services/sources/create-source-pdf";
import { storagePathFor as appsJobsStoragePathFor } from "../../../../jobs/src/trigger/extract-from-pdf";

const SAMPLE_INPUTS: ReadonlyArray<{
  workspaceId: string;
  sourceId: string;
  label: string;
}> = [
  {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    sourceId: "22222222-2222-4222-8222-222222222222",
    label: "common-shape uuids",
  },
  {
    workspaceId: "00000000-0000-0000-0000-000000000000",
    sourceId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    label: "all-zero vs all-f boundary",
  },
  {
    workspaceId: crypto.randomUUID(),
    sourceId: crypto.randomUUID(),
    label: "fresh runtime uuids",
  },
];

describe("computed-path: apps/web and apps/jobs converge on identical Storage paths", () => {
  test("convergence: both sides produce identical paths for representative inputs", () => {
    for (const { workspaceId, sourceId, label } of SAMPLE_INPUTS) {
      const appsWebPath = appsWebStoragePathFor(workspaceId, sourceId);
      const appsJobsPath = appsJobsStoragePathFor(workspaceId, sourceId);
      expect(
        appsWebPath,
        `convergence mismatch (${label}): apps/web=${appsWebPath}, apps/jobs=${appsJobsPath}`,
      ).toBe(appsJobsPath);
    }
  });

  test("format: both sides match the canonical ws/{workspace_id}/{source_id}.pdf template", () => {
    for (const { workspaceId, sourceId, label } of SAMPLE_INPUTS) {
      const expectedFormat = `ws/${workspaceId}/${sourceId}.pdf`;
      expect(
        appsWebStoragePathFor(workspaceId, sourceId),
        `apps/web format drift (${label})`,
      ).toBe(expectedFormat);
      expect(
        appsJobsStoragePathFor(workspaceId, sourceId),
        `apps/jobs format drift (${label})`,
      ).toBe(expectedFormat);
    }
  });
});
