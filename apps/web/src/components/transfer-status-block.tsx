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

// Sprint 04 A2 — settings-page status block for a pending ownership
// transfer. Renders nothing if no pending transfer. Conditional copy
// based on caller's role in the transfer (locked Q4):
//   - Owner (from_user_id) sees: "Transfer pending: → [target] · Initiated [date]"
//     with [Cancel transfer] button
//   - Target (to_user_id) sees: "Pending transfer to you · Use the
//     banner above to accept" with [Decline] button
// Same component, conditional rendering by auth.uid() vs from/to.

import type { AuthentlyServerClient } from "@/lib/supabase/server";
import { listWorkspaceMembers } from "@/services/members/list-members";
import { CancelTransferButton } from "./cancel-transfer-button";

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
  supabase: AuthentlyServerClient;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type PendingTransfer = {
  id: string;
  created_at: string;
  from_user_id: string;
  to_user_id: string;
};

type MemberLite = {
  userId: string;
  email: string | null;
  fullName: string | null;
};

function displayName(member: MemberLite | undefined): string {
  if (!member) return "another member";
  return member.fullName ?? member.email ?? "another member";
}

export async function TransferStatusBlock({
  workspaceSlug,
  workspaceId,
  currentUserId,
  supabase,
}: Props): Promise<React.ReactElement | null> {
  const { data: pending, error } = await supabase
    .from("workspace_ownership_transfers")
    .select("id, created_at, from_user_id, to_user_id")
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .maybeSingle<PendingTransfer>();

  if (error || !pending) return null;

  const members = await listWorkspaceMembers(supabase, workspaceSlug);
  const memberMap = new Map<string, MemberLite>();
  for (const m of members) {
    memberMap.set(m.userId, {
      userId: m.userId,
      email: m.email,
      fullName: m.fullName,
    });
  }

  const isFrom = pending.from_user_id === currentUserId;
  const isTo = pending.to_user_id === currentUserId;

  if (!isFrom && !isTo) return null;

  const initiatedLabel = formatDate(pending.created_at);

  if (isFrom) {
    const targetName = displayName(memberMap.get(pending.to_user_id));
    return (
      <section
        className="rounded-md border border-blue-200 bg-blue-50/60 px-4 py-3 text-[13px] text-blue-900"
        aria-label="Pending ownership transfer"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="leading-snug">
            <strong>Transfer pending</strong> → {targetName} · Initiated{" "}
            {initiatedLabel}
          </p>
          <CancelTransferButton
            workspaceSlug={workspaceSlug}
            label="Cancel transfer"
            successMessage="Transfer cancelled."
            variant="ghost"
          />
        </div>
      </section>
    );
  }

  // Target view (isTo).
  return (
    <section
      className="rounded-md border border-blue-200 bg-blue-50/60 px-4 py-3 text-[13px] text-blue-900"
      aria-label="Pending ownership transfer to you"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="leading-snug">
          <strong>Pending transfer to you.</strong> Use the banner above
          to accept, or decline here.
        </p>
        <CancelTransferButton
          workspaceSlug={workspaceSlug}
          label="Decline"
          successMessage="Transfer declined."
          variant="ghost"
        />
      </div>
    </section>
  );
}
