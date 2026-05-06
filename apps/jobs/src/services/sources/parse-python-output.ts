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

// Sprint 07 C2a — shared helper used by both extract-from-url and
// extract-from-pdf tasks to parse the JSON-over-stdout protocol from
// the Python extraction modules. Surface contract per SPRINT_07.md
// B3-Q2: success carries content + optional title; failure carries
// a prefix-encoded error class per B3-Q3.
//
// Invariants this parser enforces:
//   - stdout must be non-empty (handles silent-Python-crash case)
//   - stdout must be valid JSON
//   - shape must be {ok: true, content: string, title?: string|null}
//     OR {ok: false, error: string}
// Anything else is classified as a transient runtime issue (the
// Python script violated its contract) so the task wrapper surfaces
// it via the `transient:` error class.

// Shape matches @trigger.dev/python's runScript Output type. The SDK
// reports exitCode as number | undefined (we declare it nullable in
// the same direction). Note: per Sprint 07 C2a Checkpoint 3 finding,
// the SDK throws on non-zero exit, so any successful return implies
// exitCode === 0 — but the parser remains resilient to either
// representation.
export type PythonRunResult = {
  stdout: string;
  stderr: string;
  exitCode?: number | undefined;
};

export type ExtractionPayload =
  | { ok: true; content: string; title: string | null }
  | { ok: false; error: string };

export function parsePythonOutput(result: PythonRunResult): ExtractionPayload {
  const stdout = result.stdout.trim();
  if (!stdout) {
    const exitMarker = typeof result.exitCode === "number" ? result.exitCode : "unknown";
    return {
      ok: false,
      error: `transient: python_no_stdout (exit=${exitMarker})`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      error: `transient: python_invalid_json`,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      ok: false,
      error: `transient: python_invalid_shape`,
    };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj["ok"] === true && typeof obj["content"] === "string") {
    const title = typeof obj["title"] === "string" ? obj["title"] : null;
    return { ok: true, content: obj["content"], title };
  }
  if (obj["ok"] === false && typeof obj["error"] === "string") {
    return { ok: false, error: obj["error"] };
  }

  return {
    ok: false,
    error: `transient: python_invalid_shape`,
  };
}
