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

import OpenAI from "openai";

let cached: OpenAI | null = null;

/**
 * Memoized OpenAI SDK instance. Used by the transcription service
 * (Sprint 06 B1) — currently the sole consumer; future AI features
 * (remix engine in Sprint 06+, etc.) will reuse it.
 *
 * Mirrors the apps/web `getStripeClient()` and apps/jobs
 * `getJobsStripeClient()` patterns: module-level `cached`, throws on
 * missing `OPENAI_API_KEY`, no I/O at module-load time.
 *
 * `maxRetries: 0` is intentional and load-bearing. The default SDK
 * value retries 4xx-ish-but-retryable errors (5xx, 429, network) up to
 * 2 times with exponential backoff before throwing. For the
 * transcription service B1 ships, that retry budget extends the
 * server-action wall-clock past Vercel's `maxDuration: 300` ceiling
 * for files near the 25MB cap (Whisper itself takes 1-3 minutes;
 * stacking SDK retries on top can push past the platform timeout).
 *
 * Sync-UX rationale: error classification surfaces `transient:` errors
 * to the UI immediately so the user can re-submit. Silent SDK retries
 * would either (a) succeed and the user waits an unexplained extra
 * minute, or (b) fail and the user sees a generic timeout instead of
 * a specific transient/auth/openai_rejected error class. Loud and
 * immediate beats silent and slow.
 *
 * Future readers: do NOT "fix" this back to the SDK default. Retry
 * policy belongs at the user-action layer (re-submit), not inside
 * the service module.
 */
export function getOpenAIClient(): OpenAI {
  if (cached) return cached;

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. The transcription service requires it. " +
        "See apps/web/.env.local.example for local setup.",
    );
  }

  cached = new OpenAI({
    apiKey,
    maxRetries: 0,
  });
  return cached;
}

/**
 * Test-only: clear the memoized client so the next `getOpenAIClient()`
 * re-reads `OPENAI_API_KEY`. Production code never calls this. Underscore-
 * prefix convention marks the function as not-for-application-use.
 */
export function __resetClientForTests(): void {
  cached = null;
}
