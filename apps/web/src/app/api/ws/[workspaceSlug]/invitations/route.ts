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

// POST /api/ws/[workspaceSlug]/invitations
//
// Creates a new pending invitation and emails the recipient. Owner/
// admin only via withMembership requireRole gate. The DB INSERT is
// also gated by `invitations_owner_admin_insert` RLS — defence-in-
// depth on top of the API check.

import { NextResponse } from "next/server";
import { withMembership } from "@/lib/api/with-membership";
import { CreateInvitationSchema } from "@/lib/schemas/invitations";
import { sendEmail } from "@/lib/email/client";
import { renderInvitationEmail } from "@/lib/email/templates/invitation";
import { getServerEnv } from "@/lib/env";
import { createInvitation } from "@/services/invitations/create-invitation";

export const POST = withMembership(
  async ({ request, supabase, user, workspace }) => {
    const body = await request.json().catch(() => ({}));
    const parsed = CreateInvitationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const created = await createInvitation(supabase, {
      workspaceId: workspace.id,
      invitedBy: user.id,
      email: parsed.data.email,
      role: parsed.data.role,
    });

    const env = getServerEnv();
    const acceptUrl = `${env.NEXT_PUBLIC_SITE_URL}/invite/${created.rawToken}`;
    const inviterName =
      typeof user.user_metadata?.["full_name"] === "string"
        ? (user.user_metadata["full_name"] as string)
        : null;

    const rendered = renderInvitationEmail({
      workspaceName: workspace.name,
      inviterName,
      inviterEmail: user.email ?? "",
      role: parsed.data.role,
      acceptUrl,
    });

    // Email is best-effort: a delivery failure shouldn't block the
    // invitation row that's already persisted. The owner/admin can
    // resend via "revoke + re-invite" if the user reports they didn't
    // get the email. Real delivery monitoring lands in Sprint 12 prep.
    const emailResult = await sendEmail({
      to: parsed.data.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    return NextResponse.json(
      {
        ok: true,
        invitation: {
          id: created.id,
          email: created.email,
          role: created.role,
          expiresAt: created.expiresAt,
        },
        emailDelivered: emailResult.ok,
      },
      { status: 201 },
    );
  },
  { requireRole: ["owner", "admin"] },
);
