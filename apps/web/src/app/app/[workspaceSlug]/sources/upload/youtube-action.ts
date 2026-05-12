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

import { createSourceYoutube } from "@/services/sources/create-source-youtube";
import type { UploadYoutubeResult } from "./types";

// Sprint 08 B2 — server action for YouTube source upload. Mirrors
// uploadUrlAction's shape per A5.2 forward-coupling lock — ensures
// B4's eventual caller migration is a uniform "swap createSourceX()
// for createSource()" across all four action handlers.
//
// Domain regex (server-side per A3.2): must match youtube.com,
// youtu.be, m.youtube.com, or music.youtube.com. Client-side does
// the same check for instant feedback; server-side is authoritative.
// yt-dlp at extraction time is the canonical "is this a single
// video" parser (per A3.1 route (i)).

const YOUTUBE_DOMAIN_RE =
  /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//;

export async function uploadYoutubeAction(
  formData: FormData,
): Promise<UploadYoutubeResult> {
  const workspaceId = formData.get("workspaceId");
  const sourceUrl = formData.get("sourceUrl");

  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { ok: false, error: "validation: workspace_id_missing" };
  }
  if (typeof sourceUrl !== "string" || sourceUrl.length === 0) {
    return { ok: false, error: "validation: source_url_missing" };
  }

  if (!YOUTUBE_DOMAIN_RE.test(sourceUrl)) {
    return {
      ok: false,
      error:
        "validation: not_youtube_domain (expected youtube.com / youtu.be / m.youtube.com / music.youtube.com)",
    };
  }

  return createSourceYoutube({ workspaceId, sourceUrl });
}
