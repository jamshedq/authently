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

### Schema choice: billing RPCs — `private` workers + `public.svc_*` wrappers

**Discovered:** Section D Commit 1 implementation, 2026-04-30.
**Refactored:** before merge of section-d-commit-1, same day.

Sprint 01 established `private` schema as the home for SECURITY DEFINER
helpers. The convention was: `private` = never PostgREST-exposed; called
only from inside RLS policies or from `public.api_*` wrappers.

Commit 1 plan named the new RPCs as `private.process_stripe_event` etc.
On implementation, the Stripe webhook handler (apps/web) and the
Trigger.dev grace-period task (apps/jobs) are themselves PostgREST
clients via `supabase-js`. Functions in `private` are not callable over
HTTP at all — `db-schemas` in `supabase/config.toml` only exposes
`public` and `graphql_public`. (Verified empirically: PostgREST returns
`PGRST106 HTTP 406 "Invalid schema: private"` regardless of role,
including service_role. The supabase-js `rpc()` method always goes
through PostgREST; the service-role key grants RLS bypass + elevated
privileges but does NOT bypass schema-exposure config.)

Three options were on the table:
- (a) Add `private` to `db-schemas` — would broaden the convention to
  "exposed but role-gated," and would let authenticated users probe
  `private.is_workspace_member(any_workspace_id)` (granted to
  authenticated) for tenant-membership enumeration. Real security
  regression. Rejected.
- (b) Keep functions in `private`, add thin `public.svc_*` wrappers
  granted to service_role only. Matches Sprint 01/02 precedent
  (`public.api_ensure_my_workspace` → `private.ensure_workspace_for_user`).
- (c) Place the new functions in `public` directly with GRANT-based
  perimeter (`revoke from public, anon, authenticated; grant to
  service_role`).

**Initial implementation: (c).** Rationalized as "(b) is pure ceremony for
service-role-only calls." The functions worked, tests verified the
perimeter (anon/auth rejected with 42501), and a smoke test confirmed
end-to-end behavior.

**Pre-merge refactor to (b):** on review, (c) was a real architectural
deviation. The Sprint 01/02 codebase pays the wrapper cost everywhere
else (`public.api_ensure_my_workspace`, `public.api_create_workspace`,
`public.api_list_workspace_members`, etc.). Breaking the pattern for
four functions creates a second convention future Claude sessions have
to learn. Pattern consistency is a long-term investment; the wrapper
overhead is small. Migration `20260430231812_billing_rpc_pattern_refactor`
drops the original `public.<name>` functions and recreates them as
`private.<name>_impl` workers with `public.svc_<name>` thin wrappers.
App code, tests, and the Trigger.dev task all switched to the
`public.svc_<name>` entry points. No behavior change; all 25 billing
tests + smoke verification still pass.

The convention now reads:
- `private.<name>` — not HTTP-callable (RLS helpers, internal workers
  not needing a public surface)
- `private.<name>_impl` + `public.svc_<name>` — service-role-only entry
  points; the wrapper is the HTTP surface, the `_impl` is the worker
  (e.g. `private.process_stripe_event_impl`,
  `public.svc_process_stripe_event`)
- `private.<name>` + `public.api_<name>` — user-callable entry points;
  `public.api_<name>` runs `auth.uid()` + dispatches to the worker
  (e.g. `private.ensure_workspace_for_user` + `public.api_ensure_my_workspace`)

Documented in CLAUDE.md (project root) so the convention persists
across sessions.

## Section D Commit 2 — design deviations + follow-ups

### Routes: `/api/ws/[slug]/billing/*` instead of `/api/billing/*` (vs. spec D2/D3)

**Discovered:** Section D Commit 2 planning, 2026-04-30.

The Sprint 02 spec D2/D3 listed the billing routes as
`POST /api/billing/checkout` and `POST /api/billing/portal`. By the time
Section D Commit 2 began, every other Sprint 02 API route had landed
under `/api/ws/[workspaceSlug]/*` (members, invitations, info, member-management,
etc.). Putting billing under `/api/billing/*` would have required a
separate body-driven slug resolver and would have made `withMembership`
unusable as-is.

We deviated to `/api/ws/[workspaceSlug]/billing/checkout` and
`/api/ws/[workspaceSlug]/billing/portal`. Pattern-consistent, slug-driven
auth + role gating via `withMembership({ requireRole: ['owner'] })`,
zero new middleware. Same lesson as Section D Commit 1's schema-choice
deviation: pattern consistency outweighs spec-text adherence when the
spec was written before the pattern crystallized.

### Stripe customer pre-creation pattern

**Added:** Section D Commit 2 implementation, 2026-04-30.

Originally planned as "let Stripe auto-create the customer at checkout
session time." On review, this leaves the resulting Stripe `customer.*`
record without `metadata.workspace_id`, making support debugging from
the Stripe Dashboard side require a session/subscription cross-reference
(neither of which is the resource ops would search by first).

Pre-create instead: `apps/web/src/services/billing/create-checkout-session.ts`
calls `stripe.customers.create({ metadata: { workspace_id }})` if
`workspace.stripe_customer_id` is null, then persists the new customer
ID via `public.svc_set_workspace_stripe_customer` (migration
`20260430234723_set_workspace_stripe_customer`) before opening the
Checkout session. The persistence makes retries (network blip, double-
click, sequential failed checkouts) idempotent — a workspace ends up
with at most one Stripe customer.

Trade-off: one extra Stripe API call per first-time checkout. Worth it
for the metadata cleanliness and the support-debugging payoff.

### Past-due banner edge case: workspace with no `stripe_customer_id`

**Added:** Section D Commit 2 implementation, 2026-04-30.

The banner's primary CTA opens the Stripe Customer Portal, which requires
a `stripe_customer_id`. A `past_due` workspace with `stripe_customer_id IS NULL`
shouldn't exist in normal flow (the customer is pre-created at first
checkout — see preceding entry), but could exist from Sprint 01 manual
seed data, an interrupted checkout, or a Stripe-side anomaly.

Banner branches in this case: shows "Contact support" with a `mailto:`
link to a placeholder address. Real `support@authently.io` (or whatever
support address ships) is Sprint 12 prep. Not user-actionable today,
but at least it doesn't render a broken Manage-billing button.

### Free-tier `/pricing` CTA links to repo root

**Added:** Section D Commit 2 implementation, 2026-04-30.

The Free tier's "Self-host on GitHub" CTA links to
`https://github.com/jamshedq/authently` — the repo root README.

**Sprint 12 follow-up:** add a top-level `## Self-hosting` section to
`README.md` (or a separate `docs/SELF_HOSTING.md`) before the Phase 1
launch. Right now the repo root README is short on operational detail;
sending a self-host-curious user there leaves them figuring it out from
docker/compose files. Tracked here so it doesn't get lost.

### Test infrastructure: `apps/web` vitest harness + `test:web` gate

**Added:** Section D Commit 2 implementation, 2026-04-30.

Section D Commit 2 introduced the first apps/web integration tests
(billing checkout/portal route handlers + service unit tests). Required
new infrastructure:

- `apps/web/vitest.config.ts` — shares `.env.test` with `packages/db` so
  CI runs against the same local Supabase fixture
- `apps/web/tests/setup.ts` — env validation + NEXT_PUBLIC_* mirroring
- `apps/web/tests/helpers/{test-workspace,stripe-mock,server-client-mock}.ts`
  — fixture creation, Stripe SDK mock module, mockable
  `createSupabaseServerClient`
- `pnpm test:web` script (root + apps/web) — added as the 7th local gate

Future API routes (D-other-routes, Sprint 03+) reuse this harness. The
one-time cost of the harness is paid; subsequent route tests are
checkout/portal-style copies.

### Service-role allow-list expansion

**Discovered:** Section D Commit 2 implementation review, 2026-04-30.

The Stripe Checkout flow needs to call `public.svc_set_workspace_stripe_customer`
during pre-creation of the Stripe customer (see preceding entry on the
pre-creation pattern). That RPC is service-role-only by GRANT, so the
checkout flow needs a service-role Supabase client — adding a fourth
legitimate apps/web service-role usage to the allow-list that was
previously implicit.

The deeper reason this is unavoidable: `workspaces.stripe_customer_id`
is locked to `service_role`-only writes by Section B's column-level
GRANTs (migration `20260429213717_create_workspace_rpc.sql` revokes
UPDATE-on-all-columns from `authenticated` and re-grants only
`(name, template)`). An RLS-subject client physically cannot write
`stripe_customer_id`, regardless of how SECURITY DEFINER routing is
arranged. The choice is between:
- service-role client → RPC (current state; preserves the column lock)
- relax the column GRANT to allow authenticated UPDATE on
  `stripe_customer_id` (would weaken Section B's invariant — every
  webhook event Stripe sends would need a corresponding "authenticated
  user can pretend to be Stripe" path)

The current state is correct; the allow-list just needed updating to
reflect it. CLAUDE.md rule 6 now formally enumerates the four legitimate
service-role usages in apps/web (was: only Trigger.dev tasks + tests +
webhook handler), with the fourth being this Checkout flow. Future
service-role expansions require:

1. Updating CLAUDE.md rule 6.
2. Naming the workspace-context boundary that protects the call.
3. Routing mutations through a `public.svc_*` SECURITY DEFINER wrapper
   (not a raw client `.from(table).update(...)`), so the invariants
   live in the database alongside the GRANT-based perimeter.

The third constraint matters: a service-role raw write would skip the
SQL-level invariant checks that `svc_*` wrappers can enforce. The
`svc_set_workspace_stripe_customer` worker, for example, asserts the
column is currently null before writing — preventing accidental
double-create of Stripe customers if a future code path triggers a
second pre-creation.

### Manual smoke caught a real bug that integration tests missed

**Discovered:** Section D Commit 2 manual smoke test, 2026-05-01.

The first real end-to-end Stripe Checkout completion against a real
workspace surfaced a chicken-and-egg deadlock between
`checkout.session.completed` and the subscription/invoice events that
follow it. All 31 billing integration tests passed; manual smoke caught
it at Phase 5.

**Symptom (from `stripe_events.payload` after a real checkout):**

| Event | `price_id` | `subscription_id` | `workspace_id_hint` | Outcome |
|---|---|---|---|---|
| `checkout.session.completed` | `null` | `sub_…` | `27f06054-…` (correct) | `unknown_price` |
| `customer.subscription.updated` | `price_…` (correct) | `sub_…` | `null` | `workspace_not_found` |
| `invoice.payment_succeeded` | `price_…` | `sub_…` | `null` | `workspace_not_found` |

**Root cause:**

1. Stripe webhook events for `checkout.session.completed` do NOT include
   `line_items` by default — populating `price_id` requires an explicit
   `expand` on the API.
2. The Sprint 02 D Commit 1 extractor read `obj["line_items"]` directly
   off the event payload (which was always `undefined` for real
   webhooks) → `price_id: null` → RPC returned `unknown_price` → the
   workspace's `stripe_subscription_id` stayed NULL.
3. The follow-up `customer.subscription.updated` event has the price
   correctly, but the RPC's resolver only tried to find the workspace
   by `stripe_subscription_id`. Since step 2 left it NULL,
   `workspace_not_found` fired even though we knew the customer.
4. `invoice.payment_succeeded` repeated step 3.

The integration tests for these branches passed because they pre-populated
`workspace_id_hint`/`price_id`/`subscription_id` from hand-crafted
payloads; they never went through the real
`stripe.checkout.sessions.retrieve` round-trip and never exercised the
"checkout.session.completed dropped, recovery event arrives" sequence.

**Two-pronged fix** (one PR commit on `section-d-commit-2`):

1. **`apps/web/src/services/webhooks/stripe/enrich-event.ts`** — new
   helper. Before extraction, calls
   `stripe.checkout.sessions.retrieve(id, { expand: ['line_items'] })`
   for `checkout.session.completed` events. Returns the event with
   `data.object` replaced by the expanded session. All other event
   types pass through unchanged. One Stripe API call per checkout
   completion, acceptable cost.

2. **`packages/db/migrations/20260501025654_billing_customer_id_fallback.sql`** —
   defense in depth. The four subscription-bound branches in
   `private.process_stripe_event_impl`
   (`customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`, `invoice.payment_succeeded`) now fall back
   to a `stripe_customer_id` lookup if the primary
   `stripe_subscription_id` lookup misses, **guarded by**
   `stripe_subscription_id IS NULL`. The guard prevents accidentally
   matching a workspace already linked to a different active
   subscription. When fallback resolves, the UPDATE links
   `stripe_subscription_id` so subsequent events for the same
   subscription resolve via the primary path.

The line_items expansion fixes the root cause; the customer_id fallback
is for production edge cases (manual Stripe Dashboard actions,
out-of-order events, admin-driven subscription changes) where the same
deadlock could re-emerge.

**Third bug surfaced during the post-fix smoke run** — the
`stripe.checkout.sessions.retrieve` round-trip in (1) is slower than
the synchronous parse of `customer.subscription.updated`, so on the
real wire the UPDATE for the subscription event fires *before* the
UPDATE for the checkout event. The `customer_id` fallback from (2) made
the subscription event's UPDATE succeed (sets `period_end` correctly),
but `checkout.session.completed` then ran second and clobbered
`period_end = null` (the extractor doesn't populate `current_period_end`
for checkout sessions — that field is only on the subscription).

Fixed in the same migration by changing the checkout branch's UPDATE to
`subscription_current_period_end = coalesce(_current_period_end, subscription_current_period_end)`.
Test in `packages/db/tests/billing/customer-id-fallback.test.ts`
("checkout.session.completed with null _current_period_end → preserves
existing period_end") replays the race in the deterministic order.

**Pattern lesson — second confirmation in Sprint 02:**

Sprint 02 has now had two cases where exhaustive integration tests
passed but manual smoke caught real bugs:

1. **Section A** — Radix DropdownMenu sign-out race. Component tests
   passed; clicking sign-out in a real browser failed.
2. **Section D Commit 2** — this entry. 31 billing tests passed;
   running real Stripe Checkout end-to-end deadlocked.

The pattern is consistent: integration tests with hand-crafted payloads
or rendered DOM verify the components work in isolation. They do not
verify the boundary between live external systems (Stripe API, browser
event loop, real DOM) and our code. That boundary is where order-of-
operations, expansion semantics, and timing assumptions live — and
those assumptions are exactly the kind of thing that's easy to get
subtly wrong and hard to write a test for.

**Discipline pattern reaffirmed:** every PR ships with a manual smoke
test, even when integration tests are exhaustive. The smoke test is
not redundancy; it's the *first* real end-to-end exercise of the
boundary.
