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

// Sprint 04 A2 — owner-only client trigger that opens the
// InitiateTransferDialog. Lives next to the dialog so the settings page
// (server component) can drop a single component into the danger zone.

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InitiateTransferDialog,
  type TransferCandidate,
} from "@/components/initiate-transfer-dialog";

type Props = {
  workspaceSlug: string;
  workspaceName: string;
  candidates: readonly TransferCandidate[];
};

export function InitiateTransferButton({
  workspaceSlug,
  workspaceName,
  candidates,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Transfer ownership
      </Button>
      <InitiateTransferDialog
        open={open}
        onOpenChange={setOpen}
        workspaceSlug={workspaceSlug}
        workspaceName={workspaceName}
        candidates={candidates}
      />
    </>
  );
}
