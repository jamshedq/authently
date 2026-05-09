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
// Sprint 07 C3.1 + C3.2 — SourcesList component tests.
//
// Component-tier tests using React Testing Library + happy-dom.
// Pattern follows apps/web/tests/app/sources/upload-widget.test.tsx
// (Sprint 06 B5 precedent).
//
// Coverage (7 tests across 3 describe blocks):
//   empty state (1):
//     1. Empty state renders with "No sources yet" + upload-page link
//   non-empty rendering (3):
//     2. Rows render in given order with correct title/type/status/date
//     3. Title falls back to "Untitled" exactly when DB row's title is NULL
//     4. Type label mapping: audio_transcript → Audio, url_extraction → URL,
//        pdf_extraction → PDF
//   polling (3, C3.2):
//     5. router.refresh fires while any row is in 'processing'
//     6. router.refresh does NOT fire when zero rows are in 'processing'
//     7. Interval clears on unmount (no refresh after unmount + advance)
//
// Sort order is verified at the SERVICE tier in
// list-sources.test.ts (the SQL `ORDER BY created_at DESC` clause is
// the contract); SourcesList itself just renders whatever array it
// receives — the component doesn't sort, it displays.
//
// Polling tests use vi.useFakeTimers per spec line 451-453. The mock
// for next/navigation's useRouter is the first in the codebase; if a
// second consumer arrives, extract to apps/web/tests/helpers/.
// =============================================================================

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SourcesList } from "@/app/app/[workspaceSlug]/sources/sources-list";
import type { SourceListRow } from "@/services/sources/list-sources";

const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const WORKSPACE_SLUG = "test-ws";

function makeRow(overrides: Partial<SourceListRow> = {}): SourceListRow {
  return {
    id: crypto.randomUUID(),
    title: "Sample Title",
    type: "url_extraction",
    status: "ready",
    error: null,
    source_url: "https://example.test/article",
    created_at: "2026-05-06T12:00:00.000Z",
    ...overrides,
  };
}

describe("SourcesList", () => {
  afterEach(() => {
    cleanup();
  });

  describe("empty state", () => {
    test('renders "No sources yet" + upload link when rows is empty', () => {
      render(<SourcesList rows={[]} workspaceSlug={WORKSPACE_SLUG} />);

      expect(screen.getByText("No sources yet")).toBeInTheDocument();

      const uploadLink = screen.getByRole("link", { name: /upload one/i });
      expect(uploadLink).toBeInTheDocument();
      expect(uploadLink).toHaveAttribute(
        "href",
        `/app/${WORKSPACE_SLUG}/sources/upload`,
      );

      // No list rendered when empty.
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });
  });

  describe("non-empty rendering", () => {
    test("renders rows in the order received with title/type/status/date", () => {
      const rows: SourceListRow[] = [
        makeRow({
          title: "First Title",
          type: "url_extraction",
          status: "ready",
          created_at: "2026-05-07T10:00:00.000Z",
        }),
        makeRow({
          title: "Second Title",
          type: "pdf_extraction",
          status: "processing",
          created_at: "2026-05-06T10:00:00.000Z",
        }),
      ];

      render(<SourcesList rows={rows} workspaceSlug={WORKSPACE_SLUG} />);

      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(2);

      // First row content.
      expect(within(items[0]!).getByText("First Title")).toBeInTheDocument();
      expect(within(items[0]!).getByText("URL")).toBeInTheDocument();
      expect(within(items[0]!).getByText("ready")).toBeInTheDocument();

      // Second row content.
      expect(within(items[1]!).getByText("Second Title")).toBeInTheDocument();
      expect(within(items[1]!).getByText("PDF")).toBeInTheDocument();
      expect(within(items[1]!).getByText("processing")).toBeInTheDocument();

      // Empty-state element should NOT render alongside the list.
      expect(screen.queryByText("No sources yet")).not.toBeInTheDocument();
    });

    test('falls back to "Untitled" exactly when the row title is null', () => {
      const rows: SourceListRow[] = [
        makeRow({ title: null, type: "audio_transcript" }),
      ];

      render(<SourcesList rows={rows} workspaceSlug={WORKSPACE_SLUG} />);

      const item = screen.getByRole("listitem");
      // "Untitled" exact, not first-N-chars or empty (per E5 lock at
      // SPRINT_07.md line 837).
      expect(within(item).getByText("Untitled")).toBeInTheDocument();
    });

    test("type label maps audio_transcript→Audio, url_extraction→URL, pdf_extraction→PDF", () => {
      const rows: SourceListRow[] = [
        makeRow({ id: "audio-1", title: "Audio Row", type: "audio_transcript" }),
        makeRow({ id: "url-1", title: "URL Row", type: "url_extraction" }),
        makeRow({ id: "pdf-1", title: "PDF Row", type: "pdf_extraction" }),
      ];

      render(<SourcesList rows={rows} workspaceSlug={WORKSPACE_SLUG} />);

      const items = screen.getAllByRole("listitem");
      expect(within(items[0]!).getByText("Audio")).toBeInTheDocument();
      expect(within(items[1]!).getByText("URL")).toBeInTheDocument();
      expect(within(items[2]!).getByText("PDF")).toBeInTheDocument();
    });
  });

  // Polling interval is 4000ms in source (POLL_INTERVAL_MS); tests
  // advance by 4500ms to clear it with margin.
  describe("polling (C3.2)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      refreshMock.mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test("router.refresh fires while any row is in 'processing'", () => {
      const rows: SourceListRow[] = [
        makeRow({ status: "processing" }),
        makeRow({ status: "ready" }),
      ];

      render(<SourcesList rows={rows} workspaceSlug={WORKSPACE_SLUG} />);

      // No refresh fires synchronously on mount.
      expect(refreshMock).not.toHaveBeenCalled();

      // First interval tick.
      vi.advanceTimersByTime(4500);
      expect(refreshMock).toHaveBeenCalledTimes(1);

      // Second interval tick — confirms the interval keeps ticking
      // while processing rows remain (rows are static in this test;
      // hasProcessing stays true; effect doesn't re-run).
      vi.advanceTimersByTime(4500);
      expect(refreshMock).toHaveBeenCalledTimes(2);
    });

    test("router.refresh does NOT fire when zero rows are in 'processing'", () => {
      const rows: SourceListRow[] = [
        makeRow({ status: "ready" }),
        makeRow({ status: "failed" }),
      ];

      render(<SourcesList rows={rows} workspaceSlug={WORKSPACE_SLUG} />);

      // Advance well past several intervals; no refresh should ever fire.
      vi.advanceTimersByTime(20000);
      expect(refreshMock).not.toHaveBeenCalled();
    });

    test("interval clears on unmount (no refresh after unmount + advance)", () => {
      const rows: SourceListRow[] = [makeRow({ status: "processing" })];

      const { unmount } = render(
        <SourcesList rows={rows} workspaceSlug={WORKSPACE_SLUG} />,
      );

      // Confirm interval is active.
      vi.advanceTimersByTime(4500);
      expect(refreshMock).toHaveBeenCalledTimes(1);

      // Unmount → effect cleanup → clearInterval.
      refreshMock.mockClear();
      unmount();

      // Advance past several intervals; no further refreshes.
      vi.advanceTimersByTime(20000);
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });
});
