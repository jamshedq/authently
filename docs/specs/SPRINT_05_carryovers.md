# Sprint 05 carryover index — deferrals captured during Sprint 05 execution
# Inputs for Sprint 06+ planning. Mirrors SPRINT_04_carryovers.md's
# convention (per-sprint carryover doc, comment-block format,
# grep-friendly, planning-input tone — not user-facing docs).
#
# === Provenance ===
# Sprint 05 commits referenced by entries in this file
# (chore-sprint-05-section-a branch and successors):
#   - <SHA>   feat(jobs): hard-delete sweeper (Sprint 05 A1)
#   - (further SHAs added as Section A and Section B sub-items land)
#
# === Status markers ===
# Items cleared in subsequent sprints retain their entry here for
# historical reference, prefixed with a STATUS line naming the sprint
# + sub-item that cleared them. Items reachable but not yet shipped
# may carry a STATUS line of "ready for SNN+ implementation."
#
# === Entry schema ===
# Each entry uses: (a) what's deferred, (b) why deferred + origin commit,
# (c) approximate scope, (d) dependencies, (e) urgency-tell. Where (e)
# is "no urgency-tell; lands when scheduled," that's stated explicitly
# rather than omitted — keeps the schema uniform across entries and
# prevents future readers from wondering whether the absence means
# "no tell" or "didn't think about it."

# === Sprint 05 origin ===

# 1. apps/jobs test infrastructure setup
#    STATUS: cleared in S05 A2 — vitest spun up alongside Stripe cancel
#       implementation. C1 added vitest.config.ts + root test:jobs gate
#       (lifted gate count 5 → 6); C2 populated the suite with 8 tests
#       covering the cancel-workspace-subscription service. Revisit
#       trigger fired exactly as designed (A2's outbound Stripe API
#       integration was the named candidate).
#    What: spin up vitest in apps/jobs (vitest.config.ts, package.json
#       test script, root-level test:jobs gate, first test file
#       scaffolding). Today apps/jobs has no test infrastructure;
#       trigger task bodies are not unit-tested at the package level.
#    Why deferred: locked at A1 commit-time review. The 19 db tests in
#       packages/db/tests/billing/sweep-soft-deleted-workspaces.test.ts
#       cover the RPC contract surface (perimeter + sweep state machine
#       + finalize cascade + record-error path) comprehensively. Spinning
#       up a separate vitest config + package script + first test
#       scaffolding for ~3 glue tests on the task body itself is the
#       wrong investment ratio at this moment. Task body is essentially
#       orchestration: rpc → service → rpc.
#    Origin: A1 commit <SHA> — see commit body "Web tests for the task
#       wrapper deferred" paragraph.
#    Scope: small-medium. apps/jobs/vitest.config.ts (~30 lines mirroring
#       packages/db); apps/jobs/package.json adds vitest devDep + test
#       script; root package.json adds test:jobs gate (lifts gate count
#       from 5 to 6); apps/jobs/tests/trigger/sweep-soft-deleted-workspaces.test.ts
#       and adjacent tests (~150-300 lines covering the wrapper logic,
#       not the RPCs).
#    Dependencies: independent. No upstream blocker.
#    Revisit trigger: when first apps/jobs sub-item needs unit-level
#       coverage that isn't db-testable. A2's Stripe SDK integration is
#       a candidate — assess at A2 pre-flight (the cancellation function
#       gains real Stripe API call paths that warrant mock-based unit
#       tests). B-section (Modal worker) likely needs its own Python
#       test surface separately, so the apps/jobs/tests/ decision is
#       primarily about TypeScript task wrapper coverage.
#    Urgency-tell: a Trigger.dev task wrapper bug surfaces in production
#       that the db-test suite didn't catch (e.g., supabase-js client
#       error handling, retry logic, summary-shape regression). At that
#       point, building unit tests against the task body becomes
#       meaningfully cheaper than diagnosing in prod.

# 2. Section B (source ingestion) — Modal-based design
#    STATUS: superseded by Sprint 06 OpenAI-based redesign.
#    What: B1-B5 source ingestion suite as originally specced in
#       Sprint 05 against Modal infrastructure — Whisper transcription
#       on A10G GPU via @modal.batched + transformers, yt-dlp /
#       Trafilatura / pdfplumber Python workers, source orchestration
#       in apps/jobs, file upload UI in apps/web. Pass 2 Q12-Q17 locks
#       (Modal-greenfield decisions) and the full B1-B5 sub-item
#       breakdown in SPRINT_05.md preserved as historical reference.
#    Why deferred: pre-execution Modal-setup runbook review surfaced
#       cost concerns ($250/month Team plan unjustified at current
#       stage), which surfaced provider-choice questions (Modal
#       self-hosted Whisper vs OpenAI Whisper API), which surfaced
#       underlying use-case fuzziness about transcription's role in
#       Authently. Resolved same-day via narrowed use case (research
#       workspace + verification, mostly use cases 1 and 4) and
#       provider switch to OpenAI Whisper API.
#    Origin: Sprint 05 mid-execution pivot, 2026-05-04. Runbook
#       (docs/runbooks/modal-setup.md, commit f2025bb) was authored
#       in Sprint 05 spec-lock; amendment marking it deferred-and-
#       superseded lands in the same closure commit as this entry.
#    Scope: All of B1-B5 in original Modal-based form. Sprint 06
#       redesign reshapes scope significantly — synchronous in
#       apps/web, OpenAI Whisper API, short-audio-only initial.
#    Dependencies: Sprint 06 redesign supersedes. No further work
#       against the Modal-based design unless Sprint 06's approach
#       fails its own validation criteria and forces a revival.
#    Revisit trigger: already fired — Sprint 06 spec-lock revives
#       Section B with the redesigned OpenAI-based approach. This
#       entry is historical reference only; future revivals to
#       Modal-based design (e.g., OpenAI Whisper proves unsuitable;
#       cost graduation makes self-hosted Modal economically viable
#       at scale) would consult both this entry and the preserved
#       SPRINT_05.md Section B detail.
#    Urgency-tell: N/A (resolved).
#    Drift findings (attempted Sprint 05 execution): modal CLI
#       PATH resolution issue in non-interactive shells. See runbook
#       status callout. Not fixed; recorded for future revival
#       reference.
