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

// Mock the server action module before importing the widget. The widget
// imports `transcribeAndSave` at module top-level; vi.mock hoists the
// factory so the mock is in place by the time the widget evaluates.
vi.mock(
  "@/app/app/[workspaceSlug]/sources/upload/actions",
  () => ({
    transcribeAndSave: vi.fn(),
    maxDuration: 300,
  }),
);

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { transcribeAndSave } from "@/app/app/[workspaceSlug]/sources/upload/actions";
import { UploadWidget } from "@/app/app/[workspaceSlug]/sources/upload/upload-widget";

const mockedTranscribeAndSave = vi.mocked(transcribeAndSave);

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_SLUG = "test-ws";

function buildAudioFile(opts: {
  size?: number;
  type?: string;
  name?: string;
}): File {
  const size = opts.size ?? 1024;
  const type = opts.type ?? "audio/mpeg";
  const name = opts.name ?? "test.mp3";
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

describe("UploadWidget", () => {
  afterEach(() => {
    cleanup();
    mockedTranscribeAndSave.mockReset();
  });

  test("client-side validation rejects oversize file before submission", async () => {
    render(
      <UploadWidget workspaceId={WORKSPACE_ID} workspaceSlug={WORKSPACE_SLUG} />,
    );

    const input = screen.getByLabelText("Choose a file") as HTMLInputElement;
    const oversize = buildAudioFile({ size: 26 * 1024 * 1024 });

    fireEvent.change(input, { target: { files: [oversize] } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /file is too large/i,
      );
    });

    // Server action MUST NOT have been called — client validation gate held.
    expect(mockedTranscribeAndSave).not.toHaveBeenCalled();
  });

  test("happy path: server action returns sourceId; transcript displays + save invoked with file + workspaceId", async () => {
    mockedTranscribeAndSave.mockResolvedValue({
      ok: true,
      sourceId: "src_test_xyz",
      transcript: "the quick brown fox",
    });

    render(
      <UploadWidget workspaceId={WORKSPACE_ID} workspaceSlug={WORKSPACE_SLUG} />,
    );

    const input = screen.getByLabelText("Choose a file") as HTMLInputElement;
    const file = buildAudioFile({ name: "happy.mp3" });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /saved/i }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("the quick brown fox")).toBeInTheDocument();
    expect(screen.getByText(/happy\.mp3/)).toBeInTheDocument();

    // Server action invoked exactly once with FormData containing file +
    // workspaceId.
    expect(mockedTranscribeAndSave).toHaveBeenCalledTimes(1);
    const callArg = mockedTranscribeAndSave.mock.calls[0]![0];
    expect(callArg).toBeInstanceOf(FormData);
    expect(callArg.get("file")).toBe(file);
    expect(callArg.get("workspaceId")).toBe(WORKSPACE_ID);
  });
});
