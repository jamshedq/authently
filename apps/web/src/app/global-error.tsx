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

// Root error boundary. Replaces the root layout when an unrecoverable error
// occurs anywhere in the App Router tree (including the root layout itself),
// so this file owns its own <html>/<body> tags.
//
// Sentry's recommended pattern for App Router (verified against current docs,
// not the deprecated Pages-Router `Sentry.captureUnderscoreErrorException`):
// capture the exception in a useEffect, then render a minimal fallback.

"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* `NextError` is Next.js's default error component. The App Router
            doesn't expose status codes for client-side errors, so 0 renders
            a generic message — a deliberate placeholder until brand-styled
            error pages land in a later sprint. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
