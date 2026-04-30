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

// Resend transport for transactional emails (Sprint 02 ships with one
// email type — workspace invitations).
//
// **No-op when RESEND_API_KEY is unset.** This is the test/CI/dev
// escape hatch: the absence of the key signals "log to console + return
// success" without any mocking framework. CI never sets the key, so
// CI never hits Resend's free-tier rate limits. Local dev can set the
// key in apps/web/.env.local to actually receive emails.
//
// Sprint 02 from-address: "Authently <onboarding@resend.dev>" — Resend's
// shared dev domain. Sprint 12 prep swaps to noreply@authently.io after
// DNS verification.

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type SendEmailResult = { ok: true } | { ok: false; error: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Authently <onboarding@resend.dev>";

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM"] ?? DEFAULT_FROM;

  if (!apiKey) {
    // Log-and-return shape lets tests + dev iterate without an API key.
    // Subject + recipient only — body is verbose for the console.
    console.log(
      `[email:noop] would send to=${args.to} subject="${args.subject}" (set RESEND_API_KEY to enable)`,
    );
    return { ok: true };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[email:resend] failed status=${res.status} body=${body.slice(0, 200)}`,
      );
      // ===== TODO(REMOVE BEFORE SECTION D) =====
      // Dev smoke-test fallback. Resend's free tier rejects sends to
      // addresses other than the account owner; when that happens here,
      // dump the full email body to the dev server console so we can
      // extract invitation links manually for multi-user testing. This
      // intentionally logs the rendered HTML — DO NOT SHIP. Strip this
      // block before starting Section D billing work.
      console.info(
        [
          "===== [email:dev-fallback] BEGIN — Resend send failed; logging full body =====",
          `to:      ${args.to}`,
          `subject: ${args.subject}`,
          "----- text -----",
          args.text,
          "----- html -----",
          args.html,
          "===== [email:dev-fallback] END =====",
        ].join("\n"),
      );
      // ===== END TODO =====
      return { ok: false, error: `resend ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email:resend] network error", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network error",
    };
  }
}
