<!--
  Sprint 05 — Carryover sweep + Source ingestion
  Locked: 2026-05-02
  Status: planning → spec-locked
  Pre-flight cycle: Pass 1 (sprint shape + Section A design + non-Modal Section B) →
    Pass 2 (Modal-greenfield decisions via Context7) → Pass 3 (this commit).
  Predecessor: Sprint 04 (PR #10, merged commit fca6218); post-Sprint-04 hygiene
    PRs #11 / #12 / #13 also landed before this spec-lock.
  Capacity: 1 solo builder, larger sprint than Sprint 04 (7 sub-items vs 5).

  Reading guide for future Claude sessions:
  - Locked decisions live BOTH inline in the relevant sub-item AND in the
    "Decisions locked at pre-flight" appendix at the bottom (26 items grouped
    by source pass).
  - Sub-item structure varies by sub-item shape; "N/A" markers are explicit
    where a section doesn't apply (so missing-by-design is distinguishable
    from missed-by-oversight).
  - Workflow conventions (top of the spec) extend Sprint 04's 6-step pattern
    with Modal mid-sprint check-ins and Python tooling.
  - Carryover index: SPRINT_04_carryovers.md is the canonical deferral
    artefact; Sprint 05 clears items #1 + #3 and promotes #4 to ready-for-S06+.
-->

# Sprint 05 — Carryover sweep + Source ingestion

## Goal

Ship two sections in sequence. **Section A — Carryover sweep** clears the
highest-priority Sprint 04 deferrals (carryover #1 scheduled hard-delete
sweeper for soft-deleted workspaces, paired with #3 Stripe subscription
cancellation) using codebase-known patterns: Trigger.dev scheduled task
matching `apps/jobs/src/trigger/billing-grace-period.ts`, SECURITY DEFINER
RPCs per the convention pinned in `packages/db/tests/CLAUDE.md`. **Section
B — Source ingestion** catches up the deferred Sprint 03 build_plan
deliverable: yt-dlp + Whisper-on-Modal + Trafilatura + pdfplumber + file
upload UI. Section A ships first, fully, before any Modal greenfield work
begins — the asymmetric-slip-risk mitigation. If Section B stretches due
to Modal unknowns, the S12 launch gate is partially de-risked regardless.

## Non-goals

- **Carryover #4 ghost membership cleanup** — promoted to ready-for-S06+
  by this spec. Requires extending Section A's sweeper scope to
  `auth.users`; out of scope for Sprint 05.
- **Carryovers #7 + #8 Resend domain verification + SMTP cutover** —
  paired email-infrastructure work; Phase 1-affecting but lands in S06
  alongside multi-owner consideration.
- **Carryovers #9 + #10 typedRpcWithNullable + typedInsert** —
  defer-until-second-instance items; no Sprint 05 work triggers a second
  instance.
- **Carryover #11 silentMembershipLookup hoist** — pair with future
  layout-perf work.
- **faster-whisper as Whisper implementation** — Pass 2 Q15 revised to
  OpenAI Whisper via HuggingFace `transformers` + `@modal.batched`
  (Modal-published example pattern; lower-risk for greenfield Modal
  user). faster-whisper revisitable in a future optimization sprint if
  Modal's pattern under-performs.
- **Modal JS/TS SDK** — Pass 2 Q17 locked at `@modal.fastapi_endpoint`
  HTTPS pattern; JS SDK is Beta. Revisit when SDK exits Beta.
- **Original Sprint 05 build_plan deliverables** (Remix engine v1 +
  Authenticity Engine + multi-model router + anti-slop guards + BYO-key
  support) — re-scoped to Sprint 06+ per the `build_plan.md` §5.2
  amendment that landed 2026-05-02. Depends on this sprint's source
  ingestion shipping.

## Workflow conventions

Same pattern as Sprint 04:

1. Spec → confirm → build → verify
2. Pause after each commit lands locally
3. User reviews against the spec; approves before next commit
4. All gates green at every commit (5 gates today; 7 gates from B1 forward
   when `lint:py` + `typecheck:py` are introduced)
5. Branch per section: `chore-sprint-05-section-a` for A1+A2;
   `chore-sprint-05-section-b` for B1–B5 (or split per sub-item if scope
   warrants; lock at section start)
6. PR opened only after all section commits land local + reviewed

### Modal mid-sprint check-ins

Section B introduces Modal as a new architectural surface. Mid-sprint
check-ins are warranted beyond the standard escalation triggers — see
Section B preamble for the detailed treatment.

### Python tooling

Section B introduces Python at `apps/media-worker/`. Tooling baseline
locked at Pass 2 SD3:

- **Python version:** 3.11 (matches Modal's published Whisper example).
- **Dependency manifest:** `pyproject.toml` (PEP 621);
  `requires-python = ">=3.11,<3.12"`.
- **Lint:** Ruff (replaces flake8 / black / isort in one tool).
- **Typecheck:** Pyright.
- **Workspace integration:** separate top-level gates `pnpm lint:py`,
  `pnpm typecheck:py`. NOT folded into Turbo's TS pipeline — toolchains
  are fundamentally separate.
- **AGPL header on all `.py` files:** full-block comment matching the
  existing `.ts` header style. `scripts/check-license-headers.mjs`
  extends to `.py` in B1's first commit (gate enforced from the moment
  Python enters the repo).

## Section A — Carryover sweep

### A1 — Scheduled hard-delete sweeper for soft-deleted workspaces

**Why:** Sprint 04 A1 introduced soft-delete via `workspaces.deleted_at`
+ cascade through `private.is_workspace_member`. The 24-hour grace
window is the user-facing semantic; hard-delete cleanup is the
operational counterpart, deferred to Sprint 05+ at A1's migration
header. Carryover #1 (keystone in the dependency tree); urgency-tell:
"I deleted a workspace and Stripe still charged me" — addressed jointly
with A2.

**Approach:** Trigger.dev scheduled task matching the existing
`apps/jobs/src/trigger/billing-grace-period.ts` pattern. Hourly cadence.
The task calls a service-role-perimeter SECURITY DEFINER RPC that
returns rows of soft-deleted workspaces past the cutoff; the Trigger.dev
side iterates, calls Stripe per-workspace (A2 logic), and on success
calls a second RPC that finalizes the hard-delete (sets
`hard_deleted_at`, deletes children). Per-workspace error isolation —
one failed Stripe call doesn't fail the whole sweep.

**Schema:**

- New migration `<ts>_workspaces_sweep_columns.sql`:
  - `alter table public.workspaces`:
    - `add column hard_deleted_at timestamptz` (audit-marked; row
      remains, children are deleted)
    - `add column last_sweep_attempt_at timestamptz` (per-workspace
      error isolation)
    - `add column last_sweep_error text` (last error message; sufficient
      for "this workspace's sweep is stuck on X" triage)
  - Partial index for sweeper query performance:
    ```sql
    create index workspaces_sweep_candidates_idx
      on public.workspaces (deleted_at)
      where hard_deleted_at is null and deleted_at is not null;
    ```

**RPCs:**

- `private.sweep_soft_deleted_workspaces_impl(_cutoff_interval interval)`
  — DEFINER worker. Returns `setof record` of `(workspace_id uuid,
  stripe_customer_id text, stripe_subscription_id text, status text)`.
  WHERE clause requires `deleted_at < now() - _cutoff_interval`,
  `deleted_at IS NOT NULL`, `hard_deleted_at IS NULL`. Per-row
  `select … for update skip locked` to prevent racing with re-delete.
  Body does NOT call Stripe; that's the Trigger.dev side's job.
- `public.svc_sweep_soft_deleted_workspaces(_cutoff_interval interval default '24 hours')`
  — service-role-only SECURITY DEFINER wrapper; granted EXECUTE to
  `service_role` only (revoked from `public, anon, authenticated` per
  the convention). Returns the same rowset shape as the worker.
- `private.finalize_workspace_hard_delete_impl(_workspace_id uuid)` —
  DEFINER worker. Deletes child rows in `workspace_invitations`,
  `workspace_members`; sets `workspaces.hard_deleted_at = now()`,
  `last_sweep_error = null`. Does NOT delete the workspace row itself
  (audit trail preserved).
- `public.svc_finalize_workspace_hard_delete(_workspace_id uuid)` —
  service-role-only wrapper.
- `private.record_workspace_sweep_error_impl(_workspace_id uuid, _error_text text)`
  — DEFINER worker. Sets `last_sweep_attempt_at = now()`,
  `last_sweep_error = _error_text`.
- `public.svc_record_workspace_sweep_error(_workspace_id uuid, _error_text text)`
  — service-role-only wrapper.

**Trigger.dev task:**

- File: `apps/jobs/src/trigger/sweep-soft-deleted-workspaces.ts`.
- Schedule: every 1 hour (`schedules.task` with cron `0 * * * *`).
- Pattern: matches `billing-grace-period.ts` (service-role client via
  `getJobsSupabaseClient`, system-task bypass per `apps/jobs/SYSTEM_TASKS.md`).
- Body: call `svc_sweep_soft_deleted_workspaces`; for each row, call
  `cancel-workspace-subscription` service (A2); on success call
  `svc_finalize_workspace_hard_delete`; on Stripe error call
  `svc_record_workspace_sweep_error` and continue.
- Per-workspace retry: separate Trigger.dev task with idempotency keyed
  on `workspace_id`; max 3 attempts before abandoning to operator triage.

**Tests** (new files in `packages/db/tests/billing/sweep-workspaces*.test.ts`):

- `svc_sweep_soft_deleted_workspaces` perimeter (anon + authenticated
  rejected with 42501).
- Sweep state machine: workspace not yet at threshold (excluded),
  workspace at threshold no subscription (returned), workspace at
  threshold with active subscription (returned with stripe IDs),
  workspace already hard-deleted (excluded), workspace soft-deleted but
  re-deletion-pending (excluded via `select … for update skip locked`).
- `svc_finalize_workspace_hard_delete` clears `workspace_members` +
  `workspace_invitations`, sets `hard_deleted_at`, preserves the
  workspace row itself.
- `svc_record_workspace_sweep_error` updates `last_sweep_attempt_at` and
  `last_sweep_error` without touching `hard_deleted_at`.
- Trigger.dev task wrapper test (mock service-role client + mock Stripe).

**Expected gate deltas:** +8-12 db tests, +2-3 web tests, ~1 migration,
+3-5 `.ts` files. `test:license-headers` 213 → ~217-219.

**Commit message:** `feat: scheduled hard-delete sweeper for soft-deleted workspaces (Sprint 05 A1)`.

### A2 — Stripe subscription cancellation for soft-deleted workspaces

**Why:** Sprint 04 A1's migration header explicitly named the gap —
*"soft-delete does NOT cancel active Stripe subscriptions; users who
delete a workspace continue to be billed; Sprint 05+ candidate."*
Carryover #3, paired with #1 in the dependency tree. Cancellation runs
inside A1's task body; folds as a logically-separate commit on the same
branch.

**Approach:** Stripe cancellation logic added as a service module called
from A1's Trigger.dev task body. Cancel mode: **immediate**
(`subscription.cancel(id)`) rather than `cancel_at_period_end` —
aligns with Sprint 04 A1's user-disclosure copy *"you remain billed
until you manage that separately"* (immediate cancellation matches user
expectation when they discover this). In-flight invoices: no special
handling; Stripe's natural mid-period cancel behavior applies. Webhook
handler unchanged (existing `customer.subscription.deleted` event
handler covers both UI-initiated and API-initiated cancellations
correctly).

**Schema:** N/A. A1's `last_sweep_attempt_at` + `last_sweep_error`
columns are reused for cancellation error logging.

**RPCs:** N/A. Stripe API call is Trigger.dev-side, not Postgres.

**App layer:**

- File: `apps/web/src/services/billing/cancel-workspace-subscription.ts`.
- **Build-time amendment (Sprint 05 A1 commit):** stub relocated to
  `apps/jobs/src/services/billing/cancel-workspace-subscription.ts`.
  Cross-app import from `apps/web` was not feasible (no
  `@authently/web` dependency in `apps/jobs`; no path alias; no
  exports field). A2's Stripe SDK + `STRIPE_SECRET_KEY` env wiring
  must be added to `apps/jobs` (currently web-only). A second
  consumer in `apps/web` would warrant extraction to
  `packages/billing/`.
- Function: `cancelWorkspaceSubscription({ workspaceId, stripeCustomerId, stripeSubscriptionId })`.
- Uses the existing service-role Stripe client (per Sprint 02-D
  precedent in `apps/web/src/services/webhooks/stripe/`); A2 will
  initialize an equivalent client in `apps/jobs/src/lib/`.
- Returns `{ ok: true }` on success or
  `{ ok: false, error: string }` on Stripe failure (so the Trigger.dev
  side can route to the error-recording RPC).
- Idempotent: if Stripe reports the subscription is already cancelled,
  returns `{ ok: true }` (the goal state is reached).

**Tests** (new file `apps/web/tests/services/billing/cancel-workspace-subscription.test.ts`):

- Happy path: active subscription → `subscription.cancel` called →
  returns `{ ok: true }`.
- Already-cancelled subscription → returns `{ ok: true }` (idempotent).
- Stripe API error (network / auth) → returns
  `{ ok: false, error }` with error text suitable for
  `last_sweep_error`.
- No `stripe_subscription_id` (workspace was on free tier) → returns
  `{ ok: true }` without calling Stripe.

**Expected gate deltas:** +5-8 web tests, +0 db tests, +0 migration,
+1-2 `.ts` files. `test:license-headers` ~217-219 → ~218-221.

**Commit message:** `feat(billing): cancel Stripe subscription for soft-deleted workspaces (Sprint 05 A2)`.

## Section B preamble — Modal greenfield

Section B introduces Modal (`modal.com`) as a new architectural surface.
This is the highest-risk single area in Sprint 05. Pre-flight Pass 2
locked the Modal-related decisions against current Modal docs (Context7,
2026-05-02), but Modal moves fast — verify against current docs at
build-time if anything looks off.

**Cost framing.** Modal bills per-second of compute. The user's Modal
workspace budget is locked at **$50/month hard cap** for Sprint 05 with
dashboard alerts at **$10 / $25 / $40** (Pass 2 Q12). The $50 cap is
deliberately conservative for greenfield; raisable as usage stabilizes
post-Sprint-05. Modal does NOT have application-level rate-limits at
the platform layer — per-workspace daily quotas live application-side
in the `ingestion_usage` table introduced in B4.

**Modal mid-sprint check-ins.** Beyond the standard escalation triggers
in `CLAUDE.md` (sprint kickoff, design questions, drift, non-obvious
failures, product-vs-execution decisions), warrant a mid-sprint check-in
any time:

- A Modal docs reference doesn't match training-data expectations
  (Modal moves fast; verify against current docs).
- A Modal cost-control primitive behaves unexpectedly (timeout,
  `max_containers`, `min_containers`, `scaledown_window`).
- Python tooling friction (Ruff, Pyright, `pyproject.toml` resolution)
  blocks gate progress.
- The Python image build fails or takes >5 minutes (cache invalidation
  likely).
- Any sub-item's expected gate deltas are exceeded.
- Whisper transcription cost-per-minute deviates from prediction
  (smoke test in B1 should establish a baseline — flag if 2x or more
  off).

**Pre-B1 prerequisite.** Before B1 starts, the user executes the
Modal-setup runbook (`docs/runbooks/modal-setup.md`, drafted in a
separate post-spec-lock commit per Pass 2 SD1). The runbook covers
account creation, billing setup, CLI auth (`modal token new`),
workspace budget cap configuration, and a smoke `modal deploy` of a
minimal hello-world function. B1 does not start until the smoke deploy
succeeds.

## Section B — Source ingestion

### B1 — Modal scaffolding + Whisper transcription

**Why:** Build_plan §5 S03 deliverable — *"Whisper transcription:
audio → text. Modal-hosted (per build_plan §9 'Heavy workers')."*
Foundational to Section B because B2 (yt-dlp) feeds audio into B1, and
B4's source orchestration routes audio inputs here. Largest single
greenfield item in Sprint 05; lands first in Section B so subsequent
sub-items have a working Modal app to extend.

**Approach:** Set up `apps/media-worker/` Python package; deploy as a
single Modal app `authently-media-worker`; add a Whisper transcription
class using OpenAI Whisper via HuggingFace `transformers` +
`@modal.batched` for dynamic batching. A10G GPU. HuggingFace model
weights cached via `modal.Volume` at a constant path. Expose
transcription via `@modal.fastapi_endpoint` for HTTPS invocation from
Trigger.dev.

**Pre-flight prerequisites:**

- Modal-setup runbook has been executed by user (Modal account, CLI
  auth, $50/month budget cap, billing alerts at $10/$25/$40, smoke
  deploy succeeded).
- `apps/media-worker/` directory does NOT yet exist.
- `scripts/check-license-headers.mjs` has NOT yet been extended to
  cover `.py` (this commit extends it).

**Image, functions, endpoints:** Single Modal app
`authently-media-worker` deploys a `Transcriber` class (`@app.cls` with
`@modal.enter` model loader + `@modal.batched` transcribe method) and
a thin `@modal.fastapi_endpoint` HTTPS wrapper that the Trigger.dev
orchestrator invokes. Image: `modal.Image.debian_slim(python_version="3.11")`
with strict `==` pins on `torch`, `transformers`, `huggingface-hub`,
`librosa`, `soundfile`, `accelerate`, `fastapi[standard]` via
`.uv_pip_install`; `modal.Volume` named `hf-hub-cache` mounted with
`HF_HUB_CACHE` env var. Model: `openai/whisper-large-v3` loaded once
per container in `@modal.enter`; A10G GPU. Detailed image definition,
function signatures, and endpoint shapes land in
`apps/media-worker/CLAUDE.md` as part of B1's first commit (see Pass 2
Q14–Q17 in the appendix for the locked decisions those details
implement). FastAPI payloads use `pydantic.BaseModel` for validation.

**Cost controls:** `timeout=30 * 60` (30-minute upper bound for
long-form audio), `max_containers=3` (concurrent container ceiling
during Sprint 05; raisable post-launch), `scaledown_window=300`
(5-minute idle timeout), all declarative on the function decorator.
Application-side: B4's `ingestion_usage` table enforces per-workspace
daily quotas (default 60 minutes/workspace/day; revisitable at S12
pricing). Modal-side: $50/month workspace budget hard cap (per Pass 2
Q12).

**Tests:**

- `apps/media-worker/tests/test_transcription.py` (Pyright + Ruff
  pass, no actual GPU work — mock the pipeline output).
- Smoke test runbook step in commit body: deploy + invoke endpoint
  with a 30-second test audio file; verify response shape +
  baseline cost-per-minute.

**Expected gate deltas:**

- `test:license-headers` ~218-221 → ~225-230 (B1 introduces the first
  `.py` files; header check script extends to `.py` in this commit).
- `test:db`, `test:web` unchanged (no TS/Postgres surface here).
- **NEW gates:** `pnpm lint:py` (Ruff), `pnpm typecheck:py` (Pyright).
  Gate count moves 5 → 7 from this commit forward.
- New `.py` files: ~3-5 in `apps/media-worker/src/` + ~1-2 tests.
- New CI workflow steps for the two new gates.

**Commit message:** `feat(media-worker): Modal scaffolding + Whisper transcription (Sprint 05 B1)`.

### B2 — yt-dlp video URL ingestion

**Why:** Build_plan §5 S03 deliverable — *"yt-dlp worker: takes a video
URL (YouTube + general video URLs) and returns audio + metadata +
thumbnails."* Feeds B1's transcription pipeline. Modal-colocated with
Whisper per Pass 1 Q18 (CPU-only Modal function, same Python image base
as B1, deploys to the same `authently-media-worker` app).

**Approach:** New Modal function `extract_audio_from_url` in
`apps/media-worker/src/source_extraction.py`. CPU-only (no GPU; yt-dlp
is shell-out + ffmpeg processing). Output: short-lived Modal volume
file path that B1's `Transcriber.transcribe` reads via internal Modal
function call (no need to round-trip through Supabase Storage for the
B2 → B1 handoff; only finalized transcripts go to Postgres).

**Image (delta from B1's image):**

```python
# Add yt-dlp + ffmpeg system dependency
extraction_image = (
    image
    .apt_install("ffmpeg")
    .uv_pip_install("yt-dlp==2025.05.10")  # pin to current stable
)
```

**Functions:**

```python
@app.function(
    image=extraction_image,
    cpu=2.0,
    timeout=10 * 60,       # 10-min upper bound for long videos
    max_containers=5,
)
def extract_audio_from_url(video_url: str) -> ExtractedAudio:
    # Run yt-dlp; return {audio_path_in_volume, title, duration_seconds,
    # thumbnail_url, source_url}.
    ...
```

**Endpoints:**

```python
@app.function(image=extraction_image)
@modal.fastapi_endpoint(method="POST")
def extract_audio_endpoint(payload: ExtractAudioPayload) -> ExtractedAudio:
    return extract_audio_from_url.remote(payload.video_url)
```

**Tests:**

- Mock yt-dlp output; verify response shape.
- Smoke test runbook step: invoke endpoint with a public 60-second
  YouTube clip; verify audio file exists + metadata fields populated.

**Expected gate deltas:** +1-2 `.py` files; `test:license-headers`
~225-230 → ~226-232. No TS/Postgres changes.

**Commit message:** `feat(media-worker): yt-dlp video URL ingestion (Sprint 05 B2)`.

### B3 — Trafilatura URL article extraction + pdfplumber PDF extraction

**Why:** Build_plan §5 S03 deliverables — *"Trafilatura: URL → article
text extraction; pdfplumber: PDF → text extraction."* Both are
pure-Python libraries with no GPU need; both are lightweight and
colocate naturally with B2 in `apps/media-worker/src/source_extraction.py`.

**Approach:** Two new Modal functions in the same module as B2. Same
extraction image base; add `trafilatura` and `pdfplumber` to the
`uv_pip_install` list.

**Image (delta from B2's extraction image):**

```python
extraction_image_v2 = (
    extraction_image
    .uv_pip_install(
        "trafilatura==1.12.2",
        "pdfplumber==0.11.4",
    )
)
```

**Functions:**

```python
@app.function(image=extraction_image_v2, cpu=1.0, timeout=2 * 60)
def extract_article_from_url(url: str) -> ExtractedArticle:
    import trafilatura
    downloaded = trafilatura.fetch_url(url)
    text = trafilatura.extract(downloaded, include_comments=False, include_tables=True)
    # Return {title, text, language, source_url}.
    ...

@app.function(image=extraction_image_v2, cpu=1.0, timeout=5 * 60)
def extract_text_from_pdf(pdf_url: str) -> ExtractedPdf:
    import pdfplumber
    # Fetch pre-signed URL → temp file → pdfplumber.open → extract per-page
    # text. Return {page_count, full_text, per_page_text, source_url}.
    ...
```

**Endpoints:**

```python
@app.function(image=extraction_image_v2)
@modal.fastapi_endpoint(method="POST")
def extract_article_endpoint(payload: UrlPayload) -> ExtractedArticle:
    return extract_article_from_url.remote(payload.url)

@app.function(image=extraction_image_v2)
@modal.fastapi_endpoint(method="POST")
def extract_pdf_endpoint(payload: PdfPayload) -> ExtractedPdf:
    return extract_text_from_pdf.remote(payload.pdf_url)
```

**Tests:**

- Mock fetch + library calls; verify response shapes.

**Expected gate deltas:** +1-2 `.py` files; `test:license-headers`
~226-232 → ~227-234. No TS/Postgres changes.

**Commit message:** `feat(media-worker): Trafilatura + pdfplumber extraction (Sprint 05 B3)`.

### B4 — Source orchestration (sources + ingestion_usage tables)

**Why:** Cross-cutting orchestration layer that ties B1/B2/B3 together
and tracks per-workspace state + cost. Carries the only Postgres
schema in Section B (the `sources` and `ingestion_usage` tables) plus
the Next.js / Trigger.dev side that routes inputs to the right Modal
function.

**Approach:** Two new tables — `sources` for per-source state machine
tracking, `ingestion_usage` for per-workspace daily quotas. Two new
Trigger.dev tasks (one for ingestion orchestration, one for quota
checks). One new TypeScript module `source_routing.ts` for input
classification. DEFINER RPCs as the sole write path on both tables;
SELECT-only RLS (per the convention pinned in
`packages/db/tests/CLAUDE.md`).

**Schema:**

- New migration `<ts>_sources_and_ingestion_usage.sql`:
  - `public.sources` table:
    - `id uuid primary key default gen_random_uuid()`
    - `workspace_id uuid not null references public.workspaces(id) on delete cascade`
    - `kind text not null check (kind in ('youtube', 'video_url', 'article_url', 'pdf_upload', 'audio_upload', 'pasted_text'))`
    - `source_url text` (nullable; null for direct uploads / pasted text)
    - `storage_path text` (nullable; `ws/{workspace_id}/sources/<id>/...` per CLAUDE.md rule 5)
    - `status text not null check (status in ('queued', 'fetching', 'transcribing', 'extracting', 'complete', 'failed'))`
    - `extracted_text text` (nullable until status='complete')
    - `extracted_metadata jsonb` (title, language, duration_seconds, etc.)
    - `error_message text` (nullable; populated on status='failed')
    - `created_at`, `updated_at`, `completed_at` timestamptz
  - `public.ingestion_usage` table:
    - `workspace_id uuid not null references public.workspaces(id) on delete cascade`
    - `usage_date date not null`
    - `transcription_seconds_used int not null default 0`
    - `extraction_count int not null default 0`
    - `primary key (workspace_id, usage_date)`
  - SELECT-only RLS on both: workspace members can read their own;
    DEFINER RPCs perform writes.

**RPCs:**

- `private.create_source_impl(_workspace_id uuid, _kind text, _source_url text, _storage_path text)`
  → returns new `sources.id`.
- `public.api_create_source(...)` — user-callable wrapper, `auth.uid()`
  membership check inside.
- `private.update_source_status_impl(_source_id uuid, _status text, _extracted_text text, _extracted_metadata jsonb, _error_message text)`
  → service-role-only via `svc_*` wrapper (called from Trigger.dev
  orchestrator).
- `public.svc_update_source_status(...)` — service-role-only wrapper.
- `private.bump_ingestion_usage_impl(_workspace_id uuid, _seconds int, _extractions int)`
  → service-role-only worker; UPSERTs into `ingestion_usage`.
- `public.svc_bump_ingestion_usage(...)` — service-role-only wrapper.
- `private.check_ingestion_quota_impl(_workspace_id uuid)` → returns
  `(transcription_seconds_remaining int, extractions_remaining int)`
  computed against per-tier limits (default 60 min/day for free tier).
- `public.api_check_ingestion_quota(_workspace_id uuid)` — user-callable
  for the UI to surface remaining quota; member-only.

**source_routing.ts module:**

- File: `apps/web/src/services/sources/source-routing.ts`.
- Function: `classifyInput({ url, file, pastedText }) → SourceKind`.
  Pure TypeScript classification:
  - URL with YouTube hostname or video MIME-type detection → `youtube`
    or `video_url`.
  - URL otherwise → `article_url`.
  - File with `application/pdf` MIME → `pdf_upload`.
  - File with `audio/*` or `video/*` MIME → `audio_upload`.
  - Pasted text → `pasted_text` (no ingestion needed; create source row
    with `extracted_text` set directly).

**Trigger.dev tasks:**

- File: `apps/jobs/src/trigger/ingest-source.ts`. Long-running task
  (`maxDuration: timeout.None`); orchestrates a single source through
  the right Modal endpoint based on its `kind`; bumps
  `ingestion_usage` on success; updates `sources.status` throughout.
- File: `apps/jobs/src/trigger/check-ingestion-quota.ts`. Optional
  per-workspace daily quota-check task (called pre-ingest from
  `ingest-source` if quota check returns 0 remaining).

**Tests:**

- `packages/db/tests/sources/source-creation.test.ts` (RLS perimeter +
  state machine).
- `packages/db/tests/sources/ingestion-usage-quota.test.ts` (RLS +
  quota bump + check).
- `apps/web/tests/services/sources/source-routing.test.ts` (input
  classification across all six `kind` cases).
- `apps/web/tests/services/sources/ingest-orchestrator.test.ts` (mock
  Modal endpoints + service-role calls).

**Expected gate deltas:** +5-10 db tests, +5-8 web tests, +1-2
migrations, +5-7 `.ts` files. `test:license-headers`
~227-234 → ~232-241.

**Commit message:** `feat(sources): orchestration tables + source routing + ingestion task (Sprint 05 B4)`.

### B5 — File upload UI

**Why:** Build_plan §5 S03 deliverable — *"File upload UI: user-facing
surface for uploading audio / video / PDF / pasting URLs."*
User-visible entry point to the Section B ingestion pipeline.

**Approach:** New page `apps/web/src/app/app/[workspaceSlug]/sources/page.tsx`
(server component) listing existing sources for the workspace. Add-source
button triggers a client-component dialog with input UI for URL paste,
text paste, and file upload (matching Sprint 04 dialog pattern). Upload
destination: Supabase Storage bucket at
`ws/{workspace_id}/sources/<id>/` per CLAUDE.md rule 5. After upload,
the `source` row is created via `api_create_source` and the Trigger.dev
`ingest-source` task is triggered with the new `source_id`.

**Server component:**

- File: `apps/web/src/app/app/[workspaceSlug]/sources/page.tsx`.
- Fetches sources via `getCurrentUserWithMemberships` + a new
  `listWorkspaceSources(workspaceId)` service.
- Renders a list of sources with per-source status badges
  (`queued` / `fetching` / `transcribing` / `extracting` /
  `complete` / `failed`) and timestamps.
- Surfaces remaining quota from `api_check_ingestion_quota`.

**Client component (add-source dialog):**

- File: `apps/web/src/app/app/[workspaceSlug]/sources/add-source-dialog.tsx`.
- Tabs: URL / Paste text / Upload file.
- File upload: pre-signed Supabase Storage upload via the standard
  client; on success, calls the server action that creates the source
  row + triggers the orchestrator task.
- Pattern matches Sprint 04's `delete-workspace-dialog.tsx` server-+-client
  split (the trigger button is client-component; the dialog body is
  server-component-friendly where possible).

**API route:**

- File: `apps/web/src/app/api/ws/[slug]/sources/route.ts`.
- POST handler: Zod-validate the source-creation payload; resolve
  workspace from slug + auth; call `api_create_source`; trigger
  `ingest-source` task; return `{ sourceId, status: 'queued' }`.

**Tests:**

- `apps/web/tests/api/ws/[slug]/sources.test.ts` (perimeter:
  unauthenticated rejected, non-member rejected, member happy path).
- `apps/web/tests/services/sources/list-workspace-sources.test.ts`.
- Component tests via the established React Testing Library pattern
  (smoke tests; not full visual regression).

**Expected gate deltas:** +3-5 web tests, +0 db tests, +3-5 `.ts`/`.tsx`
files. `test:license-headers` ~232-241 → ~235-246.

**Commit message:** `feat(web): source upload UI (Sprint 05 B5)`.

## Commit order

```
1. docs spec-lock (this commit)             — branch: docs-sprint-05-spec-lock
2. docs/runbooks/modal-setup.md              — branch: docs-modal-setup-runbook
3. user executes Modal setup runbook         — out-of-repo
4. A1 sweeper                                — branch: chore-sprint-05-section-a
5. A2 Stripe cancellation                    — same branch as A1
6. (PR for Section A; merge)
7. user verifies Modal smoke deploy          — runbook checkpoint
8. B1 Modal scaffolding + Whisper            — branch: chore-sprint-05-section-b
9. B2 yt-dlp                                 — same branch as B1
10. B3 Trafilatura + pdfplumber              — same branch
11. B4 source orchestration                  — same branch
12. B5 file upload UI                        — same branch
13. (PR for Section B; merge)
```

Section A ships fully (steps 1–6) before any Modal greenfield work
begins. The user runbook execution (step 3) and the post-A2 Modal
smoke verification (step 7) are checkpoints the human owns; B1 does
not start until step 7 confirms Modal is operational.

## Guardrails

Existing TypeScript guardrails from Sprint 04 (carried forward):

- AGPL header on every new `.ts`/`.tsx` source file.
- Migration filenames via `pnpm db:new` (no manual timestamp
  construction).
- DEFINER RPC convention: `private.<name>_impl` worker +
  `public.api_<name>` user-callable wrapper or `public.svc_<name>`
  service-role-only wrapper, both with proper grants (authenticated
  only for `api_*`, service_role only for `svc_*`).
- All check-and-mutate logic in SQL `WHERE` clauses, not application
  layer.
- Tests for RLS perimeter (anonymous + non-member + non-authorized
  should all fail with 42501 or appropriate disambiguator).
- Spec → confirm → build → verify; pause after each commit.
- Boot-loaded config gate-run hygiene: any `supabase/config.toml` or
  `supabase/templates/*.html` change requires
  `supabase stop && supabase start` before the gate run (per the
  convention pinned in `packages/db/tests/CLAUDE.md`).

New Python guardrails (Section B):

- AGPL header on every new `.py` source file (full-block comment style;
  `scripts/check-license-headers.mjs` extends to `.py` in B1).
- Strict version pinning in `pyproject.toml` (no `>=` ranges; matches
  Modal example pattern of `==` exact pins).
- Modal image-build caching: stable image hashes across deploys via
  strict pins; `force_build` flag NOT used in production code.
- Service-role allow-list NOT expanded for Modal HTTPS endpoints —
  endpoints are unauthenticated at the HTTP layer (Modal's deploy
  permissions gate access via `MODAL_TOKEN_*` secrets); inside the
  endpoint, validate payload via Pydantic + check Modal token from
  Trigger.dev side.

## Definition of done

Sprint-level summary; sub-item-level expected gate deltas appear inline.

**Gates green at every commit:**

- `pnpm test:license-headers` — extends to `.py` from B1 forward.
- `pnpm typecheck` — TypeScript-only; 6 packages (current).
- `pnpm lint` — TypeScript-only; 6 packages (current).
- `pnpm test:db` — DB integration tests.
- `pnpm test:web` — Next.js app tests.
- **NEW (from B1):** `pnpm lint:py` — Ruff over `apps/media-worker/`.
- **NEW (from B1):** `pnpm typecheck:py` — Pyright over
  `apps/media-worker/`.

**Gate count:** 5 today; **7** from B1 forward. CI workflow updated in
B1's first commit to run the two new gates.

**Sprint-level cumulative predictions** (predicted at spec-lock; actual
at sprint close will be reflected in `build_plan.md` §5.2 amendment):

- `test:license-headers`: 213 → ~235-246 (+22-33 files: ~12-20
  `.ts`/`.tsx` + ~5-10 `.py`).
- `test:db`: 125 → ~138-155 (+13-30).
- `test:web`: 49 → ~62-78 (+13-29).
- `lint:py`, `typecheck:py`: NEW — 0 baseline → enforced on all `.py`
  files in `apps/media-worker/`.

**Manual smoke after Section A merge:**
- Soft-delete a workspace; wait >24 hours (or temporarily lower the
  cutoff via the runbook); verify hard-delete + Stripe cancellation
  fire.

**Manual smoke after Section B merge:**
- Upload a 30-second audio file; verify transcription completes and
  text appears in the source row.
- Submit a YouTube URL; verify yt-dlp + Whisper handoff.
- Submit an article URL; verify Trafilatura extraction.
- Submit a PDF; verify pdfplumber extraction.

## Decisions locked at pre-flight (Pass 1/2/3, 2026-05-02)

26 locked decisions in compact form for grep-friendly reference.
Inline prose in each sub-item is authoritative; this appendix is the
lookup index.

### Pass 1 — sprint shape + Section A design (Q1–Q11)

1. Spec housekeeping (Q1) — `SPRINT_CURRENT.md` deleted; `SPRINT_NN.md` is canonical.
2. Sub-item naming (Q2) — A1+A2 carryovers; B1–B5 ingestion. Folding permitted at execution time. See Sections A and B.
3. Forward-looking docs (Q3) — clear #1+#3 in `SPRINT_04_carryovers.md`; new `SPRINT_05_carryovers.md` only if mid-sprint deferrals; `build_plan.md` §5.2 update at sprint close.
4. Sweeper cadence (Q4) — hourly `schedules.task` per `billing-grace-period.ts` pattern. See A1.
5. Idempotency model (Q5) — audit-marked `hard_deleted_at` column + partial index `workspaces_sweep_candidates_idx`. See A1.
6. Restore-mid-sweep (Q6) — `WHERE deleted_at IS NOT NULL` + `select … for update skip locked` per-workspace. See A1.
7. Sweeper RPC shape (Q7) — `public.svc_sweep_soft_deleted_workspaces` returns rows; Stripe call is Trigger.dev-side. See A1.
8. Stripe cancel mode (Q8) — immediate (`subscription.cancel(id)`). See A2.
9. In-flight invoices (Q9) — no special handling; Stripe's natural mid-period behavior. See A2.
10. Webhook handling (Q10) — unchanged; existing `customer.subscription.deleted` handler covers both paths. See A2.
11. Failure mode (Q11) — per-workspace error isolation via `last_sweep_*` columns + retry task keyed on `workspace_id`. See A1, A2.

### Pass 2 — Modal-greenfield (Q12–Q17), Context7-grounded

12. Modal account + billing (Q12) — runbook-driven; $50/month workspace budget cap; alerts at $10/$25/$40. See Section B preamble.
13. Deployment + directory (Q13) — `apps/media-worker/` Python package; module-mode deploy; single Modal app `authently-media-worker`. See B1.
14. Python deps (Q14) — `debian_slim(python_version="3.11")` + `.uv_pip_install` + strict `==` pins; HF cache via `modal.Volume`. See B1.
15. Whisper model (Q15, REVISED) — OpenAI Whisper via HuggingFace `transformers` + `@modal.batched`, A10G GPU. NOT faster-whisper. See B1.
16. Cost controls (Q16) — `timeout=30*60`, `max_containers=3`, `scaledown_window=300` declarative; quotas in B4's `ingestion_usage`; Modal $50/mo cap. See B1.
17. Integration shape (Q17) — `@modal.fastapi_endpoint` HTTPS + Trigger.dev `maxDuration: timeout.None`. NOT Modal JS SDK (Beta). See B1, B4.

### Pass 1 continued — non-Modal Section B + conventions (Q18–Q23)

18. yt-dlp host (Q18) — Modal-colocated with Whisper; CPU-only function; same image base. See B2.
19. Trafilatura + pdfplumber location (Q19) — Modal CPU; all Python on Modal. See B3.
20. File upload UI (Q20) — server-component dialog + client-component trigger; Supabase Storage at `ws/{workspace_id}/sources/<id>/`. See B5.
21. Source routing (Q21) — `source_routing.ts` pure-TS classification; Trigger.dev dispatches to right Modal endpoint. See B4.
22. Convention applicability (Q22) — DEFINER + SELECT-only RLS for data tables; server/client split for UI; gate-run hygiene on config; escalation signals + co-author always; Modal mid-sprint check-ins explicit. See Workflow conventions, Section B preamble.
23. Runbook split (Q23) — Modal setup is user-driven runbook drafted by Claude post-spec-lock; A1+A2 ship before B1. See Commit order.

### Sub-decisions (SD1–SD3, Pass 2)

24. Runbook commit placement (SD1) — standalone commit between spec-lock merge and A1. See Commit order.
25. Python AGPL headers (SD2) — yes, full-block style; `check-license-headers.mjs` extends to `.py` in B1. See Guardrails, B1.
26. Python tooling (SD3) — 3.11; `pyproject.toml`; Ruff + Pyright; separate `lint:py` + `typecheck:py` gates. Gate count 5 → 7. See Workflow conventions, Definition of done.

## Build-time confirmations

Unknowns to verify during execution rather than locking at spec-time:

- **Modal account state** (pre-B1): user has executed the
  Modal-setup runbook; `modal token` is configured locally; smoke
  deploy of hello-world function succeeds.
- **Free-tier credit amount** (runbook checkpoint): verify current
  Modal free-tier monthly credit on first dashboard login. The
  $30/month figure cited in `modal.com/docs/examples/mongodb-search`
  may have been refined; the $50/month workspace budget cap absorbs
  variance.
- **Whisper cost-per-minute baseline** (B1 smoke test): establish
  baseline cost on a 30-second test clip; flag if 2x or more off
  prediction.
- **Modal image build time** (B1 first deploy): if >5 minutes,
  cache invalidation is suspect; flag for mid-sprint review.
- **Stripe test-mode cancellation behavior** (A2 verification):
  confirm `subscription.cancel(id)` immediate-mode behavior in test
  mode matches production semantics — no surprise prorations or
  invoice issuance on cancel.
- **`apps/media-worker/CLAUDE.md` necessity** (B1 first commit):
  if the Python conventions in this spec + the Modal docs link feel
  insufficient when actually writing B1 code, surface the gap and
  introduce `apps/media-worker/CLAUDE.md` as a B1-scope addition.
  The spec deliberately does not preempt this file.

## Carryover items NOT in Sprint 05 (for future reference)

Active backlog after Sprint 05 ships. Authoritative entries live in
`SPRINT_04_carryovers.md`; this section is a Sprint-05-shipping summary.

- **#2 Revoke-all-sessions on account delete** — independent; lands
  when a security/compliance trigger surfaces.
- **#4 Hard-delete cleanup of ghost memberships** — promoted by this
  spec to ready-for-S06+. Sprint 05 A1 covers workspaces only;
  extending the sweeper scope to `auth.users` is the S06+ item.
- **#5 user_profiles row-creation strategy reconsider** — independent;
  lands when the next column is added to `user_profiles`.
- **#6 Multi-owner workspace model** — independent; Sprint 06+
  candidate. Build_plan §5.2 amendment recommends Sprint 18
  technical-fit.
- **#7 + #8 Resend domain verification + SMTP cutover** — paired;
  lands in S06 or before S12 launch (whichever comes first).
- **#9 typedRpcWithNullable helper** — defer-until-second-instance.
- **#10 typedInsert helper** — defer-until-second-instance.
- **#11 silentMembershipLookup hoist** — pair with future layout-perf
  work.
- **#12 Cosmetic UX items** — polish-sprint candidate.
- **#13 `public.smoke_test` table drop** — DB cleanup pass candidate.

This list is current as of 2026-05-02 spec-lock; consult
`SPRINT_04_carryovers.md` at execution time for authoritative status.
