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

// Sprint 04 A2 — full-width banner mounted in the workspace layout, below
// PastDueBanner. Renders only when the calling user is the target of a
// pending ownership transfer for the current workspace (locked decision
// Q4: banner appears in the *offered* workspace, where the action is
// naturally taken). Pattern mirrors PastDueBanner: server-fetched,
// returns null in non-actionable cases, layouts can render unconditionally.

import { silentMembershipLookup } from "@/lib/api/silent-membership";
import { AcceptTransferButton } from "./accept-transfer-button";
import { CancelTransferButton } from "./cancel-transfer-button";

type Props = {
  workspaceSlug: string;
};

export async function TransferOfferBanner({
  workspaceSlug,
}: Props): Promise<React.ReactElement | null> {
  const ctx = await silentMembershipLookup(workspaceSlug);
  if (!ctx) return null;

  const { data, error } = await ctx.supabase
    .from("workspace_ownership_transfers")
    .select("id, created_at, from_user_id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("to_user_id", ctx.user.id)
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .maybeSingle<{ id: string; created_at: string; from_user_id: string }>();

  if (error || !data) return null;

  return (
    <div
      className="border-b border-blue-200 bg-blue-50 px-6 py-3 text-[13px] text-blue-900"
      role="status"
      aria-live="polite"
    >
      <div className="container flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="leading-snug">
          <strong>Workspace ownership offer.</strong> The current owner has
          asked to transfer ownership to you. Accept to take over billing
          and admin responsibilities for this workspace.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <AcceptTransferButton workspaceSlug={workspaceSlug} />
          <CancelTransferButton
            workspaceSlug={workspaceSlug}
            label="Decline"
            successMessage="Transfer declined."
            variant="ghost"
          />
        </div>
      </div>
    </div>
  );
}
