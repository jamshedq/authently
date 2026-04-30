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

// Centralised open-redirect guard for the `?next=` URL parameter.
// Used by:
//   - /auth/callback           (PKCE code exchange landing)
//   - /login form               (post-sign-in redirect)
//   - /sign-up form             (post-confirmation redirect)
// Any future flow that accepts `?next=` should call this helper.
//
// Rejection rules (anything that fails returns the default fallback):
//   - null / empty string                         → no input
//   - doesn't start with '/'                      → could be `https://evil.com`
//   - starts with '//'                            → protocol-relative URL
//   - starts with '/\\' or '\\'                  → Windows-style path manipulation
//   - contains a literal newline / carriage return → header-splitting / malformed
//
// Anything that survives is a path on our origin only, which the caller
// composes with NEXT_PUBLIC_SITE_URL for absolute URLs.

const DEFAULT_FALLBACK = "/app";

export function safeNext(
  rawNext: string | null,
  fallback: string = DEFAULT_FALLBACK,
): string {
  if (!rawNext) return fallback;
  if (typeof rawNext !== "string") return fallback;
  if (!rawNext.startsWith("/")) return fallback;
  if (rawNext.startsWith("//")) return fallback;
  if (rawNext.startsWith("/\\") || rawNext.startsWith("\\")) return fallback;
  if (rawNext.includes("\n") || rawNext.includes("\r")) return fallback;
  return rawNext;
}
