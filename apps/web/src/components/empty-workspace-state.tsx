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

// Section B3 — empty-state surface for users with zero workspace
// memberships. In the normal flow the sign-up trigger creates one, so
// this branch is reached only as recovery (workspace deleted while the
// user wasn't a member of any other — Sprint 03+ will surface this
// route deliberately when delete lands).
//
// Client Component because it owns the Create-Workspace dialog's
// open/closed state. The Server Component caller renders the page shell
// (Header, layout container) and embeds <EmptyWorkspaceState />
// underneath so the rest of the app chrome stays server-rendered.

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";

export function EmptyWorkspaceState() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <p className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
          No workspaces yet
        </p>
        <h1 className="text-[24px] font-medium leading-tight tracking-[-0.24px] text-foreground">
          Create your first workspace
        </h1>
        <p className="text-[14px] text-muted-foreground">
          Workspaces keep your content, members, and integrations
          separate. You&apos;ll be the owner — invite teammates later from
          the workspace settings page.
        </p>
        <Button onClick={() => setDialogOpen(true)} className="mt-2">
          Create workspace
        </Button>
      </div>
      <CreateWorkspaceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
