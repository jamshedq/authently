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

// =============================================================================
// REMOVE BEFORE SPRINT 02.
//
// Debug-only endpoint that exercises the Sentry + Axiom SDK wiring. Gated
// on NODE_ENV === 'development' so it's a 404 in any production build —
// safe to ship to prod (it's inert there), but it should be deleted when
// the verification stops being useful.
//
// Usage (from `pnpm --filter @authently/web dev`, with envs populated):
//   GET /api/__debug/observability               → usage hint
//   GET /api/__debug/observability?sentry=1      → captures a test exception
//   GET /api/__debug/observability?axiom=1       → emits a test log line
//
// Both flags can be combined: ?sentry=1&axiom=1
//
// Verification path documented in docs/runbooks/observability.md.
// =============================================================================

import * as Sentry from "@sentry/nextjs";
import { Logger } from "next-axiom";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class ObservabilityProbeError extends Error {
  constructor() {
    super("Authently observability probe — Sentry capture test");
    this.name = "ObservabilityProbeError";
  }
}

export async function GET(request: Request): Promise<Response> {
  if (process.env["NODE_ENV"] !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const wantSentry = url.searchParams.get("sentry") === "1";
  const wantAxiom = url.searchParams.get("axiom") === "1";

  const result: Record<string, unknown> = {};

  if (wantSentry) {
    const err = new ObservabilityProbeError();
    Sentry.captureException(err, {
      tags: { source: "debug-observability", purpose: "sdk-wiring-check" },
    });
    result["sentry"] = process.env["NEXT_PUBLIC_SENTRY_DSN"]
      ? "captured (DSN set — should appear in Sentry within seconds)"
      : "captured locally (no DSN set — SDK is no-op; set NEXT_PUBLIC_SENTRY_DSN to verify upstream)";
  }

  if (wantAxiom) {
    const log = new Logger({ source: "debug-observability" });
    log.info("authently-axiom-probe", {
      ts: new Date().toISOString(),
      purpose: "sdk-wiring-check",
    });
    await log.flush();
    result["axiom"] = process.env["AXIOM_TOKEN"]
      ? "logged (AXIOM_TOKEN set — should appear in dataset within ~1 minute)"
      : "logged locally (no AXIOM_TOKEN set — SDK is no-op; set AXIOM_TOKEN/AXIOM_DATASET to verify upstream)";
  }

  if (!wantSentry && !wantAxiom) {
    return Response.json({
      hint: "append ?sentry=1 to capture a test Sentry exception, ?axiom=1 to emit a test Axiom log line, or both",
      see: "docs/runbooks/observability.md",
    });
  }

  return Response.json({ ok: true, ...result });
}
