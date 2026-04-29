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

// Inline HTML template for workspace invitations. Plain template
// literals — no JSX runtime needed for one email type. When we add a
// second template (password reset over Resend, billing receipts, etc.)
// extract into React Email or a shared layout function.
//
// HTML escaping: the only interpolated user data is workspaceName +
// inviterName + role + acceptUrl. Names get escaped via escapeHtml;
// role is enum-validated upstream; acceptUrl is constructed
// server-side from SITE_URL + a hex token (no user input on the URL).

type Args = {
  workspaceName: string;
  inviterName: string | null;
  inviterEmail: string;
  role: "admin" | "editor" | "viewer";
  acceptUrl: string;
};

type Rendered = { subject: string; html: string; text: string };

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ROLE_LABEL: Record<Args["role"], string> = {
  admin: "an admin",
  editor: "an editor",
  viewer: "a viewer",
};

export function renderInvitationEmail(args: Args): Rendered {
  const safeWorkspace = escapeHtml(args.workspaceName);
  const inviterDisplay = args.inviterName?.trim()
    ? `${args.inviterName} (${args.inviterEmail})`
    : args.inviterEmail;
  const safeInviter = escapeHtml(inviterDisplay);
  const roleLabel = ROLE_LABEL[args.role];

  const subject = `You're invited to ${args.workspaceName} on Authently`;

  const text = [
    `${safeInviter} invited you to join ${args.workspaceName} on Authently as ${roleLabel}.`,
    ``,
    `Accept the invitation:`,
    args.acceptUrl,
    ``,
    `If you weren't expecting this email, you can safely ignore it. The link expires in 7 days.`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#fafafa;font-family:'Inter',system-ui,sans-serif;color:#0d0d0d;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid rgba(0,0,0,0.05);border-radius:16px;padding:32px;">
            <tr><td>
              <p style="margin:0 0 16px;font-size:13px;letter-spacing:0.6px;text-transform:uppercase;color:#666666;">Authently</p>
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:600;letter-spacing:-0.24px;color:#0d0d0d;">
                You're invited to ${safeWorkspace}
              </h1>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#333333;">
                ${safeInviter} invited you to join <strong>${safeWorkspace}</strong> on Authently as ${roleLabel}.
              </p>
              <p style="margin:24px 0;">
                <a href="${args.acceptUrl}" style="display:inline-block;background:#0d0d0d;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:8px 24px;border-radius:9999px;">
                  Accept invitation
                </a>
              </p>
              <p style="margin:0 0 8px;font-size:13px;color:#666666;">
                Or paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;font-size:13px;color:#888888;word-break:break-all;">
                ${args.acceptUrl}
              </p>
              <p style="margin:0;font-size:12px;color:#888888;">
                This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.
              </p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
