# Sprint 06 carryover index — deferrals captured during Sprint 06 spec-lock
# Inputs for Sprint 07+ planning. Mirrors SPRINT_05_carryovers.md's
# convention (per-sprint carryover doc, comment-block format,
# grep-friendly, planning-input tone — not user-facing docs).
#
# === Provenance ===
# Sprint 06 commits referenced by entries in this file:
#   - <SHA>   docs(specs): lock Sprint 06 spec (this commit)
#   - (further SHAs added as Sprint 06 sub-items land)
#
# === Status markers ===
# Items cleared in subsequent sprints retain their entry here for
# historical reference, prefixed with a STATUS line naming the sprint
# + sub-item that cleared them. Items reachable but not yet shipped
# may carry a STATUS line of "ready for SNN+ implementation."
#
# === Entry schema ===
# Each entry uses: (a) what's deferred, (b) why deferred + origin commit,
# (c) approximate scope, (d) dependencies, (e) revisit trigger, (f)
# urgency-tell. Where (f) is "no urgency-tell; lands when scheduled,"
# that's stated explicitly rather than omitted — keeps the schema
# uniform across entries.

# === Sprint 06 origin ===

# 1. Section B sub-items B2, B3, B4 (originally Sprint 07 scope)
#    STATUS: B3 cleared in Sprint 07 (spec-lock 2026-05-05) — URL/PDF
#       extraction via Trafilatura + pdfplumber, Trigger.dev v4 Python
#       build extension, sources management surface (list + polling +
#       delete) shipped together as the Sprint 07 vertical slice.
#       B2 (YouTube via yt-dlp) and B4 (orchestration) carried forward
#       to Sprint 08 per Sprint 07 vertical-slice discipline. The
#       per-sub-item picture:
#         - B3: cleared in Sprint 07. Original "deferred to Sprint 07"
#           status is now resolved. yt-dlp brittleness (entry #2 below)
#           does NOT carry to B3 — only B2.
#         - B2: deferred to Sprint 08. Recorded in
#           SPRINT_07_carryovers.md entry #1.
#         - B4: deferred to Sprint 08. Recorded in
#           SPRINT_07_carryovers.md entry #1. Becomes load-bearing
#           with three-plus source types in production; once Sprint 08
#           lands B2's `youtube_transcript`, parallel
#           `api_create_source_*` wrappers start to feel like
#           duplication B4 collapses.
#       Original "deferred to Sprint 07" framing below preserved as
#       historical context for the original lock decision.
#       --- ORIGINAL STATUS ---
#       deferred to Sprint 07 by Sprint 06 spec-lock; vertical-
#       slice strategy locked at D5a/D5b.
#    What: B2 (YouTube ingestion via yt-dlp), B3 (URL/PDF extraction
#       via Trafilatura + pdfplumber), B4 (source orchestration tying
#       B1/B2/B3 together for multi-source-type routing).
#    Why deferred: D5b lock at Sprint 06 design time. Two-sprint
#       split chosen over a single five-sub-item sprint to avoid the
#       size precedent that caused Sprint 05's Section B to be
#       deferred mid-flight. Vertical slice (B1+B5) ships first,
#       validates the ingestion concept with first users, then
#       Sprint 07 expands source-type breadth. Validation-before-
#       breadth pattern.
#    Origin: Sprint 06 spec-lock, 2026-05-04.
#    Scope: All of B2 + B3 + B4 in their redesigned forms. Python
#       tooling baseline (D3: Trigger.dev build extension in
#       apps/jobs) lands with B2/B3 in Sprint 07; no Modal. Approximate
#       per-item size to be locked at Sprint 07 pre-flight.
#    Dependencies: Sprint 06 B1+B5 ships and validates first; D3-locked
#       Python tooling lands in Sprint 07 (Trigger.dev build extension
#       in apps/jobs).
#    Revisit trigger: Sprint 06 ships clean and B1+B5 are running
#       cleanly with first users. Sprint 07 spec-lock cycle begins
#       at that point.
#    Urgency-tell: low — Sprint 07 is the planned continuation, not
#       a contingent revival. A use-case validation finding from
#       Sprint 06 that reveals source-type breadth (URL/article/PDF)
#       is more urgent than expected would re-prioritize within
#       Sprint 07.

# 2. yt-dlp brittleness (Sprint 07 operational concern for B2)
#    STATUS: known operational concern; carried forward from Sprint
#       06 design walkthrough for explicit Sprint 07 inheritance.
#    What: yt-dlp is the most fragile component of any YouTube
#       ingestion path. YouTube actively breaks downloaders; yt-dlp
#       updates regularly to keep up. B2 will need ongoing maintenance
#       attention to keep working in production.
#    Why captured here: B2 design at Sprint 06 was already narrowed
#       to YouTube-only with best-effort service contract specifically
#       because of this concern. Recording it at Sprint 06 means
#       Sprint 07 inherits the concern explicitly rather than
#       re-deriving it during pre-flight.
#    Origin: Sprint 06 design walkthrough (B2 scope decision Q&A),
#       2026-05-04.
#    Scope: B2 only. Doesn't affect B1, B3, B4.
#    Dependencies: Sprint 07 B2 implementation will need (a) graceful
#       failure mode (clear error to user when yt-dlp fails; fall
#       back to manual upload via B5), (b) tests mocking at yt-dlp
#       library boundary (not hitting real YouTube), (c) operational
#       runbook entry for "yt-dlp is broken; here's how to update."
#    Revisit trigger: B2 pre-flight in Sprint 07. Or any production
#       failure of B2 that reveals an inadequately-handled brittleness
#       mode.
#    Urgency-tell: B2 production failure rate. If a meaningful
#       fraction of YouTube ingestion attempts fail post-Sprint-07
#       launch, that's signal to invest in resilience.

# 3. Streaming transcription UX (deferred enhancement)
#    STATUS: deferred from Sprint 06 vertical slice.
#    What: Server-Sent Events / token streaming during transcription.
#       Currently B5 shows a static loading spinner; streaming would
#       show transcript text appearing as Whisper produces it.
#    Why deferred: B5-Q4 lock at Sprint 06 design time. Streaming
#       adds frontend complexity (subscription handling, partial-
#       transcript display logic, error-mid-stream semantics) without
#       validated user demand for short-audio workflows where total
#       transcription time is 5-30 seconds — short enough that a
#       spinner is acceptable UX.
#    Origin: Sprint 06 spec-lock, 2026-05-04.
#    Scope: B5 UX enhancement only. Doesn't affect B1's service
#       contract — the OpenAI SDK already supports streaming, so
#       enabling it is additive to B1's surface.
#    Dependencies: OpenAI SDK supports streaming; the Whisper API
#       endpoint supports it. Implementation requires SSE handling
#       on the apps/web side and partial-transcript display logic
#       in B5.
#    Revisit trigger: user feedback that transcription wait feels
#       long. Probable forward signal: long-audio support lands in
#       a future sprint, at which point spinner UX becomes
#       inadequate. Streaming is also worth revisiting if OpenAI's
#       API latency increases meaningfully.
#    Urgency-tell: user feedback or session-time analytics on
#       transcription waits.
