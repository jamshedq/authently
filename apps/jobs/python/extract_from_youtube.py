#!/usr/bin/env python3
# Authently — Open-source AI content engine
# Copyright (C) 2026 The Authently Contributors
# Licensed under the GNU Affero General Public License v3.0 or later.
# See LICENSE at repo root.
"""
Sprint 08 B2 — YouTube audio download entry point.

Invoked by extractFromYoutubeTask (apps/jobs/src/trigger/extract-from-youtube.ts)
after the user submits a YouTube URL via the upload page (Sprint 08 B2 4th tab).
The task passes the URL + an output directory via argv; this script downloads
the bestaudio stream (native format, no FFmpeg postprocessor) to that
directory and emits the audio file path + video metadata as JSON.

The task then reads the audio file, constructs a Node File, hands it to
@authently/ai/transcription's transcribeAudio, and writes the resulting
transcript back to the sources row via svc_update_source_status.

Output contract (per SPRINT_08.md A4.1 + B2 implementation notes):
  Success: {"ok": true, "audio_path": "<path>", "title": "<title>", "duration": <seconds>}
  Failure: {"ok": false, "error": "<class:detail>"}

Always exits 0. Success/failure encoded in JSON shape only — same
contract as extract_from_url.py and extract_pdfplumber.py per the
@trigger.dev/python SDK's exit-code-throws-on-non-zero behavior
(documented at apps/jobs/python/extract_from_url.py:32-39).

Error classes (locked at SPRINT_08.md A2.3 + A3.1):
  - youtube_unavailable:    — private / deleted / region-locked video
  - youtube_age_restricted: — age-restricted video; user must download
                              and upload audio manually
  - youtube_invalid_url:    — URL doesn't resolve to a single video
                              (playlist / channel / search / etc.)
  - transient:              — yt-dlp itself broken (extractor crashed,
                              YouTube API change, network unavailable)
  - validation:             — argv shape wrong (developer-mistake guard)

Format selection rationale (per SPRINT_08.md pre-flight Item 2):
  format='bestaudio[ext=m4a]/bestaudio[ext=webm]' — prefer native m4a;
  fall back to webm. Constrained to ONLY these two formats because
  @authently/ai/transcription's openai-whisper ALLOWED_MIME_TYPES
  accepts audio/m4a + audio/webm but NOT audio/opus (the latter is
  what plain 'bestaudio' often resolves to). NO FFmpegExtractAudio
  postprocessor — that would require ffmpeg binary in the deployment
  image, which the Trigger.dev Python build extension does not
  provide. Native-stream download avoids re-encoding and the ffmpeg
  dependency.

  Edge case: if a YouTube video offers neither m4a nor webm audio
  (rare; opus-only or other niche container), yt-dlp raises a
  DownloadError with "Requested format is not available" which the
  classifier below buckets as `transient: yt_dlp:...`. Acceptable for
  Sprint 08; expand format set if this surfaces as a real-world
  failure mode against actual user-submitted videos.

Error-prefix mapping strategy (per SPRINT_08.md SPRINT_08_state.md §4):
  yt-dlp's DownloadError and ExtractorError encode failure mode in the
  error message string, not in separate exception classes. The mapping
  below string-matches on lowercased message content to dispatch to the
  four locked prefixes. Order matters — more specific matches first.
"""
import json
import os
import re
import sys
from typing import Optional

import yt_dlp
from yt_dlp.utils import DownloadError, ExtractorError


def emit_success(audio_path: str, title: Optional[str], duration: Optional[int]) -> None:
    sys.stdout.write(json.dumps({
        "ok": True,
        "audio_path": audio_path,
        "title": title,
        "duration": duration,
    }))
    sys.stdout.write("\n")
    sys.exit(0)


def emit_failure(error: str) -> None:
    sys.stdout.write(json.dumps({"ok": False, "error": error}))
    sys.stdout.write("\n")
    sys.exit(0)


# yt-dlp encodes failure mode in the error message text. Map by lowercased
# substring match — order matters because some matches are subsets of
# others (e.g., "age" appears in "age-restricted" but also potentially
# in other strings; check more specific first).
#
# References (yt-dlp message text patterns observed across the
# DownloadError / ExtractorError surface):
#   - "Private video"             → youtube_unavailable
#   - "Video unavailable"         → youtube_unavailable
#   - "This video has been removed" → youtube_unavailable
#   - "is not available in your country" → youtube_unavailable (geo)
#   - "Sign in to confirm your age" → youtube_age_restricted
#   - "age-restricted" / "age restricted" → youtube_age_restricted
#   - "Unsupported URL"           → youtube_invalid_url
#   - "is not a valid URL"        → youtube_invalid_url
#
# Anything else falls through to `transient:` — covers extractor bugs,
# network failures, YouTube-side breaking changes, and any error we
# haven't mapped explicitly.
UNAVAILABLE_PATTERNS = (
    "private video",
    "video unavailable",
    "this video has been removed",
    "is not available",  # covers geo-restriction "in your country"
    "video is no longer available",
    "this video has been blocked",
)

AGE_RESTRICTED_PATTERNS = (
    "sign in to confirm your age",
    "age-restricted",
    "age restricted",
    "confirm your age",
)

INVALID_URL_PATTERNS = (
    "unsupported url",
    "is not a valid url",
    "no video formats found",  # often surfaces for non-video pages
)


def classify_yt_dlp_error(message: str) -> str:
    """Map a yt-dlp error message to one of the four locked prefixes."""
    lowered = message.lower()

    for pattern in AGE_RESTRICTED_PATTERNS:
        if pattern in lowered:
            return f"youtube_age_restricted: {message[:120]}"

    for pattern in UNAVAILABLE_PATTERNS:
        if pattern in lowered:
            return f"youtube_unavailable: {message[:120]}"

    for pattern in INVALID_URL_PATTERNS:
        if pattern in lowered:
            return f"youtube_invalid_url: {message[:120]}"

    # Unmapped — bucket as transient (user's correct action is retry later
    # or report; yt-dlp itself broken or YouTube changed something).
    return f"transient: yt_dlp:{message[:120]}"


def main() -> None:
    if len(sys.argv) < 3:
        emit_failure("validation: usage:extract_from_youtube.py <url> <output_dir>")
        return

    url = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.isdir(output_dir):
        try:
            os.makedirs(output_dir, exist_ok=True)
        except OSError as e:
            emit_failure(f"validation: output_dir:{type(e).__name__}")
            return

    # outtmpl uses video ID for filename uniqueness. yt-dlp resolves
    # %(id)s from metadata at download time; the actual emitted file
    # path is captured via the post-download info dict (not constructed
    # by us) so we don't need to know the extension in advance — yt-dlp
    # picks m4a vs webm based on what bestaudio resolves to.
    ydl_opts = {
        "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]",
        "outtmpl": os.path.join(output_dir, "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        # No postprocessors — avoid FFmpegExtractAudio's ffmpeg binary
        # dependency. Format restricted to m4a/webm only because plain
        # bestaudio often resolves to opus, which is NOT in
        # packages/ai/src/transcription/openai-whisper.ts's
        # ALLOWED_MIME_TYPES set.
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except DownloadError as e:
        emit_failure(classify_yt_dlp_error(str(e)))
        return
    except ExtractorError as e:
        emit_failure(classify_yt_dlp_error(str(e)))
        return
    except Exception as e:  # broad: catch any unmapped yt-dlp internal error
        emit_failure(f"transient: yt_dlp_runtime:{type(e).__name__}")
        return

    if info is None:
        emit_failure("youtube_invalid_url: no_info")
        return

    # extract_info returns dict (single video) or playlist envelope.
    # Sprint 08 B2 scope is single-video only (per A3.1 lock); reject
    # playlist results explicitly.
    if info.get("_type") == "playlist":
        emit_failure("youtube_invalid_url: playlist_not_supported")
        return

    # requested_downloads carries the actual on-disk path post-download.
    # Falls back to constructing from outtmpl variables if absent (yt-dlp
    # version variation in the requested_downloads exposure).
    downloads = info.get("requested_downloads") or []
    audio_path: Optional[str] = None
    if downloads and isinstance(downloads, list):
        first = downloads[0]
        if isinstance(first, dict):
            filepath = first.get("filepath") or first.get("_filename")
            if isinstance(filepath, str):
                audio_path = filepath

    if audio_path is None:
        # Reconstruct from id + ext as best-effort fallback. ext is the
        # post-download container (m4a / webm / etc.).
        vid_id = info.get("id")
        ext = info.get("ext")
        if isinstance(vid_id, str) and isinstance(ext, str):
            candidate = os.path.join(output_dir, f"{vid_id}.{ext}")
            if os.path.isfile(candidate):
                audio_path = candidate

    if audio_path is None or not os.path.isfile(audio_path):
        emit_failure("transient: audio_path_missing")
        return

    raw_title = info.get("title")
    title: Optional[str] = raw_title.strip() if isinstance(raw_title, str) and raw_title.strip() else None

    raw_duration = info.get("duration")
    duration: Optional[int] = int(raw_duration) if isinstance(raw_duration, (int, float)) else None

    emit_success(audio_path, title, duration)


if __name__ == "__main__":
    main()
