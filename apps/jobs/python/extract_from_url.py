#!/usr/bin/env python3
# Authently — Open-source AI content engine
# Copyright (C) 2026 The Authently Contributors
# Licensed under the GNU Affero General Public License v3.0 or later.
# See LICENSE at repo root.
"""
Sprint 07 C2a — URL extraction entry point.

Invoked by extractFromUrlTask (apps/jobs/src/trigger/extract-from-url.ts)
after the task has done a HEAD request and decided the URL is reachable.
The task passes Content-Type along with the URL via argv so this script
trusts the routing decision (no second HEAD).

Branches on Content-Type:
  - text/html (or application/xhtml+xml) → trafilatura
  - application/pdf                       → urllib fetch + pdfplumber inline

Per SPRINT_07.md C2a resolution: the URL-resolves-to-PDF case is handled
inline in this script via pdfplumber (rather than spawning a second
subprocess) — the Python process is already warm and pdfplumber is an
in-process import. This is why the script imports both libraries despite
the filename describing the URL-extraction role rather than either
library by name. The original draft (extract_trafilatura.py) was renamed
during C2a Checkpoint 2 review to reflect that the script's job is
"URL extraction" (HTML or PDF), not "trafilatura wrapper."

Output contract per SPRINT_07.md B3-Q2:
  Success: {"ok": true, "content": "<extracted text>", "title": "<title or null>"}
  Failure: {"ok": false, "error": "<class:detail>"}

Always exits 0. Success/failure is encoded in the JSON shape only.
Pre-flight Item 1 originally documented exit codes 0/1, but the
@trigger.dev/python SDK's runScript helper throws on non-zero exits,
which would swallow the parseable failure-shape JSON inside an
exception message. Exiting 0 in both branches lets the task wrapper
read stdout cleanly and route on the JSON shape. Genuine runtime
failures (Python not installed, ImportError, etc.) still surface
via the SDK's exception path and are classified as `transient:` by
the task wrapper.

Error classes (prefix-encoded per B3-Q3):
  - extraction_failed: — Trafilatura/pdfplumber returned no usable content
  - network:           — URL fetch failed (timeout, DNS, non-2xx, urllib error)
  - validation:        — argv shape wrong (developer-mistake guard)
"""
import io
import json
import sys
import urllib.error
import urllib.request
from typing import Optional

import pdfplumber
import trafilatura

NETWORK_TIMEOUT_SECONDS = 30


def emit_success(content: str, title: Optional[str]) -> None:
    sys.stdout.write(json.dumps({"ok": True, "content": content, "title": title}))
    sys.stdout.write("\n")
    sys.exit(0)


def emit_failure(error: str) -> None:
    sys.stdout.write(json.dumps({"ok": False, "error": error}))
    sys.stdout.write("\n")
    sys.exit(0)


def extract_html(url: str) -> None:
    try:
        downloaded = trafilatura.fetch_url(url)
    except Exception as e:  # broad: trafilatura wraps multiple urllib errors
        emit_failure(f"network: fetch_url:{type(e).__name__}")
        return
    if downloaded is None:
        # trafilatura.fetch_url returns None on non-2xx, decode failures, etc.
        emit_failure("network: fetch_returned_none")
        return

    try:
        content = trafilatura.extract(downloaded)
    except Exception as e:
        emit_failure(f"extraction_failed: extract:{type(e).__name__}")
        return
    if not content:
        emit_failure("extraction_failed: no_content")
        return

    title: Optional[str] = None
    try:
        meta = trafilatura.extract_metadata(downloaded)
        if meta is not None and getattr(meta, "title", None):
            title = meta.title
    except Exception:
        # Title is best-effort — UI fallback "Untitled" handles None.
        pass

    emit_success(content, title)


def extract_pdf_from_url(url: str) -> None:
    try:
        with urllib.request.urlopen(url, timeout=NETWORK_TIMEOUT_SECONDS) as resp:
            pdf_bytes = resp.read()
    except urllib.error.HTTPError as e:
        emit_failure(f"network: http_{e.code}")
        return
    except urllib.error.URLError as e:
        emit_failure(f"network: url_error:{type(e.reason).__name__}")
        return
    except Exception as e:
        emit_failure(f"network: {type(e).__name__}")
        return

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages_text = [p.extract_text() or "" for p in pdf.pages]
            content = "\n\n".join(t for t in pages_text if t).strip()
            meta = pdf.metadata or {}
            raw_title = meta.get("Title")
            title: Optional[str] = raw_title.strip() if isinstance(raw_title, str) and raw_title.strip() else None
    except Exception as e:
        emit_failure(f"extraction_failed: pdfplumber:{type(e).__name__}")
        return

    if not content:
        emit_failure("extraction_failed: no_content")
        return

    emit_success(content, title)


def main() -> None:
    if len(sys.argv) < 3:
        emit_failure("validation: usage:extract_trafilatura.py <url> <content_type>")
        return

    url = sys.argv[1]
    raw_content_type = sys.argv[2]
    content_type = raw_content_type.split(";")[0].strip().lower()

    if content_type in ("text/html", "application/xhtml+xml"):
        extract_html(url)
    elif content_type == "application/pdf":
        extract_pdf_from_url(url)
    else:
        emit_failure(f"network: unsupported_content_type:{content_type}")


if __name__ == "__main__":
    main()
