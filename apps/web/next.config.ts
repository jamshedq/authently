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

import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // The shared/db packages ship as TypeScript source (no build step). Next
  // must transpile them on the fly.
  transpilePackages: ["@authently/shared", "@authently/db"],
  reactStrictMode: true,
  experimental: {
    // Server Actions are on by default in Next 15; nothing to opt into here.
  },
};

// Sentry wraps the build to support source maps + tracing. Without
// SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT set, source-map upload is
// skipped — the SDK still initializes at runtime via instrumentation.ts.
const sentryOrg = process.env["SENTRY_ORG"];
const sentryProject = process.env["SENTRY_PROJECT"];
const sentryAuthToken = process.env["SENTRY_AUTH_TOKEN"];

export default withSentryConfig(nextConfig, {
  silent: true,
  hideSourceMaps: true,
  disableLogger: true,
  ...(sentryOrg ? { org: sentryOrg } : {}),
  ...(sentryProject ? { project: sentryProject } : {}),
  ...(sentryAuthToken ? { authToken: sentryAuthToken } : {}),
});
