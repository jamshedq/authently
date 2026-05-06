#!/usr/bin/env python3
# Authently — Open-source AI content engine
# Copyright (C) 2026 The Authently Contributors
# Licensed under the GNU Affero General Public License v3.0 or later.
# See LICENSE at repo root.
"""
Sprint 07 C2a — User-uploaded PDF extraction.

Invoked by extractFromPdfTask (apps/jobs/src/trigger/extract-from-pdf.ts)
when a user uploads a PDF via the apps/web tabbed-upload page (lands in
C2b/C4). The PDF bytes live in Supabase Storage at
ws/{workspace_id}/{source_id}.pdf in the 'sources-pdf' bucket; the task
generates a short-lived signed URL and passes it as the sole argv to
this script.

Per SPRINT_07.md C2a resolution: this script accepts ONLY signed URLs
from Storage. The URL-resolves-to-PDF case (where a user-submitted URL
HEADs to application/pdf) is handled inline in extract_trafilatura.py
via the same pdfplumber import — not by this script.

Output contract per SPRINT_07.md B3-Q2:
  Success: {"ok": true, "content": "<extracted text>", "title": "<title or null>"}
  Failure: {"ok": false, "error": "<class:detail>"}

Always exits 0. Success/failure is encoded in the JSON shape only.
Pre-flight Item 1 originally documented exit codes 0/1; switched to
exit-0-always after C2a Checkpoint 3 surfaced that
@trigger.dev/python's runScript throws on non-zero exits, which would
swallow the parseable JSON inside an exception. See extract_from_url.py
for the same finding.

Error classes (prefix-encoded per B3-Q3):
  - extraction_failed: — pdfplumber returned no usable content (no text
                          layer; corrupt PDF; empty PDF)
  - network:           — Signed URL fetch failed (signed URL expired or
                          Storage object missing)
  - validation:        — argv shape wrong (developer-mistake guard)
"""
import io
import json
import sys
import urllib.error
import urllib.request
from typing import Optional

import pdfplumber

NETWORK_TIMEOUT_SECONDS = 30


def emit_success(content: str, title: Optional[str]) -> None:
    sys.stdout.write(json.dumps({"ok": True, "content": content, "title": title}))
    sys.stdout.write("\n")
    sys.exit(0)


def emit_failure(error: str) -> None:
    sys.stdout.write(json.dumps({"ok": False, "error": error}))
    sys.stdout.write("\n")
    sys.exit(0)


def main() -> None:
    if len(sys.argv) < 2:
        emit_failure("validation: usage:extract_pdfplumber.py <signed_url>")
        return

    signed_url = sys.argv[1]

    try:
        with urllib.request.urlopen(signed_url, timeout=NETWORK_TIMEOUT_SECONDS) as resp:
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


if __name__ == "__main__":
    main()
