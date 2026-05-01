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

// Section B layout — sets the `authently_last_workspace_slug` cookie so
// that /app/page.tsx can preferentially redirect a returning user back
// to the workspace they were last looking at.
//
// IMPORTANT: this layout does NOT do auth/membership checks. The cookie
// reflects state, it doesn't drive auth decisions — leaf pages
// (dashboard, settings, future routes) each run their own
// `requireMembership` (or analogous) check. Adding membership gating
// here would either double-DB-hit or force every leaf to assume the
// layout did the work, which fails defence-in-depth.
//
// The cookie is httpOnly + sameSite=lax + 30-day. It's purely
// informational; even if an attacker manipulated it, /app/page.tsx
// validates the slug against actual memberships before redirecting.

import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { PastDueBanner } from "@/components/billing/past-due-banner";

// Force-dynamic rendering for the entire workspace tree. Section B
// browser smoke testing surfaced a stale-Header bug after login/logout;
// every page under /app/[slug]/* is auth-gated and inherently dynamic
// anyway, so opting out of static rendering here is free, and it
// pre-empts caching surprises in cookie-driven layouts on later
// sections. (Tracked in docs/retrospectives/SPRINT_02.md.)
export const dynamic = "force-dynamic";

const LAST_WORKSPACE_COOKIE = "authently_last_workspace_slug";
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

type Props = {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
};

export default async function WorkspaceLayout({ children, params }: Props) {
  const { workspaceSlug } = await params;
  const cookieStore = await cookies();

  // Server Component cookie writes only succeed when the request is
  // already in a writable-cookie context (Server Actions, Route
  // Handlers, or middleware). On a regular page render Next swallows
  // the throw — that's fine, the cookie was set on the navigation
  // event that triggered the render. We defensively try/catch to
  // mirror the supabase server-client cookie pattern.
  try {
    cookieStore.set(LAST_WORKSPACE_COOKIE, workspaceSlug, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: THIRTY_DAYS_SECONDS,
      path: "/",
    });
  } catch {
    // Read-only cookie context (e.g. nested Server Component render).
    // Cookie set will succeed on the next navigation entry through
    // middleware or this layout's first render.
  }

  return (
    <>
      <PastDueBanner workspaceSlug={workspaceSlug} />
      {children}
    </>
  );
}
