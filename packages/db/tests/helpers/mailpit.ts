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

// Tiny client for Mailpit, the SMTP catcher Supabase ships in its local
// dev stack as of CLI v1.x (port 54324; older docs reference Inbucket on
// the same port — Supabase swapped backends but kept the port). Used by
// auth integration tests to read password-reset / email-confirmation
// messages without needing a real SMTP service.

const MAILPIT_BASE = process.env["MAILPIT_URL"] ?? "http://127.0.0.1:54324";

type MailpitListEntry = {
  ID: string;
  To: { Address: string; Name: string }[];
  From: { Address: string; Name: string };
  Subject: string;
  Created: string;
};

type MailpitListResponse = {
  total: number;
  count: number;
  messages: MailpitListEntry[];
};

type MailpitMessage = {
  ID: string;
  Subject: string;
  HTML: string;
  Text: string;
};

/**
 * Poll Mailpit for the most-recent message addressed to `email`. Times
 * out after `timeoutMs` if no message arrives. Returns the parsed message
 * including HTML and text bodies.
 */
export async function fetchLatestMessage(opts: {
  email: string;
  timeoutMs: number;
  pollIntervalMs?: number;
}): Promise<MailpitMessage> {
  const { email, timeoutMs, pollIntervalMs = 200 } = opts;
  const deadline = Date.now() + timeoutMs;
  // Mailpit's search API takes Gmail-style queries.
  const searchUrl = `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`;

  while (Date.now() < deadline) {
    const listRes = await fetch(searchUrl);
    if (listRes.ok) {
      const list = (await listRes.json()) as MailpitListResponse;
      if (list.messages.length > 0) {
        // Mailpit returns newest first.
        const latest = list.messages[0]!;
        const detailRes = await fetch(
          `${MAILPIT_BASE}/api/v1/message/${latest.ID}`,
        );
        if (detailRes.ok) {
          return (await detailRes.json()) as MailpitMessage;
        }
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(
    `[mailpit] No message arrived for ${email} within ${timeoutMs}ms`,
  );
}

/**
 * Delete every message in Mailpit. Tests can call this in a beforeEach
 * to keep "latest message" assertions deterministic.
 */
export async function clearAllMessages(): Promise<void> {
  await fetch(`${MAILPIT_BASE}/api/v1/messages`, { method: "DELETE" });
}
