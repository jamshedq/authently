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

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SourceListRow } from "@/services/sources/list-sources";
import { SourceRow } from "./source-row";

// Sprint 07 C3.1 + C3.2 + C3.3 — sources list component.
//
// C3.1 shipped render-only behavior: list rendering with empty-state
// branching, title fallback, type label mapping, status as raw string.
// C3.2 added `setInterval` polling: while any visible row has
// status === 'processing', a 4s interval calls router.refresh() so
// the server component re-fetches and re-renders. The interval halts
// when no processing rows remain. C3.3 extracted per-row rendering into
// `<SourceRow>` (per the codebase precedent — MemberRow / InvitationRow)
// and added the delete confirmation modal (E6b) + failed-row error class
// label + click-to-expand error text (E6c). Per-row state lives in
// SourceRow; SourcesList owns the polling effect and the empty-state.
//
// === Polling design (C3.2) ===
//
// useEffect dependency on `hasProcessing` (not the full rows array)
// means: when polling refreshes, new rows arrive, hasProcessing
// recomputes; if it flips false, the effect re-runs, the cleanup
// fires, and the early-return prevents re-arming. The stopping
// condition flows from React's idiom, not custom logic.
//
// Race conditions across concurrent refreshes are delegated to
// Next.js — router.refresh() supersedes any pending refresh by
// design. No application-level debouncing or response-ordering.
//
// Polling interval: 4000ms (midpoint of spec's 3-5s range, E2 lock
// at SPRINT_07.md line 389-393).
//
// === Empty-state branch lives here, not in page.tsx ===
//
// Spec line 422 places the empty-state branch in page.tsx; this
// component handles it instead. Reasoning (locked at C3.1 Checkpoint 0
// surface 2026-05-07): page.tsx is a server component, and the
// codebase has no infrastructure for testing server components
// directly (Sprint 06 B5's precedent tests client components only).
// Folding the branch into SourcesList lets the empty state be
// component-tested via React Testing Library + happy-dom. The spec's
// intent ("Empty-state branch when zero rows") is satisfied; the branch
// happens one level deeper than the literal text says.

const POLL_INTERVAL_MS = 4000;

type Props = {
  rows: ReadonlyArray<SourceListRow>;
  workspaceSlug: string;
};

export function SourcesList({ rows, workspaceSlug }: Props) {
  const router = useRouter();
  const hasProcessing = rows.some((r) => r.status === "processing");

  useEffect(() => {
    if (!hasProcessing) return;
    const id = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasProcessing, router]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8 text-sm">
        <p className="text-muted-foreground">No sources yet</p>
        <Link
          href={`/app/${workspaceSlug}/sources/upload`}
          className="font-medium underline underline-offset-4"
        >
          Upload one
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => (
        <SourceRow key={row.id} row={row} workspaceSlug={workspaceSlug} />
      ))}
    </ul>
  );
}
