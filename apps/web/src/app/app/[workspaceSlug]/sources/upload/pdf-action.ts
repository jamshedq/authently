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

"use server";

import { createSourcePdf } from "@/services/sources/create-source-pdf";
import type { UploadPdfResult } from "./types";

// Sprint 07 C2b.2 — server action for PDF source upload. Thin route per
// CLAUDE.md: validate FormData → delegate to service module → return.
// File validation (MIME, size) + rollback orchestration live in
// createSourcePdf.

export async function uploadPdfAction(
  formData: FormData,
): Promise<UploadPdfResult> {
  const file = formData.get("file");
  const workspaceId = formData.get("workspaceId");
  const title = formData.get("title");

  if (!(file instanceof File)) {
    return { ok: false, error: "validation: file_missing" };
  }
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { ok: false, error: "validation: workspace_id_missing" };
  }
  if (typeof title !== "string" || title.length === 0) {
    return { ok: false, error: "validation: title_missing" };
  }

  return createSourcePdf({ workspaceId, file, title });
}
