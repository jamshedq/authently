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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadWidget } from "./upload-widget";
import { UrlTab } from "./url-tab";
import { PdfTab } from "./pdf-tab";
import { YoutubeTab } from "./youtube-tab";

// Sprint 07 C4 — tabbed upload page extension. Sprint 08 B2 widened
// to four tabs at the existing upload route: Audio (Sprint 06 widget
// mounted unchanged) | URL (text input → uploadUrlAction) | PDF
// (drag/drop → uploadPdfAction) | YouTube (text input →
// uploadYoutubeAction; Sprint 08 B2 4th-tab end-position addition
// per A3.3.1).
//
// State: local useState with "audio" as default. Preserves Sprint 06
// entry-point behavior — page loads with the audio widget visible.
// URL-param-driven state declined at C4 Checkpoint 0 discovery: no
// existing precedent in apps/web/src/ for ?tab= deep-linking, and the
// upload page doesn't have a deep-linking requirement that would
// justify the additional complexity.

type Props = {
  workspaceId: string;
  workspaceSlug: string;
};

export function UploadTabs({ workspaceId, workspaceSlug }: Props) {
  const [activeTab, setActiveTab] = useState("audio");

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="w-full"
    >
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="audio">Audio</TabsTrigger>
        <TabsTrigger value="url">URL</TabsTrigger>
        <TabsTrigger value="pdf">PDF</TabsTrigger>
        <TabsTrigger value="youtube">YouTube</TabsTrigger>
      </TabsList>
      <TabsContent value="audio">
        <UploadWidget
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
        />
      </TabsContent>
      <TabsContent value="url">
        <UrlTab workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
      </TabsContent>
      <TabsContent value="pdf">
        <PdfTab workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
      </TabsContent>
      <TabsContent value="youtube">
        <YoutubeTab workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
      </TabsContent>
    </Tabs>
  );
}
