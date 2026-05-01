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

// Sprint 04 A1 — owner-only client trigger that opens the
// DeleteWorkspaceDialog. Lives next to the dialog so the settings page
// (a server component) can drop a single component into the danger zone
// without managing client state itself.

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DeleteWorkspaceDialog } from "@/components/delete-workspace-dialog";

type Props = {
  workspaceSlug: string;
  workspaceName: string;
};

export function DeleteWorkspaceButton({
  workspaceSlug,
  workspaceName,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete workspace
      </Button>
      <DeleteWorkspaceDialog
        open={open}
        onOpenChange={setOpen}
        workspaceSlug={workspaceSlug}
        workspaceName={workspaceName}
      />
    </>
  );
}
