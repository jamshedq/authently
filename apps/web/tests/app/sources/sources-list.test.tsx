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
// Sprint 07 C3.1 — SourcesList component tests (Checkpoint 1+2 collapsed).
//
// Component-tier tests using React Testing Library + happy-dom.
// Pattern follows apps/web/tests/app/sources/upload-widget.test.tsx
// (Sprint 06 B5 precedent).
//
// Coverage (4 tests):
//   1. Empty state renders with "No sources yet" + upload-page link
//   2. Rows render in given order with correct title/type/status/date
//   3. Title falls back to "Untitled" exactly when DB row's title is NULL
//   4. Type label mapping: audio_transcript → Audio, url_extraction → URL,
//      pdf_extraction → PDF
//
// Sort order is verified at the SERVICE tier in
// list-sources.test.ts (the SQL `ORDER BY created_at DESC` clause is
// the contract); SourcesList itself just renders whatever array it
// receives — the component doesn't sort, it displays.
// =============================================================================

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SourcesList } from "@/app/app/[workspaceSlug]/sources/sources-list";
import type { SourceListRow } from "@/services/sources/list-sources";

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
});
