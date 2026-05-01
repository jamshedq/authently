# Sprint 03 carryover index — grep output of "Sprint 03" mentions in SPRINT_02.md
# Each line: LINE_NUM:CONTENT — jump to docs/retrospectives/SPRINT_02.md:N for context
# Used as input when planning the actual Sprint 03 spec.

5:Sprint 03 lives at `docs/specs/SPRINT_03_carryovers.md`.
9:tech debt in Sprint 03 or for Sprint 12 launch prep.
13:- **[CARRYOVER]** — deferred to Sprint 03 (carried in `SPRINT_03_carryovers.md`)
41:**When:** late Sprint 02 (after Section C/D land) or early Sprint 03's front-loaded tech debt block — same time slot used in S02 prep.
51:1. Add a `last_active_at timestamptz not null default now()` column to `workspace_members` in a Sprint 03 migration.
55:**When:** Sprint 03 — pairs naturally with the workspace deletion + ownership transfer work in the same sprint, since both touch `workspace_members`.
71:**When:** Sprint 03 polish item, alongside the supabase-js typed-helper consolidation. Same code-path, similar shape of refactor.
97:**When:** Sprint 03's first cleanup commit, alongside the supabase-js typing consolidation. Sprint 02 nearly tripled the local-test surface (39 RLS + 37 billing + 3 auth + 35 web = 114 tests across 4 suites); Sprint 03 will add more (workspace deletion + ownership transfer + invitation enhancements), so the CI-runtime concern is now closer to actionable than originally estimated.
320:Future API routes (D-other-routes, Sprint 03+) reuse this harness. The
473:**Sprint 03 follow-up [CARRYOVER]:** Strengthen `process_stripe_event`
482:consolidation in Sprint 03's first cleanup commit.
