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

// POST /api/ws/[workspaceSlug]/billing/portal
//
// Owner-only. Returns a Stripe Customer Portal session URL the client can
// redirect to. Requires a workspace.stripe_customer_id; if absent, returns
// 400 NOT_SUBSCRIBED so the UI can fall back to a "Subscribe" CTA or
// (for past_due-but-orphaned cases) a support contact link.

import { withMembership } from "@/lib/api/with-membership";
import { errorResponse } from "@/lib/api/error-response";
import { createPortalSession } from "@/services/billing/create-portal-session";
import { getBillingState } from "@/services/billing/get-billing-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withMembership(
  async (ctx) => {
    let billing;
    try {
      billing = await getBillingState(ctx.supabase, ctx.workspace.id);
    } catch (err) {
      return errorResponse(err);
    }
    if (!billing) {
      return Response.json(
        { error: "FORBIDDEN", message: "Workspace not accessible." },
        { status: 403 },
      );
    }

    if (!billing.stripe_customer_id) {
      return Response.json(
        {
          error: "NOT_SUBSCRIBED",
          message:
            "This workspace has no Stripe customer record. Subscribe to a paid plan first.",
        },
        { status: 400 },
      );
    }

    try {
      const result = await createPortalSession({
        customerId: billing.stripe_customer_id,
        workspaceSlug: ctx.workspace.slug,
      });
      return Response.json({ url: result.url });
    } catch (err) {
      return errorResponse(err);
    }
  },
  { requireRole: ["owner"] },
);
