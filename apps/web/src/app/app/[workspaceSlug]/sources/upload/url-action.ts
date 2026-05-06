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

import { createSourceUrl } from "@/services/sources/create-source-url";
import type { UploadUrlResult } from "./types";

// Sprint 07 C2b.2 — server action for URL source upload. Thin route per
// CLAUDE.md: validate FormData → delegate to service module → return.
// Business logic (RPC + trigger + rollback) lives in createSourceUrl.

export async function uploadUrlAction(
  formData: FormData,
): Promise<UploadUrlResult> {
  const workspaceId = formData.get("workspaceId");
  const sourceUrl = formData.get("sourceUrl");

  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { ok: false, error: "validation: workspace_id_missing" };
  }
  if (typeof sourceUrl !== "string" || sourceUrl.length === 0) {
    return { ok: false, error: "validation: source_url_missing" };
  }

  return createSourceUrl({ workspaceId, sourceUrl });
}
