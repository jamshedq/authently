# Authently — Open-source AI content engine
# Copyright (C) 2026 The Authently Contributors
# Licensed under the GNU Affero General Public License v3.0 or later.
# See LICENSE at repo root.
"""Sprint 07 C2.5 — pytest infrastructure smoke test.

Verifies pytest discovers tests under apps/jobs/python/tests/ and the
pythonpath = . configuration exposes both production modules for import
by name. Module-specific contract tests live in test_extract_from_url.py
and test_extract_pdfplumber.py.
"""


def test_module_imports_resolve() -> None:
    import extract_from_url
    import extract_pdfplumber

    assert hasattr(extract_from_url, "main")
    assert hasattr(extract_pdfplumber, "main")
