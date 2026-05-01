# Sprint 03 spec — Source ingestion + cleanup

**Status:** Locked 2026-05-01.

**Build-plan reference:** `docs/specs/build_plan.md` S03 line — *"Source ingestion: yt-dlp worker, Whisper, Trafilatura, pdfplumber, file upload UI"*.

**Carryover routing:** `docs/specs/SPRINT_03_carryovers.md` — Sprint 02's [CARRYOVER]
items map to Section A below. Items that earlier planning placed in Sprint 03
but conflict with the build plan's source-ingestion theme (workspace
deletion, ownership transfer, account deletion, Resend domain verification,
cosmetic UX) are routed to Sprint 04+ and remain `[DEFERRED]` in the
carryover index.

**Sprint shape:** Two sections, two PRs.

1. **Section A — cleanup commit.** PR #1: `chore-sprint-03-cleanup`. Five
   refactor / migration items batched into one squashable PR. Ships first.
2. **Section B — source ingestion (build_plan.md S03).** PR #2 (and
   possibly #3 if scope splits). Branch `section-3-source-ingestion`.
   Detailed planning happens after Section A merges; the high-level shape
   below points at the build plan and lists known unknowns.

---

## Section A — cleanup commit (PR: `chore-sprint-03-cleanup`)

Five items, each one logical commit on the same branch. Ships as one PR.
Total estimated diff: ~600–900 lines including tests; no UX surface change.
All 7 local gates must pass at every commit.

**Sequence:** A3 → A4 → A1 → A2 → A5.

### A3 — supabase-js typing helpers

**Why:** SPRINT_02.md retro [CARRYOVER]. Four current sites with the same
`as never` workaround pattern. Centralize so the workaround stops repeating.

**What:**
- `apps/web/src/lib/supabase/typed-rpc.ts` — `typedRpc(client, fnName, args)`
  returning a properly-typed `PostgrestResponse`. Replaces `as never` casts.
- `apps/web/src/lib/supabase/typed-update.ts` — `Database`-aware `.update()`
  wrapper for tables whose Update type collapses to `never` under
  `exactOptionalPropertyTypes`.

**Migrate the four current call sites:**
- `apps/web/src/services/workspaces/ensure-primary-workspace.ts`
- `apps/web/src/services/workspaces/create-workspace.ts`
- `apps/web/src/services/workspaces/update-workspace.ts`
- `apps/web/src/services/billing/create-checkout-session.ts`

**Sequencing reason:** Land first so the new RPC call sites in A1 use the
helpers from day one (no sixth `as never` to clean up later).

### A4 — Header double-`getUser` refactor

**Why:** SPRINT_02.md retro [CARRYOVER]. Two JWT-validation round-trips on
every signed-in page render (~10ms cold-render cost saved).

**What:** Refactor `getCurrentUserWithMemberships(supabase)` to accept an
optional pre-fetched `User`:
```ts
getCurrentUserWithMemberships(supabase, prefetchedUser?: User)
```
Update `apps/web/src/components/header.tsx` to pass through its
already-fetched user. Other call sites (`/api/me/route.ts`, etc.) keep
the no-arg ergonomics.

### A1 — `last_active_at` column on `workspace_members`

**Why:** SPRINT_02.md retro [CARRYOVER]. `memberships[0]` fallback in
`/app/page.tsx` and the user-menu switcher both relied on RLS-default
ordering. Spec called for "most-recently-active."

**What:**
- New migration `<ts>_workspace_members_last_active_at.sql` adding
  `last_active_at timestamptz not null default now()`.
- New SECURITY DEFINER function pair:
  - `private.touch_workspace_member_activity_impl(_workspace_id uuid)` — worker
  - `public.api_touch_workspace_member_activity(_workspace_id uuid)` —
    user-callable wrapper, runs `auth.uid()` inside, dispatches to worker.
    Granted to `authenticated`. Pattern matches Sprint 01/02 `api_*` convention.
- **Debounce** the activity bump per the user's review note:
  ```sql
  update public.workspace_members
    set last_active_at = now()
    where workspace_id = _workspace_id
      and user_id = auth.uid()
      and last_active_at < now() - interval '60 seconds';
  ```
  Prevents rapid intra-workspace navigation from generating constant DB writes.
- Wire `apps/web/src/app/app/[workspaceSlug]/layout.tsx` to call the RPC
  alongside the existing `LAST_WORKSPACE_COOKIE` set.
- Sort `getCurrentUserWithMemberships` results by `last_active_at desc`.

**Backfill:** none. Default `now()` on existing rows is correct.

**Tests (new in `packages/db/tests/rls/last-active-at.test.ts`):**
- Authenticated user can call `api_touch_workspace_member_activity` for their
  own membership; updates `last_active_at`.
- Non-member cannot call it (security perimeter test).
- Debounce: second call within 60 seconds is a no-op (RPC returns successfully
  but `last_active_at` is unchanged).

### A2 — monotonic forward-only `period_end` predicate

**Why:** SPRINT_02.md retro [CARRYOVER]. Strictly stronger guarantee than
the null-vs-populated `coalesce` shipped in commit `e950949`. Defends
against same-subscription out-of-order webhook delivery with different
`period_end` values.

**What:** New migration
`<ts>_billing_period_end_monotonic.sql` recreates
`private.process_stripe_event_impl` with a forward-only predicate on the
**one UPDATE** that needs it: the `customer.subscription.updated` branch.

Verified during A2 pre-flight that only three branches actually touch
`subscription_current_period_end`, and only one of those benefits from
the forward-only predicate:
- `checkout.session.completed` — keeps the existing
  `coalesce(_current_period_end, subscription_current_period_end)` from
  commit `e950949`. Adding the WHERE-clause predicate would skip the
  entire UPDATE when `_current_period_end` is null (always for checkout
  sessions), un-fixing the race.
- `customer.subscription.deleted` — intentionally clears period_end to
  null on cancellation. The predicate would prevent the UPDATE from
  firing.
- `customer.subscription.updated` — the actual case at risk. Out-of-order
  delivery from Stripe (snapshot semantics, where each event carries the
  full subscription state) could otherwise overwrite a newer period_end
  with an older one.

```sql
update public.workspaces
  set stripe_subscription_id = _subscription_id,
      plan_tier = mapped_tier,
      subscription_current_period_end = _current_period_end
  where id = resolved_workspace_id
    and (stripe_subscription_id = _subscription_id
         or stripe_subscription_id is null)
    -- Forward-only predicate (A2):
    and (subscription_current_period_end is null
         or subscription_current_period_end < _current_period_end);
```

**Outcome semantics:** when the predicate fails and the UPDATE finds
0 rows, the function returns `subscription_mismatch` — broadened from
strictly "subscription_id mismatch" to also cover "stale period_end
replay." The TS-side `VALID_OUTCOMES` set is unchanged; ops disambiguates
via the SQL warning message which now reads
`subscription_mismatch_or_stale_period_end` and includes the incoming
period_end.

**Tests (new file `packages/db/tests/billing/period-end-monotonic.test.ts`):**
- `subscription.updated` arrives twice in reverse order (newer date first,
  older date second) → workspace ends with newer date.
- `subscription.updated` arrives twice with the same date → second is a
  no-op (idempotent on retry).

### A5 — RLS test parallelization

**Why:** SPRINT_02.md retro [CARRYOVER]. Sprint 02 nearly tripled the
local test surface (114 tests across 4 suites). Sprint 03 source ingestion
will add more.

**Approach:** Vitest projects feature (`--project` flag). Single Supabase
fixture, single setup cost, parallel test execution. If unexpected
interactions surface, fall back to fast/slow split per the retro entry.

**Verification:** Compare CI runtime before/after; document the delta in
the commit message.

### A6 — Restore `build_plan_v2.docx` as `docs/specs/build_plan.md`

**Why:** Doc was removed from the repo in commit `176a7fc` ("internal
planning doc, not OSS-appropriate"). Removal caused planning friction —
Sprint 03 planning had to extract it from git history. Markdown form is
diffable, searchable, and PR-reviewable; the AGPL/internal concern doesn't
apply (planning doc, not user-facing code).

**What:** `docs/specs/build_plan.md` (29 KB, 371 lines, converted via
custom XML→markdown extractor). Provenance comment at the top notes the
source baseline (initial commit `0acd0c4`, validated April 2026).

**Already done in this branch's working tree** (alongside the
`SPRINT_03_carryovers.md` and this `SPRINT_CURRENT.md` updates). Will
land as the final commit of `chore-sprint-03-cleanup`.

### Section A PR sequence

```
chore-sprint-03-cleanup
├─ commit 1: A3 — supabase-js typing helpers + migrate 4 call sites
├─ commit 2: A4 — Header double-getUser refactor
├─ commit 3: A1 — last_active_at column + debounced bump-on-visit + sort
├─ commit 4: A2 — monotonic period_end predicate + tests
├─ commit 5: A5 — RLS test parallelization (vitest projects)
└─ commit 6: A6 — restore build_plan.md + lock Sprint 03 spec
```

**Manual smoke after merge:** verify (1) workspace switcher shows recently-
visited workspace first after navigating to a different workspace, (2)
Stripe subscription.updated webhook out-of-order replay test (forge two
events with different period_ends, replay reverse order, verify final
state).

---

## Section B — source ingestion (build_plan.md S03)

**Status:** High-level only. Detailed spec written after Section A merges.

**Build-plan source:** `docs/specs/build_plan.md` line 216:
> *"S03 / 5–6 / P1 / Source ingestion: yt-dlp worker, Whisper, Trafilatura,
> pdfplumber, file upload UI"*

**Five components:**

1. **yt-dlp worker** — Modal-hosted Python worker that takes a video URL
   (YouTube + general video URLs) and returns audio + metadata + thumbnails.
2. **Whisper transcription** — audio → text. Modal-hosted (per
   build_plan.md §9 "Heavy workers: Modal for FFmpeg, Whisper, yt-dlp,
   video assembly").
3. **Trafilatura** — Python library for URL → article text extraction.
   Modal worker or server-side (lighter than the others; could colocate).
4. **pdfplumber** — Python library for PDF → text extraction. Same
   colocation question as Trafilatura.
5. **File upload UI** — user-facing surface in `apps/web` for uploading
   audio / video / PDF / pasting URLs. Stores results in S3 with
   `ws/{workspace_id}/sources/<id>/` namespacing per CLAUDE.md rule 5.

**Open architectural questions for the post-merge planning cycle:**

- Single Modal app handling all four (yt-dlp + Whisper + Trafilatura +
  pdfplumber) vs. four separate apps? Build plan mentions "Modal for
  FFmpeg, Whisper, yt-dlp, video assembly" but lumps them into one
  "Heavy workers" category.
- Per-source state machine: where does ingestion status live (new table
  `sources`? extend an existing one?), and what are the states (queued →
  fetching → transcribing → complete / failed)?
- Tenant-scoped `defineTenantTask` wraps which boundaries? The Modal
  call is third-party; the Trigger.dev orchestration is ours.
- API surface: REST endpoints to kick off + poll? Webhook callbacks
  from Modal? Both?
- Quotas: free-tier vs Solo vs Studio source-ingestion limits (build plan
  doesn't specify; tied to Sprint 12 pricing-tier finalization).
- Retention: how long do we keep raw audio after transcription? Costs vs
  re-fetch ergonomics.
- Voice-profile foundation hook: build plan S04 says voice fingerprint
  extraction; S03's pdfplumber + Trafilatura + Whisper outputs feed
  that. Plan the data shape so S04 doesn't need a re-architecture.

These get answered in the Section B planning cycle (post-merge), in the
same Spec → Confirm → Build → Verify pattern as Sprint 02.

---

## Definition of done — Sprint 03

### Section A
- [ ] All 5 cleanup items shipped in `chore-sprint-03-cleanup` PR
- [ ] All 7 local gates pass at every commit
- [ ] CI runtime delta from A5 documented in commit message
- [ ] `build_plan.md` restored alongside SPRINT_CURRENT.md + SPRINT_03_carryovers.md
- [ ] Workspace-switcher recently-visited ordering verified manually

### Section B (planned post-merge; placeholder)
- [ ] yt-dlp worker functional on Modal; ingests YouTube + general video URLs
- [ ] Whisper transcription functional; outputs SRT + plain-text
- [ ] Trafilatura URL → article-text extraction functional
- [ ] pdfplumber PDF → text extraction functional
- [ ] File upload UI accepts audio / video / PDF / URL; per-source status visible
- [ ] All sources stored in S3 with `ws/{workspace_id}/sources/<id>/` namespacing
- [ ] RLS tests cover source-ingestion tables
- [ ] Manual smoke: end-to-end YouTube URL → transcript visible in UI
