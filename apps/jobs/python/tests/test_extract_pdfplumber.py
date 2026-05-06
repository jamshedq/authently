# Authently — Open-source AI content engine
# Copyright (C) 2026 The Authently Contributors
# Licensed under the GNU Affero General Public License v3.0 or later.
# See LICENSE at repo root.
"""Sprint 07 C2.5 — extract_pdfplumber.py contract tests.

Verifies the Python script's behavior for the signed-URL → pdfplumber
extraction path. The TS task wrapper passes a Storage-signed URL as the
sole argv; this script fetches the PDF via urllib and extracts text via
pdfplumber, emitting a single JSON line on stdout (always exit 0 — see
SPRINT_07_preflight.md Item 1 [CORRECTED 2026-05-06]).

Mocking strategy: stdlib only. monkeypatch.setattr targets
urllib.request.urlopen and pdfplumber.open on their respective module
objects — the production script reads each via attribute lookup at call
time, so module-level patching is observed. capsys captures stdout;
SystemExit is caught via pytest.raises since the script's emit_*
helpers always sys.exit(0).

Error class taxonomy (per SPRINT_07.md B3-Q3): only the three classes
the Python layer can observe are asserted here. timeout: and transient:
are TS-task-layer responsibilities and are NOT asserted from this file.
  - extraction_failed: — pdfplumber returned no usable content (raised, or empty)
  - network:           — urllib fetch failed (HTTPError, URLError, generic)
  - validation:        — argv shape wrong
"""
import json
import urllib.error
import urllib.request

import pdfplumber
import pytest

import extract_pdfplumber


# ---------- helpers ----------


class _FakeHTTPResponse:
    """Minimal urlopen() return value: context manager with .read()."""

    def __init__(self, body: bytes) -> None:
        self._body = body

    def __enter__(self) -> "_FakeHTTPResponse":
        return self

    def __exit__(self, *args: object) -> bool:
        return False

    def read(self) -> bytes:
        return self._body


class _FakePage:
    def __init__(self, text):
        self._text = text

    def extract_text(self):
        return self._text


class _FakePdf:
    """Minimal pdfplumber.open() return value: context manager with .pages and .metadata."""

    def __init__(self, pages_text, metadata=None):
        self.pages = [_FakePage(t) for t in pages_text]
        self.metadata = metadata

    def __enter__(self) -> "_FakePdf":
        return self

    def __exit__(self, *args: object) -> bool:
        return False


def _run_main(monkeypatch, capsys, argv, *, urlopen=None, pdf_open=None):
    """Invoke extract_pdfplumber.main() under controlled argv + mocks; return parsed JSON."""
    monkeypatch.setattr("sys.argv", argv)
    if urlopen is not None:
        monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    if pdf_open is not None:
        monkeypatch.setattr(pdfplumber, "open", pdf_open)
    with pytest.raises(SystemExit) as exc:
        extract_pdfplumber.main()
    # Always exit 0 — success/failure encoded in JSON shape only.
    assert exc.value.code == 0
    captured = capsys.readouterr()
    return json.loads(captured.out)


# ---------- happy-path tests ----------


def test_happy_path_with_title(monkeypatch, capsys) -> None:
    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_pdfplumber.py", "https://example.test/signed-url"],
        urlopen=lambda *a, **k: _FakeHTTPResponse(b"%PDF-1.4 stub"),
        pdf_open=lambda *a, **k: _FakePdf(
            ["Page one text", "Page two text"],
            metadata={"Title": "My Document"},
        ),
    )
    assert payload == {
        "ok": True,
        "content": "Page one text\n\nPage two text",
        "title": "My Document",
    }


def test_happy_path_no_title(monkeypatch, capsys) -> None:
    # metadata=None exercises the `meta = pdf.metadata or {}` defensive read.
    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_pdfplumber.py", "https://example.test/signed-url"],
        urlopen=lambda *a, **k: _FakeHTTPResponse(b"%PDF-1.4 stub"),
        pdf_open=lambda *a, **k: _FakePdf(["Body"], metadata=None),
    )
    assert payload == {"ok": True, "content": "Body", "title": None}


# ---------- network-class failure tests ----------


def test_http_error_404(monkeypatch, capsys) -> None:
    def raise_http(*a, **k):
        raise urllib.error.HTTPError(
            url=a[0] if a else "url", code=404, msg="Not Found", hdrs=None, fp=None
        )

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_pdfplumber.py", "https://example.test/signed-url"],
        urlopen=raise_http,
    )
    assert payload == {"ok": False, "error": "network: http_404"}


def test_url_error(monkeypatch, capsys) -> None:
    # URLError carries `reason`; the script reports type(e.reason).__name__.
    def raise_url(*a, **k):
        raise urllib.error.URLError(reason=ConnectionRefusedError())

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_pdfplumber.py", "https://example.test/signed-url"],
        urlopen=raise_url,
    )
    assert payload == {"ok": False, "error": "network: url_error:ConnectionRefusedError"}


def test_generic_network_exception(monkeypatch, capsys) -> None:
    """Generic catchall: urlopen raises a non-HTTPError, non-URLError exception.

    The script's third except clause classifies any unanticipated failure
    during urlopen as `network: <ExceptionName>`, NOT propagating it as
    an unhandled crash. This test asserts that classification contract —
    a regression here (e.g., a future refactor narrowing the except
    clause) would surface the failure to the TS task layer as a
    `transient: python_runtime:<ErrorName>` instead of the intended
    network:-class outcome.
    """
    def raise_timeout(*a, **k):
        raise TimeoutError("simulated raw timeout, not wrapped in URLError")

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_pdfplumber.py", "https://example.test/signed-url"],
        urlopen=raise_timeout,
    )
    assert payload == {"ok": False, "error": "network: TimeoutError"}


# ---------- extraction-failed-class failure tests ----------


def test_pdfplumber_raises(monkeypatch, capsys) -> None:
    # Any exception raised inside the pdfplumber.open `with` block is caught
    # and routed through the extraction_failed: pdfplumber:<ExceptionName> class.
    def raise_pdf(*a, **k):
        raise RuntimeError("simulated pdfplumber parse failure")

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_pdfplumber.py", "https://example.test/signed-url"],
        urlopen=lambda *a, **k: _FakeHTTPResponse(b"corrupted"),
        pdf_open=raise_pdf,
    )
    assert payload == {
        "ok": False,
        "error": "extraction_failed: pdfplumber:RuntimeError",
    }


def test_image_only_pdf_yields_no_content(monkeypatch, capsys) -> None:
    # pdfplumber returns successfully on image-only PDFs but extract_text()
    # yields None or empty per page; the script's `or ""` collapse + strip
    # yields empty content, which routes to extraction_failed: no_content
    # (NOT extraction_failed: pdfplumber:<ExceptionName> — no exception was raised).
    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_pdfplumber.py", "https://example.test/signed-url"],
        urlopen=lambda *a, **k: _FakeHTTPResponse(b"%PDF-1.4 stub"),
        pdf_open=lambda *a, **k: _FakePdf([None, ""], metadata=None),
    )
    assert payload == {"ok": False, "error": "extraction_failed: no_content"}


# ---------- validation-class failure tests ----------


def test_missing_argv(monkeypatch, capsys) -> None:
    # argv == [script_name] only (no signed_url positional) → validation: usage:...
    payload = _run_main(monkeypatch, capsys, ["extract_pdfplumber.py"])
    assert payload == {
        "ok": False,
        "error": "validation: usage:extract_pdfplumber.py <signed_url>",
    }
