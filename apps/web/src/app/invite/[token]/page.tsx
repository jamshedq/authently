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

// Public invitation accept landing. Branches:
//   - invalid / expired / accepted     → "no longer valid" copy
//   - valid + anonymous                → sign-in / sign-up CTAs with
//                                        ?next=/invite/{token}
//   - valid + authed + email match     → AcceptInvitationButton
//   - valid + authed + email mismatch  → "wrong account" copy
//
// The lookup envelope (api_lookup_invitation) is anti-enumerating —
// invalid / expired / accepted are indistinguishable to the caller.
// We render a single "no longer valid" branch for all of them.
//
// Token comes through the URL path; we encodeURIComponent it before
// reusing it in client-bound URLs to defend against odd characters
// (the DB-issued tokens are hex, but the page accepts any string and
// the lookup will simply return "invalid" for anything bogus).

import Link from "next/link";
import { Header } from "@/components/header";
import { AcceptInvitationButton } from "@/components/accept-invitation-button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { lookupInvitation } from "@/services/invitations/lookup-invitation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
};

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="container">
        <div className="mx-auto max-w-md space-y-6 py-20">{children}</div>
      </main>
    </>
  );
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();
  const lookup = await lookupInvitation(supabase, token);

  if (lookup.status !== "valid") {
    return (
      <InviteShell>
        <div className="space-y-3">
          <p className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
            Invitation
          </p>
          <h1 className="text-[24px] font-medium leading-tight tracking-[-0.24px] text-foreground">
            This link is no longer valid
          </h1>
          <p className="text-[14px] text-muted-foreground">
            The invitation may have expired, been revoked, or already been
            accepted. Ask the workspace owner to send a new one.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex h-9 items-center rounded-full border border-input bg-background px-4 text-[14px] font-medium text-foreground transition hover:opacity-90"
        >
          Back to home
        </Link>
      </InviteShell>
    );
  }

  const { data: { user } } = await supabase.auth.getUser();
  const nextPath = `/invite/${encodeURIComponent(token)}`;

  // Valid + anonymous: sign-up / sign-in CTAs with `?next=` carrying
  // the invite URL through the auth flow.
  if (!user) {
    const signUpHref = `/sign-up?next=${encodeURIComponent(nextPath)}`;
    const signInHref = `/login?next=${encodeURIComponent(nextPath)}`;
    return (
      <InviteShell>
        <div className="space-y-3">
          <p className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
            You&apos;re invited
          </p>
          <h1 className="text-[24px] font-medium leading-tight tracking-[-0.24px] text-foreground">
            Join {lookup.workspaceName} as {lookup.role}
          </h1>
          <p className="text-[14px] text-muted-foreground">
            Sign in or create an Authently account to accept. The
            invitation is for{" "}
            <span className="font-medium text-foreground">{lookup.emailHint}</span>.
          </p>
        </div>
        <div className="space-y-2">
          <Link
            href={signUpHref}
            className="inline-flex h-10 w-full items-center justify-center rounded-full bg-foreground px-4 text-[15px] font-medium text-background transition hover:opacity-90"
          >
            Create account
          </Link>
          <Link
            href={signInHref}
            className="inline-flex h-10 w-full items-center justify-center rounded-full border border-input bg-background px-4 text-[15px] font-medium text-foreground transition hover:opacity-90"
          >
            I already have an account
          </Link>
        </div>
      </InviteShell>
    );
  }

  // Valid + authed: check email match. We don't have the full invitee
  // email (anti-enumeration), but the api_accept_invitation RPC enforces
  // the strict match server-side. We surface a UX warning if the user's
  // email obviously doesn't match the hint pattern; otherwise offer the
  // accept button and let the server be authoritative.
  const userEmail = (user.email ?? "").toLowerCase();
  const emailHintLower = lookup.emailHint.toLowerCase();
  // emailHint shape is "x***@domain.com". Compare first char + domain.
  const userFirst = userEmail.charAt(0);
  const userDomain = userEmail.split("@")[1] ?? "";
  const hintFirst = emailHintLower.charAt(0);
  const hintDomain = emailHintLower.split("@")[1] ?? "";
  const looksMismatched =
    userFirst !== hintFirst || userDomain !== hintDomain;

  if (looksMismatched) {
    return (
      <InviteShell>
        <div className="space-y-3">
          <p className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
            Wrong account
          </p>
          <h1 className="text-[24px] font-medium leading-tight tracking-[-0.24px] text-foreground">
            This invitation is for {lookup.emailHint}
          </h1>
          <p className="text-[14px] text-muted-foreground">
            You&apos;re signed in as{" "}
            <span className="font-medium text-foreground">{user.email}</span>.
            Sign out and sign back in with the invited address to join{" "}
            {lookup.workspaceName}.
          </p>
        </div>
        <div className="space-y-2">
          <Link
            href="/app/account"
            className="inline-flex h-10 w-full items-center justify-center rounded-full border border-input bg-background px-4 text-[15px] font-medium text-foreground transition hover:opacity-90"
          >
            Account settings
          </Link>
        </div>
      </InviteShell>
    );
  }

  return (
    <InviteShell>
      <div className="space-y-3">
        <p className="font-mono text-[12px] uppercase tracking-[0.6px] text-muted-foreground">
          You&apos;re invited
        </p>
        <h1 className="text-[24px] font-medium leading-tight tracking-[-0.24px] text-foreground">
          Join {lookup.workspaceName} as {lookup.role}
        </h1>
        <p className="text-[14px] text-muted-foreground">
          You&apos;ll get the {lookup.role} role on this workspace.
        </p>
      </div>
      <AcceptInvitationButton
        token={token}
        workspaceName={lookup.workspaceName}
      />
    </InviteShell>
  );
}
