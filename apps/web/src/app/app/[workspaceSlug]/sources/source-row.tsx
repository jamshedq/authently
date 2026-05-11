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

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  SourceListRow,
  SourceType,
} from "@/services/sources/list-sources";
import { DeleteSourceDialog } from "./delete-source-dialog";

// Sprint 07 C3.3 — extracted row component. Pattern follows MemberRow /
// InvitationRow (Sprint 04 era): list page maps over an extracted row
// component; each row owns its own interactive state (modal open,
// error expand).
//
// State scope:
//   isModalOpen   — controls the delete confirmation dialog visibility
//   isErrorExpanded — controls the click-to-expand error text (E6c)
// Both are per-row; lifting to SourcesList would cross-couple unrelated
// rows (clicking expand on row A would close/open state on row B).

const TYPE_LABELS: Record<SourceType, string> = {
  audio_transcript: "Audio",
  url_extraction: "URL",
  pdf_extraction: "PDF",
};

// Error class labels per spec line 396: "error class label visible by
// default (e.g. 'Extraction failed' / 'Network error' / 'Timeout')".
// Prefix-match lookup — error strings emit as `<prefix>: <detail>`
// (verified in C3.3 Checkpoint 0 discovery against Python + TS emit
// sites). The detail varies (exception type, HTTP code, Content-Type
// value); the prefix is the stable label key.
const ERROR_CLASS_LABELS: Record<string, string> = {
  extraction_failed: "Extraction failed",
  network: "Network error",
  timeout: "Timeout",
  transient: "Temporary error",
  validation: "Validation error",
};

function errorClassLabel(errorString: string | null): string {
  if (!errorString) return "Unknown error";
  const prefix = errorString.split(":")[0]?.trim() ?? "";
  return ERROR_CLASS_LABELS[prefix] ?? "Unknown error";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type Props = {
  row: SourceListRow;
  workspaceSlug: string;
};

export function SourceRow({ row, workspaceSlug }: Props) {
  void workspaceSlug;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);

  const isFailed = row.status === "failed";
  const title = row.title ?? "Untitled";

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{TYPE_LABELS[row.type]}</span>
        {isFailed ? (
          <button
            type="button"
            onClick={() => setIsErrorExpanded((v) => !v)}
            aria-expanded={isErrorExpanded}
            className="text-destructive underline-offset-4 hover:underline"
          >
            {errorClassLabel(row.error)}
          </button>
        ) : (
          <span className="text-muted-foreground">{row.status}</span>
        )}
        <span className="text-muted-foreground">
          {formatDate(row.created_at)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsModalOpen(true)}
          aria-label={`Delete ${title}`}
        >
          Delete
        </Button>
      </div>
      {isFailed && isErrorExpanded && row.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {row.error}
        </div>
      ) : null}
      <DeleteSourceDialog
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        sourceId={row.id}
        sourceTitle={title}
      />
    </li>
  );
}
