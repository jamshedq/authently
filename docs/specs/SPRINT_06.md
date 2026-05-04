<!--
  Sprint 06 — Source ingestion vertical slice (B1 + B5)
  Locked: 2026-05-04
  Status: planning → spec-locked
  Pre-flight cycle: single-pass — design was locked in chat session
    walkthrough during Sprint 05 closure rather than via the multi-pass
    cycle Sprint 05 used. Spec-lock here drafts the artefacts only;
    no design re-litigation.
  Predecessor: Sprint 05 closure (commit 574266f). Section A shipped;
    Section B's original Modal-based design was deferred and superseded
    by the redesigned approach this spec captures.
  Capacity: 1 solo builder. Smaller than Sprint 05 (2 sub-items vs 7);
    matches the validation-before-breadth strategy locked at D5a/D5b.

  Reading guide for future Claude sessions:
  - This sprint is a vertical slice. B1 (transcription service) and B5
    (file upload UI) ship end-to-end together. B2/B3/B4 deferred to
    Sprint 07 — recorded in SPRINT_06_carryovers.md entry #1.
  - Sprint 05's closure amendment forward-references this spec; that
    forward-reference becomes historically accurate when this commit
    lands. Closure amendment is durable record and is NOT modified by
    this commit.
  - Section B's original Modal-based design (preserved in SPRINT_05.md
    below the closure amendment) is historical reference only. The
    redesigned approach is OpenAI Whisper API, sync apps/web, no Modal.
  - Decisions locked at pre-flight live BOTH inline at sub-item level
    AND in the compact appendix at the bottom (D-prefix for design
    decisions, B1-/B5- prefix for implementation locks).
-->

# Sprint 06 — Source ingestion vertical slice (B1 + B5)

## Goal

Ship the first usable state of source ingestion via vertical slice.
B1 implements transcription against OpenAI Whisper API; B5 implements
the file upload UI that consumes B1 and persists transcripts to a new
`sources` table. Together they form an end-to-end audio-to-source
flow — upload a file, get a transcript, save it as a workspace
source.

The slice is deliberately narrow: short audio only (≤25MB per OpenAI
Whisper API's file-endpoint cap), one source type (`audio_transcript`),
synchronous execution in `apps/web` (no Trigger.dev orchestration),
no audio persistence (privacy-respecting default). Validation-
before-breadth: ship the user-facing path first, validate use, expand
in Sprint 07 with B2/B3/B4 (YouTube, URL/PDF, orchestration).

## Non-goals

- **Long-audio support** — files >25MB or >~25min rejected at upload
  with a clear error. Chunking + stitching pipeline deferred; recorded
  as SPRINT_05_carryovers.md entry #3.
- **B2 (YouTube ingestion via yt-dlp), B3 (URL/PDF extraction via
  Trafilatura + pdfplumber), B4 (source orchestration)** — deferred
  to Sprint 07 per D5b two-sprint split. Recorded in
  SPRINT_06_carryovers.md entry #1. Python tooling baseline (D3:
  Trigger.dev build extension in `apps/jobs`) lands with B2/B3 in
  Sprint 07; Sprint 06 itself uses no Python.
- **Audio persistence** — files stream through B5 → server action →
  OpenAI without storing the bytes anywhere. Re-transcription
  requires re-upload. Privacy-respecting default per B5-Q3.
- **Streaming transcript UX** — Server-Sent Events / token streaming
  during transcription deferred. Static loading spinner with progress
  text suffices for short-audio workflows where total latency is
  5-30 seconds. Recorded as SPRINT_06_carryovers.md entry #3.
- **Duration-based validation** — size cap (25MB) is the sufficient
  proxy. OpenAI surfaces duration rejection via API error which we
  classify as `openai_rejected`; no client-side duration parsing.
- **Modal infrastructure** — superseded entirely. Section B's
  original Modal-based design is historical reference only; see
  SPRINT_05.md's preserved Section B detail and `docs/runbooks/
  modal-setup.md`'s deferred-and-superseded status callout.

## Workflow conventions

Same 6-step pattern as Sprint 04 / 05:

1. Spec → confirm → build → verify
2. Pause after each commit lands locally
3. User reviews against the spec; approves before next commit
4. All 6 gates green at every commit (gate count unchanged from S05
   closure baseline; no new gate added in S06)
5. Branch per section: `chore-sprint-06-section-b-vertical` (or
   shorter; lock at section start)
6. PR opened only after all section commits land local + reviewed

Sprint 06 has only one section (Section B vertical slice). Branch
naming reflects the section, not "Section A / B" — there's no
parallel Section A to disambiguate against.

## Section B — vertical slice (B1 + B5)

### B1 — OpenAI Whisper transcription service

**Why:** Section B is upstream infrastructure for both research (use
case 1) and verification (use case 4) per D4(a) lock — both depend
on transcript text from audio sources. Sync `apps/web` execution
(not async `apps/jobs`) because short-audio transcription completes
within request timeout (~5-30s for files near the 25MB cap); no need
for Trigger.dev orchestration. OpenAI Whisper API chosen over
self-hosted Modal Whisper per Sprint 05 closure cascade — provider
cost + use-case-fuzziness pivot landed on the managed API.

**Approach:** Server action calls a service module at
`apps/web/src/services/transcription/openai-whisper.ts`. Mirrors the
established `apps/web/src/services/billing/` pattern. Service module
instantiates the OpenAI SDK (`openai` npm package, NOT raw fetch —
matches the Stripe SDK precedent in
`apps/web/src/services/webhooks/stripe/`), streams the file through
to OpenAI's `audio.transcriptions.create` endpoint, returns a
prefix-encoded result.

Result shape:
- Success: `{ ok: true, transcript: string, duration?: number }`
- `validation:` — server-side revalidation failed (size, type)
- `openai_rejected:` — OpenAI 4xx (file format unsupported, duration
  too long, etc.); user-fixable
- `transient:` — network, 5xx, timeout — would-be retry-eligible if
  the architecture were async (sync sweep means user can re-submit)
- `auth:` — `OPENAI_API_KEY` misconfigured; operator-fixable
- `timeout:` — server action exceeded its own wall-clock budget
  before OpenAI returned

Sync execution → no Trigger.dev retry → classification primarily
exists for UX (B5 surfaces user-friendly messages based on the error
prefix). The classification surface mirrors A2's pattern but the
runtime semantics differ (no automatic retry; user-driven retry via
re-submit).

Note: B1's commit ships the service module + tests + env wiring with
no production caller; B5's commit adds the server action that
consumes it. Same stub-then-caller pattern A1/A2 used in Sprint 05
(the `cancel-workspace-subscription.ts` stub landed in A1 with no
caller until A2's task body wired it). Future-Claude reading B1's
commit in isolation should not mistake the un-called service for
dead code.

**Validation:** Both-side per B1-Q4. Client-side instant feedback on
file pick (size > 25MB → reject; type not in OpenAI's MIME allowlist
→ reject). Server-side revalidates on receipt as defense in depth.
Accepted formats: mp3, mp4, mpeg, mpga, m4a, wav, webm (per OpenAI
Whisper API docs). No explicit duration check — size cap is
sufficient proxy; OpenAI rejects server-side at >~25min if a file
slips through, which we surface as `openai_rejected`.

**Schema:** N/A. B1 is service-only; no DB writes. (B5 adds the
sources table that B1's transcript ultimately persists into via
B5's server action.)

**RPCs:** N/A. B1's service module makes outbound HTTP calls only.

**App layer:**

- `apps/web/src/services/transcription/openai-whisper.ts` (new) —
  service module with `transcribeAudio({ file, fileName })` →
  `TranscribeAudioResult` (the prefix-encoded shape above).
- `apps/web/src/services/transcription/openai-client.ts` (new) —
  memoized OpenAI SDK instance. Mirror the `getStripeClient()` /
  `getJobsStripeClient()` pattern: module-level `cached`, throws on
  missing `OPENAI_API_KEY`.
- `apps/web/src/lib/env.ts` (modify) — add
  `OPENAI_API_KEY: z.string().min(1).optional()` to `ServerEnvSchema`.
  Optional follows the established convention (boot-without-billing
  / boot-without-AI) — code paths that don't touch transcription
  shouldn't fail to start because OpenAI isn't configured locally.
- `apps/web/.env.local.example` (modify) — add `OPENAI_API_KEY=`
  with a comment block matching the existing Stripe block.

The server action wrapping the service lives at the B5 layer (the
upload UI is the sole caller); B1's commit ships the service module
+ env wiring + tests.

**Tests** (~9, in `apps/web/tests/services/transcription/`):

1. Happy path: valid file + active key → `audio.transcriptions.create`
   called → `{ ok: true, transcript: "..." }`
2. `openai-client` throws when `OPENAI_API_KEY` is missing
3. Validation rejection (server-side): oversize file → `validation:
   size_exceeded`
4. Validation rejection (server-side): bad MIME → `validation:
   unsupported_format`
5. `openai_rejected` (OpenAI returns 4xx with `duration_too_long` or
   similar) → `openai_rejected: <message>`
6. `transient` (OpenAI 5xx) → `transient: <message>`
7. `transient` (network connection error) → `transient: <message>`
8. `auth` (OpenAI 401/403) → `auth: <message>`
9. `timeout` (server-action wall-clock exceeded; mock abort) →
   `timeout: <message>`

OpenAI SDK mock pattern: copy + extend the apps/web Stripe-mock
helper at `apps/web/tests/helpers/stripe-mock.ts` to a new
`apps/web/tests/helpers/openai-mock.ts`. Per the precedent set in
A2 — copy + extend at two consumers; extraction warrants a third.

**Expected gate deltas:** +9 web tests, +0 db tests, +0 migration,
+4 new `.ts` files (openai-whisper.ts, openai-client.ts,
openai-mock.ts helper, openai-whisper.test.ts; env.ts is a
modification, not a new file; .env.local.example is excluded from
license-headers scope). `test:license-headers` 221 → 225.
`test:web` 49/10 → ~58/11.

**Commit message:** `feat(transcription): OpenAI Whisper service +
client wrapper + env wiring (Sprint 06 B1)`.

### B5 — File upload UI + sources table

**Why:** B1 returns a transcript; B5 is the user-facing surface that
consumes it. Pairs with B1 as the vertical slice (D5a lock). Without
the UI, B1 is dead code; without B1's persistence target (the
sources table), the user has nothing to do with the transcript.
Vertical slice means both ship together.

**Approach:** Single-file upload widget with drag-and-drop OR
click-to-browse (B5-Q1 scope). Inline validation feedback before
upload. Loading spinner with progress text during transcription
(B5-Q4: streaming UX deferred). Transcript display when B1 returns.
Error display when transcription fails — error class drives
user-facing message: `validation:` / `openai_rejected:` surface
user-actionable text; `transient:` / `auth:` / `timeout:` surface
generic retry text. Exact copy locked at build-time pre-flight.
Save-to-workspace button persists the transcript via the new
sources RPC.

No audio persistence per B5-Q3. The file goes from the browser →
server action → OpenAI; the bytes are not stored on disk or in
object storage. Re-transcription requires re-upload.

**Schema:** New migration creating the `sources` table.

```sql
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  type text not null check (type in ('audio_transcript')),
  content text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index sources_workspace_id_active_idx
  on public.sources (workspace_id)
  where deleted_at is null;
```

The `type` check constraint enumerates `'audio_transcript'` only at
S06; Sprint 07's B2/B3/B4 sub-items extend the constraint
(`'youtube_transcript'`, `'url_extraction'`, `'pdf_extraction'`) via
follow-up migrations. Soft-delete via `deleted_at` matches Sprint
04's workspace soft-delete convention (deferred hard-delete sweeper
work is not in scope for Sprint 06; sources don't carry the same
grace-window semantics workspaces do).

RLS policies (in same migration):

- SELECT: workspace member only (via `private.is_workspace_member`
  helper, established in Sprint 02).
- INSERT/UPDATE/DELETE: revoked from end users; routed through the
  DEFINER write path below.

**RPCs:**

- `private.create_source_audio_impl(_workspace_id uuid, _user_id uuid,
  _content text)` — DEFINER worker. Inserts the row; returns the new
  `source.id`. Matches the Sprint 04/05 DEFINER-write-path
  convention.
- `public.api_create_source_audio(_workspace_id uuid, _content text)`
  — auth-callable wrapper. SECURITY DEFINER, granted to
  `authenticated`. Reads `auth.uid()` inside, asserts workspace
  membership via `private.is_workspace_member`, dispatches to the
  worker. Naming follows CLAUDE.md's database function convention
  (`api_<name>` for user-callable; `svc_<name>` reserved for
  service-role-only).

Future sub-items (B2/B3/B4) add parallel `api_create_source_*`
wrappers per source type; the worker pattern stays parallel.

**App layer:**

- `packages/db/migrations/<ts>_sources_table.sql` (new) — schema +
  RLS + RPCs above.
- `packages/db/types.ts` (regenerate) — `Source` row type + RPC
  signatures.
- `apps/web/src/services/sources/create-source-audio.ts` (new) —
  service module wrapping the RPC call. Mirrors
  `apps/web/src/services/billing/create-checkout-session.ts` shape.
- `apps/web/src/app/(app)/[workspace]/sources/upload/page.tsx`
  (new) — page route hosting the upload widget. Server component
  shell with the client widget mounted inside.
- `apps/web/src/app/(app)/[workspace]/sources/upload/upload-widget.tsx`
  (new, `'use client'`) — drag-and-drop + click-to-browse + state
  machine for {idle, validating, transcribing, success, error} +
  save-to-workspace action.
- `apps/web/src/app/(app)/[workspace]/sources/upload/actions.ts`
  (new) — Next.js server action that wraps B1's `transcribeAudio`
  + B5's `createSourceAudio` into a single `transcribeAndSave`
  action callable from the client widget.

**Tests** (~5):

DB tests (`packages/db/tests/sources/`):
1. Perimeter: `api_create_source_audio` rejects anon (42501)
2. Perimeter: `api_create_source_audio` rejects non-member
   (42501 — workspace membership check fires)
3. Happy path: member calls `api_create_source_audio` →
   row created with correct workspace_id + user_id

Web tests (`apps/web/tests/app/sources/`):
4. Upload widget — client-side validation rejects oversize file
   before submission
5. Upload widget — happy path renders transcript + save button →
   server action invoked with correct payload

The DB tests live in `packages/db/tests/` per the perimeter-test
convention; the web tests live in `apps/web/tests/`. Total
~5 tests across both surfaces (3 db + 2 web).

**Expected gate deltas:** +3 db tests, +2 web tests, +1 migration,
+6 new `.ts/.tsx` files (create-source-audio.ts, page.tsx,
upload-widget.tsx, actions.ts, 1 db test file, 1 web test file;
.sql migration excluded from license-headers scope; types.ts is a
regeneration). `test:license-headers` 225 → 231. `test:db` 144/24
→ 147/25 (new sources test file). `test:web` ~58/11 → ~60/12.

**Commit message:** `feat(sources): file upload UI + sources table
+ create-source-audio RPC (Sprint 06 B5)`.

## Sequencing within Sprint 06

B1 ships before B5. Reasoning: B1 is the backend service B5 depends
on. Shipping B1 first with its own test surface means B5 can be
built against a stable, tested service module rather than a moving
target. B1's commit has no UI — service + tests + env wiring. B5's
commit lands the migration + RPCs + UI + the integration glue.

Within the sprint:

1. Branch: `chore-sprint-06-section-b-vertical` off main.
2. B1 commit: service module + client wrapper + env wiring + 9
   tests + openai-mock helper.
3. Pause for review against spec.
4. B5 commit: migration + RPCs + types regeneration + UI + 5
   tests.
5. Pause for review against spec.
6. PR opened (single PR for the section).

## Gate predictions (cumulative across both commits)

All 6 gates green. Per-commit deltas above; cumulative end-state:

- `test:license-headers`: 221 → 231 (+10 across both commits:
  4 from B1 + 6 from B5)
- `typecheck`: 6/6
- `lint`: 6/6
- `test:db`: 144/24 → 147/25
- `test:web`: 49/10 → ~60/12
- `test:jobs`: 8/1 (unchanged — Sprint 06 doesn't touch apps/jobs)

Allow ±1 drift per commit (file consolidation or split during
build is normal); if any gate moves outside ±2 of the predicted
range, scope leaked.

## Manual smoke test (after section merges)

- Upload a short audio file (under 25MB, mp3 or m4a). Verify
  transcription completes and transcript displays.
- Upload an oversize file. Verify client-side rejection before
  upload begins.
- Upload an audio file in unsupported format. Verify rejection
  (client-side if extension is checkable; server-side via
  `openai_rejected` if it slips through).
- Save transcript to workspace. Verify a `sources` row was
  created with correct workspace_id, user_id, type, content.
- Cross-tenant: confirm RLS blocks reading another workspace's
  sources rows.

## Forward-references to Sprint 07

Sprint 07 ships B2 + B3 + B4 in some order to be locked at Sprint
07 pre-flight:

- B2 — YouTube ingestion via yt-dlp. Python tooling lands here per
  D3 (Trigger.dev build extension in `apps/jobs`). yt-dlp
  brittleness recorded as SPRINT_06_carryovers.md entry #2 — a
  known operational concern Sprint 07 inherits explicitly.
- B3 — URL/PDF extraction via Trafilatura + pdfplumber. Same Python
  baseline as B2.
- B4 — source orchestration tying B1/B2/B3 together for
  multi-source-type routing. Likely the smallest of the three
  sub-items by code volume but the most architecturally load-bearing
  (it's what makes the source surface uniform across types).

Sprint 07 sub-items extend the `sources.type` check constraint via
follow-up migration (`'youtube_transcript'` for B2,
`'url_extraction'` / `'pdf_extraction'` for B3). Conservative S06
constraint (`audio_transcript` only) matches Sprint 04 pattern of
not pre-anticipating future sprints in schema.

Sprint 07 spec-lock fires when Sprint 06 ships and B1+B5 have been
validated with first users.

## Decisions locked at pre-flight

Compact list for grep-friendly reference. Same pattern as
SPRINT_05.md's appendix.

**Foundational (D-prefix):**
- D2 — short-audio-only initial scope (≤25MB / ≤~25min); long-audio
  deferred (recorded as SPRINT_05_carryovers.md entry #3)
- D3 — Python tooling deferred to Sprint 07; via Trigger.dev build
  extension in `apps/jobs`. Sprint 06 itself uses no Python.
- D4(a) — Section B is upstream infrastructure for both research
  (use case 1) and verification (use case 4); not specialized to
  either
- D5a — vertical slice B1+B5 first, then B3, B2, B4 (Sprint 07
  internal ordering TBD at S07 pre-flight)
- D5b — two-sprint split (Sprint 06: B1+B5; Sprint 07: B3+B2+B4)

**B1 implementation (B1-prefix):**
- B1-Q1 — server action + service module pattern
  (`apps/web/src/services/transcription/openai-whisper.ts`); not a
  Trigger.dev task
- B1-Q2 — OpenAI SDK (`openai` npm package), not raw fetch
- B1-Q3 — error classification: `validation:` / `openai_rejected:`
  / `transient:` / `auth:` / `timeout:` (prefix-encoded)
- B1-Q4 — both-side validation; 25MB cap; accepted formats per
  OpenAI Whisper API docs (mp3/mp4/mpeg/mpga/m4a/wav/webm); no
  explicit duration check
- B1-Q5 — `OPENAI_API_KEY` in `apps/web/src/lib/env.ts` zod schema,
  optional (matches `STRIPE_SECRET_KEY` precedent)
- B1-Q6 — ~9 tests covering happy path + 4 error classes + env
  guard + 2 validation paths

**B5 implementation (B5-prefix):**
- B5-Q1 — single-file upload; drag-and-drop or click-to-browse;
  inline validation feedback; loading spinner; transcript display;
  error display; save-to-workspace
- B5-Q2 — minimal `sources` table; columns id / workspace_id /
  user_id / type (enum, only `audio_transcript` at S06) / content /
  created_at / deleted_at; soft-delete convention extends to
  sources
- B5-Q3 — no audio persistence; stream through, don't store;
  re-transcription requires re-upload
- B5-Q4 — loading spinner with progress text; streaming UX
  (SSE/token streaming) deferred (recorded as
  SPRINT_06_carryovers.md entry #3)
- B5-Q5 — ~5 tests; 3 db (perimeter + happy path) + 2 web (UI
  surface)

**Naming:**
- DEFINER write path uses `api_create_source_audio` (auth-callable
  wrapper) + `private.create_source_audio_impl` (worker), per
  CLAUDE.md's database function naming convention. Future B2/B3
  sub-items add parallel `api_create_source_*` wrappers.
