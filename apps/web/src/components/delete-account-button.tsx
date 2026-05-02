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

// Sprint 04 A3 — client trigger that opens the DeleteAccountDialog.
// Lives next to the dialog so the account page (server component) can
// drop in a single component without hosting client state itself.
// Account page conditionally renders this only when there are no
// blocking workspaces (β policy gate is shown upfront via the inline
// list).

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DeleteAccountDialog } from "@/components/delete-account-dialog";

type Props = {
  email: string;
};

export function DeleteAccountButton({ email }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <DeleteAccountDialog
        open={open}
        onOpenChange={setOpen}
        email={email}
      />
    </>
  );
}
