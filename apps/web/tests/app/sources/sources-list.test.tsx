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
// Sprint 07 C3.1 + C3.2 + C3.3 — SourcesList component tests.
//
// Component-tier tests using React Testing Library + happy-dom.
// Pattern follows apps/web/tests/app/sources/upload-widget.test.tsx
// (Sprint 06 B5 precedent).
//
// Coverage (10 tests across 4 describe blocks):
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
//   delete + error display (3, C3.3):
//     8. Clicking Delete opens modal; submitting the modal form invokes
//        deleteSourceAction with the row's sourceId in FormData.
//     9. Error class label mapping: prefix-match for `extraction_failed:` /
//        `network:` / `timeout:` / `transient:` renders spec-defined labels.
//    10. Click-to-expand: failed row's error label is visible by default;
//        the full error text is hidden until the label is clicked.
//
// Sort order is verified at the SERVICE tier in
// list-sources.test.ts (the SQL `ORDER BY created_at DESC` clause is
// the contract); SourcesList itself just renders whatever array it
// receives — the component doesn't sort, it displays.
//
// Polling tests use vi.useFakeTimers per spec line 451-453. The mock
// for next/navigation's useRouter is the first in the codebase; if a
// second consumer arrives, extract to apps/web/tests/helpers/.
//
// C3.3 mocks deleteSourceAction directly so the delete flow test
// asserts FormData contents without invoking the server action body.
// =============================================================================

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SourcesList } from "@/app/app/[workspaceSlug]/sources/sources-list";
import type { SourceListRow } from "@/services/sources/list-sources";

const refreshMock = vi.hoisted(() => vi.fn());
const deleteSourceActionMock = vi.hoisted(() => vi.fn());

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

vi.mock("@/app/app/[workspaceSlug]/sources/delete-action", () => ({
  deleteSourceAction: deleteSourceActionMock,
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

  // C3.3 — delete flow + failed-row error display tests. Real timers (no
  // vi.useFakeTimers) because the delete flow is an async server-action
  // call; fake timers would block the microtask queue.
  describe("delete + error display (C3.3)", () => {
    beforeEach(() => {
      deleteSourceActionMock.mockClear();
      deleteSourceActionMock.mockResolvedValue({ ok: true });
      refreshMock.mockClear();
    });

    test("clicking Delete opens modal; submitting invokes deleteSourceAction with sourceId in FormData", async () => {
      const sourceId = "11111111-2222-3333-4444-555555555555";
      const rows: SourceListRow[] = [
        makeRow({ id: sourceId, title: "Source To Delete" }),
      ];

      render(<SourcesList rows={rows} workspaceSlug={WORKSPACE_SLUG} />);

      // Row-level Delete button — disambiguate from modal's button by
      // scoping to the listitem. Modal content renders via Radix portal
      // to document.body and is not inside the <li>.
      const row = screen.getByRole("listitem");
      const rowDeleteButton = within(row).getByRole("button", {
        name: /^Delete Source To Delete$/i,
      });
      fireEvent.click(rowDeleteButton);

      // Modal opens (Radix Dialog renders to portal in document.body;
      // screen queries the whole document by default).
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByText(/Delete source/i)).toBeInTheDocument();

      // Submit the modal form by clicking the destructive Delete button.
      // Use form submit rather than button click so FormData is built
      // from the form's hidden inputs.
      const form = dialog.querySelector("form");
      if (!form) throw new Error("Expected delete form inside dialog");
      fireEvent.submit(form);

      // Wait one microtask for the async submit handler to invoke the mock.
      await Promise.resolve();
      await Promise.resolve();

      expect(deleteSourceActionMock).toHaveBeenCalledTimes(1);
      const formData = deleteSourceActionMock.mock.calls[0]?.[0] as FormData;
      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get("sourceId")).toBe(sourceId);
    });

    test("error class label mapping renders spec-defined labels for the four prefixes", () => {
      const rows: SourceListRow[] = [
        makeRow({
          id: "fail-extraction",
          title: "Extraction Failed Row",
          status: "failed",
          error: "extraction_failed: no_content",
        }),
        makeRow({
          id: "fail-network",
          title: "Network Failed Row",
          status: "failed",
          error: "network: http_404",
        }),
        makeRow({
          id: "fail-timeout",
          title: "Timeout Row",
          status: "failed",
          error: "timeout: head_request",
        }),
        makeRow({
          id: "fail-transient",
          title: "Transient Row",
          status: "failed",
          error: "transient: python_runtime:ImportError",
        }),
      ];

      render(<SourcesList rows={rows} workspaceSlug={WORKSPACE_SLUG} />);

      const items = screen.getAllByRole("listitem");

      // Spec labels per SPRINT_07.md line 396 ("Extraction failed",
      // "Network error", "Timeout"); "Temporary error" for `transient:`
      // per C3.3 Checkpoint 0 decision (spec doesn't name a label for
      // transient: explicitly).
      expect(
        within(items[0]!).getByRole("button", { name: /^Extraction failed$/ }),
      ).toBeInTheDocument();
      expect(
        within(items[1]!).getByRole("button", { name: /^Network error$/ }),
      ).toBeInTheDocument();
      expect(
        within(items[2]!).getByRole("button", { name: /^Timeout$/ }),
      ).toBeInTheDocument();
      expect(
        within(items[3]!).getByRole("button", { name: /^Temporary error$/ }),
      ).toBeInTheDocument();
    });

    test("click-to-expand: failed row's error text is hidden by default and visible after clicking the label", () => {
      const fullErrorText = "extraction_failed: pdfplumber:PDFPageCountError";
      const rows: SourceListRow[] = [
        makeRow({
          id: "fail-1",
          title: "Failed Row",
          status: "failed",
          error: fullErrorText,
        }),
      ];

      render(<SourcesList rows={rows} workspaceSlug={WORKSPACE_SLUG} />);

      const row = screen.getByRole("listitem");

      // Label is visible by default; full error text is NOT.
      const labelButton = within(row).getByRole("button", {
        name: /^Extraction failed$/,
      });
      expect(labelButton).toHaveAttribute("aria-expanded", "false");
      expect(within(row).queryByText(fullErrorText)).not.toBeInTheDocument();

      // Click the label → full error text appears.
      fireEvent.click(labelButton);
      expect(labelButton).toHaveAttribute("aria-expanded", "true");
      expect(within(row).getByText(fullErrorText)).toBeInTheDocument();

      // Click again → full error text hidden.
      fireEvent.click(labelButton);
      expect(labelButton).toHaveAttribute("aria-expanded", "false");
      expect(within(row).queryByText(fullErrorText)).not.toBeInTheDocument();
    });
  });
});
