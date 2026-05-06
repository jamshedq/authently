# Authently — Open-source AI content engine
# Copyright (C) 2026 The Authently Contributors
# Licensed under the GNU Affero General Public License v3.0 or later.
# See LICENSE at repo root.
"""Sprint 07 C2.5 — extract_from_url.py contract tests.

Verifies the dual-path script's behavior across both extraction routes:
  - text/html (and application/xhtml+xml) → trafilatura
  - application/pdf                       → urllib + inline pdfplumber

Coverage explicitly splits the dual paths so a regression in either branch
is legible. Branch-logic tests (Content-Type parsing, unsupported types)
cover the dispatch decision separately.

Mocking strategy: stdlib only. monkeypatch.setattr targets module-level
symbols (trafilatura.fetch_url, trafilatura.extract,
trafilatura.extract_metadata, urllib.request.urlopen, pdfplumber.open) that
the production script reads via attribute lookup at call time. capsys
captures stdout; SystemExit is caught via pytest.raises since the script's
emit_* helpers always sys.exit(0).

Error class taxonomy (per SPRINT_07.md B3-Q3): only the three classes the
Python layer can observe are asserted here. timeout: and transient: are
TS-task-layer responsibilities and are NOT asserted from this file.
"""
import json
import urllib.error
import urllib.request

import pdfplumber
import pytest
import trafilatura

import extract_from_url


# ---------- helpers ----------


class _FakeHTTPResponse:
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
    def __init__(self, pages_text, metadata=None):
        self.pages = [_FakePage(t) for t in pages_text]
        self.metadata = metadata

    def __enter__(self) -> "_FakePdf":
        return self

    def __exit__(self, *args: object) -> bool:
        return False


class _FakeMetadata:
    """Minimal trafilatura metadata object exposing a .title attribute."""

    def __init__(self, title=None):
        self.title = title


def _run_main(monkeypatch, capsys, argv, *, mocks=None):
    """Invoke extract_from_url.main() under controlled argv + mocks; return parsed JSON."""
    monkeypatch.setattr("sys.argv", argv)
    mocks = mocks or {}
    if "fetch_url" in mocks:
        monkeypatch.setattr(trafilatura, "fetch_url", mocks["fetch_url"])
    if "extract" in mocks:
        monkeypatch.setattr(trafilatura, "extract", mocks["extract"])
    if "extract_metadata" in mocks:
        monkeypatch.setattr(trafilatura, "extract_metadata", mocks["extract_metadata"])
    if "urlopen" in mocks:
        monkeypatch.setattr(urllib.request, "urlopen", mocks["urlopen"])
    if "pdf_open" in mocks:
        monkeypatch.setattr(pdfplumber, "open", mocks["pdf_open"])
    with pytest.raises(SystemExit) as exc:
        extract_from_url.main()
    # Always exit 0 — success/failure encoded in JSON shape only.
    assert exc.value.code == 0
    captured = capsys.readouterr()
    return json.loads(captured.out)


# ============================================================
# URL → HTML path (Content-Type: text/html | application/xhtml+xml)
# ============================================================


def test_html_happy_path(monkeypatch, capsys) -> None:
    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/article", "text/html"],
        mocks={
            "fetch_url": lambda url: "<html><body>doc</body></html>",
            "extract": lambda html: "Extracted body text",
            "extract_metadata": lambda html: _FakeMetadata(title="Article Title"),
        },
    )
    assert payload == {
        "ok": True,
        "content": "Extracted body text",
        "title": "Article Title",
    }


def test_html_fetch_url_returns_none(monkeypatch, capsys) -> None:
    """fetch_url returning None (non-exceptional failure path).

    trafilatura.fetch_url documents returning None on non-2xx, decode
    failures, etc. The script's `if downloaded is None` branch routes
    this to network: fetch_returned_none — distinct from the
    `except Exception` catchall around fetch_url.
    """
    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/article", "text/html"],
        mocks={"fetch_url": lambda url: None},
    )
    assert payload == {"ok": False, "error": "network: fetch_returned_none"}


def test_html_fetch_url_raises(monkeypatch, capsys) -> None:
    """fetch_url raising (catchall) → network: fetch_url:<ExceptionName>.

    The script's broad `except Exception` around fetch_url is the
    classification backstop: trafilatura wraps several urllib errors
    into its own exceptions, and any unanticipated exception type still
    needs to land in the network: class. Same classification-contract
    reasoning as the urllib generic-catchall test in the PDF path.
    """

    def raise_fetch(url):
        raise RuntimeError("simulated trafilatura internal failure")

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/article", "text/html"],
        mocks={"fetch_url": raise_fetch},
    )
    assert payload == {"ok": False, "error": "network: fetch_url:RuntimeError"}


def test_html_extract_returns_empty(monkeypatch, capsys) -> None:
    """extract returning empty/None → extraction_failed: no_content."""
    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/article", "text/html"],
        mocks={
            "fetch_url": lambda url: "<html></html>",
            "extract": lambda html: "",
        },
    )
    assert payload == {"ok": False, "error": "extraction_failed: no_content"}


def test_html_extract_raises(monkeypatch, capsys) -> None:
    """extract raising → extraction_failed: extract:<ExceptionName>."""

    def raise_extract(html):
        raise ValueError("simulated trafilatura parse failure")

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/article", "text/html"],
        mocks={
            "fetch_url": lambda url: "<html></html>",
            "extract": raise_extract,
        },
    )
    assert payload == {"ok": False, "error": "extraction_failed: extract:ValueError"}


# ============================================================
# URL → PDF path (Content-Type: application/pdf)
# ============================================================


def test_pdf_happy_path(monkeypatch, capsys) -> None:
    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/file.pdf", "application/pdf"],
        mocks={
            "urlopen": lambda *a, **k: _FakeHTTPResponse(b"%PDF-1.4 stub"),
            "pdf_open": lambda *a, **k: _FakePdf(
                ["Page one", "Page two"],
                metadata={"Title": "PDF Title"},
            ),
        },
    )
    assert payload == {
        "ok": True,
        "content": "Page one\n\nPage two",
        "title": "PDF Title",
    }


def test_pdf_http_error_404(monkeypatch, capsys) -> None:
    def raise_http(*a, **k):
        raise urllib.error.HTTPError(
            url=a[0] if a else "url", code=404, msg="Not Found", hdrs=None, fp=None
        )

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/file.pdf", "application/pdf"],
        mocks={"urlopen": raise_http},
    )
    assert payload == {"ok": False, "error": "network: http_404"}


def test_pdf_url_error(monkeypatch, capsys) -> None:
    def raise_url(*a, **k):
        raise urllib.error.URLError(reason=ConnectionRefusedError())

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/file.pdf", "application/pdf"],
        mocks={"urlopen": raise_url},
    )
    assert payload == {"ok": False, "error": "network: url_error:ConnectionRefusedError"}


def test_pdf_generic_network_exception(monkeypatch, capsys) -> None:
    """Generic catchall: urlopen raises non-HTTPError, non-URLError → network: <ExceptionName>.

    Symmetric with extract_pdfplumber.py's test_generic_network_exception.
    Both modules share the same urllib three-branch except structure;
    both get the catchall classification-contract assertion.
    """

    def raise_timeout(*a, **k):
        raise TimeoutError("simulated raw timeout, not wrapped in URLError")

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/file.pdf", "application/pdf"],
        mocks={"urlopen": raise_timeout},
    )
    assert payload == {"ok": False, "error": "network: TimeoutError"}


def test_pdf_pdfplumber_raises(monkeypatch, capsys) -> None:
    def raise_pdf(*a, **k):
        raise RuntimeError("simulated pdfplumber parse failure")

    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/file.pdf", "application/pdf"],
        mocks={
            "urlopen": lambda *a, **k: _FakeHTTPResponse(b"corrupted"),
            "pdf_open": raise_pdf,
        },
    )
    assert payload == {
        "ok": False,
        "error": "extraction_failed: pdfplumber:RuntimeError",
    }


def test_pdf_image_only_yields_no_content(monkeypatch, capsys) -> None:
    """Image-only / text-free PDF: pdfplumber returns successfully, but extract_text
    yields None per page → empty content → extraction_failed: no_content.

    Symmetric with extract_pdfplumber.py's test_image_only_pdf_yields_no_content.
    The URL→PDF path's no_content branch is reachable cleanly when a fetched
    PDF lacks a text layer; classification stays in extraction_failed: (NOT
    network:, NOT extraction_failed: pdfplumber:, since no exception was raised).
    """
    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/file.pdf", "application/pdf"],
        mocks={
            "urlopen": lambda *a, **k: _FakeHTTPResponse(b"%PDF-1.4 stub"),
            "pdf_open": lambda *a, **k: _FakePdf([None, ""], metadata=None),
        },
    )
    assert payload == {"ok": False, "error": "extraction_failed: no_content"}


# ============================================================
# Branch-logic tests (Content-Type parsing + dispatch)
# ============================================================


def test_content_type_with_charset_routes_to_html(monkeypatch, capsys) -> None:
    """'TEXT/HTML; charset=utf-8' must parse to 'text/html' via the script's
    split(';')[0].strip().lower() chain → routes to HTML path.

    Real-world Content-Type headers commonly include charset parameters and
    inconsistent casing. A regression in the parsing chain (e.g., dropping
    .lower(), forgetting the semicolon split) would route a legitimate
    HTML response to the unsupported_content_type branch, surfacing as
    a false network: failure for users.
    """
    payload = _run_main(
        monkeypatch,
        capsys,
        [
            "extract_from_url.py",
            "https://example.test/article",
            "TEXT/HTML; charset=utf-8",
        ],
        mocks={
            "fetch_url": lambda url: "<html></html>",
            "extract": lambda html: "Body",
            "extract_metadata": lambda html: _FakeMetadata(title=None),
        },
    )
    assert payload == {"ok": True, "content": "Body", "title": None}


def test_unsupported_content_type(monkeypatch, capsys) -> None:
    """Unknown Content-Type → network: unsupported_content_type:<type>.

    Note: classified as network:, not extraction_failed: — script treats an
    unprocessable Content-Type as a network-layer outcome (the network
    returned something the pipeline can't process). A docstring/comment
    rationale for this classification choice is a deferred follow-up;
    out of scope for C2.5 to change.
    """
    payload = _run_main(
        monkeypatch,
        capsys,
        ["extract_from_url.py", "https://example.test/file.zip", "application/zip"],
    )
    assert payload == {
        "ok": False,
        "error": "network: unsupported_content_type:application/zip",
    }


# ============================================================
# Validation-class failure tests
# ============================================================


def test_missing_argv(monkeypatch, capsys) -> None:
    """argv with only script name (no url, no content_type) → validation: usage:....

    Note: emitted string still references the OLD filename
    'extract_trafilatura.py' (script renamed during C2a but the validation
    message wasn't updated — flagged for follow-up cleanup, out of scope
    for C2.5). Test asserts what the code actually emits, not what the
    new filename would suggest.
    """
    payload = _run_main(monkeypatch, capsys, ["extract_from_url.py"])
    assert payload == {
        "ok": False,
        "error": "validation: usage:extract_trafilatura.py <url> <content_type>",
    }
