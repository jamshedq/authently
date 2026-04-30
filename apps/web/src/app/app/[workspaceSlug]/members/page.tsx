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

// /app/[workspaceSlug]/members — open to all roles. requireMembership
// runs the auth + membership gate (no role restriction). The page
// fetches members + pending invitations, then renders three sections:
//   - Invite form           (rendered only for owner/admin)
//   - Members list          (everyone sees; mutation controls per-row
//                            are gated inside <MemberRow/>)
//   - Pending invitations   (everyone sees; revoke button gated)
//
// Server-side data fetches:
//   - listWorkspaceMembers(slug) → SECURITY DEFINER api_list_workspace_members
//   - listPendingInvitations(workspaceId) → RLS-gated SELECT
//
// `isLastOwner` for the actor is computed inline so the leave button
// can disable + tooltip without a separate API call.

import { InvitationRow } from "@/components/invitation-row";
import { InviteMemberForm } from "@/components/invite-member-form";
import { MemberRow } from "@/components/member-row";
import { requireMembership } from "@/lib/api/require-membership";
import { listPendingInvitations } from "@/services/invitations/list-invitations";
import { listWorkspaceMembers } from "@/services/members/list-members";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { supabase, user, workspace, role } = await requireMembership(
    workspaceSlug,
  );

  const [members, invitations] = await Promise.all([
    listWorkspaceMembers(supabase, workspace.slug),
    listPendingInvitations(supabase, workspace.id),
  ]);

  const isOwner = role === "owner";
  const isAdmin = role === "admin";
  const canMutate = isOwner || isAdmin;

  const ownerCount = members.filter((m) => m.role === "owner").length;
  const actorIsLastOwner = isOwner && ownerCount === 1;

  return (
    <main className="container max-w-3xl py-12">
      <div className="space-y-1.5">
        <p className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
          Members
        </p>
        <h1 className="text-[24px] font-medium leading-tight tracking-[-0.24px] text-foreground">
          {workspace.name}
        </h1>
        <p className="text-[13px] text-muted-foreground">
          {members.length} {members.length === 1 ? "member" : "members"}
          {invitations.length > 0
            ? ` · ${invitations.length} pending`
            : ""}
        </p>
      </div>

      <div className="mt-10 space-y-12">
        {canMutate ? (
          <section className="space-y-3">
            <h2 className="text-[18px] font-medium tracking-[-0.18px] text-foreground">
              Invite a teammate
            </h2>
            <p className="text-[13px] text-muted-foreground">
              They&apos;ll get an email with a link that expires in 7 days.
              {isAdmin
                ? " Admins can grant editor or viewer roles."
                : " Owners can grant admin, editor, or viewer roles."}
            </p>
            <InviteMemberForm
              workspaceSlug={workspace.slug}
              actorRole={isOwner ? "owner" : "admin"}
            />
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-[18px] font-medium tracking-[-0.18px] text-foreground">
            Members
          </h2>
          <div className="rounded-2xl border border-border/60 bg-background px-5">
            {members.map((m) => (
              <MemberRow
                key={m.userId}
                workspaceSlug={workspace.slug}
                workspaceName={workspace.name}
                member={m}
                actorRole={role}
                isSelf={m.userId === user.id}
                isLastOwner={
                  m.userId === user.id ? actorIsLastOwner : false
                }
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[18px] font-medium tracking-[-0.18px] text-foreground">
            Pending invitations
          </h2>
          {invitations.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No pending invitations.
              {canMutate
                ? " Use the form above to invite someone."
                : ""}
            </p>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-background px-5">
              {invitations.map((inv) => (
                <InvitationRow
                  key={inv.id}
                  workspaceSlug={workspace.slug}
                  invitation={inv}
                  canRevoke={canMutate}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
