# Authently — Open-source AI content engine
# Copyright (C) 2026 The Authently Contributors
# Licensed under the GNU Affero General Public License v3.0 or later.
# See LICENSE at repo root.
"""Sprint 08 B2 — extract_from_youtube.py contract tests.

Verifies the script's behavior across the four locked YouTube failure
prefixes (per SPRINT_08.md A2.3 + A3.1):
  - youtube_unavailable:    (private / deleted / region-locked)
  - youtube_age_restricted: (age-restricted)
  - youtube_invalid_url:    (playlist / channel / unsupported URL)
  - transient:              (yt-dlp itself broken; YouTube API change)

Plus the success path: yt-dlp emits `{ok: true, audio_path, title,
duration}` JSON to stdout when a single video downloads successfully.

Mocking strategy: stdlib only. monkeypatch.setattr targets
yt_dlp.YoutubeDL — the script reads this symbol at call time, so
swapping it with a fake class redirects all download attempts to the
fake. The fake either populates the requested audio file on disk and
returns an info dict, or raises DownloadError / ExtractorError with a
configurable message that the classify_yt_dlp_error helper string-
matches against.

capsys captures stdout; SystemExit is caught via pytest.raises since
emit_success / emit_failure always sys.exit(0) (same exit-0-always
contract as extract_from_url.py per the @trigger.dev/python SDK's
throws-on-non-zero behavior).
"""
import json
import os
from typing import Optional

import pytest
import yt_dlp
from yt_dlp.utils import DownloadError, ExtractorError

import extract_from_youtube


# ---------- helpers ----------


class _FakeYoutubeDL:
    """Test double for yt_dlp.YoutubeDL.

    Captures ydl_opts for assertion. extract_info returns a configurable
    info dict OR raises a configurable exception. When download=True is
    requested and the info dict has an audio_filename, writes a fake
    file at the outtmpl path so the script's existence check passes.
    """

    captured_opts: Optional[dict] = None

    def __init__(self, ydl_opts):
        _FakeYoutubeDL.captured_opts = ydl_opts
        self._ydl_opts = ydl_opts
        # Configured per-test via class attributes (info_to_return /
        # exception_to_raise). Reset between tests by the fixture below.
        self._info = type(self).info_to_return
        self._exc = type(self).exception_to_raise

    info_to_return: Optional[dict] = None
    exception_to_raise: Optional[Exception] = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def extract_info(self, url, download=False):
        if self._exc is not None:
            raise self._exc
        if self._info is None:
            return None

        if download and "audio_filename" in self._info:
            # Write the fake file to disk so the script's os.path.isfile
            # check finds it. Path matches outtmpl's resolution
            # (output_dir/<id>.<ext>) for the success path.
            paths = self._ydl_opts.get("paths", {})
            outtmpl = self._ydl_opts.get("outtmpl", "%(id)s.%(ext)s")
            home = paths.get("home", ".") if isinstance(paths, dict) else "."
            del home  # unused; outtmpl in our test config has full path
            target = self._info["audio_filename"]
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(b"fake-audio-bytes")

        return self._info


@pytest.fixture(autouse=True)
def reset_fake_state():
    """Reset class-level test config between tests."""
    _FakeYoutubeDL.info_to_return = None
    _FakeYoutubeDL.exception_to_raise = None
    _FakeYoutubeDL.captured_opts = None
    yield


@pytest.fixture
def patched_ytdl(monkeypatch):
    """Replace yt_dlp.YoutubeDL with the test double for the test's duration."""
    monkeypatch.setattr(yt_dlp, "YoutubeDL", _FakeYoutubeDL)
    # Also patch within the extract_from_youtube module's namespace
    # because the script does `import yt_dlp` and references
    # yt_dlp.YoutubeDL at call time — the module-level reference works
    # via the same monkeypatch above (yt_dlp is shared), but make this
    # explicit so the patch is robust to import-style refactors.
    monkeypatch.setattr(extract_from_youtube.yt_dlp, "YoutubeDL", _FakeYoutubeDL)


def _read_stdout(capsys) -> dict:
    """Parse the JSON line the script emits to stdout."""
    out = capsys.readouterr().out.strip()
    return json.loads(out)


# ---------- happy path ----------


def test_success_emits_audio_path_title_duration(tmp_path, monkeypatch, capsys, patched_ytdl):
    """yt-dlp succeeds → script emits {ok: true, audio_path, title, duration}."""
    audio_path = str(tmp_path / "test123.m4a")
    _FakeYoutubeDL.info_to_return = {
        "id": "test123",
        "ext": "m4a",
        "title": "  My Video Title  ",  # whitespace stripped per the script
        "duration": 125.0,
        "requested_downloads": [{"filepath": audio_path}],
        "audio_filename": audio_path,  # tells the fake to write the file
    }

    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtu.be/test123", str(tmp_path)])
    with pytest.raises(SystemExit) as excinfo:
        extract_from_youtube.main()
    assert excinfo.value.code == 0

    payload = _read_stdout(capsys)
    assert payload["ok"] is True
    assert payload["audio_path"] == audio_path
    assert payload["title"] == "My Video Title"
    assert payload["duration"] == 125


# ---------- failure: argv shape ----------


def test_validation_argv_too_short(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py"])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["ok"] is False
    assert payload["error"].startswith("validation:")


# ---------- failure prefix mapping ----------


def test_unavailable_private_video(tmp_path, monkeypatch, capsys, patched_ytdl):
    _FakeYoutubeDL.exception_to_raise = DownloadError("Private video")
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtu.be/x", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["ok"] is False
    assert payload["error"].startswith("youtube_unavailable:")


def test_unavailable_video_removed(tmp_path, monkeypatch, capsys, patched_ytdl):
    _FakeYoutubeDL.exception_to_raise = DownloadError("This video has been removed by the uploader")
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtu.be/x", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["error"].startswith("youtube_unavailable:")


def test_age_restricted(tmp_path, monkeypatch, capsys, patched_ytdl):
    _FakeYoutubeDL.exception_to_raise = DownloadError(
        "Sign in to confirm your age. This video may be inappropriate for some users."
    )
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtu.be/x", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["error"].startswith("youtube_age_restricted:")


def test_invalid_url(tmp_path, monkeypatch, capsys, patched_ytdl):
    _FakeYoutubeDL.exception_to_raise = DownloadError("Unsupported URL: https://example.com/foo")
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://example.com/foo", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["error"].startswith("youtube_invalid_url:")


def test_transient_unmapped_error(tmp_path, monkeypatch, capsys, patched_ytdl):
    """Errors that don't match any locked prefix bucket to `transient:`."""
    _FakeYoutubeDL.exception_to_raise = DownloadError(
        "Some completely new yt-dlp internal error nobody predicted"
    )
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtu.be/x", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["error"].startswith("transient:")


def test_extractor_error_also_classified(tmp_path, monkeypatch, capsys, patched_ytdl):
    """ExtractorError flows through the same classifier as DownloadError."""
    _FakeYoutubeDL.exception_to_raise = ExtractorError("Video unavailable: this video is private")
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtu.be/x", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["error"].startswith("youtube_unavailable:")


# ---------- failure: info shape ----------


def test_info_is_none(tmp_path, monkeypatch, capsys, patched_ytdl):
    _FakeYoutubeDL.info_to_return = None
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtu.be/x", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["error"] == "youtube_invalid_url: no_info"


def test_info_is_playlist_rejected(tmp_path, monkeypatch, capsys, patched_ytdl):
    _FakeYoutubeDL.info_to_return = {"_type": "playlist", "id": "PLfoo", "entries": []}
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtube.com/playlist?list=PLfoo", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["error"] == "youtube_invalid_url: playlist_not_supported"


def test_audio_path_missing_after_download(tmp_path, monkeypatch, capsys, patched_ytdl):
    """Info dict lacks requested_downloads + id+ext fallback → transient: audio_path_missing."""
    _FakeYoutubeDL.info_to_return = {
        "id": "test123",
        # ext missing — fallback path can't be constructed
        "title": "title",
        "duration": 60,
    }
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtu.be/test123", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()
    payload = _read_stdout(capsys)
    assert payload["error"] == "transient: audio_path_missing"


# ---------- format selector assertion ----------


def test_format_selector_m4a_or_webm_only(tmp_path, monkeypatch, capsys, patched_ytdl):
    """Verify the ydl_opts use the constrained m4a/webm format selector
    (not plain bestaudio which would allow opus, not in ALLOWED_MIME_TYPES)."""
    audio_path = str(tmp_path / "test123.m4a")
    _FakeYoutubeDL.info_to_return = {
        "id": "test123",
        "ext": "m4a",
        "title": "title",
        "duration": 60,
        "requested_downloads": [{"filepath": audio_path}],
        "audio_filename": audio_path,
    }
    monkeypatch.setattr("sys.argv", ["extract_from_youtube.py", "https://youtu.be/test123", str(tmp_path)])
    with pytest.raises(SystemExit):
        extract_from_youtube.main()

    opts = _FakeYoutubeDL.captured_opts
    assert opts is not None
    assert opts["format"] == "bestaudio[ext=m4a]/bestaudio[ext=webm]"
    # No FFmpegExtractAudio postprocessor (deployment image doesn't bundle ffmpeg).
    assert "postprocessors" not in opts
