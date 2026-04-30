# Sprint 02 retrospective — running notes

This file is a living record of learnings, surprises, and follow-up tech
debt discovered during Sprint 02. Append as the sprint progresses; do not
defer to a single end-of-sprint write-up. Items here become candidates for
front-loaded tech debt in Sprint 03.

## Tech debt tracked for late S02 / early S03

### Consolidate supabase-js type-inference workarounds

**Discovered:** Sprint 02 Section B, Commit 1.

**Sites with the same workaround pattern (3):**

- `apps/web/src/services/workspaces/ensure-primary-workspace.ts` — parameterless RPC; `as PostgrestSingleResponse<...>` cast on the awaited result.
- `apps/web/src/services/workspaces/create-workspace.ts` — args-bearing RPC; typed wrapper around `supabase.rpc` to pin both args and return shape.
- `apps/web/src/services/workspaces/update-workspace.ts` — `.update()` whose parameter type collapses to `never` because every column on `workspaces` is optional in the generated Update type.

**Root cause:** supabase-js v2.105 + `exactOptionalPropertyTypes: true` interaction. The library's overloaded function types narrow incorrectly under that compiler flag, producing a `never` parameter or `never` return chain at the call site. Runtime behaviour is correct in all three cases; only the type-check fails.

**Why it matters:** Each site needs a hand-rolled cast that future readers must verify is safe. We've already had three independent rediscoveries of the same fix; without consolidation we'll see it again every time we touch a new RPC or an UPDATE on an all-optional table.

**Proposed work:**

1. Single `lib/supabase/typed-rpc.ts` helper that takes `(client, fnName, args)` and returns a properly-typed `PostgrestResponse`.
2. Single `lib/supabase/typed-update.ts` helper or a `Database`-aware `.update()` wrapper.
3. Migrate the three existing sites to use the helpers; delete their inline workarounds.
4. Add an upstream issue reference (or update a stale one) so we can drop the helpers when supabase-js fixes the inference.

**Sizing:** ~30-60 minutes. No behaviour change, just a centralisation refactor with the existing RLS test suite as the regression net.

**When:** late Sprint 02 (after Section C/D land) or early Sprint 03's front-loaded tech debt block — same time slot used in S02 prep.

### Workspace selection ordering is non-deterministic

**Discovered:** Sprint 02 Section B, Commit 2.

`/app/page.tsx` falls back to `memberships[0]` when the `authently_last_workspace_slug` cookie is unset or names a workspace the user is no longer a member of. The spec called for "ordered by most-recently-active", but `workspace_members` doesn't track that yet — so `memberships[0]` is whatever Postgres returns under RLS, with no `ORDER BY`. In practice this is stable per session but can drift across deployments or row writes.

**Proposed work:**

1. Add a `last_active_at timestamptz not null default now()` column to `workspace_members` in a Sprint 03 migration.
2. Bump it on each `/app/[slug]/*` visit (cheap UPDATE alongside the existing cookie-set in the workspace layout, or via an explicit RPC).
3. `getCurrentUserWithMemberships` (or its caller) sorts by `last_active_at desc`. The user-menu switcher and `/app/page.tsx` fallback both use that order.

**When:** Sprint 03 — pairs naturally with the workspace deletion + ownership transfer work in the same sprint, since both touch `workspace_members`.

### Header double-`getUser` on signed-in renders

**Discovered:** Sprint 02 Section B, Commit 2.

`apps/web/src/components/header.tsx` calls `auth.getUser()` directly to gate the signed-in/anonymous branch, then `getCurrentUserWithMemberships(supabase)` re-runs `auth.getUser()` internally. Two JWT-validation round-trips on every signed-in page render.

**Why it's acceptable for Sprint 02:** Cold-render cost is <10ms; the validation hits Supabase Auth's verify-JWT path which is fast. Cleaner-to-read code (the early-return branch for anonymous) outweighs the micro-cost.

**Proposed work:**

1. Refactor `getCurrentUserWithMemberships` to accept a pre-fetched `User` parameter, falling back to `getUser()` when omitted.
2. Update Header to pass through its already-fetched user.
3. Other call sites (e.g. `/api/me/route.ts`) keep the no-arg ergonomics — they only run `getUser` once today.

**When:** Sprint 03 polish item, alongside the supabase-js typed-helper consolidation. Same code-path, similar shape of refactor.

### Workspace settings + members lacked navigation entries

**Discovered:** Sprint 02 Section B browser smoke test.

After Section B shipped, the only way to reach `/app/[slug]/settings` was by typing the URL. Members management (Section C) had the same problem. Both gaps are addressed in Section C's UI commit, which adds "Workspace settings" + "Members" entries to the UserMenu's WORKSPACES section. **Status: addressed in Section C Commit 2.**

### Header dev-cache surfaced again post-login/logout

**Discovered:** Sprint 02 Section B browser smoke test.

The Server Component header occasionally serves stale signed-in/out state until a hard refresh in dev. Section C's UI commit lifts `export const dynamic = "force-dynamic"` to `apps/web/src/app/app/[workspaceSlug]/layout.tsx`, which forces SSR per request for the entire authed tree. Trade-off: prevents static rendering of `/app/[slug]/*` — acceptable because every page in that tree is auth-gated dynamic anyway. **Status: addressed in Section C Commit 2.**

### RLS test count growing section-over-section

**Discovered:** Sprint 02 Section C, Commit 1.

Test count and run-time grow with every section: Section A added 9 RLS tests, Section B 16, Section C 39. CI's `RLS isolation tests` job now takes ~2m23s — well under the GitHub Actions 6-hour ceiling, but the slope is steep enough that we should plan for it before the suite hits 5+ minute runs.

**Proposed work (when, not if):**

1. Group tests into fast (`tests/rls/*-rls.test.ts` — pure SELECT/INSERT/DELETE policy probes) vs slow (`tests/rls/*-acceptance.test.ts`, `*-cascade.test.ts` — multi-step lifecycle flows).
2. Run them in parallel via vitest's existing `--shard` flag, or split into separate CI jobs that each set up Supabase independently.
3. Move email-flow tests (`tests/auth/password-reset.test.ts` + future invitation-email tests) to a tagged "needs-mailpit" group that can be skipped when Mailpit's container isn't available.

**When:** Sprint 12 prep, or sooner if any single CI run starts to clear 5 minutes. **Not urgent.**

## Section C smoke test findings (verified end-to-end)

- Multi-tenant invitation flow works correctly through anonymous → sign-up → accept paths
- Email mismatch detection works (anti-enumeration with masked email hint)
- Last-owner UI protection verified with helpful tooltip; DB trigger is the security floor
- Resend free tier rejected non-owner emails (403). Workaround: dev-fallback `console.info` logs full email body. **Tracked as removal item before Section D ships.**

## Cosmetic UX issues found in Section C smoke test (defer to polish sprint)

- Duplicate "Authently" header rendered on `/invite/[token]` pages — workspace layout bleeds through onto public routes that have their own header
- "Wrong Account" page's primary CTA is "Account settings" instead of more useful "Sign out" — should offer the corrective action directly

## Section D Commit 1 — design deviations from spec text

### `past_due_since` column added; grace anchor changed (vs. spec D5)

**Discovered:** Section D Commit 1 planning, 2026-04-30.

The Sprint 02 spec D5 proposed anchoring the 7-day past-due grace period on
`subscription_current_period_end < now() - interval '7 days'`. During
implementation planning we replaced this with a new column,
`workspaces.past_due_since timestamptz`, set by `process_stripe_event`
when a subscription transitions into `past_due` and cleared on transition
back to `active`. Grace task uses
`past_due_since < now() - interval '7 days'`.

**Why the deviation:**

1. Stripe's smart retries (dunning) run for 1–4 weeks AFTER `period_end`
   in many account configurations. Anchoring on `period_end` means we
   could downgrade a workspace mid-dunning while Stripe is still actively
   trying to collect.
2. The re-entry case (workspace goes past_due → recovers → past_due again
   in a later period) was load-bearing on the side effect of
   `customer.subscription.updated` resetting `current_period_end`.
   `past_due_since` makes the invariant direct.
3. The recovery path (`invoice.payment_succeeded` clears `past_due_since`)
   makes it trivial to express "how long has this customer actually been
   past due?" — a question ops will ask repeatedly.

**Impact:** schema cost is one nullable timestamp column on `workspaces`.
Spec D5 text describing the predicate is now wrong; the migration header
documents the deviation. The behavior still matches spec intent ("7 days
of past_due → free"); only the anchor moved.

**Approved:** by Jamshed during Section D Commit 1 planning, before any code
was written.

### `invoice.payment_succeeded` added to handled events (vs. spec D4)

**Discovered:** Section D Commit 1 planning, 2026-04-30.

Spec D4 listed four event types: `checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.payment_failed`. Without a recovery-path handler, a successful
dunning retry (Stripe's `invoice.payment_succeeded`) would leave
`past_due_since` set indefinitely, and the grace task would downgrade a
paying customer 7 days after their first payment failure even after
they recovered.

Added `invoice.payment_succeeded` as a fifth event:
- If the workspace is currently `past_due` (i.e. `past_due_since IS NOT NULL`),
  flip status to `active` and clear `past_due_since`.
- If already active, no-op (idempotent for normal renewal payments).

**Approved:** by Jamshed; runbook (`docs/runbooks/stripe-products.md`) and
the `--events` filter argument were updated in the same commit.

### Schema choice: billing RPCs in `public`, not `private`

**Discovered:** Section D Commit 1 implementation, 2026-04-30.

Sprint 01 established `private` schema as the home for SECURITY DEFINER
helpers. The convention was: `private` = never PostgREST-exposed; called
only from inside RLS policies or from `public.api_*` wrappers.

Commit 1 plan named the new RPCs as `private.process_stripe_event` etc.
On implementation, the Stripe webhook handler (apps/web) and the
Trigger.dev grace-period task (apps/jobs) are themselves PostgREST
clients via `supabase-js`. Functions in `private` are not callable over
HTTP at all — `db-schemas` in `supabase/config.toml` only exposes
`public` and `graphql_public`.

We had three options:
- (a) Add `private` to `db-schemas` — broadens the convention to
  "exposed but role-gated," weakening the original invariant.
- (b) Keep functions in `private`, add thin `public.api_*` wrappers
  — pure ceremony for service-role-only calls.
- (c) Place the new functions in `public` directly with GRANT-based
  perimeter (`revoke from public, anon, authenticated; grant to
  service_role`).

We picked (c). Rationale: the `private` convention is for functions that
should NEVER be HTTP-callable (RLS helpers like `is_workspace_member`,
or workers like `ensure_workspace_for_user` that only run from inside
another `public.api_*`). Our functions ARE HTTP-callable — by the
webhook handler — so the schema name should reflect that. The security
perimeter is the GRANT, validated by
`packages/db/tests/billing/process-stripe-event-rls.test.ts`.

The convention now reads:
- `private.*` — not HTTP-callable at all (RLS helpers, internal workers)
- `public.*` with service-role-only GRANT — HTTP-callable, only by
  webhook handler / scheduled tasks
- `public.api_*` — HTTP-callable by authenticated users

Migration headers (`20260430200155_billing_event_processor.sql`,
`20260430200413_billing_grace_period.sql`) document this choice for
future Claude sessions.
