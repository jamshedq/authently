# Sprint 03 carryover index — grep output of "Sprint 03" mentions in SPRINT_02.md
# Each line: LINE_NUM:CONTENT — jump to docs/retrospectives/SPRINT_02.md:N for context
# Used as input when planning the actual Sprint 03 spec.
#
# === Sprint 03 routing decision (2026-05-01) ===
# Sprint 03's PRIMARY scope is source ingestion per docs/specs/build_plan.md S03
# (yt-dlp worker + Whisper + Trafilatura + pdfplumber + file upload UI).
#
# Items below carry into Sprint 03 ONLY as the cleanup commit:
#   - supabase-js type-inference workarounds (4 sites)
#   - Header double-getUser refactor
#   - last_active_at column on workspace_members
#   - monotonic forward-only period_end predicate
#   - RLS test parallelization
#
# Items that earlier planning placed in Sprint 03 but ARE NOT Sprint 03 scope —
# routed to Sprint 04+ (these came from SPRINT_02.md "Out of scope", not from
# build_plan.md, and conflict with the build plan's S03 source-ingestion theme):
#   - Workspace deletion (soft-delete + cascade) → Sprint 04+
#   - Ownership transfer flow → Sprint 04+
#   - Account deletion (GDPR scope) → Sprint 04+
#   - Resend domain verification + DNS records → Sprint 04+ (continues using
#     onboarding@resend.dev meanwhile)
#   - Cosmetic UX items (duplicate /invite header, "Wrong Account" CTA) → Sprint 04+
#
# Sprint 12 launch-prep items remain [DEFERRED] in SPRINT_02.md (real support
# email, README Self-hosting section, real wordmark, real pricing decisions).
#
# === Sprint 04+ tech-debt routed by A3-followup (2026-05-01) ===
# Surfaced when grepping `as never` after A3 landed. NOT fixed by typedRpc /
# typedUpdate; require their own follow-ups:
#
# 1. supabase-gen-types nullability gap on RPC arg types
#    Site: apps/web/src/services/webhooks/stripe/handle-event.ts:99
#    Bug: `supabase gen types` strips nullability from RPC argument types.
#    The webhook handler legitimately passes `null` for fields an event type
#    doesn't carry (e.g. invoice events have no current_period_end), but the
#    generated Args type marks every field as non-null. Cast with `as never`
#    to bypass.
#    Fix options: (a) upstream fix in `supabase gen types`; or (b) a
#    `typedRpcWithNullable` helper that accepts `Partial<FnArgs<T>>` /
#    relaxes the args type. Sprint 04+ when there's a second case to
#    motivate the helper.
#
# 2. typedInsert helper for .insert({...} as never) cases
#    Site: apps/web/src/services/invitations/create-invitation.ts:76
#    Bug: bytea binary insertion uses the wire-protocol shape `\x<hex>`
#    string, which doesn't match the generated Insert type for
#    `workspace_invitations.token_hash`. Cast bypasses the type error.
#    Fix: a `typedInsert<T extends TableName>(client, table, body)` helper
#    paralleling typedUpdate. Defer until a second binary-insert site exists.
#
# 3. Hoist silentMembershipLookup to workspace layout, pass to PastDueBanner via props
#    Site: apps/web/src/app/app/[workspaceSlug]/layout.tsx
#    After Sprint 03 A1 added the activity-bump (slug → workspace_id resolve
#    + RPC call), the workspace layout now does overlapping DB work with
#    PastDueBanner: the layout's slug → workspace_id SELECT and
#    PastDueBanner's silentMembershipLookup() both fetch the same
#    workspace + membership. Hoisting silentMembershipLookup to the layout
#    and passing the membership context to PastDueBanner via props would
#    save 2-3 DB queries per workspace render. Naturally pairs with other
#    layout-render optimizations later (post-Sprint-03; not blocking).
#
# === Sprint 02 lingering (surfaced during Sprint 04 A1 pre-flight, 2026-05-01) ===
#
# 1. public.smoke_test table still in-tree despite S02 drop intent
#    Site: packages/db/migrations/20260428000001_init.sql:145
#    The init.sql header comment reads "S01-only RLS validation table;
#    dropped in S02" — but no drop migration shipped during Sprint 02. The
#    table still exists, gated by `private.is_workspace_member`, so it
#    inherits the Sprint 04 A1 soft-delete cascade automatically (no
#    behavioral concern). But keeping a Sprint 01-only test fixture
#    around is dead weight.
#    Fix: add a drop migration in a future cleanup commit.
#    When: not blocking; pair with another DB cleanup pass.

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
