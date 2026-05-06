# Sprint 07 carryover index — deferrals captured during Sprint 07 spec-lock
# Inputs for Sprint 08+ planning. Mirrors SPRINT_06_carryovers.md's
# convention (per-sprint carryover doc, comment-block format,
# grep-friendly, planning-input tone — not user-facing docs).
#
# === Provenance ===
# Sprint 07 commits referenced by entries in this file:
#   - <SHA>   docs(specs): lock Sprint 07 spec (this commit)
#   - (further SHAs added as Sprint 07 sub-items land)
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

# === Sprint 07 origin ===

# 1. Section B sub-items B2, B4 (Sprint 08 scope)
#    STATUS: deferred to Sprint 08 by Sprint 07 spec-lock; two-sprint
#       vertical-slice continuation strategy.
#    What: B2 (YouTube ingestion via yt-dlp), B4 (source orchestration
#       tying B1/B2/B3 together for multi-source-type routing).
#    Why deferred: Sprint 07 vertical-slice discipline. Three new
#       source types in one sprint (URL + PDF + YouTube) plus the
#       sources management surface (list + polling + delete) plus
#       Python tooling baseline plus B4 orchestration would have
#       been the 5-sub-item shape that Sprint 05 deferred mid-flight
#       and Sprint 06 explicitly avoided via the D5b two-sprint split.
#       Sprint 07 ships breadth-validation (URL/PDF) + management
#       surface; Sprint 08 finishes breadth (YouTube) + adds
#       orchestration once three source types are in production.
#    Origin: Sprint 07 spec-lock, 2026-05-05. Original Sprint 06
#       spec forward-referenced this split (SPRINT_06.md "Forward-
#       references to Sprint 07" mentioned B2/B3/B4 as a unit; Sprint 07
#       spec narrows to B3 only and pushes B2/B4).
#    Scope: B2 = YouTube transcript ingestion via yt-dlp; reuses
#       Sprint 07's Python build extension + python-runner.ts shared
#       subprocess wrapper. B4 = unified source-creation surface that
#       collapses the parallel api_create_source_* wrappers into a
#       single dispatch entry. Approximate per-sub-item size to be
#       locked at Sprint 08 pre-flight.
#    Dependencies: Sprint 07 B3 ships and validates; Python build
#       extension (D3 lock from Sprint 06) lands cleanly in Sprint 07
#       commit 2; yt-dlp pinning + brittleness mitigation is locked
#       at Sprint 08 pre-flight.
#    Revisit trigger: Sprint 07 ships clean and B3 + sources list page
#       run cleanly with first users. Sprint 08 spec-lock cycle begins
#       at that point. yt-dlp brittleness (SPRINT_06_carryovers.md
#       entry #2) is the inherited operational concern Sprint 08
#       addresses explicitly.
#    Urgency-tell: low — Sprint 08 is the planned continuation, not
#       a contingent revival. A use-case validation finding from
#       Sprint 07 that reveals YouTube ingestion demand is more urgent
#       than expected would re-prioritize Sprint 08 internal ordering
#       (B2 first, then B4) but not change the sprint scope.

# 2. Orphaned 'processing' row sweeper
#    STATUS: deferred from Sprint 07 vertical slice; explicit accept-
#       the-orphan-possibility lock per E6d.
#    What: Background task (Trigger.dev scheduled or apps/jobs cron)
#       that scans for sources rows stuck in `status = 'processing'`
#       past a threshold (e.g. 24h since `created_at`) and either
#       transitions them to `status = 'failed'` with a `transient:`
#       error or hard-deletes them. Orphans happen when a Trigger.dev
#       task crashes after creating the row but before calling
#       `svc_update_source_status`, or when the Python subprocess
#       hangs past the configured timeout without surfacing back to
#       the task wrapper.
#    Why deferred: E6d lock at Sprint 07 design time. Without
#       production traffic, the orphan rate is hypothetical — the
#       sweeper would be optimization for a problem that may not
#       exist at meaningful scale. Bootstrap-friendly bias: ship
#       without the sweeper, observe orphan rate in production,
#       build the sweeper if (and only if) the rate is user-visible.
#    Origin: Sprint 07 spec-lock, 2026-05-05.
#    Scope: small. One Trigger.dev scheduled task or apps/jobs
#       cron + one DB function (`svc_sweep_orphan_sources` or
#       similar) + perimeter test + integration test. Pattern
#       parallels Sprint 04's `cancel-workspace-subscription`
#       scheduled task and Sprint 04's `svc_find_workspaces_past_due_grace_expired`
#       sweeper.
#    Dependencies: independent. Sprint 07 ships + accumulates
#       enough production data for orphan rate to be measurable.
#    Revisit trigger: orphan rate becomes user-visible — e.g., a
#       user reports a row stuck in `'processing'` for hours; or
#       a workspace has multiple visible orphans; or operational
#       monitoring (when added) shows orphan-row count crossing a
#       threshold. Until that signal fires, the cost of building
#       the sweeper exceeds the cost of accepting orphans.
#    Urgency-tell: support tickets / direct user feedback about
#       stuck rows, OR the appearance of orphan rows in the
#       sources-list UI for first users that would degrade the
#       perceived reliability of the sources surface.
#
#    --- [E6d-Storage addendum, added 2026-05-06 with C2b.1] ---
#    Storage object orphans — distinct from the DB-row orphans above.
#
#    What: PDF uploads (Sprint 07 pre-flight Item 3 — Supabase Storage
#       signed URL at `ws/{workspace_id}/{source_id}.pdf` in the
#       `sources-pdf` bucket) create Storage objects via the apps/web
#       action layer (lands in C2b.2). Storage orphans surface when
#       (a) extraction fails or the task crashes after upload;
#       (b) the row is created but the user abandons the upload
#       mid-flight; (c) other upload-without-row races. URL extraction
#       has no Storage footprint, so Storage orphans are a
#       pdf_extraction-only concern.
#
#       api_delete_source soft-delete (C2b.1) does NOT cascade to
#       Storage cleanup — soft-deleted rows logically still exist and
#       keep their Storage object alongside them. Storage orphans only
#       surface from failed extractions or upload-without-row races,
#       not from user-initiated deletes.
#    Why deferred: same E6d reasoning as the DB-row sweeper above —
#       without production traffic, the orphan rate is hypothetical.
#       Bootstrap-friendly bias: ship without, observe in production
#       (bucket size, cost/quota), build the sweeper if the rate is
#       meaningful.
#    Origin: Sprint 07 C2b.1 commit, 2026-05-06. The C2b.1 RPCs are
#       the structural entry point where Storage object creation
#       becomes possible (via C2b.2's apps/web action layer that uses
#       api_create_source_pdf and then uploads PDF bytes to the
#       deterministic path). Addendum lands inline with C2b.1 because
#       that's the commit where the orphan class is introduced — the
#       doc artifact lives next to the RPCs that create the possibility.
#    Scope: small. One Trigger.dev scheduled task or apps/jobs cron
#       that lists the `sources-pdf` Storage bucket and deletes objects
#       whose corresponding source row is missing, soft-deleted, or in
#       `'failed'` status past a threshold. Pattern parallels the DB-row
#       sweeper above.
#    Dependencies: Sprint 07 C2b.2 ships (apps/web action layer that
#       creates Storage objects) + production data to make orphan rate
#       measurable.
#    Tooling gap (load-bearing for the trigger to actually fire):
#       there is no existing mechanism that surfaces "this Storage
#       object has no corresponding active source row." Supabase Studio
#       shows aggregate bucket size; Stripe shows aggregate costs at
#       the billing boundary; neither surfaces orphan-vs-active counts.
#       Building orphan-detection tooling (a list-bucket-and-join-by-
#       source_id query, or a cron that emits a metric) is itself a
#       future-sprint concern not in scope for any current sprint.
#       **Until that tooling exists, Storage orphans accrue silently
#       and are accepted.** The sweeper described above is feasible
#       only after the orphan-detection tooling lands.
#    Revisit trigger: passive observation only, until tooling exists.
#       Bucket size growing disproportionately to active row count
#       (visible at Supabase Studio's storage view as a coarse signal),
#       OR Storage cost trending up at the Stripe billing boundary,
#       OR direct user feedback about bucket usage. None of these fire
#       at low scale — early-stage orphans are not detectable. When the
#       trigger is "fire if cost matters," the trigger may not fire
#       until cost has materially mattered. Acknowledged.
#    Urgency-tell: Supabase Storage usage analytics OR billing cost
#       trend, with the caveat above. If the `sources-pdf` bucket grows
#       disproportionately to active pdf_extraction row count once
#       observability lands (when, not if — orphan-detection tooling
#       is owed), Storage cleanup is the cheapest remediation.

# 3. Card grid view for sources list page
#    STATUS: deferred from Sprint 07 list page; E5 lock — compact
#       list only.
#    What: Alternative card-based grid layout for the sources list
#       page. Each card shows title, type icon, status badge, and
#       a content preview (first N chars of `content`). User toggles
#       between compact list view and card grid view via a control
#       in the page header.
#    Why deferred: E5 lock at Sprint 07 design time. Compact list is
#       sufficient for low source counts (Sprint 07's expected user
#       state — first weeks post-launch) and exposes more rows
#       per screen than a card grid. Card view becomes valuable
#       once content previews are useful for orientation, which
#       requires content extraction quality + a meaningful corpus
#       to scan. Without those, a card grid is decorative.
#    Origin: Sprint 07 spec-lock, 2026-05-05.
#    Scope: small-medium. Adds a view toggle + card component +
#       content-preview truncation logic + per-card delete UX (or
#       reuses the row-level delete confirmation modal). Card
#       layout: tile grid with responsive breakpoints, ~3-4 cards
#       per row at desktop width.
#    Dependencies: independent of breadth (B2/B4) work; depends only
#       on Sprint 07 list page shipping. Reusable across all source
#       types.
#    Revisit trigger: source counts grow such that compact list
#       feels dense (probable threshold: 50+ sources per workspace),
#       OR direct user feedback that visual orientation is hard
#       in the list view, OR design-system push for a more visual
#       sources surface.
#    Urgency-tell: source-count distribution analytics (when
#       observability lands) — if median user crosses ~30 sources,
#       compact list density becomes a UX problem.

# 4. Filter controls for sources list page
#    STATUS: deferred from Sprint 07 list page; E5 lock.
#    What: Filter controls in the page header — by type
#       (audio_transcript / url_extraction / pdf_extraction /
#       eventually youtube_transcript), by status (processing / ready
#       / failed), by date range. Multi-select within a filter type;
#       AND across filter types.
#    Why deferred: E5 lock. Same compactness reasoning as the card
#       grid (entry #3) — at low source counts, sort by created_at
#       DESC is sufficient orientation. Filter UX is an investment
#       that pays off as source counts grow.
#    Origin: Sprint 07 spec-lock, 2026-05-05.
#    Scope: medium. Adds filter component (multi-select pills or
#       similar) + URL-param persistence (filter state survives
#       page reload + sharable URLs) + service-layer query filter
#       parameters (extends listSources signature). Server-side
#       filtering preferred over client-side once row counts grow.
#    Dependencies: source-count growth or direct user request. The
#       service module (`list-sources.ts`) shipped in Sprint 07
#       already accepts a workspaceId; extending to accept a filter
#       parameter object is additive.
#    Revisit trigger: source counts grow (probable threshold: 50+
#       sources per workspace), OR direct user feedback that "I
#       can't find the source I'm looking for" / "I want to see only
#       failed extractions to clean them up."
#    Urgency-tell: same as entry #3 — source-count distribution +
#       direct user feedback.

# 5. Pagination for sources list page
#    STATUS: deferred from Sprint 07 list page; E5 lock.
#    What: Pagination controls (page-numbered or cursor-based) at
#       the bottom of the sources list. Default page size 25 or 50
#       rows; user navigates between pages.
#    Why deferred: E5 lock. Sprint 07 ships unpaginated — the entire
#       sources query loads. At low source counts, this is fine; at
#       hundreds-plus rows, it becomes a perceptible page-load delay
#       and a memory/render cost on the client.
#    Origin: Sprint 07 spec-lock, 2026-05-05.
#    Scope: medium. Cursor-based pagination preferred over offset-
#       based at scale (sources table is append-mostly with soft-
#       delete; cursor on `(created_at DESC, id DESC)` is stable).
#       Service layer extends to accept cursor + limit; client
#       updates URL on page change.
#    Dependencies: source-count growth. Polling implementation
#       (E2 lock — `setInterval` driving `router.refresh()`) needs
#       to handle paginated state correctly: refresh should not
#       jump back to page 1 if the user has navigated.
#    Revisit trigger: a workspace crosses ~100 sources and page-load
#       performance degrades, OR direct performance complaint.
#    Urgency-tell: page-load timing analytics on the sources list
#       route. If p95 list-page render time crosses ~500ms,
#       pagination is the cheapest mitigation.

# 6. Sort controls for sources list page
#    STATUS: deferred from Sprint 07 list page; E5 lock.
#    What: User-facing sort controls — toggle column header to sort
#       by title (alpha), type, status, created_at. Asc/desc.
#       Persistent in URL params alongside filter state.
#    Why deferred: E5 lock. Sprint 07 ships sort = `created_at DESC`
#       only. At low source counts, recency-first is the correct
#       default for nearly every workflow. Other sorts become
#       valuable as users develop persistent organizational
#       behaviors against the sources corpus.
#    Origin: Sprint 07 spec-lock, 2026-05-05.
#    Scope: small. Service layer extends to accept sortBy +
#       sortDirection; UI adds clickable column headers. Couples
#       cleanly with filter (entry #4) and pagination (entry #5).
#    Dependencies: filter / pagination shipping is not strictly
#       required but the URL-param state machine is shared across
#       all three; landing them together is cheaper than three
#       separate revisits.
#    Revisit trigger: same as filter (entry #4) — source-count
#       growth + user feedback.
#    Urgency-tell: low — sort-by-other-columns is the lowest-value
#       of the deferred list-page features. Most users will not
#       miss it until filter and pagination are also missing.

# 7. Retry mechanism for failed extractions
#    STATUS: deferred per E6a — delete-and-resubmit is the canonical
#       Sprint 07 pattern.
#    What: A "Retry" button on failed rows in the sources list. On
#       click, the existing row's status flips back to `'processing'`
#       and a new Trigger.dev task is dispatched against the same
#       source (URL or PDF). Optionally with backoff / max-retry
#       count to prevent infinite loops on permanently-failing URLs.
#    Why deferred: E6a lock at Sprint 07 design time. Delete-and-
#       resubmit is functionally equivalent for the user (delete
#       failed row, paste URL again into upload tab, get a new row)
#       and avoids the state-machine complexity of in-place retry
#       (idempotency, race against the original task if it eventually
#       returns, retry-count bookkeeping). Bootstrap-friendly bias:
#       simplest pattern that gives users an out, validate friction,
#       expand only if friction is real.
#    Origin: Sprint 07 spec-lock, 2026-05-05.
#    Scope: medium. New API RPC (`api_retry_source` or similar) +
#       state-machine validation (only `'failed'` rows can retry) +
#       UI button + retry-count column on sources table (or
#       implicit via task-history; lock at retry implementation
#       time). Plus Trigger.dev idempotency handling for the
#       common case of "user clicks retry, original task is still
#       in flight."
#    Dependencies: independent of breadth (B2/B4). Depends on
#       Sprint 07 list page shipping. Reusable across all async
#       source types.
#    Revisit trigger: direct user feedback that delete-and-
#       resubmit is friction-heavy, OR a use-case where preserving
#       the original `created_at` matters (e.g., in a research
#       timeline where source insertion order is meaningful and
#       resubmitting moves the row to the top).
#    Urgency-tell: user feedback on the failed-row UX. If users
#       describe "I couldn't get my source in" as a multi-step
#       irritation, retry button is the cheapest remedy.

# 8. Title backfill for Sprint 06 audio_transcript rows
#    STATUS: accepted state — no backfill in Sprint 07 or beyond.
#    What: Sprint 06 B5 did not capture filenames at upload time;
#       audio_transcript rows landed with `title` (now NULL after
#       Sprint 07's schema additions). The list page renders these
#       rows with the "Untitled" fallback per E5.
#    Why deferred (and accepted): no path to recover the original
#       filenames — they were never persisted. The user could
#       theoretically re-upload to recapture filenames, but for
#       existing personal-use rows the cost (re-transcribe + pay
#       OpenAI again) outweighs the benefit. "Untitled" is a
#       discoverable signal that the row predates Sprint 07's
#       title-capturing flow; users who want titles can re-upload
#       (delete + re-add).
#    Origin: Sprint 07 spec-lock, 2026-05-05. Locked as accepted-
#       state during E5 prose drafting.
#    Scope: N/A (no backfill).
#    Dependencies: N/A.
#    Revisit trigger: none. This is not a deferred-and-revisit-able
#       item; it's an accepted historical state. If this entry
#       gets revisited it'd be in the context of "should we add
#       a `name` text input to the audio tab so future rows
#       capture user-provided names independently of filenames"
#       — that's a separate question and would warrant its own
#       carryover entry at the time it surfaces.
#    Urgency-tell: none — accepted state.

# 9. Source detail page
#    STATUS: deferred per Sprint 07 (B) lock — rows in the sources
#       list are non-interactive in Sprint 07.
#    What: A page route at
#       `apps/web/src/app/app/[workspaceSlug]/sources/[sourceId]/page.tsx`
#       (or similar) that renders a single source's full content
#       — title, type, source_url (if URL extraction), full content
#       text (not truncated), error if failed, created_at. Read-only
#       in initial form; edit/annotate UX is its own future scope.
#    Why deferred: Sprint 07 (B) lock at spec-lock time. The list
#       page renders title + type + status + created_at — sufficient
#       for the current use cases (find your sources, see what's
#       processing, delete failed ones). Viewing full content is a
#       distinct workflow (read / verify / quote-from), and the
#       value of that workflow depends on what the user actually
#       does with sources downstream — likely candidate: B4
#       orchestration in Sprint 08 referencing source content in
#       the UI (e.g., "use this source as input for a remix"),
#       at which point the detail page becomes the natural target
#       for "let me see the source first" navigation.
#    Origin: Sprint 07 spec-lock, 2026-05-05. Surfaced during
#       drafting concerns (B); user locked the deferral.
#    Scope: small-medium. New dynamic route +
#       `requireMembership` + service-layer single-source fetch
#       (extends `list-sources.ts` or new `get-source.ts`) +
#       rendering. Read-only initial scope; edit + annotate are
#       separate sprints.
#    Dependencies: independent. Could ship in Sprint 08 alongside
#       B4 if that's when the consumer surfaces, or in a dedicated
#       polish sprint at any point.
#    Revisit trigger: a concrete user need for viewing extracted
#       content emerges. Likely candidate: B4 orchestration in
#       Sprint 08 referencing source content in the UI (e.g., a
#       "select source" picker that previews content). Could also
#       fire earlier if first-user feedback says "I want to read
#       what got extracted before I trust it."
#    Urgency-tell: B4 design surface in Sprint 08 — if any B4 UI
#       references source content, the detail page is the natural
#       target. Or first-user feedback on the sources list flow.
