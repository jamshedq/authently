<!--
  Sprint 07 — Source ingestion expansion (B3 + sources management)
  Locked: 2026-05-05
  Status: planning → spec-locked
  Pre-flight cycle: single-pass — design was locked in chat session
    walkthrough during Sprint 06 closure rather than via the multi-pass
    cycle Sprint 04/05 used. Spec-lock here drafts the artefacts only;
    no design re-litigation. Same single-pass shape as Sprint 06.
  Predecessor: Sprint 06 (B1 + B5 vertical slice). Audio source
    ingestion shipped end-to-end at commit 4f9b443; "use server"
    placement polish at 7c49082; smoke-test discipline documented
    at 921b083. Sprint 07 expands source-type breadth to URL + PDF
    (B3) and adds the sources management surface (list page +
    polling + delete) that consumes both Sprint 06's audio rows and
    Sprint 07's new rows.
  Capacity: 1 solo builder. Larger surface than Sprint 06 (4 commits
    vs. 2) but each commit is bounded and sequenced; sub-item
    locks already done in this spec.

  Reading guide for future Claude sessions:
  - This sprint is a vertical slice continuation. B3 (URL/PDF
    extraction) ships alongside the sources list page + status
    infrastructure that consumes async B3 output. B2 (YouTube via
    yt-dlp) and B4 (orchestration) explicitly deferred to Sprint 08
    — recorded in SPRINT_07_carryovers.md entry #1.
  - Sprint 06's `sources` table schema is extended (not replaced).
    The base columns (workspace_id / user_id / type / content /
    created_at / deleted_at) carry forward unchanged; this sprint
    adds status / error / source_url / title and widens the type
    CHECK constraint to admit `'url_extraction'` and
    `'pdf_extraction'`. `'youtube_transcript'` is NOT widened in
    Sprint 07 — that lands with B2 in Sprint 08.
  - Async writes use the empty-string content placeholder pattern
    (locked Sprint 07 (A)): the B3 source-creation RPC inserts the
    row with `status = 'processing'` and `content = ''`, the
    Trigger.dev task UPDATEs to `status = 'ready'` (or `'failed'`)
    with real content via the service-role status RPC. This
    preserves the existing `content NOT NULL` constraint without
    forcing a column-level schema change.
  - Decisions locked at pre-flight live BOTH inline at sub-item level
    AND in the compact appendix at the bottom (E-prefix for
    foundational decisions, B3-prefix for B3 implementation locks).
-->

# Sprint 07 — Source ingestion expansion (B3 + sources management)

## Goal

Expand source ingestion breadth from audio-only (Sprint 06) to URL +
PDF, and ship the sources management surface (list page + polling +
delete) that makes the table usable as a workspace's source library.

The slice is bounded: B3 only (URL via Trafilatura, PDF via
pdfplumber) — B2 (YouTube via yt-dlp) and B4 (cross-source
orchestration) explicitly deferred to Sprint 08. The list page is
deliberately compact (no card grid, no filters, no pagination, no
sort controls, no source detail page) — those land when validated
need emerges. Async execution via Trigger.dev with status polling
at 3-5s intervals; Realtime upgrade deferred. Validation-before-
breadth: ship B3 + a usable sources surface, validate with first
users, expand breadth in Sprint 08.

## Non-goals

- **B2 (YouTube ingestion via yt-dlp)** — deferred to Sprint 08.
  Recorded as SPRINT_07_carryovers.md entry #1. yt-dlp brittleness
  (originally captured in SPRINT_06_carryovers.md entry #2) carries
  forward as an inherited operational concern for Sprint 08.
- **B4 (source orchestration)** — deferred to Sprint 08. Recorded
  as SPRINT_07_carryovers.md entry #1. Sprint 07 handles each source
  type via parallel `api_create_source_*` wrappers (mirroring B5's
  pattern from Sprint 06); B4's role is the cross-type surface that
  unifies routing, which only becomes load-bearing once a third
  type lands.
- **Source detail page** — deferred. Rows in the sources list are
  non-interactive in Sprint 07; clicking a row does not navigate
  anywhere. Recorded as SPRINT_07_carryovers.md entry #9. Revisit
  trigger: a concrete user need for viewing extracted content
  emerges (likely candidate: B4 orchestration in Sprint 08
  referencing source content in the UI).
- **Card grid / filter / pagination / sort controls** — list page
  ships compact-only. Recorded as SPRINT_07_carryovers.md entries
  #3-#6. Acceptable until source counts grow user-visibly.
- **Retry mechanism for failed extractions** — delete-and-resubmit
  is the canonical pattern. No retry button, no automatic backoff.
  Recorded as SPRINT_07_carryovers.md entry #7.
- **Orphaned `'processing'` row sweeper** — accept the orphan
  possibility for rows stuck in `'processing'` (Trigger.dev task
  crash, Python subprocess hang past timeout, etc.). No background
  cleanup task in Sprint 07. Recorded as SPRINT_07_carryovers.md
  entry #2. Revisit trigger: orphan rate becomes user-visible.
- **Realtime status updates (Supabase Realtime / WebSockets)** —
  polling at 3-5s suffices for the latency profile of B3
  extractions (typical 2-30s). Realtime upgrade deferred.
- **Backfill of Sprint 06 audio_transcript rows for `title`** —
  existing rows do not have captured filenames; `title` stays NULL
  until those sources are re-uploaded. UI fallback ("Untitled")
  handles the display. No backfill in Sprint 07. Recorded as
  SPRINT_07_carryovers.md entry #8.
- **PDF persistence beyond the extraction window** — PDFs follow
  the audio precedent (Sprint 06 B5-Q3): bytes pass through
  apps/web → Trigger.dev → Python → discarded. Re-extraction
  requires re-upload. The temporary transfer mechanism (payload
  vs. signed URL vs. ephemeral storage) lands at pre-flight per
  the verification items below.

## Workflow conventions

Same 6-step pattern as Sprint 04 / 05 / 06:

1. Spec → confirm → build → verify
2. Pause after each commit lands locally
3. User reviews against the spec; approves before next commit
4. All 6 gates green at every commit (gate count unchanged from
   Sprint 06 closure baseline)
5. Branch per section: `chore-sprint-07-section-b-expansion` (or
   shorter; lock at section start)
6. PR opened only after all section commits land local + reviewed

Sprint 07 has only one section (Section B continued). Branch
naming reflects the section, not "Section A / B" — there's no
parallel Section A to disambiguate against.

**Manual smoke discipline (CLAUDE.md addition at commit `921b083`):**
Sprint 07 commits 3 and 4 add new server actions (URL submission,
PDF upload, delete) and modify the existing upload page; per the
"Framework rules not caught by automated gates" section in
CLAUDE.md, each of those commits requires a manual smoke pass
before merge even with all 6 gates green. Smoke is browser-load
or `curl` to the affected route; need not be exhaustive.

## Section B continued — sources expansion

Four sub-items, four commits, sequenced per E7 lock:

1. **Schema migration** — sources table extension + new RPCs
   (no app code).
2. **B3 backend** — Trigger.dev Python build extension + extraction
   tasks + service modules.
3. **Sources list + status infrastructure** — list page, polling,
   delete server action.
4. **Tabbed upload page extension** — audio (Sprint 06) + URL +
   PDF tabs in a single route.

Each sub-item ships as a separate commit on the same branch.

### Schema migration

**Why:** B3 needs status fields and provenance columns to track
async extraction lifecycle. The list page consumes those fields
to render rows. Schema-first sequencing means subsequent commits
build against a stable, applied migration; commit 1 has no
runtime caller (same stub-then-caller pattern Sprint 05 A1/A2 and
Sprint 06 B1 used).

**Approach:** A single migration extending the existing
`public.sources` table. Additive only — no column drops, no
constraint relaxations on existing columns. The `type` CHECK
constraint widens to admit two new values; `audio_transcript`
remains valid for Sprint 06's existing rows.

**Schema delta:**

```sql
-- Add status lifecycle + provenance + display columns
alter table public.sources
  add column status text not null default 'ready'
    check (status in ('processing', 'ready', 'failed')),
  add column error text,
  add column source_url text,
  add column title text;

-- Widen type check to admit B3's two new types. 'youtube_transcript'
-- intentionally excluded — that lands with B2 in Sprint 08.
alter table public.sources
  drop constraint sources_type_check,
  add constraint sources_type_check
    check (type in ('audio_transcript', 'url_extraction', 'pdf_extraction'));
```

The `status` default of `'ready'` means existing audio_transcript
rows from Sprint 06 retain their effective state without backfill;
B3 source-creation RPCs explicitly set `status = 'processing'`.

**Empty-string content placeholder (Sprint 07 (A) lock):** the
existing `content text NOT NULL` constraint is preserved. B3's
source-creation RPCs insert with `content = ''` (empty string) and
`status = 'processing'`; the service-role status RPC UPDATEs to
real content + `status = 'ready'` when the Trigger.dev task
finishes. Empty string is a valid non-null value, avoiding a
breaking column-level change.

**RPCs added in this commit (no callers yet):**

- `private.create_source_url_impl(_workspace_id uuid, _user_id uuid,
  _source_url text)` — DEFINER worker. Inserts `(workspace_id,
  user_id, type='url_extraction', content='', source_url, status='processing')`.
  Returns `source.id`.
- `public.api_create_source_url(_workspace_id uuid, _source_url text)`
  — auth-callable wrapper. Asserts `auth.uid()` non-null + workspace
  membership; dispatches to worker. Errcodes: `22023` (missing user
  / source_url), `42501` (non-member).
- `private.create_source_pdf_impl(_workspace_id uuid, _user_id uuid,
  _title text)` — DEFINER worker. Inserts `(type='pdf_extraction',
  content='', title, status='processing')`. Returns `source.id`.
  `title` carries the user-supplied filename for display fallback;
  Python extraction may overwrite it if the PDF carries a metadata
  title.
- `public.api_create_source_pdf(_workspace_id uuid, _title text)`
  — auth-callable wrapper. Same shape as `api_create_source_url`.
- `private.update_source_status_impl(_source_id uuid, _status text,
  _content text, _title text, _error text)` — DEFINER worker.
  Validates status transition (`processing` → `ready` | `failed`);
  rejects illegal transitions with `22023`.
- `public.svc_update_source_status(_source_id, _status, _content,
  _title, _error)` — service-role-only HTTP entry point. Granted
  to `service_role` only; revoked from `public, anon, authenticated`.
  Called by Trigger.dev tasks via service-role client. Naming
  follows `svc_<name>` convention per CLAUDE.md.
- `private.delete_source_impl(_source_id uuid, _user_id uuid)` —
  DEFINER worker. Asserts caller is a workspace member of the
  source's workspace (any member can delete any source — matches
  SELECT permission scope; collaboration-friendly default).
  Soft-deletes (`deleted_at = now()`).
- `public.api_delete_source(_source_id uuid)` — auth-callable
  wrapper.

**App layer:** none in this commit. Migration + types regen only.

**Tests** (~9 db tests):

- `api_create_source_url` perimeter (anon → 22023 defensive check;
  non-member → 42501) + happy path (member call inserts row with
  correct columns)
- `api_create_source_pdf` perimeter + happy path (3 tests, same
  pattern)
- `svc_update_source_status` perimeter (anon → 42501 from GRANT
  layer; authenticated user → 42501 from GRANT layer) + happy path
  (service-role transitions row from `processing` → `ready` with
  content + title) + happy path (service-role transitions
  `processing` → `failed` with error). The 3 status RPC tests
  per B3-Q5.
- `api_delete_source` perimeter + happy path (3 tests)

The svc_update_source_status perimeter shape differs from api_*
perimeters: svc_* is rejected at the GRANT layer (PostgREST returns
42501 to both anon and authenticated, since neither role is granted
EXECUTE), whereas api_* wrappers receive the call and reject inside
the function body via `auth.uid() IS NULL` (22023) or
`is_workspace_member` (42501). Same distinction documented in
Sprint 06 B5 perimeter test commentary.

**Expected gate deltas:** +9 db tests, +1 migration, +1 types
regen. License-headers neutral (.sql excluded; types.ts is a
regen of an existing file).

**Commit message:** `feat(sources): sources table additions — status + provenance + title (Sprint 07 schema)`

### B3 — URL/PDF extraction

**Why:** Source-type breadth expansion. URL extraction (article
text) and PDF extraction (long-form document text) are the two
non-audio research workflows users requested. Trigger.dev async
execution per E1 lock — research-content latency profile (HEAD +
fetch + library extraction = up to ~30s) doesn't fit a sync
server-action budget cleanly even on Vercel Pro.

**Approach (E1, E3, B3-Q1, B3-Q2, B3-Q3 locked):**

Two Trigger.dev tasks (locked Sprint 07 (D)):

- `extractFromUrlTask({ workspaceId, sourceId, sourceUrl })` —
  HEAD request branches on Content-Type. `text/html` → invokes
  `extract_trafilatura.py`; `application/pdf` → invokes
  `extract_pdfplumber.py`. Other content types → returns
  `network: unsupported_content_type`. Updates row via
  `svc_update_source_status` on completion.
- `extractFromPdfTask({ workspaceId, sourceId, fileTransfer })` —
  always invokes `extract_pdfplumber.py`. The
  `fileTransfer` shape (payload-embedded base64 vs. signed-URL
  pointer) lands at pre-flight per the Trigger.dev v4 verification
  item below.

Two Python modules under `apps/jobs/python/`:

- `extract_trafilatura.py` — reads URL from argv, invokes
  trafilatura library, prints `{"ok": true, "content", "title"}`
  or `{"ok": false, "error"}` to stdout. Exit 0 on success, 1 on
  failure.
- `extract_pdfplumber.py` — reads file path from argv (or stdin
  bytes pending pre-flight), invokes pdfplumber, prints same
  protocol shape.

Python dependencies pinned in `apps/jobs/python/requirements.txt`:
`trafilatura`, `pdfplumber`. Exact versions locked at pre-flight
per the verification items.

**Error classification (B3-Q3 locked, four classes prefix-encoded
in `sources.error`):**

- `extraction_failed:` — Trafilatura/pdfplumber library returned
  no usable content (stripped HTML had no main body; PDF had no
  extractable text layer)
- `network:` — URL fetch failed (DNS resolution failure, non-2xx
  response, unsupported Content-Type). [AMENDED 2026-05-07: dropped
  "timeout" from this list — code emits a distinct `timeout:` class
  for HEAD timeouts, see below.]
- `transient:` — Python subprocess crashed unexpectedly, or
  Trigger.dev infra failure (retryable in principle; user-driven
  retry via delete-and-resubmit per E6a)
- `timeout:` — HEAD request exceeded its 5s budget (`timeout:
  head_request`), or task exceeded execution budget (configured at
  Trigger.dev task definition level; budget locked at pre-flight).
  Distinguished from `network:` because remote-server-slow ≠
  remote-server-unreachable — different operational categories.

**Task return shape (B3-Q2 locked):** `{ ok: true, content, title }`
or `{ ok: false, error }`. `title` may be NULL when extraction
didn't yield one (article without `<title>`, PDF without metadata
title); list-page UI handles the NULL case via the "Untitled"
fallback per E5.

**App layer (apps/jobs):**

- `apps/jobs/trigger.config.ts` (modify) — add Python build
  extension. Exact API shape locked at pre-flight per
  Trigger.dev v4 docs.
- `apps/jobs/src/trigger/extract-from-url.ts` (new) — Trigger.dev
  task definition; HEAD branch logic + Python subprocess
  invocation + status RPC dispatch.
- `apps/jobs/src/trigger/extract-from-pdf.ts` (new) — task
  definition; pdfplumber-only.
- `apps/jobs/python/extract_trafilatura.py` (new)
- `apps/jobs/python/extract_pdfplumber.py` (new)
- `apps/jobs/python/requirements.txt` (new)
- `apps/jobs/src/lib/python-runner.ts` (new) — shared subprocess
  wrapper. Spawns `python3 <module> <args>`, captures stdout JSON,
  classifies errors per the four-class taxonomy. One file because
  both tasks need identical stdout/exit-code handling.

**App layer (apps/web):**

- `apps/web/src/services/sources/create-source-url.ts` (new) —
  service module wrapping `api_create_source_url` RPC + triggering
  `extractFromUrlTask`. Returns the new `source.id` to the caller.
- `apps/web/src/services/sources/create-source-pdf.ts` (new) —
  same shape; RPC + `extractFromPdfTask` trigger.

**Tests** (~7 task tests + 0 net new db tests; the 3 status RPC
tests already shipped in commit 1):

- `extract-from-url.test.ts` — happy path (text/html), happy path
  (application/pdf branch), network failure (timeout/DNS),
  extraction failure (empty body), timeout (3-4 tests target;
  exact count flexes to 4 via the union of url-specific cases)
- `extract-from-pdf.test.ts` — happy path, malformed PDF (returns
  extraction_failed), empty PDF (no text layer), timeout (3-4
  tests target)

Python modules tested by mocking the library-level call (not
running real trafilatura/pdfplumber against fixtures); tests
assert the wrapper logic — argv parsing, stdout JSON shape, exit
codes — and the Trigger.dev task's invocation + status RPC
dispatch.

**Expected gate deltas:** +7 jobs tests (+ test scaffolding for
two new task test files), 0 db tests delta from this commit (already
landed in commit 1), 0 web tests delta. License-headers +6 (two
.ts task files, one shared lib, two .py modules — Python files
require `# AGPL-3.0-or-later` style headers; `requirements.txt`
excluded). `test:jobs` 8/1 → ~15/3.

**Commit message:** `feat(sources): URL + PDF extraction tasks + Python build extension (Sprint 07 B3)`

### Sources list + status infrastructure

**Why:** B3's async output needs a UI surface. Without a list page,
B3 sources land in the database with no way for the user to see
them. The list page is also where polling lives — the polling
trigger is "any source visible to this user is in `'processing'`
state."

**Approach (E2, E5, E6 locked):**

Compact list, one row per source, columns: title (or "Untitled"
fallback), type, status, created_at. Sort: `created_at DESC` only.
Empty state: "No sources yet" with link to upload page.

Polling (E2 lock): client-side `setInterval` (3-5s) calls
`router.refresh()` while at least one visible row has
`status = 'processing'`. Polling halts when no rows remain in
`'processing'`. The server component re-fetches on refresh.
Realtime upgrade explicitly deferred.

Failed-row UI (E6c lock): error class label visible by default
(e.g. "Extraction failed" / "Network error" / "Timeout"); row
expands inline to show the full error text on click. No retry
suggestions, no report-issue link.

Delete (E6a, E6b lock): single row delete via confirmation modal.
No undo. No bulk delete. Confirmed delete invokes server action
→ `api_delete_source` RPC → soft-delete (sets `deleted_at`).
Row disappears from list on next refresh.

**Row interactivity (Sprint 07 (B) lock):** rows are non-interactive
beyond the delete control. Clicking the row body does not
navigate. Source detail page deferred per
SPRINT_07_carryovers.md entry #9.

**Schema:** none in this commit. Consumes commit 1's additions.

**RPCs:** none in this commit. Consumes commit 1's
`api_delete_source` and the SELECT RLS policy from Sprint 06.

**App layer:**

- `apps/web/src/services/sources/list-sources.ts` (new) — service
  module. SELECT against the sources table via the user's RLS
  context; orders by `created_at DESC`; filters `deleted_at IS NULL`
  in the query (RLS already filters but explicit query filter is
  defense in depth and matches the existing `sources_select`
  policy predicate).
- `apps/web/src/services/sources/delete-source.ts` (new) — wraps
  `api_delete_source` RPC.
- `apps/web/src/app/app/[workspaceSlug]/sources/page.tsx` (new) —
  server component. Calls `requireMembership(workspaceSlug)` then
  `listSources({ workspaceId })`. Renders the list component.
  Empty-state branch when zero rows.
- `apps/web/src/app/app/[workspaceSlug]/sources/sources-list.tsx`
  (new, `'use client'`) — list rendering + polling + per-row
  delete. `useEffect` that sets up `setInterval` if any row is in
  `'processing'`; clears interval when none. Per-row
  expand-to-show-error toggle for `failed` rows.
- `apps/web/src/app/app/[workspaceSlug]/sources/delete-action.ts`
  (new, `'use server'`) — server action wrapping `deleteSource`.
  Invoked by the confirmation modal's confirm button.

**Tests** (~5 list page UI tests, per E5/E6 enumeration):

- Empty state renders when zero sources (renders link to upload
  page)
- Mixed-status list (one of each status) renders rows in
  `created_at DESC` order with the correct status pill
- Delete confirmation modal: clicking delete opens modal; clicking
  confirm invokes server action; row removed from list after
  refresh
- Failed-row error expansion: error label visible by default;
  click expands to reveal full error text
- Title fallback: row with NULL title renders "Untitled" exactly
  (consistent token, not first-N-chars)

Polling behavior (interval setup/teardown) tested via `vi.useFakeTimers`
+ asserting no refresh fires when zero processing rows; refresh
fires within window when ≥1 processing row.

**Expected gate deltas:** +5 web tests, +0 db tests, +4 new
.ts/.tsx files (page, list component, delete action, list service)
+ 1 web test file. License-headers +5.
`test:web` ~67/13 → ~72/14.

**Commit message:** `feat(sources): sources list page + polling + delete (Sprint 07 list)`

### Tabbed upload page extension

**Why:** Sprint 06 shipped the upload page as audio-only. Sprint 07
adds URL and PDF entry points. Locked B3-Q4: tabbed UI at the
existing route, audio tab preserves Sprint 06 behavior unchanged,
URL and PDF tabs added as siblings.

**Approach (B3-Q4 locked):**

Tabbed UI at `apps/web/src/app/app/[workspaceSlug]/sources/upload/
page.tsx`. Three tabs (Audio | URL | PDF). Audio tab is the
existing Sprint 06 widget extracted into a sub-component without
behavioral change. URL tab is a text input + submit button. PDF
tab is a drag-and-drop + click-to-browse area mirroring the audio
widget shape.

URL/PDF flows are async: submit → `api_create_source_*` returns
`sourceId` immediately (status='processing') → page redirects to
`/app/[workspaceSlug]/sources` (the list page) → user sees the
new row in `'processing'` state, polling drives the eventual
transition to `'ready'` or `'failed'`.

Audio flow (Sprint 06) remains synchronous; the audio tab's
success state preserves Sprint 06's transcript-display + save-or-
upload-another UX unchanged.

**Schema:** none.

**RPCs:** none new. Consumes commit 1's `api_create_source_url`
and `api_create_source_pdf`.

**App layer:**

- `apps/web/src/app/app/[workspaceSlug]/sources/upload/page.tsx`
  (modify) — wrap the existing widget in a tab container.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/upload-tabs.tsx`
  (new, `'use client'`) — tab selection state machine; renders one
  of three sibling components based on active tab.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/upload-widget.tsx`
  (modify) — stays in place but is now mounted inside the Audio
  tab. Behavior unchanged.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/url-tab.tsx`
  (new, `'use client'`) — URL input + submit button + server-action
  invocation.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/pdf-tab.tsx`
  (new, `'use client'`) — drag-and-drop + click-to-browse + submit
  + server-action invocation.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/url-action.ts`
  (new, `'use server'`) — server action: validate URL → call
  `createSourceUrl` service module.
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/pdf-action.ts`
  (new, `'use server'`) — server action: validate PDF (size, MIME)
  → call `createSourcePdf` service module → return `sourceId`
  (page redirects after).
- `apps/web/src/app/app/[workspaceSlug]/sources/upload/types.ts`
  (modify) — add `CreateSourceUrlResult` and `CreateSourcePdfResult`
  type unions parallel to the existing `TranscribeAndSaveResult`.

Both new `'use server'` files follow CLAUDE.md's "Framework rules
not caught by automated gates" discipline: route-segment configs
(`maxDuration` if needed) live on `page.tsx`, types live on
`types.ts`, only async functions exported from the action files.

**Tests** (~0 net new — list page tests in commit 3 cover the
post-upload visual confirmation; tabbed UI behavior is shallow
visual logic and doesn't warrant component-level tests beyond the
existing audio-tab test from Sprint 06). If the tab-switching
behavior surfaces a regression in manual smoke, a regression test
is added at that point.

**Expected gate deltas:** +0 web tests, +0 db tests, +5 new files
(upload-tabs, url-tab, pdf-tab, url-action, pdf-action) + 1 modify
(page.tsx, upload-widget.tsx, types.ts). License-headers +5.

**Commit message:** `feat(sources): tabbed upload page — audio + URL + PDF (Sprint 07 tabs)`

## Sequencing within Sprint 07

Per E7 lock — schema first, then B3 backend, then list page UI,
then tabbed upload extension:

1. Branch: `chore-sprint-07-section-b-expansion` off main.
2. **Commit 1** (schema): migration + new RPCs + types regen +
   9 db tests. No app code, no caller for the new RPCs yet.
3. Pause for review against spec.
4. **Commit 2** (B3 backend): Trigger.dev tasks + Python modules +
   build extension config + service modules in apps/web + 7 task
   tests. Wires the URL/PDF source-creation RPCs to async tasks.
5. Pause for review against spec. Manual smoke not required for
   this commit (no new browser-facing surface; server actions land
   in commit 4).

**[AMENDED 2026-05-06 — Commit 2.5 inserted between Commits 2 and 3 per Sprint 07 C2a Checkpoint 2 review. The original sequencing folded Python module unit tests into Commit 2's ~14-test scope per B3-Q5; during C2a Checkpoint 2, the implementer surfaced that pytest infrastructure spin-up was not the established pattern and would meaningfully expand C2's session size. Rather than leave Python module testing as a soft "we'll get to it" deferral, the obligation is converted into a structural commitment via this amendment.]**

5a. **Commit 2.5** (B3 backend tests): pytest infrastructure for
    `apps/jobs/python/` and ~6-8 Python module tests covering both
    extraction modules' contract — argv shape, JSON stdout shape,
    exit codes, error class prefixing (`extraction_failed:`,
    `network:`, `validation:`). Adds a 7th standing gate
    `test:python` to the gate list.

    **Scope is infrastructure + tests only.** No production code
    changes. No edits to `apps/jobs/python/*.py` beyond what tests
    directly require (e.g., refactoring `main()` for testability if
    a function-extraction proves necessary for mocking). Scope
    strictly bounded to `apps/jobs/python/` — no apps/web edits, no
    other apps/jobs files, no migrations. Negative scope is the
    bound: anything outside `apps/jobs/python/` is out of scope by
    construction, regardless of how convenient the change appears
    while pytest is being spun up.

    **Commit 3 cannot begin until Commit 2.5 lands.** Pre-committed
    and binding, not a possibility to weigh later. Same discipline
    as the MCP escape valve in build_plan.md §5.3 — the structural
    commitment is the defense against deferred-test-debt slip,
    which is exactly the failure mode this amendment exists to
    prevent.

5b. Pause for review against spec. Manual smoke not required
    (test infrastructure only).

**[AMENDED 2026-05-07 — C2b sub-sequencing block. After C2.5 landed (PR #27), Commit 3 was further blocked by the apps/web side of B3 backend. The original Commit 1 description (lines 195-227) bundled three `api_*` RPCs (`api_create_source_url`, `api_create_source_pdf`, `api_delete_source`) that were narrowed at C1 implementation to ship only schema + `svc_update_source_status`; the `api_*` RPCs moved to C2b. The original Commit 2 description (lines 540-548) bundled apps/web service modules with the apps/jobs Trigger.dev tasks; the apps/web portion was structurally too large alongside the apps/jobs work and split into C2b. C2b further split into three sub-commits during implementation. This block retrospectively documents the split (C2b.1 + C2b.2 already shipped) and locks C2b.3's scope per Option C from C2b.3 discovery (verification-strategy alignment with this spec's manual-smoke section above). Same structural-amendment discipline as C2.5.]**

5c. **C2b.1** (`api_*` RPCs + perimeter tests):
    `public.api_create_source_url`, `public.api_create_source_pdf`,
    `public.api_delete_source` + 12 perimeter tests +
    `packages/db/tests/CLAUDE.md` `api_*`/`svc_*` perimeter test
    disambiguation. Shipped 2026-05-06 as commit `933406a` (PR #28).

5d. **C2b.2** (apps/web action layer): apps/web service modules
    orchestrating RPC + Storage upload + Trigger.dev wiring;
    `sources-pdf` Storage bucket migration with RLS + 6 perimeter
    tests in a new `test:storage` vitest project; apps/web→Trigger.dev
    typed wrapper at `apps/web/src/lib/trigger.ts` with inline payload
    types; computed-not-passed pattern and best-effort rollback
    discipline locked at C2b.2 review; 12 service module tests in
    `apps/web/tests/services/sources/`. Shipped 2026-05-06 as commit
    `70ae37a` (PR #29).

5e. **C2b.3** (integration boundary tests): ~7-10 tests at the
    apps/web side of the apps/web ↔ apps/jobs seam, extending C2b.2's
    integration-tier precedent. Four families: (a) wire-boundary
    decoupling via cross-package import of `defineTenantTask` schema,
    (b) rollback discipline edges including rollback-itself-fails
    fallback for URL/PDF (row stays in `'processing'` as the E6d
    accept-orphan state by design) and explicit verification of
    E6d-Storage orphan acceptance, (c) computed-not-passed Storage
    path convergence via cross-package import of both sides' path
    functions, (d) trigger-boundary payload contracts. Cross-package
    imports are testing-only coupling — runtime apps/web stays
    type-decoupled from apps/jobs.

    **Out of scope for C2b.3.** Full-pipeline verification (URL/PDF →
    content visible to user, status transitions to `'ready'` /
    `'failed'`) is spec-assigned to manual smoke testing per the
    Manual smoke test section below; C2b.3 does NOT automate these.
    `transient:` and `timeout:` failure classes are covered by
    existing apps/jobs unit tests at
    `apps/jobs/tests/trigger/extract-from-{url,pdf}.test.ts`; C2b.3
    does NOT duplicate that coverage.

    No new test gate, no new framework — extends
    `apps/web/tests/services/sources/` vitest precedent (file
    location resolved at C2b.3 discovery: alongside C2b.2 tests vs
    sibling `apps/web/tests/integration/sources/`).

    **Commit 3 cannot begin until C2b.3 lands.** Same
    structural-commitment discipline as C2.5.

5f. Pause for review against spec. Manual smoke not required
    (integration boundary tests at apps/web side; no new
    browser-facing surface).

**[AMENDED 2026-05-07 — C3 sub-sequencing block. Same structural-amendment discipline as C2.5 (lines 550-575) and C2b (lines 584-613). C3 has six distinct UI behaviors per the spec — E5 list rendering, E5 empty state, E5 sort by `created_at DESC`, E2 polling at 3-5s, E6b delete confirmation modal, E6c failed-row error class display. Treating "Commit 3" as monolithic risks the integration-drift failure mode that motivated the C2b split: too many interacting concerns in a single commit, checkpoint-attribution clarity lost, review surface diffuse. C3 is split at prompt time into C3.1 / C3.2 / C3.3, each shipping a coherent review surface. Sub-items 5g / 5h / 5i below collectively achieve what the original Commit 3 description below prescribes; the original Commit 3 description remains canonical for content scope.]**

5g. **C3.1** (list page baseline): server component reading
    sources, compact list rendering (title + type + status +
    time), empty state with link to upload page, sort by
    `created_at DESC`. NO polling, NO delete UI, NO failed-row
    error class display. ~6-8 tests covering rendering + empty
    state + RLS at page level.

5h. **C3.2** (status polling): client-side `setInterval` (3-5s)
    polling while any visible row is in `'processing'`; halts on
    resolution. Builds on C3.1's list. Per E2 lock — Realtime
    upgrade explicitly deferred. ~2-3 tests covering polling
    behavior with `vi.useFakeTimers`.

5i. **C3.3** (delete UI + failed-row error display): confirmation
    modal per E6b; delete server action wrapping
    `api_delete_source` service from C2b.2; error class label
    (mapping `extraction_failed:` / `network:` / `timeout:` /
    `transient:` to human-readable labels) + expandable error
    text per E6c. The "interactive bits" of the list page. ~3-4
    tests covering delete flow + error class label mapping +
    click-to-expand behavior. **Manual smoke required** per
    CLAUDE.md "Framework rules not caught by automated gates"
    discipline (new server action: `delete-action.ts`).

5j. Pause for review against spec.

**Commit 4 cannot begin until C3.3 lands.** Same
structural-commitment discipline as C2.5 + C2b.

6. **Commit 3** (list page): page.tsx + sources-list.tsx +
   delete-action.ts + list/delete service modules + 5 web tests.
   Manual smoke required per CLAUDE.md discipline (new server
   action: delete).
7. Pause for review against spec.
8. **Commit 4** (tabbed upload): page.tsx modification + tab
   components + URL/PDF actions. Manual smoke required (new
   server actions: url-action, pdf-action; modified upload page).
9. Pause for review against spec.
10. PR opened (single PR for the section, four-commit stack).

## Gate predictions (cumulative across all four commits)

All 6 gates green at every commit. Per-commit deltas above;
cumulative end-state vs. Sprint 06 closure baseline (`921b083`):

- `test:license-headers`: 232 → ~256 (+~24 cumulative: ~4 from
  commit 1's new db test files; ~10 from commit 2's task + Python
  + service files; ~5 from commit 3's list page + delete; ~5 from
  commit 4's tabbed-upload extension. Modifies of existing files
  do not change the count. Python files count under the
  license-headers gate with `# AGPL-3.0-or-later`-style headers.)
- `typecheck`: 6/6
- `lint`: 6/6
- `test:db`: 148/25 → ~157/29 (+9 tests in 4 new files from commit 1)
- `test:web`: 60/12 → ~65/13 (+5 tests in 1 new file from commit 3)
- `test:jobs`: 8/1 → ~15/3 (+7 tests in 2 new files from commit 2)

**Test count target — B3-Q5 (~14 tests):** the four-class breakdown
locked at pre-flight (3-4 Trafilatura + 3-4 pdfplumber + 3 status
RPC + 4-5 list page UI) accounts for B3-domain coverage.

**+ ~6-9 perimeter tests for new RPCs (CLAUDE.md mandate):**
`api_create_source_url` (3: anon perimeter, non-member perimeter,
happy path), `api_create_source_pdf` (3), `api_delete_source` (3).
The svc_update_source_status perimeter pair is already counted
inside B3-Q5's 3 status RPC tests.

Total predicted new tests across the sprint: ~22 (~14 B3 + ~9
perimeters/happy-paths). Allow ±2 drift per commit; if any gate
moves outside ±3 of the predicted range, scope leaked.

## Manual smoke test (after section merges)

Browser-driven, not automated. Targets the production code paths
that automated gates can't exercise.

- **URL extraction (HTML)** — submit a known-good article URL via
  the URL tab. Verify redirect to sources list with row in
  `'processing'`. Wait for polling to flip to `'ready'`. Verify
  title + content populated.
- **URL extraction (PDF Content-Type)** — submit a URL whose
  Content-Type is `application/pdf`. Verify the URL task branches
  to pdfplumber. Same outcome shape as HTML.
- **URL network failure (404 / DNS unreachable)** — submit a URL
  that 404s or has unresolvable DNS. Verify row transitions to
  `'failed'` with `network:` prefix in the error column. List page
  renders the failed row with expand-for-error UI.
- **URL HEAD timeout** — submit a URL where the HEAD request hangs
  past the 5s budget. Verify row transitions to `'failed'` with
  `timeout:` prefix (`timeout: head_request`) in the error column.
- **PDF upload** — drag a known-good PDF onto the PDF tab. Verify
  same async flow: redirect → processing → ready.
- **PDF malformed** — upload a corrupt PDF (or a renamed text file).
  Verify row transitions to `'failed'` with `extraction_failed:`
  prefix in the error column (specifically `extraction_failed:
  pdfplumber:<ErrorName>` for syntax errors / parse failures, or
  `extraction_failed: no_content` for empty / no-text-layer PDFs);
  failed row renders with expand-for-error.
- **Delete** — delete a source from the list page. Confirm modal
  fires; confirmed delete soft-deletes. Row disappears after
  refresh.
- **Audio (Sprint 06 regression check)** — upload audio via the
  Audio tab. Verify Sprint 06 behavior unchanged: synchronous
  transcription, transcript display, save-to-workspace.
- **Cross-tenant** — confirm RLS still blocks reading another
  workspace's URL/PDF source rows; confirm the polling query
  doesn't expose rows the user shouldn't see.
- **Empty state** — visit list page on a fresh workspace; verify
  "No sources yet" + link to upload page.
- **Title fallback** — visit list page on a workspace that has
  Sprint 06 audio_transcript rows (no `title`); verify "Untitled"
  fallback renders.

## Pre-flight verification items

To run before Sprint 07 implementation begins (not during this
spec-lock):

- **Trigger.dev v4 build extension API for Python** — confirm the
  exact configuration shape via Context7 docs. The extension is
  what bundles `apps/jobs/python/` files into the Trigger.dev
  deployment image; without it, the Python modules aren't reachable
  at task runtime. Lock the runtime version (Python 3.11 / 3.12)
  + extension config in `apps/jobs/trigger.config.ts` at pre-flight.
- **Trafilatura + pdfplumber pinned versions** — verify current
  releases are compatible with the Python runtime selected by the
  build extension. Pin in `apps/jobs/python/requirements.txt`
  with exact versions (no version ranges).
- **PDF file transfer mechanism** — `apps/web` → `Trigger.dev`
  payload size limit vs. PDF size cap. Options: payload-embedded
  base64 (small files only); ephemeral signed URL via Supabase
  Storage; direct S3 upload. Pick one at pre-flight; document
  the choice inline at commit 2 with a build-time amendment if
  the choice diverges from this spec.
- **Trafilatura HEAD-request behavior** — confirm trafilatura's
  fetcher honors `Content-Type` correctly when the URL extraction
  task short-circuits a `application/pdf` URL into pdfplumber.
  If trafilatura also has a fetcher we'd want to defer to,
  document the boundary at pre-flight.
- **Status RPC payload shape** — `svc_update_source_status` takes
  multiple optional columns (`content`, `title`, `error`). Confirm
  via Postgres docs that nullable parameters with default NULL
  work cleanly through PostgREST + supabase-js. If positional
  parameter dispatch is fragile, switch to a JSONB payload shape
  at pre-flight.

## Forward-references to Sprint 08

Sprint 08 ships B2 (YouTube via yt-dlp) + B4 (orchestration) per
SPRINT_07_carryovers.md entry #1.

- **B2** — YouTube transcript ingestion via yt-dlp. yt-dlp
  brittleness is an inherited operational concern (originally
  recorded as SPRINT_06_carryovers.md entry #2). B2 will need
  graceful failure mode + tests mocked at the yt-dlp library
  boundary + an operational runbook for yt-dlp updates. Likely
  reuses Sprint 07's Python build extension + the `python-runner.ts`
  shared subprocess wrapper.
- **B4** — source orchestration. The cross-source surface that
  unifies routing across audio/URL/PDF/YouTube. Becomes
  load-bearing once a third source type lands; with three-plus
  types in production, parallel `api_create_source_*` wrappers
  start to feel like duplication that B4 collapses.

Sprint 07 sub-items widen the `sources.type` check constraint to
admit `'url_extraction'` + `'pdf_extraction'`. Sprint 08 widens
again to admit `'youtube_transcript'` for B2.

Sprint 08 spec-lock fires when Sprint 07 ships and B3 has been
validated with first users.

## Decisions locked at pre-flight

Compact list for grep-friendly reference. Same pattern as
SPRINT_06.md's appendix.

**Foundational (E-prefix):**
- E1 — async execution: Trigger.dev for B2/B3. Chosen for the
  research-content latency profile (HEAD + fetch + library
  extraction up to ~30s). Sprint 06's sync apps/web pattern stays
  for audio (~5-30s short-form fits in a server action).
- E2 — status updates: polling at 3-5s while any source in workspace
  is in `'processing'` state. Polling stops when no rows remain in
  `'processing'`. Realtime upgrade deferred (recorded in
  SPRINT_07_carryovers.md as part of the polling-vs-realtime
  framing — not a separate entry; deferred as inherent to E2).
- E3 — Python execution: Trigger.dev v4 build extension in
  `apps/jobs`. Python files live at `apps/jobs/python/`. Protocol
  is JSON over stdout: `{ok: true, content, title}` on success,
  `{ok: false, error}` on failure. Exit codes 0 (success) / 1
  (failure). Dependencies pinned in `apps/jobs/python/requirements.txt`.
  Exact build extension API verified at pre-flight.
- E4 — sources table additions: `status`, `error`, `source_url`,
  `title`. Type CHECK widened to admit `'url_extraction'` +
  `'pdf_extraction'`. `'youtube_transcript'` deferred to Sprint 08.
- E5 — sources list page: compact list, no card grid; one row per
  source (title, type, status, created_at); rows non-interactive
  per Sprint 07 (B); sort `created_at DESC`; no filter; no
  pagination; "Untitled" fallback for NULL title; "No sources yet"
  empty state with upload-page link. Card grid / filter / pagination
  / sort controls deferred (recorded as
  SPRINT_07_carryovers.md entries #3-#6).
- E6 — failure UX: (E6a) no retry; delete-and-resubmit pattern
  only. (E6b) confirmation modal on delete; no undo; no bulk
  delete. (E6c) failed row UI shows error class label by default,
  expandable to reveal full error text; no retry suggestions;
  no report-issue link. (E6d) accept orphan possibility for rows
  stuck in `'processing'`; no sweeper in Sprint 07 (recorded as
  SPRINT_07_carryovers.md entry #2).
- E7 — implementation order: schema first → B3 backend → list
  page UI → tabbed upload extension. Four commits.

**Sprint 07 drafting locks (referenced inline as "Sprint 07 (X)
lock"):**
- Sprint 07 (A) — empty-string content placeholder pattern
  (`content = ''` during `'processing'`; preserves NOT NULL).
- Sprint 07 (B) — source detail page deferred; rows non-interactive
  in Sprint 07. Recorded as SPRINT_07_carryovers.md entry #9.
- Sprint 07 (C) — preserve B3-Q5's ~14 test count for B3-domain
  coverage; mandatory CLAUDE.md perimeter tests for new public.api_*
  functions add ~9 more on top.
- Sprint 07 (D) — two Trigger.dev tasks (`extractFromUrlTask`,
  `extractFromPdfTask`) wrapping two Python modules
  (`extract_trafilatura.py`, `extract_pdfplumber.py`).
- Sprint 07 (E) — sources list route at
  `apps/web/src/app/app/[workspaceSlug]/sources/page.tsx` (matches
  Sprint 06's apps/web path-deviation amendment).

**B3 implementation (B3-prefix):**
- B3-Q1 — single user-facing URL field; task does HEAD request,
  branches on Content-Type; PDF drag-and-drop is a separate UI
  entry but reuses the same pdfplumber Python module.
- B3-Q2 — task return shape `{ok: true, content, title}` |
  `{ok: false, error}`. `title` may be NULL.
- B3-Q3 — error classes (four, prefix-encoded in `error` column):
  `extraction_failed:`, `network:`, `transient:`, `timeout:`.
- B3-Q4 — tabbed upload UI at the existing route. Audio tab
  preserves Sprint 06 behavior unchanged.
- B3-Q5 — test coverage target ~14: 3-4 Trafilatura task tests +
  3-4 pdfplumber task tests + 3 status RPC tests + 4-5 list page
  UI tests. Plus mandatory perimeter coverage for the new
  `public.api_*` RPCs (~9 more tests, per Sprint 07 (C)).

**Naming:**
- `public.api_create_source_url` + `private.create_source_url_impl`
  — auth-callable wrapper + DEFINER worker pattern (matches
  Sprint 06's `api_create_source_audio`).
- `public.api_create_source_pdf` + `private.create_source_pdf_impl`
  — same pattern.
- `public.svc_update_source_status` +
  `private.update_source_status_impl` — service-role-only HTTP
  entry point + DEFINER worker. `svc_*` prefix per CLAUDE.md
  convention; granted to `service_role`, revoked from
  `public, anon, authenticated`.
- `public.api_delete_source` + `private.delete_source_impl` —
  auth-callable wrapper + DEFINER worker. Authorization: any
  workspace member can soft-delete any source in that workspace
  (matches SELECT permission scope; collaboration-friendly).
