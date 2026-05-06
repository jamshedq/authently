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

import { describe, expect, test } from "vitest";
import { parsePythonOutput } from "../../../src/services/sources/parse-python-output.ts";

// Pure-function tests for the JSON-stdout protocol parser. Covers the
// success shape, the failure shape, and every contract violation path
// the parser routes to `transient:` (no stdout, invalid JSON,
// unexpected shape).

describe("parsePythonOutput", () => {
  test("success shape with content + title", () => {
    const result = parsePythonOutput({
      stdout: '{"ok": true, "content": "extracted", "title": "Page Title"}\n',
      stderr: "",
      exitCode: 0,
    });
    expect(result).toEqual({
      ok: true,
      content: "extracted",
      title: "Page Title",
    });
  });

  test("success shape with null title (extraction yielded none)", () => {
    const result = parsePythonOutput({
      stdout: '{"ok": true, "content": "extracted", "title": null}\n',
      stderr: "",
      exitCode: 0,
    });
    expect(result).toEqual({ ok: true, content: "extracted", title: null });
  });

  test("failure shape with prefix-encoded error class", () => {
    const result = parsePythonOutput({
      stdout: '{"ok": false, "error": "network: timeout"}\n',
      stderr: "",
      exitCode: 0,
    });
    expect(result).toEqual({ ok: false, error: "network: timeout" });
  });

  test("empty stdout → transient: python_no_stdout", () => {
    const result = parsePythonOutput({
      stdout: "",
      stderr: "Killed by signal 9",
      exitCode: 137,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("transient: python_no_stdout");
      expect(result.error).toContain("137");
    }
  });

  test("invalid JSON → transient: python_invalid_json", () => {
    const result = parsePythonOutput({
      stdout: "not json at all",
      stderr: "",
      exitCode: 0,
    });
    expect(result).toEqual({ ok: false, error: "transient: python_invalid_json" });
  });

  test("unexpected shape (missing required fields) → transient: python_invalid_shape", () => {
    const result = parsePythonOutput({
      stdout: '{"status": "ok"}\n',
      stderr: "",
      exitCode: 0,
    });
    expect(result).toEqual({ ok: false, error: "transient: python_invalid_shape" });
  });

  test("ok=true without content → transient: python_invalid_shape", () => {
    const result = parsePythonOutput({
      stdout: '{"ok": true}\n',
      stderr: "",
      exitCode: 0,
    });
    expect(result).toEqual({ ok: false, error: "transient: python_invalid_shape" });
  });
});
