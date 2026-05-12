<!--
  Sprint 08 — YouTube ingestion + source orchestration
  Locked: 2026-05-11
  Status: planning → spec-locked
  Pre-flight cycle: single-pass — design was locked across a multi-turn
    walk in the Sprint 07 close session (anchors A1–A7), with the
    design-partner relay pattern (Claude Code as executor with repo
    access; design-partner Claude as no-repo-context design input;
    user as relay). Spec-lock here drafts the artefact only; no design
    re-litigation. Same single-pass shape as Sprint 06 / Sprint 07.
  Predecessor: Sprint 07 (B3 + sources management). URL/PDF extraction
    shipped C1 → C2a → C2.5 → C2b.1 → C2b.2 → C2b.3 → C3.1 → C3.2 →
    C3.3 → C4 across PRs #25–#44, plus the standalone trigger.config.ts
    dev Python path fix at PR #45 (commit 1328e37). Sprint 07 closed
    out URL + PDF + the sources management surface (list page +
    polling + delete UI + error display + tabbed upload). Sprint 08
    extends source-type breadth to YouTube (B2) and ships the source
    orchestration that closes out the sources vertical slice (B4).
  Capacity: 1 solo builder. Two sub-commits (B2 then B4), each bounded
    and sequenced; sub-item locks already done in this spec.

  Reading guide for future Claude sessions:
  - This sprint closes out the source-ingestion vertical slice from
    Sprint 06 + Sprint 07. B0 instantiates `packages/ai` (canonical-
    as-planned per build_plan.md §1.2; pre-flight surfaced that
    transcription reuse from apps/jobs forced this); B2 adds YouTube
    as a fourth source type; B4 collapses the parallel
    `api_create_source_*` wrappers into a unified RPC dispatch.
    B2 + B4 origin recorded in SPRINT_07_carryovers.md entry #1; B0
    origin is build_plan §1.2 ("All AI calls go through
    `packages/ai` with a model router") with Sprint 08's transcription
    reuse as the first multi-consumer forcing function — not a
    Sprint 07 carryover.
  - Sprint 07's `sources` table schema carries forward. B2 widens the
    `type` CHECK constraint to admit `'youtube_transcript'` (the
    third widening: Sprint 06 introduced `'audio_transcript'`, Sprint
    07 widened to add `'url_extraction'` + `'pdf_extraction'`, Sprint
    08 widens to add `'youtube_transcript'`).
  - YouTube transcript extraction reuses the shared transcription
    service (extracted from apps/web's openai-whisper.ts to
    `packages/ai/src/transcription/` in B0) via a two-stage subprocess
    shape (locked A4.1, mechanism revisited at pre-flight): yt-dlp
    Python subprocess downloads the audio and emits a file path; the
    Trigger.dev task picks the file up and hands the bytes (as a
    Node-compatible File) to the shared transcription service. A4.1's
    outcome holds (Whisper quality + error classification surface
    unchanged); mechanism softens from "direct reuse of B1 in apps/web"
    to "shared-package consumption from packages/ai."
  - B4's dispatch collapse is at the HTTP boundary only (locked A5.1).
    The four `private.create_source_*_impl` workers stay parallel
    because their type-specific INSERT logic is the actual
    non-duplicated work; parallel names ≠ duplicated logic. General
    principle introduced at A5.1: "Collapse at the layer where
    duplication actually lives, not at every layer where the names
    look parallel."
  - Decisions locked at pre-flight live BOTH inline at sub-item level
    AND in the compact appendix at the bottom (A-prefix following the
    seven-anchor walk that produced this spec: A1 = sub-sequencing,
    A2 = yt-dlp brittleness, A3 = URL surface, A4 = transcript
    strategy [A4.1 mechanism revisited at pre-flight per Finding 3 →
    locked option (i) shared-package extraction], A5 = dispatch
    shape, A6 = upload UX [settled by A3.3], A7 = source detail page
    [deferred]).
-->

# Sprint 08 — YouTube ingestion + source orchestration

## Goal

Close out the source-ingestion vertical slice from Sprint 06 + Sprint
07 by instantiating `packages/ai` (B0; canonical-as-planned per
build_plan §1.2, forced by Sprint 08's transcription-reuse need),
adding YouTube as the fourth source type (B2), and collapsing the
parallel `api_create_source_*` wrappers into a unified dispatch (B4).

The slice is bounded: B0 instantiates `packages/ai` with the
transcription service as its first consumer (extracted from
apps/web's `openai-whisper.ts`); B2 ships YouTube transcript
extraction via yt-dlp's audio download path terminating in the shared
transcription service (locked A4 route (a) — audio-only via Whisper,
not captions-first; A4.1 mechanism revisited at pre-flight per
Finding 3, resolved to option (i) shared-package extraction); B4
ships the HTTP-boundary collapse with full migration of all four
existing callers (audio + URL + PDF + YouTube) to the unified RPC in
a single commit (locked A5.3 (a)). **Three sub-commits**, each with
its own gate cycle and smoke window. B0 lands first (no behavior
changes; package extraction); B2 lands second as a parallel wrapper
following the Sprint 07 pattern and consuming the B0 shared service;
B4 lands third and collapses the four wrappers.

## Non-goals

- **Captions-first transcript extraction (A4 route (b))** — deferred.
  Sprint 08 takes route (a): yt-dlp downloads audio, B1 Whisper
  service transcribes. The captions-first path (with audio fallback)
  adds branching control flow + a manual-vs-auto-caption heuristic
  that doesn't exist yet + reopens A2.2's freshly-locked
  uniformity-as-feature constraint. Upgrade trigger: if (1) observed
  YouTube extraction volume exceeds 30% of total extractions over a
  trailing 30-day window AND Whisper cost on YouTube extractions
  exceeds $200/month at 6 weeks post-S15 launch, OR (2) three or more
  distinct users report transcript quality observably worse than the
  source's available captions within any 30-day window, evaluate
  upgrade to route (b). Until trigger fires, (a) is operative.
- **Playlist / channel / live-stream URL support** — deferred.
  Sprint 08 accepts single-video URLs only (locked A3.1 — permissive
  single-video via yt-dlp's URL parsing + lightweight domain
  pre-check at apps/web boundary). Playlist URLs, channel URLs, and
  currently-live `watch?v=` URLs (no fixed transcript yet) are
  rejected with `youtube_invalid_url:` prefix at the worker layer.
  Expansion to playlists / channels lands when scoped as a future
  B2.1 follow-on.
- **Worker-level dispatch collapse (A5.1 option (B))** — deferred and
  declined. The four `private.create_source_*_impl` workers have
  type-specific INSERT logic (different columns: `file_path` vs
  `source_url` vs `storage_key`) that isn't duplicated and shouldn't
  be union-of-fields-collapsed. B4 collapses only the HTTP boundary;
  workers stay parallel.
- **Split-commit B4 (B4.1 add unified + migrate / B4.2 drop old
  wrappers)** — option-not-taken at A5.3. Verified
  integration-shaped test coverage (real Supabase + real RPC calls
  in `apps/web/tests/services/sources/create-source-url.test.ts` and
  `create-source-pdf.test.ts`; only Trigger.dev SDK mocked)
  protects the migration; split-commit's deferred-deletion ceremony
  doesn't earn its place against the existing verification surface.
- **Source detail page** — still deferred. The Sprint 07 carryover
  (entry #9) named "B4 orchestration in Sprint 08 referencing source
  content in the UI" as the revisit trigger; B4 is DB-layer
  collapse + caller migration with no new UI surface, so the trigger
  has not fired. A7's likely revisit lands in S09–S11 (Authenticity
  Engine block) when remix input needs source content navigation.
- **Card grid / filter / pagination / sort controls on sources list
  page** — Sprint 07 deferrals (SPRINT_07_carryovers.md entries
  #3–#6) carry forward unchanged. List page remains compact-only.
- **Retry mechanism for failed extractions** — Sprint 07 deferral
  (SPRINT_07_carryovers.md entry #7) carries forward.
  Delete-and-resubmit is still the canonical pattern.
- **Orphaned `'processing'` row sweeper (DB + Storage)** — Sprint 07
  deferral (SPRINT_07_carryovers.md entry #2 + its E6d-Storage
  addendum) carries forward. Accept-the-orphan-possibility stays
  operative.
- **`youtube_no_transcript:` failure prefix** — deferred. Only
  activates if A4 upgrade trigger fires and route (b) is chosen at
  evaluation time. Recorded as a forward-reference in this spec
  alongside A4's upgrade trigger; not implemented in Sprint 08.

## Workflow conventions

Inherits Sprint 06 / 07's six-step pattern:

1. Spec → confirm → build → verify
2. Pause after each sub-commit lands locally
3. User reviews against the spec; approves before next sub-commit
4. All 6 gates green at every sub-commit (gate count unchanged from
   Sprint 07 closure baseline; no new standing gates added in Sprint
   08)
5. Branch per section: `chore-sprint-08-section-b-close` (or
   shorter; lock at section start)
6. PR opened only after all section commits land local + reviewed

Sprint 08 has only one section (Section B continued — packages/ai
instantiation + YouTube + orchestration). Branch naming reflects the
section, matching Sprint 07's convention.

**Sub-commit count: three** — B0 → B2 → B4. Originally locked at
two (B2 + B4 per SPRINT_07_carryovers.md #1); B0 added at pre-flight
per the A4.1 lock-revisit (Finding 3 forced the packages/ai
instantiation as the resolution path that respects both A4.1's
outcome framing and Sprint 07 C2b.3's decoupling convention).

**Manual smoke discipline (CLAUDE.md "Framework rules not caught by
automated gates"):** Both B2 and B4 introduce new server actions
(`uploadYoutubeAction` in B2; full migration of four action handlers
to call the unified `createSource()` in B4) and modify the existing
upload page (B2 adds a 4th tab; B4 doesn't modify the upload UI
beyond renaming the underlying call). Both sub-commits require a
manual smoke pass before merge even with all 6 gates green.

B4's smoke surface is **4x larger than B2's** (explicitly noted per
A5.3 refinement): all four source types (audio + URL + PDF +
YouTube) must be smoked end-to-end through the new unified RPC, not
just YouTube. The B4 sub-commit needs a focused work session sized
to absorb the four-item smoke run; smoke-window discipline holds —
commit + smoke happen in the same focused session.

**A1.3 rollback playbook (named explicitly for B4):** CLAUDE.md
declares DB migrations append-only — Claude may CREATE new
migrations, never edit existing ones. Therefore B4's migration that
DROPs the four `api_create_source_*` wrappers cannot be rolled back
via a simple `git revert`. Rollback means three coordinated changes,
all shipped as a new commit (not as edits to B4's commit):

1. **New DB migration** recreating the four old wrappers
   (`api_create_source_audio`, `api_create_source_url`,
   `api_create_source_pdf`, `api_create_source_youtube`) + their
   workers' EXECUTE grants (workers themselves still exist —
   B4 only drops the wrappers, not the workers).
2. **TS-side restore** of the four typed callers
   (`createSourceAudio` / `createSourceUrl` / `createSourcePdf` /
   `createSourceYoutube`) from git history at the apps/web service
   module layer.
3. **TS-side action handler reversion** — each of the four action
   handlers (`uploadAudioAction`, `uploadUrlAction`, `uploadPdfAction`,
   `uploadYoutubeAction`) reverts its `createSource()` call back to
   the typed caller restored in step 2.

Higher friction than a typical revert because step 1 is a new
migration, not an undo of the dropped migration. This is the cost
accepted for choosing single-commit B4 over the split-commit shape
(which would have left old wrappers in place until B4.2); the cost
is named here rather than discovered during a post-merge regression.

**A5.1 general principle (Sprint 08 discipline addition):** "Collapse
at the layer where the duplication actually lives, not at every layer
where the names look parallel." Parallel names ≠ duplicated logic.
Future collapse decisions (e.g., "should we unify the workers? the
action handlers?") flow from this principle: locate the actual
duplicated logic, collapse there, leave non-duplicated work parallel.

## Section B continued — packages/ai instantiation + YouTube + orchestration

Three sub-items, three commits, sequenced per A1 lock (updated at
pre-flight for B0 prerequisite):

1. **B0 — packages/ai instantiation** (canonical-as-planned per
   build_plan §1.2; first multi-consumer forcing function) —
   package scaffolding + transcription extraction from apps/web's
   `openai-whisper.ts` + apps/web import update + apps/jobs gains
   `@authently/ai` as a workspace dependency. **No behavior changes**;
   apps/web's existing transcription tests are the verification
   surface (pass unchanged after the move).
2. **B2 — YouTube transcript extraction** — schema widening + new
   `api_create_source_youtube` wrapper + worker + yt-dlp Python
   module + new Trigger.dev task consuming the B0 shared
   transcription service + apps/web action handler + 4th
   upload-page tab + tests.
3. **B4 — Source orchestration** — unified `api_create_source` RPC +
   apps/web migration of all four callers + drop of the four old
   `api_create_source_*` wrappers + consolidated TS `createSource()`
   + tests.

Each sub-item ships as a separate commit on the same branch. **B2
depends on B0** (B2 imports from `@authently/ai/transcription` that
B0 creates). **B4 doesn't depend on B0 or B2 architecturally** — its
work is at the DB + action handler layer, orthogonal to the
transcription path — but lands third because the carryover doc closes
both B2 + B4 entries at sprint close together. B0's provenance is
build_plan §1.2, not a Sprint 07 carryover; the carryover docs at
sprint close note B0 as "instantiating canonical-as-planned package
at first multi-consumer pressure," not "deferred work from Sprint
07."

### B0 — packages/ai instantiation

**Why:** Pre-flight Item 3 surfaced a structural conflict between
A4.1's "reuse B1 Whisper service" lock and the Sprint 07 C2b.3
decoupling convention. The shared-transcription-service-via-shared-
package pattern is the resolution. `packages/ai` is canonical-as-
planned per build_plan §1.2 ("All AI calls go through `packages/ai`
with a model router"); Sprint 08's transcription reuse is the first
multi-consumer forcing function — not unilateral scope expansion.
Lock locked at pre-flight A4.1-revisit; design-partner walk + repo-
discovery (apps/jobs/package.json zero apps/web deps, C2b.3 PR
description framing @authently/shared as the canonical
cross-package-coupling pattern, packages/ structure showing
db/hosted-features/shared/ui without ai) confirmed.

**Approach:** Mechanical extraction. Move the existing apps/web
transcription module + its OpenAI client wrapper to a new
`packages/ai/` workspace. apps/web's imports update to consume from
the new package; behavior is unchanged. apps/jobs gains
`@authently/ai` as a workspace dependency in B2 (not B0 — keeping
B0's blast radius bounded to apps/web import migration only;
apps/jobs consumes the package once B2 needs it).

**Scope boundaries (load-bearing — B0 is NOT full packages/ai
instantiation):**

- **In scope:** Package scaffolding (`packages/ai/package.json`,
  `tsconfig.json`, build/exports config matching `@authently/shared`
  and `@authently/db` conventions). Move
  `apps/web/src/services/transcription/openai-whisper.ts` and
  `apps/web/src/services/transcription/openai-client.ts` to
  `packages/ai/src/transcription/`. Update all apps/web import
  paths. Add `@authently/ai: workspace:*` to `apps/web/package.json`.
  Existing apps/web tests (`openai-whisper.test.ts`,
  `transcription` action layer tests) pass unchanged with updated
  import paths.
- **Out of scope** (explicit, so B0 doesn't drift into a larger
  packages/ai instantiation):
  - **NO model router.** build_plan §1.2 names the model router as
    a packages/ai concern; it lands at S09–S11 with the Authenticity
    Engine block (remix engine + multi-model router per §5.3).
  - **NO voice-aware prompts.** S09–S11 concern.
  - **NO anti-slop guards.** S09–S11 concern.
  - **NO new AI service modules.** B0 only moves what exists; it
    does not add transcription variants, prompt builders, or other
    AI services. New AI services land when their forcing function
    materializes (per build_plan §1.2 forward-looking framing).
  - **NO apps/jobs consumption** in B0. apps/jobs's
    `@authently/ai` dependency is added in B2 alongside the
    Trigger.dev task that uses it. Keeps B0's scope to apps/web
    import migration + package scaffolding only.

**Package scaffolding conventions to verify at pre-flight** (B0-
specific items added to the pre-flight verification list below):
existing `@authently/shared` and `@authently/db` scaffolding shapes
should be the template — same `package.json` skeleton, same
`tsconfig.json` extension chain, same export pattern. Identify any
divergences before B0 implementation begins.

**Files moved (apps/web → packages/ai):**

- `apps/web/src/services/transcription/openai-whisper.ts` →
  `packages/ai/src/transcription/openai-whisper.ts`
- `apps/web/src/services/transcription/openai-client.ts` →
  `packages/ai/src/transcription/openai-client.ts`

**Files modified (apps/web):**

- `apps/web/package.json` — add `"@authently/ai": "workspace:*"` to
  dependencies.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/actions.ts`
  (and any other apps/web file currently importing from
  `services/transcription/`) — update imports from
  `@/services/transcription/openai-whisper` to
  `@authently/ai/transcription` (or whatever the exported path
  shape lands as at B0 pre-flight).
- `apps/web/tests/services/transcription/openai-whisper.test.ts`
  may move alongside the source (or stay in apps/web if the test
  exercises the apps/web side of the integration; lock at B0
  implementation).

**Files created (packages/ai/):**

- `packages/ai/package.json`
- `packages/ai/tsconfig.json`
- `packages/ai/src/transcription/openai-whisper.ts` (moved)
- `packages/ai/src/transcription/openai-client.ts` (moved)
- `packages/ai/src/transcription/index.ts` (exports surface)
- `packages/ai/src/index.ts` (package root exports)
- AGPL license header on all new files; existing headers preserved
  on moved files.

**No app behavior changes.** The apps/web transcription path
(Sprint 06 B5 audio upload server action) continues to work
identically. The B0 verification surface is apps/web's existing
transcription tests passing with the updated import paths.

**Tests:** no new tests. Existing apps/web tests
(`apps/web/tests/services/transcription/openai-whisper.test.ts`)
exercise the same code (whether it lives at the old apps/web path or
the new packages/ai path — vi.mock paths adjust to the new import
location). License-header gate picks up the new package files.

**Smoke:** **none beyond apps/web's existing transcription test
suite passing.** Package extraction shouldn't change behavior; the
unit tests are the verification mechanism. No manual browser smoke
required for B0 — there's no new server action, no modified upload
page, no behavior-bearing surface for a browser to exercise.

**Expected gate deltas:**

- `test:license-headers`: +~5-6 new files (package.json, tsconfig.json,
  index.ts files, plus AGPL headers on moved files which are
  count-neutral since headers existed). Net: +~5-6.
- `typecheck`: 6/6 → 7/7? Depends on whether `packages/ai` adds a new
  typecheck target. Matches `@authently/shared`'s pattern at B0
  pre-flight; lock there.
- `lint`: unchanged behavior; new package's lint config matches
  `@authently/shared`'s pattern.
- `test:db`, `test:web`, `test:jobs`: unchanged (no test additions
  or removals; apps/web tests retarget the moved import).

**Commit message:** `feat(packages/ai): Sprint 08 B0 — instantiate packages/ai with transcription extraction from apps/web`

### Sprint 08 YouTube failure-prefix surface (consolidated)

The four YouTube-specific failure prefixes locked across A2.3 + A3.1,
plus the inherited Sprint 07 `transient:` prefix folded forward for
yt-dlp-itself-broken cases. Consolidated here as a single
implementation reference so future readers see the full prefix
contract at one glance; B2's Python module + Trigger.dev task
implement against this surface, and `docs/runbooks/yt-dlp.md`
references this section from its "Diagnosing yt-dlp failures by
error prefix" section.

| Prefix | Source | Display label | Expanded user-facing text |
|---|---|---|---|
| `youtube_unavailable:` | A2.3 lock | "Video unavailable" | "This video is private, deleted, or region-locked. Use a different URL." |
| `youtube_age_restricted:` | A2.3 lock | "Age-restricted" | "This video is age-restricted by YouTube. Download the audio and upload it manually." |
| `youtube_invalid_url:` | A3.1 lock | "Not a video URL" | "This URL doesn't resolve to a single YouTube video. Playlists and channels aren't supported — paste a single video URL." |
| `transient:` (inherited) | Sprint 07 carry-forward | "Temporary error" | (existing Sprint 07 expanded text) — covers yt-dlp-itself-broken case; user's correct action is "retry later" |

Discipline carry from C3.3 + A2.3 refinement: BOTH the display label
AND the expanded user-facing text are specified at spec-lock, not
invented at implementation time. The Sprint 07 C3.3 walk noted that
its prefix → label mapping landed at implementation because the spec
didn't prescribe it; Sprint 08 pulls that lesson forward. Future
error-prefix-introducing commits follow this shape: spec-lock owns
both surfaces.

Deferred: `youtube_no_transcript:` — only activates if A4 upgrade
trigger fires and route (b) is chosen. Not implemented in Sprint 08.

### B2 — YouTube transcript extraction

**Why:** Source-type breadth expansion. YouTube transcripts are the
research workflow most commonly requested alongside articles + PDFs
for technical creator use cases. Async execution via Trigger.dev
per Sprint 07 E1 (latency profile: yt-dlp download + Whisper
transcription = up to ~minutes for longer videos, well outside a
sync server-action budget).

**Approach (A2, A3, A4 locked):**

One Trigger.dev task wrapping a two-stage subprocess (locked A4.1,
mechanism revisited at pre-flight per Finding 3 → consumes the B0
shared transcription service from `@authently/ai`):

- `extractFromYoutubeTask({ workspaceId, sourceId, sourceUrl })` —
  invokes the yt-dlp Python module to download audio to a known
  path; on success, reads the audio file's bytes and constructs a
  Node-compatible `File` (per `transcribeAudio`'s input shape from
  the shared transcription service); hands the `File` to
  `transcribeAudio` from `@authently/ai/transcription`; on Whisper
  success, calls `svc_update_source_status` with
  `_status = 'ready'`, `_content = <whisper transcript>`, `_title =
  <yt-dlp video title>`. On failure at either stage, calls
  `svc_update_source_status` with `_status = 'failed'` and the
  appropriate prefix from the consolidated YouTube failure-prefix
  surface above.

One Python module under `apps/jobs/python/`:

- `extract_from_youtube.py` — reads YouTube URL from argv, invokes
  yt-dlp library to download audio to a temp path, prints
  `{"ok": true, "audio_path": "<path>", "title": "<video title>",
  "duration": <seconds>}` to stdout on success, prints
  `{"ok": false, "error": "<prefix>: <detail>"}` on failure. Exit 0
  on success, 1 on failure. Maps yt-dlp library exceptions to the
  consolidated prefix set: video-private/deleted/region-locked →
  `youtube_unavailable:`; age-restricted → `youtube_age_restricted:`;
  URL doesn't resolve to a single video → `youtube_invalid_url:`;
  yt-dlp itself broken (extractor crashed, network unavailable,
  YouTube API change) → `transient:`.

Subprocess shape matches Sprint 07's trafilatura + pdfplumber
pattern (locked A2.2): subprocess-boundary mocking, JSON stdout,
exit codes 0/1. Uniformity-as-feature: three Python subprocesses
(trafilatura, pdfplumber, yt-dlp) all mock identically in tests;
their wire contract is the same JSON shape with a type-specific
payload variation.

**Two-stage subprocess shape (A4.1 locked, three reasons; mechanism
revisited at pre-flight):**

1. Reuses the shared transcription service from `@authently/ai`
   (extracted from B1 in B0) — no risk of regressing the apps/web
   audio path while building the YouTube path; both consumers go
   through the same shared code.
2. Keeps A2.2 subprocess-boundary mocking uniform — yt-dlp Python
   subprocess mocks identically to trafilatura / pdfplumber; the
   shared transcription service's Whisper-from-Node remains its own
   surface unchanged from apps/web's perspective.
3. Separation of concerns matches the existing architecture —
   Python handles content-acquisition (trafilatura for HTML,
   pdfplumber for PDF, yt-dlp for audio extraction); Node handles
   content-transformation (transcription, future Authenticity
   Engine processing).

Single-script piping (yt-dlp + Whisper SDK both inside the Python
script) would mix those layers and re-introduce a parallel Whisper
caller alongside the shared transcription service.

**A4.1 outcome preserved across the mechanism revisit:** Whisper
quality + error classification surface are unchanged from B1's
existing implementation. The error prefix taxonomy
(`validation:` / `openai_rejected:` / `transient:` / `auth:` /
`timeout:`) emitted by `classifyOpenAIError` carries forward to the
YouTube extraction path identically. What changed at pre-flight is
the consumption mechanism (shared-package import instead of direct
cross-app import), not what gets transcribed or how errors are
classified.

**URL acceptance surface (A3.1 locked, route (i) — permissive +
domain pre-check):**

apps/web validates at two layers (locked A3.2):

- Client-side: HTML5 `type="url"` + domain regex matching
  `youtube.com`, `youtu.be`, `m.youtube.com`, `music.youtube.com`.
  Matches Sprint 07 C4's URL tab pattern.
- Server-side: same domain regex in the action layer before
  Trigger.dev dispatch. Authoritative; client-side is
  defense-in-depth.

The regex is domain-shallow — it does not track YouTube's URL
evolution (Shorts, embed, mobile, music URLs all pass the domain
check). yt-dlp owns deep URL parsing on the Python side. URLs that
pass the domain check but don't resolve to a single video at yt-dlp
time fail with `youtube_invalid_url:`.

**`source_url` storage (A3.4 locked):** the row stores the original
user-pasted URL, not yt-dlp's canonical-form normalization. yt-dlp
resolves any of the ~8 single-video URL forms internally;
preserving the original URL keeps provenance (a user who pasted a
Shorts URL sees the Shorts URL in the list page, not silently
rewritten to `watch?v=`). Known future consequence — flagged in
`SPRINT_08_carryovers.md`: if a future feature ever needs to detect
"two source rows pointing at the same underlying YouTube video via
different URL forms" (dedup or analytics on re-ingestion), that
check has to canonicalize at query time.

**Title source (A3.5 locked):** server-extracted from yt-dlp
metadata, no pre-submit title input. Matches Sprint 07's URL article
pattern (trafilatura's page title is server-extracted; user doesn't
label the source at ingestion). yt-dlp's metadata title is the
canonical creator-given title, no user labeling needed at
ingestion. Fallback to `"Untitled"` if metadata extraction fails —
consistent with Sprint 07 E5's NULL-title fallback for the list
page.

**Upload page UX (A3.3 / A6 locked, option (1) — 4th tab):**

Sprint 07 C4 shipped a 3-tab pattern (Audio | URL | PDF) under
`apps/web/src/app/app/[workspaceSlug]/sources/upload/`. B2 adds a
4th tab "YouTube" at end-position (A3.3.1 — no reordering of
existing tabs, no muscle-memory disruption for users on the Sprint
07 pattern). Label "YouTube" (A3.3.2 — matches the
`youtube_transcript` source type name; "Video" rejected as
premature generalization for non-YouTube video sources that don't
yet exist in scope).

Implementation pattern inheritance from C4 (worth naming explicitly
per A3.3 refinement so implementation doesn't reinvent):
`youtube-tab.tsx` sibling under
`apps/web/src/app/app/[workspaceSlug]/sources/upload/`, structured
identically to `url-tab.tsx`: text input + submit button +
server-action invocation. Same `<form action={handleSubmit}>`
pattern; same `useFormStatus` submit button; same client-side
`router.push` + `router.refresh` after success. `uploadYoutubeAction`
mirrors `urlAction`'s shape (forward-coupling note per A5.2 —
ensures B4 migration is a uniform "swap `createSourceX()` for
`createSource()`" change across all four action handlers).

**yt-dlp pinning + verification (A2.1 locked, (iii)+(α)):**

yt-dlp hard-pinned in `apps/jobs/python/requirements.txt` alongside
trafilatura and pdfplumber. **Bump cadence:** weekly automated PR
that bumps yt-dlp to its latest release (mechanism: GitHub Action
on a weekly cron, runs `pip install --upgrade yt-dlp`, diffs
requirements.txt, opens a PR if the version changed). **Verification:**
manual smoke on every bump PR — paste a known-good YouTube URL,
see the row reach `'ready'`. Two-part lock: smoke is the
verification surface, not optional. A bump PR with green CI but no
smoke is silent regression to the (γ) shape, which is named here as
explicitly not the operative contract.

**Downgrade trigger:** if observed YouTube extraction volume is
below 10% of total source extractions over a trailing 30-day window
at 6 weeks post-S15 launch, downgrade to (iii)+(γ) (hard pin +
weekly bump PR + user-report-driven verification) and record in
`SPRINT_08_carryovers.md` as a resolved-state entry. Until trigger
fires, (α) is operative.

**Operational runbook (A2.4 locked):** new file at
`docs/runbooks/yt-dlp.md` (per CLAUDE.md "operational truth,
human-curated" — user authors the content; spec-lock owns the stub
structure). Three sections:

1. **Diagnosing yt-dlp failures by error prefix** — references the
   "Sprint 08 YouTube failure-prefix surface" subsection above for
   the full prefix-to-meaning mapping.
2. **Manual bump procedure** — includes the smoke-on-bump
   verification per A2.1; cross-reference is **local to this
   section** (not an external pointer) so the operational contract
   is resistant to drift: someone reading the bump procedure sees
   the smoke requirement inline, not via a forward jump.
3. **Fixture refresh procedure** — subprocess-boundary mock JSON
   shapes for the test suite, when yt-dlp's emitted error shapes
   shift after a version bump.

The B2 smoke checklist (paste a known-good YouTube URL, see row
reach `'ready'`) IS the smoke-on-bump fixture per A2.1. Same URLs,
same expected behavior. The runbook's bump procedure references B2's
smoke checklist directly; no duplicate spec content.

**App layer (apps/jobs):**

- `apps/jobs/package.json` (modify) — add
  `"@authently/ai": "workspace:*"` to dependencies. **First addition
  of @authently/ai to apps/jobs's dependency surface.** Workspace
  scaffolding from B0 makes this a one-line dependency add; no new
  cross-package coupling pattern (matches the existing
  `@authently/shared` + `@authently/db` shape).
- `apps/jobs/trigger.config.ts` (modify) — no extension changes;
  Python build extension from Sprint 07 already discovers
  `apps/jobs/python/**/*.py` and the new `extract_from_youtube.py`
  is picked up automatically.
- `apps/jobs/src/trigger/extract-from-youtube.ts` (new) —
  Trigger.dev task definition; yt-dlp Python subprocess invocation
  + Node-compatible `File` construction from the audio path + call
  to `transcribeAudio` from `@authently/ai/transcription` + status
  RPC dispatch.
- `apps/jobs/python/extract_from_youtube.py` (new)
- `apps/jobs/python/requirements.txt` (modify) — add hard-pinned
  yt-dlp entry; exact version locked at pre-flight.

The existing `apps/jobs/src/lib/python-runner.ts` shared subprocess
wrapper from Sprint 07 C2a handles `extract_from_youtube.py`
identically to the other two modules — no per-module dispatch
needed; same stdout/exit-code handling.

**App layer (apps/web):**

- `apps/web/src/services/sources/create-source-youtube.ts` (new) —
  service module wrapping `api_create_source_youtube` RPC +
  triggering `extractFromYoutubeTask`. Mirrors
  `create-source-url.ts` shape: zod validation, RPC call, trigger
  dispatch, returns the new `source.id` to the caller.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/youtube-action.ts`
  (new) — server action calling the service module. Mirrors
  `url-action.ts` shape (per A5.2 forward-coupling).
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/youtube-tab.tsx`
  (new) — sibling of `url-tab.tsx` per A3.3 pattern-inheritance
  note above.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/upload-tabs.tsx`
  (modify) — add 4th tab "YouTube" at end-position; new tab content
  mounts `<YoutubeTab>`.

**Schema delta (folded into B2's commit):**

```sql
-- Widen type CHECK to admit YouTube transcripts. Third widening
-- of the constraint (audio + url + pdf existed; youtube_transcript
-- joins them).
alter table public.sources
  drop constraint sources_type_check,
  add constraint sources_type_check
    check (type in (
      'audio_transcript',
      'url_extraction',
      'pdf_extraction',
      'youtube_transcript'
    ));
```

**RPCs added in this commit:**

- `private.create_source_youtube_impl(_workspace_id uuid, _user_id
  uuid, _source_url text)` — DEFINER worker. Inserts `(workspace_id,
  user_id, type='youtube_transcript', content='', source_url,
  status='processing')`. Returns `source.id`. Mirrors
  `create_source_url_impl` shape; the `source_url` carries the
  original user-pasted URL (per A3.4).
- `public.api_create_source_youtube(_workspace_id uuid, _source_url
  text)` — auth-callable wrapper. Asserts `auth.uid()` non-null +
  workspace membership; dispatches to worker. Errcodes: `22023`
  (missing user / source_url), `42501` (non-member). Mirrors
  `api_create_source_url` shape.

This wrapper is **temporary** — it follows the Sprint 07 parallel
pattern in B2 so B2 can ship and be smoked independently of B4. B4
deletes this wrapper in the same migration that introduces the
unified `api_create_source` RPC.

**Tests (~9 new):**

DB tier (`packages/db/tests/`):
- `api_create_source_youtube` perimeter (anon → 22023 defensive
  check; non-member → 42501) + happy path (member call inserts row
  with correct columns including `source_url`). 3 tests.

Jobs tier (`apps/jobs/tests/`):
- `extract-from-youtube.test.ts` — Trigger.dev task tests with
  subprocess-boundary Python mock. Happy path (mocked yt-dlp emits
  audio_path + title, mocked Whisper returns transcript, status RPC
  called with `'ready'`); each of the four failure prefixes routes
  to status RPC with `'failed'` + correct prefix. ~5 tests.

Web tier (`apps/web/tests/`):
- `create-source-youtube.test.ts` (in
  `apps/web/tests/services/sources/`) — service module tests
  mirroring `create-source-url.test.ts` shape (real Supabase + real
  RPC; Trigger.dev SDK mocked). Happy path + workspace-perimeter
  rejection. ~2-3 tests.

Python module tests fold into the existing pytest infrastructure
from Sprint 07 C2.5 — no new test gate, no new framework. Module
tests cover argv shape, JSON stdout shape, exit codes, error class
prefixing per the prefix surface.

**Expected gate deltas:**

- `test:license-headers`: +~5 new files (.ts task, .py module, .ts
  service module, .ts action, .tsx tab) + modifications to existing
  files (modifications are header-neutral).
- `test:db`: +3 tests in 1 new file.
- `test:web`: +2-3 tests in 1 new file.
- `test:jobs`: +5 tests in 1 new file.
- `typecheck`, `lint`: unchanged.

**Commit message:** `feat(sources): Sprint 08 B2 — YouTube transcript extraction via yt-dlp`

### B4 — Source orchestration

**Why:** Collapse the parallel `api_create_source_*` wrappers into a
unified RPC. With four source types now in production (audio + URL
+ PDF + YouTube), the parallel wrapper pattern has reached the size
where it feels like duplication; B4 exists to collapse it (per
SPRINT_07_carryovers.md entry #1, "becomes load-bearing with
three-plus source types in production").

**Approach (A5 locked):**

HTTP-boundary collapse only (A5.1 option (A)): a single
`public.api_create_source` wrapper validates the type discriminator
+ payload shape, then dispatches to the appropriate type-specific
`private.create_source_*_impl` worker. **Workers stay parallel** —
their type-specific INSERT logic (different columns per type:
`file_path` for audio, `source_url` for URL/YouTube, `storage_key`
for PDF) is the actual non-duplicated work. Collapsing workers
means a single worker handling the union of all type-specific
fields, which is more code not less.

This is the application of the A5.1 general principle: "Collapse at
the layer where the duplication actually lives." The carryover's
"parallel wrappers" framing named the actual duplication — four
near-identical wrapper bodies that all do "validate payload →
dispatch to worker → return sourceId." That's what collapses.

**Unified RPC signature:**

```sql
public.api_create_source(
  _workspace_id uuid,
  _type text,
  _payload jsonb
) returns uuid
```

`_type` is the discriminator (`'audio_transcript'`, `'url_extraction'`,
`'pdf_extraction'`, `'youtube_transcript'`). `_payload` carries the
type-specific fields:

| `_type` | `_payload` shape |
|---|---|
| `'audio_transcript'` | `{ file_path: text }` (Sprint 06 B1 pattern) |
| `'url_extraction'` | `{ source_url: text }` |
| `'pdf_extraction'` | `{ title: text }` (storage_key is server-generated in the worker) |
| `'youtube_transcript'` | `{ source_url: text }` |

The wrapper:
1. Asserts `auth.uid()` is non-null (else `22023`).
2. Asserts workspace membership via `private.is_workspace_member`
   (else `42501`).
3. Validates `_type` is one of the four known discriminator values
   (else `validation:unknown_source_type`).
4. Validates `_payload` shape per `_type` using `jsonb_typeof` +
   required-key checks (else `validation:invalid_payload`).
5. Dispatches to the appropriate worker via a CASE statement on
   `_type`. Each branch calls `private.create_source_<type>_impl`
   with the unpacked payload fields.
6. Returns the worker's `source.id`.

**Payload validation placement (A5.4 locked, two-layer):**

- **TS layer:** zod discriminated-union schema at the apps/web action
  boundary per CLAUDE.md zod rule. Type-specific schemas per source
  type form the union; one zod schema covers the full surface.
- **DB layer:** the wrapper does **structural** validation
  (`jsonb_typeof`, required keys per type discriminator). The worker
  re-validates its own payload shape as defense-in-depth.

Distinction worth specifying so implementation doesn't accidentally
duplicate or skip: the DB layer does **structural** validation only.
**Semantic** validation (file size limits for PDFs, MIME type for
audio, URL form for YouTube) lives at the action handler layer.
Semantic checks don't belong at the DB because the inputs there are
already past the apps/web validation boundary; structural checks
defend against malformed payloads at the RPC boundary.

**TS-side dispatch shape (A5.2 locked, single `createSource()`):**

apps/web gains a single service module:

```ts
// apps/web/src/services/sources/create-source.ts
export type CreateSourcePayload =
  | { type: 'audio_transcript'; filePath: string }
  | { type: 'url_extraction'; sourceUrl: string }
  | { type: 'pdf_extraction'; title: string }
  | { type: 'youtube_transcript'; sourceUrl: string };

export async function createSource(
  workspaceId: string,
  payload: CreateSourcePayload,
): Promise<{ ok: true; sourceId: string } | { ok: false; error: string }>;
```

All four action handlers (`uploadAudioAction`, `uploadUrlAction`,
`uploadPdfAction`, `uploadYoutubeAction`) migrate to call this
unified function. **Action handlers stay type-specific** — they do
type-specific pre-validation (file size for PDF, MIME for audio,
URL form for YouTube) before terminating in a single
`createSource()` call. The collapse is at the RPC boundary; action
handlers are the natural place for type-specific pre-validation
that doesn't belong at the DB.

This preserves the C4 tab → action → unified-RPC chain cleanly.
Collapsing action handlers would force tabs to either share an
action (re-introducing dispatch at the UI layer) or wire to a
generic action with type discriminator pre-set (verbose and
ceremonial). Keeping action handlers type-specific is the right
boundary.

**Error surface (A5.5 locked, A2.2 cross-anchor check):**

Unified RPC returns uniform shape regardless of source type. apps/web
action returns `{ok: true, sourceId} | {ok: false, error: string}` —
same discriminated union pattern as Sprint 07 C2b.2 actions.
Create-source-RPC failures are **input-validation only**:
`workspace_not_member` (`42501`), `validation:unknown_source_type`,
`validation:invalid_payload`. Extraction failures (the YouTube
failure-prefix surface above + Sprint 07's existing prefixes) come
through the polling / status RPC path, not the create-source-RPC
path.

**Cross-anchor constraint check at A5 (explicit, per
deliberate-over-implicit discipline):**

- **A2.2 uniform error-handling** ✓ — unified RPC returns uniform
  error shape; per-source-type extraction errors route through
  polling, not the create-source-RPC path.
- **A4.3 uniform content shape** ✓ — single text blob in `content`
  across all source types means the unified RPC doesn't need a
  content-shape discriminator; content is uniform regardless of
  extraction path.
- **A3 expanded prefix set** ✓ — the four YouTube failure prefixes
  (`youtube_unavailable:`, `youtube_age_restricted:`,
  `youtube_invalid_url:`, plus inherited `transient:`) flow through
  the polling path, not the create-source-RPC path. No new
  RPC-layer constraint.

All three cross-anchor constraints land cleanly. The (A) +
single `createSource()` + full migration decision was implicitly
assumed by A2.2 and A4.3 locks; this verification confirms the
assumption holds without forcing reopens.

**Schema delta (folded into B4's commit):**

```sql
-- Create the unified wrapper.
create function public.api_create_source(
  _workspace_id uuid,
  _type text,
  _payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _source_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '22023';
  end if;

  if not private.is_workspace_member(_workspace_id, auth.uid()) then
    raise exception 'not a workspace member' using errcode = '42501';
  end if;

  case _type
    when 'audio_transcript' then
      -- validate + dispatch to private.create_source_audio_impl
    when 'url_extraction' then
      -- validate + dispatch to private.create_source_url_impl
    when 'pdf_extraction' then
      -- validate + dispatch to private.create_source_pdf_impl
    when 'youtube_transcript' then
      -- validate + dispatch to private.create_source_youtube_impl
    else
      raise exception 'validation:unknown_source_type'
        using errcode = '22023';
  end case;

  return _source_id;
end;
$$;

grant execute on function public.api_create_source to authenticated;

-- Drop the four parallel wrappers (workers stay).
drop function public.api_create_source_audio(uuid, text);
drop function public.api_create_source_url(uuid, text);
drop function public.api_create_source_pdf(uuid, text);
drop function public.api_create_source_youtube(uuid, text);
```

The four `private.create_source_*_impl` workers are preserved
unchanged. The unified wrapper dispatches to them via the CASE
statement.

**App layer (apps/web):**

- `apps/web/src/services/sources/create-source.ts` (new) — unified
  service module per the TS signature above.
- `apps/web/src/services/sources/create-source-audio.ts` (DELETE) —
  callers migrate to `createSource()`.
- `apps/web/src/services/sources/create-source-url.ts` (DELETE) —
  callers migrate to `createSource()`.
- `apps/web/src/services/sources/create-source-pdf.ts` (DELETE) —
  callers migrate to `createSource()`.
- `apps/web/src/services/sources/create-source-youtube.ts` (DELETE)
  — the B2 service module deletes; callers migrate to
  `createSource()`. Net effect: B2 introduced `createSourceYoutube`
  in its sub-commit; B4 deletes it alongside its three siblings in
  this sub-commit. Single-commit (a) shape per A5.3.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/*.ts` action
  handlers (modify) — each of the four action handlers swaps its
  type-specific `createSourceX()` call for `createSource(workspaceId,
  { type: '...', ... })`.

**Tests:**

The existing `apps/web/tests/services/sources/create-source-url.test.ts`
and `create-source-pdf.test.ts` (plus the `create-source-youtube.test.ts`
introduced in B2) refactor to exercise the unified `createSource()`
path. Net test count is roughly neutral: existing tests retarget,
with one new test file for the discriminator-validation path
(`createSource()` with an unknown `_type` rejects with
`validation:unknown_source_type`).

Perimeter test for `public.api_create_source` (3 tests: anon
rejected with `22023` defensive check, non-member rejected with
`42501`, member happy path) replaces the **twelve** perimeter tests
for the four old wrappers (3 each). Net DB test count: roughly -9
tests (twelve removed; three added), reflecting the actual
collapse.

**Expected gate deltas:**

- `test:license-headers`: -3 (three deleted service modules); +1
  (new unified service module). Net -2.
- `test:db`: -9 tests (twelve old perimeter tests removed; three new
  unified perimeter tests added). Migration delta: +1 migration.
- `test:web`: roughly neutral on test count; existing test files
  refactor in place. +1 file for unknown-discriminator test.
- `test:jobs`: unchanged.
- `typecheck`, `lint`: unchanged.

**Commit message:** `refactor(sources): Sprint 08 B4 — collapse api_create_source_* wrappers into unified api_create_source RPC`

## Sequencing within Sprint 08

Per A1 lock (updated at pre-flight for B0 prerequisite) — B0 first
as the packages/ai instantiation, B2 second consuming B0's shared
service, B4 third as the collapse + migration:

1. Branch: `chore-sprint-08-section-b-close` off main.
2. **Commit 1 (B0)** — packages/ai instantiation. Package
   scaffolding + transcription extraction from
   `apps/web/src/services/transcription/` to
   `packages/ai/src/transcription/` + apps/web import path updates.
   **No new tests** (existing apps/web transcription tests retarget
   the moved import path and pass unchanged). **No manual smoke
   required** — no behavior changes; unit tests are the verification
   surface.
3. Pause for review against spec.
4. **Commit 2 (B2)** — YouTube transcript extraction. Schema CHECK
   widening + `api_create_source_youtube` wrapper + worker + yt-dlp
   Python module + Trigger.dev task consuming
   `@authently/ai/transcription` + apps/web service module +
   action handler + 4th upload-page tab + apps/jobs gains
   `@authently/ai` workspace dependency + ~9 tests. Manual smoke
   required per CLAUDE.md "Framework rules not caught by automated
   gates" (new server action: `youtube-action.ts`; modified upload
   page).
5. Pause for review against spec.
6. **Commit 3 (B4)** — source orchestration. Unified
   `api_create_source` RPC + apps/web migration of all four
   callers + drop of the four old `api_create_source_*` wrappers +
   consolidated TS `createSource()` + tests. **Manual smoke required
   on all four source types end-to-end** (B4's 4x smoke surface
   expansion per A5.3 refinement); commit + smoke happen in the
   same focused work session per smoke-window discipline.
7. Pause for review against spec.
8. PR opened (single PR for the section, three-commit stack).

**Dependency graph between sub-commits:**

- **B0 blocks B2.** B2 imports from `@authently/ai/transcription`;
  the package must exist for B2 to compile and test.
- **B2 blocks B4.** B4's caller migration includes the YouTube path;
  if B4 shipped without B2, there would be nothing YouTube-shaped
  to migrate, and the unified RPC's discriminator surface would be
  incomplete.
- **B0 does NOT block B4 directly** — B4 doesn't touch transcription
  paths. But B4 lands third because the sub-commit sequencing is
  linear on a single branch, and B2 must land between B0 and B4.

## Gate predictions (cumulative across all three commits)

All 6 gates green at every commit. Per-commit deltas above;
cumulative end-state vs. Sprint 07 closure baseline (final post-PR
#45 state):

- `test:license-headers`: ~256 → ~264 (+~5-6 from B0 new package
  files; +5 from B2 new files; -2 net from B4's three deletions +
  one addition).
- `typecheck`: 6/6 → 7/7 if `packages/ai` adds a new typecheck
  target (mirrors `@authently/shared` pattern; verify at B0
  pre-flight).
- `lint`: 6/6 (B0 adds packages/ai to lint targets; matches existing
  package conventions).
- `test:db`: ~157 → ~151 (+3 from B2's `api_create_source_youtube`
  perimeter; -9 net from B4's twelve-removed + three-added
  unified-RPC perimeter shape). Net delta -6. B0 contributes 0 to
  test:db.
- `test:web`: ~65 → ~67 (+2-3 from B2's service module test; +1
  from B4's unknown-discriminator test). B0 contributes 0 net to
  test:web — existing transcription tests retarget the moved
  import path without count change.
- `test:jobs`: ~15 → ~20 (+5 from B2's `extract-from-youtube`
  task).

Total predicted new tests across the sprint: ~10–11 net at the
sources-domain layer (≈9 added in B2, ≈-9 removed + ≈3-4 added in
B4 = net negative due to the perimeter consolidation). B0 adds zero
tests (extraction-only commit). Allow ±2 drift per commit; if any
gate moves outside ±3 of the predicted range, scope leaked.

The DB test count going **down** is correct and expected — that's
the collapse working as intended. Sprint 08 is a collapse sprint as
much as it's a breadth sprint.

B0's net-zero test count is also correct and expected — package
extraction shouldn't change behavior, so tests retarget without
counting differently. If B0 adds new tests, that's a signal of
scope expansion beyond the locked B0 boundaries.

## Manual smoke test (per sub-commit)

### B0 smoke (after Commit 1 lands)

**No manual browser smoke.** Verification surface is the existing
apps/web transcription test suite passing unchanged after the
import path update. Audio-upload path (Sprint 06 B5) continues to
work identically; if the unit tests pass, the move is correct.

If smoke is desired for extra confidence: upload an audio file via
the Audio tab on a running dev server, verify transcript renders.
This exercises the same path as the unit tests at runtime, not
strictly necessary.

### B2 smoke (after Commit 2 lands)

Browser-driven, not automated. Targets the production code paths
that automated gates can't exercise. **This same checklist is the
smoke-on-bump fixture per A2.1's yt-dlp pinning lock** — paste a
known-good YouTube URL on every bump PR, see the row reach
`'ready'`. Same URLs, same expected behavior.

- **YouTube transcript extraction (happy path)** — submit a
  known-good YouTube video URL via the YouTube tab. Verify
  redirect to sources list with row in `'processing'`. Wait for
  polling to flip to `'ready'`. Verify title (from yt-dlp metadata)
  + content (Whisper transcript) populated. Acceptance criterion
  for A2.1's smoke-on-bump fixture: this item passes on every
  weekly bump PR.
- **YouTube Shorts URL** — submit a `youtube.com/shorts/<id>` URL.
  Verify same async flow; yt-dlp's URL parsing handles the Shorts
  variant; row reaches `'ready'` with same shape as a regular
  video URL. Source row stores the original Shorts URL (per
  A3.4).
- **Invalid YouTube URL (playlist URL)** — submit a
  `youtube.com/playlist?list=...` URL. Verify row transitions to
  `'failed'` with `youtube_invalid_url:` prefix. List page renders
  the failed row with the "Not a video URL" label and expand-for-
  error showing the full user-facing text.
- **Unavailable video** — submit a URL for a private / deleted /
  region-locked video. Verify row transitions to `'failed'` with
  `youtube_unavailable:` prefix; label "Video unavailable" renders.
- **Age-restricted video** — submit a URL for an age-restricted
  video. Verify row transitions to `'failed'` with
  `youtube_age_restricted:` prefix; label "Age-restricted" renders;
  expanded text suggests manual audio upload.
- **Non-YouTube URL in YouTube tab** — submit a non-YouTube URL
  (e.g., `https://example.com/article`) in the YouTube tab. Verify
  client-side validation rejects via the domain regex (no
  Trigger.dev task spawned); user sees the validation error
  inline.
- **Audio / URL / PDF regression check** — confirm Sprint 06 audio
  flow + Sprint 07 URL/PDF flows still work unchanged. Upload
  audio, paste an article URL, drag a PDF; verify each reaches
  `'ready'` via its existing path.

### B4 smoke (after Commit 3 lands)

**4x smoke surface vs. B2** (per A5.3 refinement). All four source
types end-to-end through the new unified RPC. Each must reach
`'ready'`.

- **Audio upload (regression after B4 migration)** — upload audio
  via the Audio tab. Verify Sprint 06 sync transcription path still
  works through the new `createSource()` call. Transcript displays;
  source saves to workspace.
- **URL extraction (regression after B4 migration)** — paste a
  known-good article URL via the URL tab. Verify async flow:
  redirect → processing → ready. Title + content populated.
- **PDF upload (regression after B4 migration)** — drag a
  known-good PDF onto the PDF tab. Verify async flow: redirect →
  processing → ready. Title (user-supplied or filename-derived) +
  content populated.
- **YouTube extraction (regression after B4 migration)** — submit
  a known-good YouTube URL via the YouTube tab. Verify async flow
  through the new unified RPC: row reaches `'ready'` with title
  (yt-dlp metadata) + content (Whisper transcript) populated.
- **Discriminator rejection** — manually exercise the unified RPC
  via Supabase Studio with an unknown `_type` value
  (e.g., `'twitter_thread'`). Verify rejection with
  `validation:unknown_source_type` errcode `22023`. Confirms the
  CASE-statement default branch fires.
- **Cross-tenant (regression check)** — confirm RLS still blocks
  reading another workspace's source rows of any type; confirm
  the unified RPC rejects non-members of the target workspace with
  `42501`.

Failed-row error display + delete UI from Sprint 07 C3.3 carry
forward unchanged; no need to re-smoke those surfaces unless B4's
migration touches the sources-list rendering (it doesn't).

## Pre-flight verification items

To run before Sprint 08 implementation begins. Items 1–6 are the
original pre-flight set (resolved during the lock-revisit cycle for
Items 3 and 5; Items 1, 2, 4, 6 confirmed clean at first pass).
Items B0.1–B0.3 are B0-specific items added at the A4.1
lock-revisit; they verify the package scaffolding conventions before
B0 implementation begins.

**Items 1–6 (Sprint 08 original pre-flight set):**

- **yt-dlp version + Python runtime compatibility** — confirm
  current yt-dlp release is compatible with the Python 3.11 / 3.12
  runtime locked in `apps/jobs/trigger.config.ts` (per Sprint 07
  pre-flight Item 1). Pin in `apps/jobs/python/requirements.txt`
  with exact version (no ranges) per A2.1 (iii) lock.
- **yt-dlp audio-download API shape** — confirm the exact yt-dlp
  Python library entry point for audio-only download to a known
  path. Spec assumes this is a stable surface; verify before B2
  implementation.
- **B1 Whisper service signature** — confirm the existing Sprint 06
  B1 transcription service accepts an audio file path as input
  (vs. an audio buffer, vs. a Supabase Storage object). A4.1's
  two-stage shape (yt-dlp emits file path; Trigger.dev task hands
  to B1) depends on B1's signature being file-path-acceptant. If
  B1 takes a buffer only, the two-stage shape adjusts to "yt-dlp
  emits file path → Trigger.dev task reads the file into a buffer
  → hands buffer to B1" — adjustment is at the Trigger.dev task
  layer, not the spec layer.
- **Weekly yt-dlp bump GitHub Action** — confirm the action's
  shape before B2 ships. Action runs `pip install --upgrade yt-dlp`
  in a checkout, diffs `apps/jobs/python/requirements.txt`, opens a
  PR with the new pinned version if it changed. Cron cadence:
  weekly (lock specific day at pre-flight; recommend off-peak so
  smoke-on-bump can run during working hours).
- **Runbook stub structure + authoring timing** —
  `docs/runbooks/yt-dlp.md` doesn't yet exist; CLAUDE.md flags
  `docs/runbooks/` as human-curated. Spec produces the stub
  structure (three sections per A2.4); user authors the content.
  **Authoring blocks merge, not PR open and not B2 smoke-window.**
  Specifically: B2 PR can open without runbook content
  (implementation proceeds independently); B2 smoke-window can
  run without runbook content (smoke is feature correctness, not
  operational documentation). The blocking point is **before B2
  merges to main** — post-merge operational scenarios (a yt-dlp
  failure in dev, the first weekly bump PR firing) depend on the
  bump procedure being documented; smoke-on-bump discipline becomes
  operative once B2 is in main. Confirm at pre-flight that the user
  has bandwidth to author the runbook content within the B2
  PR-open-to-merge window.
- **B4 migration order in the single commit** — the migration
  creates the unified wrapper AND drops the four old wrappers in
  the same SQL file. Verify ordering: the unified wrapper must be
  created first; if the four old wrappers are dropped before the
  unified one exists, there's a brief moment within the migration
  where no `api_create_source*` RPC exists for the four types. In
  practice this is a transaction-scoped concern only, but
  documenting the ordering at pre-flight keeps it deliberate.

**B0-specific pre-flight items (added at A4.1 lock-revisit):**

- **B0.1 — packages/ai scaffolding conventions.** Read existing
  `packages/shared/package.json`, `packages/shared/tsconfig.json`,
  and the package's exports surface (`src/index.ts` shape). Mirror
  the same scaffolding shape for `packages/ai`. If
  `@authently/shared` and `@authently/db` diverge on any
  convention (e.g., differing tsconfig extension chains or build
  configs), name the divergence and decide which to follow before
  B0 implementation. Lock the choice inline at B0 implementation
  if it diverges from this spec.
- **B0.2 — monorepo workspace exports pattern.** Verify the
  exports field shape in existing packages — is the convention
  `"./transcription"` named subpath exports, a single root export,
  or some other shape? Match the existing convention so apps/web
  imports look like `import { transcribeAudio } from
  "@authently/ai/transcription"` (consistent with how apps already
  consume `@authently/shared` and `@authently/db`).
- **B0.3 — apps/web import update surface area.** Grep apps/web
  source for current imports from `@/services/transcription/` to
  catalog the files that need updating in B0. Per the earlier
  finding, the surface is small: `openai-whisper.ts` (moves) +
  `actions.ts` (Sprint 06 B5 server action that imports
  `transcribeAudio`) + the test file. Confirm no additional
  consumers surface during B0 work; if they do, fold them into the
  same commit.

## Forward-references to Sprint 09

Sprint 09 begins the Authenticity Engine block (per build_plan.md
§5.3). The block spans S09–S11 in some internal order (locked at
each sprint's spec-lock cycle): voice fingerprint extraction, remix
engine, Authenticity Engine UI.

Sprint 08 closes out the source-ingestion vertical slice. The
sources table now holds all four source types (audio / URL / PDF /
YouTube), the unified `api_create_source` RPC dispatches across
them, and the polling-driven status surface lets users see
extraction progress.

**Outputs Sprint 09+ consumes from Sprint 08:**

- The `sources` table is the corpus the Authenticity Engine reads
  from. Voice fingerprint extraction (likely S09) reads past posts
  the user has ingested as sources; remix input (likely S10–S11)
  reads source content as the raw material for AI generation.
- The unified `createSource()` TS service module is the entry point
  for any future source type. Sprint 09+ may add new source types
  (e.g., direct-text-input for "I have past posts as text I want to
  paste in"); the unified surface accepts a new discriminator value
  + payload variant without revisiting the dispatch shape.
- `packages/ai` is now instantiated (B0). build_plan §1.2's "All AI
  calls go through `packages/ai` with a model router" framing is
  no longer aspirational; transcription is the first concrete
  consumer. S09–S11's Authenticity Engine work (model router,
  voice-aware prompts, anti-slop guards per §1.2) lands as
  additions to the package, not new-package instantiation.
  Sprint-close consolidation annotates build_plan §1.2 with
  "packages/ai instantiated in Sprint 08 B0 with transcription as
  first consumer; model router + additional consumers land
  S09–S11" so future sessions don't read §1.2 as still-aspirational
  when it's partially shipped.

**Deferred items pointing forward:**

- **Source detail page (A7)** — likely revisits in S09–S11 when the
  Authenticity Engine UI references source content for remix input
  ("select a source to remix from" picker that previews content).
  Carryover entry SPRINT_07_carryovers.md #9 carries forward unchanged.
- **A2.1 downgrade trigger** — fires 6 weeks post-S15 launch. If
  observed YouTube extraction volume is below 10% of total
  extractions over a trailing 30-day window, evaluate downgrade to
  (iii)+(γ) (drop the manual-smoke-on-bump discipline; user-report-
  driven verification). Not a Sprint 09 concern; relevant at S15+6
  weeks.
- **A4 upgrade trigger** — fires 6 weeks post-S15 launch. If (1)
  observed YouTube extraction volume exceeds 30% of total
  extractions over trailing 30-day window AND Whisper cost on
  YouTube extractions exceeds $200/month, OR (2) three or more
  distinct users report transcript quality observably worse than
  the source's available captions within any 30-day window,
  evaluate upgrade to route (b) (captions-first with audio
  fallback). At upgrade evaluation time, the deferred
  `youtube_no_transcript:` failure prefix activates with label +
  expanded text decisions made at that point.
- **A3 URL surface expansion** — fires when expansion to
  playlists / channels is scoped. Not bound to a specific sprint;
  triggers on user-feature-request or use-case-validation signal.
- **A3.4 dedup / analytics consequence** — flagged as
  carryover-worthy if a future feature needs to detect "two source
  rows pointing at the same underlying YouTube video via different
  URL forms." Recorded in SPRINT_08_carryovers.md as a known
  consequence of the original-URL storage choice; future-sprint
  concern, not Sprint 09 specific.

## Decisions locked at pre-flight

Compact list for grep-friendly reference. Same pattern as Sprint 06 /
Sprint 07's appendix. A-prefix follows the seven-anchor walk that
produced this spec.

**Foundational (A-prefix):**

- **A1 — Sub-sequencing.** B0 first (packages/ai instantiation; no
  behavior change), B2 second (parallel wrapper pattern consuming
  B0's shared service), B4 third (HTTP-boundary collapse + full
  migration). **Three commits, one PR** (updated at pre-flight from
  the original two-commit lock for the B0 prerequisite). B4 is
  single-commit per A5.3 (a); split-commit B4.1/B4.2 named as
  option-not-taken with reasoning (integration-shaped tests +
  smoke-on-all-four provide the verification surface split-commit's
  deferred-deletion would have added). Rollback playbook for B4 is
  named explicitly in the Workflow conventions section: higher
  friction than a typical revert because migrations are append-only
  per CLAUDE.md.

- **A2 — yt-dlp brittleness mitigation.** Four sub-locks:
  - A2.1 pinning + verification: (iii)+(α) — hard pin in
    `apps/jobs/python/requirements.txt` + weekly automated bump
    PR + manual smoke on every bump per smoke-window discipline.
    Downgrade trigger: if observed YouTube extraction volume is
    below 10% of total source extractions over a trailing 30-day
    window at 6 weeks post-S15 launch, downgrade to (iii)+(γ) and
    record in SPRINT_08_carryovers.md as a resolved-state entry.
    Until trigger fires, (α) is operative.
  - A2.2 mocking boundary: subprocess-boundary, matching Sprint
    07 trafilatura/pdfplumber pattern. Uniformity-as-feature
    forwards as a constraint on A5: unified error-handling across
    source types is the default in B4 dispatch.
  - A2.3 failure prefixes: `youtube_unavailable:` and
    `youtube_age_restricted:` locked with both label + expanded
    text (per C3.3 discipline refinement applied at spec-lock
    time, not implementation time); `youtube_no_transcript:`
    deferred (route (a) chosen at A4); yt-dlp-itself-broken folds
    into inherited `transient:`.
  - A2.4 runbook: new file `docs/runbooks/yt-dlp.md`, three
    sections (Diagnosing yt-dlp failures by error prefix /
    Manual bump procedure / Fixture refresh procedure),
    smoke-on-bump cross-reference local to the bump section.

- **A3 — YouTube URL surface.** Five sub-locks:
  - A3.1 URL acceptance: route (i) — permissive single-video via
    yt-dlp + lightweight domain pre-check at apps/web boundary
    (`youtube.com|youtu.be|m.youtube.com|music.youtube.com`).
    New prefix `youtube_invalid_url:` locked with label "Not a
    video URL" + expanded text. Playlists / channels rejected.
  - A3.2 validation placement: two layers — client-side
    (`type="url"` + domain regex) + server-side (same regex in
    action layer). yt-dlp owns deep parsing.
  - A3.3 upload page UX: option (1) — add 4th tab "YouTube" at
    end-position. Substantively settles A6.
    `youtube-tab.tsx` mirrors `url-tab.tsx` shape (pattern-
    inheritance explicit so implementation doesn't reinvent).
  - A3.4 `source_url` storage: store original user-pasted URL,
    not yt-dlp's canonical form. Dedup/analytics-on-re-ingestion
    consequence flagged as future-carryover-candidate in
    SPRINT_08_carryovers.md.
  - A3.5 title source: server-extracted from yt-dlp metadata,
    no pre-submit input. "Untitled" fallback consistent with
    Sprint 07 E5 on metadata extraction failure.

- **A4 — Transcript extraction strategy.** Three sub-locks plus
  A4.1 mechanism revisit at pre-flight:
  - A4 route: (a) — audio-only via Whisper. yt-dlp downloads
    audio, Trigger.dev task hands to the shared transcription
    service. Upgrade trigger to route (b): compound condition
    (cost+volume OR three-or-more-distinct-users-within-30-day-
    window quality complaint) at 6 weeks post-S15 launch.
  - A4.1 subprocess shape: two-stage. yt-dlp Python emits audio
    file path; Trigger.dev task picks file up, constructs a
    Node-compatible `File`, and hands to the shared transcription
    service (`@authently/ai/transcription`). Three reasons: shared
    service untouched in behavior (extracted in B0; quality +
    error classification preserved), A2.2 mocking uniform,
    separation of concerns.
  - **A4.1 mechanism revisit (pre-flight Item 3 → locked option
    (i)):** original lock "Trigger.dev task hands audio file to B1
    Whisper service unchanged" rested on a reuse mechanism that
    conflicted with the Sprint 07 C2b.3 decoupling convention
    (apps/jobs runtime independence from apps/web). Pre-flight
    Finding 3 surfaced the conflict; verification found (a) C2b.3
    documented scope narrow, (b) apps/jobs/package.json has zero
    apps/web deps structurally, (c) broader Authently convention
    routes shared logic through shared packages
    (`@authently/shared` is the named example), (d) `packages/ai`
    is canonical-as-planned per build_plan §1.2 with no existing
    instantiation. Resolution: lock option (i) — instantiate
    `packages/ai` in B0, extract transcription as first consumer,
    apps/jobs imports from `@authently/ai/transcription` in B2.
    Option (ii) reimplementation in apps/jobs held in reserve only
    if B0 hits blocking complications. Option (iii) direct
    cross-package import effectively off the table per Finding 3
    broader-convention reasoning. A4.1 outcome preserved (Whisper
    quality + error classification surface unchanged); mechanism
    softened (shared-package consumption replaces direct cross-app
    reuse).
  - A4.2 audio format: deferred to discovery (implementation
    detail; not spec-lock).
  - A4.3 transcript shape: inherit single-text-blob from the
    shared transcription service (originally B1's pattern,
    extracted to packages/ai in B0). Forwards as a constraint on
    A5: uniform content shape across source types.

- **A5 — B4 dispatch shape.** Five sub-locks plus cross-anchor checks:
  - A5.1 end-state depth: (A) — HTTP boundary collapse, workers
    stay parallel. General principle introduced: "Collapse at
    the layer where duplication actually lives, not at every
    layer where names look parallel." Parallel names ≠
    duplicated logic.
  - A5.2 TS-side dispatch: single `createSource()` function with
    discriminated-union payload. Action handlers stay
    type-specific (each tab's action does type-specific
    pre-validation before calling `createSource()`).
  - A5.3 migration scope: (a) — single-commit full migration of
    all four callers. Smoke surface expanded to all four source
    types end-to-end. Verified integration-shaped test coverage
    (real Supabase + real RPC) protects the migration; split-
    commit option-not-taken with reasoning.
  - A5.4 validation placement: TS-layer zod discriminated-union
    schema + DB-layer structural validation (`jsonb_typeof`,
    required keys). DB does structural; action handlers do
    semantic.
  - A5.5 error surface: uniform `{ok, sourceId} | {ok: false,
    error}` shape. Create-source-RPC failures are input-
    validation only; extraction failures route through polling.
  - Cross-anchor checks at A5: A2.2 (uniform error-handling) ✓,
    A4.3 (uniform content shape) ✓, A3 expanded prefix set ✓.
    All three constraints land cleanly without forcing reopens.

- **A6 — Upload page UX.** Settled by A3.3 — option (1), 4th tab
  "YouTube" at end-position. No additional decisions; A6 walked
  as a confirmation rather than a substantive design call.

- **A7 — Source detail page.** Still deferred. Revisit trigger from
  SPRINT_07_carryovers.md entry #9 ("B4 orchestration in Sprint
  08 referencing source content in the UI") has not fired —
  neither B2 nor B4 introduces a UI consumer for source content.
  Carryover entry carries forward; likely revisit in S09–S11
  (Authenticity Engine block) when remix input needs source
  navigation.

**Sprint 08 drafting locks (referenced inline as "Sprint 08 (X)
lock"):**

- Sprint 08 (A) — A5.1 general principle ("collapse at the layer
  where the duplication actually lives") added as a Sprint 08
  discipline; future collapse decisions in subsequent sprints
  apply it.
- Sprint 08 (B) — manual smoke surface for B4 expanded to all four
  source types end-to-end. Smoke-window discipline holds: commit
  + smoke same focused work session; B4's session is sized to
  absorb the 4x smoke run.
- Sprint 08 (C) — failure-prefix consolidation as a standalone
  spec subsection. The four-prefix YouTube failure surface
  (`youtube_unavailable:` + `youtube_age_restricted:` +
  `youtube_invalid_url:` + inherited `transient:`) lives in one
  subsection so the implementation surface is legible at one
  glance; `docs/runbooks/yt-dlp.md` references it from the
  diagnosing-failures section.
- Sprint 08 (D) — verify-prompt-against-spec discipline applied at
  draft time (this spec). Anchor sub-locks transcribed from the
  walk's locked summaries; load-bearing precision details
  (downgrade-trigger anchors, quality-complaint threshold,
  runbook stub structure, smoke-surface expansion, rollback
  friction) preserved verbatim or near-verbatim per the user's
  precision-tightening checklist surfaced at draft-time
  endorsement.
- Sprint 08 (E) — packages/ai instantiated at B0 per A4.1
  lock-revisit (pre-flight Finding 3). Provenance is build_plan
  §1.2 canonical-as-planned framing ("All AI calls go through
  `packages/ai` with a model router"), not a Sprint 07 carryover.
  Sprint 08's transcription-reuse need is the first multi-consumer
  forcing function. **Scope discipline:** B0 is package
  scaffolding + transcription extraction + apps/web import update
  only — explicitly NOT the model router, voice-aware prompts, or
  anti-slop guards (those land at S09–S11 with the Authenticity
  Engine block). Future-session protection: build_plan §1.2 status
  annotation at sprint-close consolidation prevents §1.2 from
  being misread as still-aspirational once partially shipped.
