<!--
  Sprint 04 — Workspace Lifecycle + Auth Hardening
  Locked: 2026-05-01
  Status: planning → spec-locked
  Capacity: 1 solo builder, ~similar duration to Sprint 03 Section A
  Predecessor: Sprint 03 (PR #9, merged commit 51ef827)
-->

# Sprint 04 — Workspace Lifecycle + Auth Hardening

## Goal

Ship the missing workspace lifecycle perimeter (deletion, ownership
transfer, account deletion) so that the 12 in-code references promising
"available in Sprint 03" become true rather than stale. Bundle PKCE
auth migration as an independent hardening win.

In parallel (non-shipping): scope Sprint 03 Section B (source ingestion)
to ~3-4 hours of background work so Sprint 05 planning isn't blind.

## Non-goals

- Voice fingerprint extraction (depends on Section B; deferred to Sprint 05+)
- Resend domain verification + forgot-password SMTP (paired; future polish sprint)
- typedRpcWithNullable, typedInsert helpers (defer until second instance)
- silentMembershipLookup hoist (defer; pair with future layout-perf work)
- Polish items (duplicate /invite header, "Wrong Account" CTA)
- Section B implementation work — planning only

## Section A — Workspace Lifecycle

### A1 — Workspace deletion (soft-delete + cascade)

**Why:** 12 in-code references promise this; users currently cannot
delete a workspace they own. Owner-only action with significant blast
radius (cascades to memberships, invitations, billing).

**Approach:** soft-delete via `deleted_at timestamptz` column rather
than hard DELETE. Reasoning:
- Reversibility for accidental deletions (24-hour grace window)
- Audit trail preservation
- Stripe subscription cleanup needs to happen async, not in the same
  transaction as the deletion
- Simpler RLS reasoning: `deleted_at IS NULL` predicate composes
  cleanly with existing membership checks

**Schema:**
- New migration `<ts>_workspaces_soft_delete.sql`:
  - Add `deleted_at timestamptz` to `public.workspaces` (nullable, default null)
  - Recreate `private.is_workspace_member(_workspace_id uuid)` to JOIN
    `public.workspaces w` and require `w.deleted_at IS NULL`. This
    single-helper cascade hits every existing policy that uses it
    (~10 policies across `workspaces`, `workspace_members`,
    `workspace_invitations`, `smoke_test`, and billing-gated paths).
    No per-policy rewrite needed.
  - Restructure `workspace_members_select`'s `OR user_id = auth.uid()`
    short-circuit so deleted-workspace memberships also disappear from
    user view (β: workspace fully vanishes on delete; audit/history
    visibility is admin-tooling territory, not RLS-permitted SELECT).
    Pattern:
    `(user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND deleted_at IS NULL))`.

**RPCs:**
- `private.delete_workspace_impl(_workspace_id uuid)`:
  - Verify `auth.uid()` is the workspace owner (not just a member)
  - Verify workspace is not already soft-deleted
  - Set `deleted_at = now()` on the workspace row
  - Returns void; raises if conditions fail
- `public.api_delete_workspace(_workspace_id uuid)` — thin wrapper,
  granted EXECUTE to authenticated only

**App layer:**
- New service `apps/web/src/services/workspaces/delete-workspace.ts`
  calling the RPC + handling the post-delete navigation
- New "Delete workspace" UI in
  `apps/web/src/app/app/[workspaceSlug]/settings/page.tsx` (replaces
  the "Sprint 03" copy + tooltip-disabled button at line 197 + 209;
  line 220's transfer button stays disabled until A2 ships)
- Confirmation modal: typed-name confirmation ("Type the workspace
  name to confirm") + **billing disclosure copy** (verbatim):
  > Note: this does not cancel your billing — you remain subscribed
  > until you manage that separately.
- Post-delete: redirect to next-best workspace via
  `getCurrentUserWithMemberships` (already ordered by `last_active_at desc`
  from S03 A1); if no other workspaces, redirect to
  `/app/no-workspace` empty state. **Confirm during build:** if that
  route doesn't exist yet, A1's scope expands to introduce it
  (~30-60 line empty-state page).

**Stripe handling (subscription cleanup):**
- Soft-delete does NOT cancel active Stripe subscriptions.
- Migration header documents the gap verbatim:
  > Soft-delete does NOT cancel active Stripe subscriptions. Until
  > a future scheduled-cleanup task ships, users who delete a
  > workspace continue to be billed; the settings UI must surface
  > this in the deletion-confirm modal.
- Sprint 05+ candidate: scheduled task to cancel Stripe subscriptions
  for workspaces soft-deleted >24 hours ago.

**Tests:**
- New `packages/db/tests/rls/workspace-deletion.test.ts` (≥6 tests):
  - Anonymous client cannot call `api_delete_workspace` (42501)
  - Authenticated non-member cannot delete a workspace
  - Authenticated member (non-owner) cannot delete a workspace
  - Authenticated owner CAN delete their own workspace
  - After deletion, the same owner cannot SELECT the workspace via
    normal queries (RLS blocks `deleted_at IS NOT NULL`)
  - After deletion, the workspace's members cannot SELECT it
  - Bonus: After deletion, invitations to that workspace are
    unreachable
- App-layer test for the service-level wrapper, mocking the RPC
- Manual smoke checklist:
  - Delete workspace UI flow end-to-end
  - Verify navigation lands on next-best workspace
  - Verify deleted workspace doesn't appear in switcher
  - Verify billing portal still accessible (deletion doesn't break it)

**Code-comment retargeting (fold into A1's commit):**
- `apps/web/src/app/app/[workspaceSlug]/settings/page.tsx:197,209`
  — replace "Sprint 03" copy + remove tooltip-disable on the now-active button
- `apps/web/src/components/empty-workspace-state.tsx:24`
  — review and update if relevant

**Expected gate deltas:**
- `test:license-headers`: +1 to +3 (new RPC test, new service file,
  new service test if added)
- `test:rls`: +6 to +8 (new deletion tests)
- `test:web`: +1 to +3 (service test if added)
- `test:billing`, `test:auth`: unchanged

**Commit message:**
`feat(web): workspace soft-deletion (Sprint 04 A1)`

---

### A2 — Ownership transfer flow

**Why:** Confirmed pre-flight: `update-member-role.ts:72-77` blocks
owner-target role changes outright (no transfer flow exists today;
owner role is hard-locked). Users cannot leave a workspace they own;
A2 is the missing piece.

**Approach:** explicit two-step transfer:
1. Current owner initiates transfer to a target member
2. Target member accepts (so transfer requires consent — not a one-way push)

Reasoning for two-step:
- Owners shouldn't be able to dump responsibility on members without
  consent (real risk: someone gets billed against their will)
- Mirrors invitation accept-flow already in the codebase

**Schema:**
- New migration `<ts>_workspace_ownership_transfers.sql`:
  - Add `public.workspace_ownership_transfers` table:
    - `id uuid primary key default gen_random_uuid()`
    - `workspace_id uuid not null references workspaces(id) on delete cascade`
    - `from_user_id uuid not null references auth.users(id) on delete cascade`
    - `to_user_id uuid not null references auth.users(id) on delete cascade`
    - `created_at timestamptz not null default now()`
    - `accepted_at timestamptz`
    - `cancelled_at timestamptz`
    - Constraint: at most one pending transfer per workspace (partial unique
      index on `workspace_id` where `accepted_at IS NULL AND cancelled_at IS NULL`)
  - RLS: only the workspace owner and the target member can SELECT;
    only the owner can INSERT/cancel; only the target can UPDATE
    (set `accepted_at`)

**RPCs:**
- `private.initiate_ownership_transfer_impl(_workspace_id uuid, _to_user_id uuid)`
  - Verify caller is current owner
  - Verify target is a member of the workspace (not just any user)
  - Verify no pending transfer exists
  - Insert row
- `private.accept_ownership_transfer_impl(_transfer_id uuid)`
  - Verify caller is the target
  - Verify transfer is pending (not accepted, not cancelled)
  - Atomic: set `accepted_at`, swap owner role on
    `workspace_members` — previous owner demoted to `'admin'`.
    Locked single-owner model; multi-owner is Sprint 06+ candidate.
- `private.cancel_ownership_transfer_impl(_transfer_id uuid)`
  - Verify caller is the original owner OR the target
  - Set `cancelled_at`
- Three corresponding `public.api_*` wrappers, all granted to authenticated

**App layer:**
- Service files in `apps/web/src/services/workspaces/`:
  - `initiate-ownership-transfer.ts`
  - `accept-ownership-transfer.ts`
  - `cancel-ownership-transfer.ts`
- UI:
  - "Transfer ownership" action in workspace settings page
    (replace the "Available in Sprint 03" tooltip per
    `settings/page.tsx:220`)
  - Pending-transfer notification banner in the **offered workspace's
    layout** (where the action is taken). Pattern mirrors `PastDueBanner`
    from Section D Commit 2; no new notification infrastructure.
    Switcher-badge enhancement deferred to polish.
  - Email notification to target (deferred — depends on Resend
    domain `[04-4]`; document as "future enhancement" comment in code)

**Tests:**
- New `packages/db/tests/rls/workspace-ownership-transfer.test.ts` (≥8 tests):
  - Anonymous cannot call any of the three RPCs
  - Non-owner cannot initiate transfer
  - Owner cannot transfer to a non-member
  - Owner cannot initiate two transfers simultaneously (partial-unique constraint)
  - Target accepts → role swap is atomic (verify via SELECT)
  - Owner cancels their own transfer → state correct
  - Target cancels (rejects) the transfer → state correct
  - After successful transfer, original owner cannot re-initiate
    (they're not the owner anymore)
- App-layer tests for each service file

**Code-comment retargeting (fold into A2):**
- `apps/web/src/components/member-row.tsx:87,284`
- `apps/web/src/services/members/remove-member.ts:30,64`
- `apps/web/src/services/members/update-member-role.ts:27,74`
- `apps/web/src/services/members/leave-workspace.ts:50`
- `apps/web/src/lib/schemas/invitations.ts:23`
- `apps/web/src/lib/schemas/members.ts:23`

Replace "Sprint 03" copy with active-feature copy. Remove any
disabled tooltips that are now unblockable.

**Expected gate deltas:**
- `test:license-headers`: +3 to +6 (multiple new files)
- `test:rls`: +8
- `test:web`: +3 to +6 (service tests)

**Commit message:**
`feat(web): workspace ownership transfer (Sprint 04 A2)`

---

### A3 — Account deletion (GDPR)

**Why:** Legal compliance for any future EU users. Users must be able
to delete their own account. Tied to A1 (workspace deletion) because
the policy decision is "what happens to workspaces a user owns when
they delete their account?"

**Policy decision (resolve before implementation):**
Two paths, exactly one to pick:

(α) **Cascade:** deleting an account soft-deletes all workspaces
    they own. Members of those workspaces lose access. Simple,
    aggressive.
(β) **Force-transfer-or-block:** an account cannot be deleted if it
    owns workspaces with other members. User must transfer ownership
    or remove other members first. Safer, more friction.

Recommend (β) for A3 — it composes cleanly with A2 (ownership transfer
exists by then), and avoids the "I deleted my account and now my
co-founder lost access to our shared workspace" footgun.

**Approach (assuming β):**
- Account deletion checks for owned workspaces with >1 member
- If found, return a structured error listing the workspaces blocking
  deletion
- If not (sole-owner workspaces or no owned workspaces), proceed with
  cascading soft-delete of owned workspaces + auth.users deletion

**Schema:**
- New migration `<ts>_user_profiles.sql`:
  - `public.user_profiles` table:
    - `user_id uuid primary key references auth.users(id) on delete cascade`
    - `deleted_at timestamptz`
  - RLS: user can SELECT/UPDATE their own row; no one else.
- Single-column-purpose for now (just `deleted_at`); future profile
  fields land here naturally. Don't reuse `auth.users.raw_user_meta_data`
  (Supabase disallows direct `alter table auth.users` from migrations
  anyway; the auth schema is owned by GoTrue).

**RPCs:**
- `private.delete_account_impl()` — uses `auth.uid()` implicitly
  - Check for blocking owned workspaces (β policy)
  - If clear: cascade soft-delete owned workspaces, then mark user as
    deleted
  - Returns structured outcome (success / blocking_workspaces array)
- `public.api_delete_account()` — wrapper

**App layer:**
- New service `apps/web/src/services/users/delete-account.ts`
- New UI in account settings page (currently `apps/web/src/app/app/account/page.tsx:69`
  has placeholder "Available in a future release" — replace)
- Confirmation flow: type-email-to-confirm + a 7-day grace window?
  (decision: defer grace window to polish sprint; just ship typed-confirm for now)
- Post-delete: sign user out + redirect to landing page

**Tests:**
- New `packages/db/tests/rls/account-deletion.test.ts` (≥5 tests):
  - Anonymous cannot call `api_delete_account`
  - User with no owned workspaces can delete cleanly
  - User with sole-owner workspaces (no other members) can delete;
    those workspaces soft-delete
  - User with owned workspaces having other members is BLOCKED;
    error returns the blocking workspace list
  - After deletion, user cannot sign in / RLS treats them as anonymous

**Code-comment retargeting (fold into A3):**
- `apps/web/src/app/app/account/page.tsx:69` — replace placeholder

**Expected gate deltas:**
- `test:license-headers`: +1 to +3
- `test:rls`: +5
- `test:web`: +1 to +2

**Commit message:**
`feat(web): account deletion with workspace-ownership guard (Sprint 04 A3)`

---

## Section B — Auth Hardening

### B1 — PKCE migration (callback + reset-password)

**Why:** Confirmed pre-flight — `/auth/callback` already does PKCE
exchange via `exchangeCodeForSession`. Only `reset-password` is on
the implicit-grant path (reads `access_token` + `refresh_token` from
the URL fragment client-side via `setSession`). Implicit grant has
known security tradeoffs vs PKCE; the in-code comment block at
`reset-password-form.tsx:21-51` already contains the full migration
recipe, written when the workaround landed. Independent of Section A.

**Approach:** Concrete steps, lifted verbatim from the in-code recipe:

1. Override `[auth.email.template.recovery]` in `supabase/config.toml`
   and create `supabase/templates/recovery.html` with link of form
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`.
2. Add route handler at `apps/web/src/app/auth/confirm/route.ts`
   calling `supabase.auth.verifyOtp({ token_hash, type })` with the
   same `safeNext()` open-redirect guard `/auth/callback` uses.
3. Convert `reset-password-form.tsx` back to a Server Component
   driven by `supabase.auth.getUser()` (session is already established
   server-side by `/auth/confirm`); drop the fragment-reading useEffect
   and the `"processing"` phase.
4. Update the Hosted Supabase Dashboard recovery template
   (Authentication → Email Templates → Reset Password) to mirror the
   local config.
5. **No `flowType` config change needed** — supabase-js v2 SSR client
   already defaults to PKCE; the only implicit-grant surface is the
   recovery email template.

**Tests:**
- Update `apps/web/tests/...auth-callback...` tests (if they exist)
  to assert PKCE code exchange behavior
- Manual smoke checklist:
  - Sign-up → email confirm → callback → land in app ✓
  - Forgot-password → email link → reset form → new password ✓
  - Magic link sign-in (if applicable) ✓

**Risk:** auth changes can break sign-up/sign-in for existing users
in subtle ways. Run the manual smoke checklist on a staging environment
before merging.

**Expected gate deltas:**
- `test:license-headers`: 0 to +1
- `test:auth`: possibly +1 to +2 if new tests added
- `test:web`: 0 to +1 if new tests added
- All other gates unchanged

**Commit message:**
`feat(web): migrate auth callbacks to PKCE flow (Sprint 04 B1)`

---

## Section C — Background Planning (non-shipping)

### C1 — Sprint 03 Section B (source ingestion) scoping

**Why:** Currently unknown whether Section B is being worked on. If
Sprint 05 will depend on Section B outputs (voice fingerprint per
build_plan.md), we need to know its real status before Sprint 05 planning.

**Scope:** ~3-4 hours total during Sprint 04, NOT shipping code.
Output is a `docs/specs/SECTION_B_SCOPING_NOTES.md` file with:
- Current status (paper plan only? partial work? abandoned?)
- Open architectural questions resolved or refined
- Estimated commit count for actual implementation
- Dependencies on third-party services (Modal, Whisper, etc.)
- Recommended placement in the multi-sprint roadmap

**Deliverable:** the notes doc, committed to a small `docs:` commit
at the end of Sprint 04.

**Not a deliverable:** any source-ingestion code.

---

## Workflow

Same pattern as Sprint 03 Section A — proven and working:

1. Spec → confirm → build → verify
2. Pause after each commit lands locally
3. User reviews against the spec; approves before next commit
4. All 7 gates green at every commit
5. Branch: `chore-sprint-04-workspace-lifecycle` (or shorter; lock at start)
6. PR opened only after all commits land local + reviewed

## Commit order

Recommend this sequence (rationale follows):

1. **A1 — Workspace deletion** (foundational; A3's policy check uses A1's
   soft-delete mechanism)
2. **A2 — Ownership transfer** (depends on A1 conceptually; the role-swap
   logic on accept needs A1's deletion to be possible)
3. **A3 — Account deletion** (depends on A1 + A2; the β policy check
   uses both: workspace existence and transfer availability)
4. **B1 — PKCE migration** (independent; can land any time during sprint
   but going last keeps the auth layer untouched while Section A is in
   flight)
5. **C1 — Section B scoping notes** (final docs commit)

Alternative: B1 first, then A1/A2/A3. Argument: get the auth-layer
change isolated and shipped before introducing feature complexity.
Counterargument: A1-A3 is the user-visible value; do it first.

**Default to A1→A2→A3→B1→C1 unless you (the human reviewer) want to swap.**

## Guardrails (same as Sprint 03)

- AGPL header on every new `.ts`/`.tsx` source file
- Migration filenames via `pnpm db:new` (no manual timestamp construction)
- `private.*_impl` worker + `public.api_*` wrapper pattern, both with
  proper grants (authenticated only — never `anon` or `public`)
- All check-and-mutate logic in SQL `WHERE` clauses, not application
  layer
- Service-role allow-list NOT expanded for any of these RPCs (all are
  user-callable)
- Tests for RLS perimeter (anonymous + non-member + non-owner should
  all fail)
- Spec → confirm → build → verify; pause after each commit; don't push

## Decisions locked at pre-flight (2026-05-01)

1. **Soft-delete vs hard-delete for workspaces** — soft-delete via
   `deleted_at timestamptz`.

2. **A3 policy (cascade vs force-transfer-or-block)** —
   force-transfer-or-block (β). An account cannot be deleted if it
   owns workspaces with other members.

3. **Workspace deletion grace window** — none in A1; defer to polish
   sprint.

4. **Email notifications on ownership transfer** — defer (depends on
   `[04-4]` Resend domain verification).

5. **A1 RLS strategy** — modify `private.is_workspace_member` to JOIN
   `workspaces` and require `deleted_at IS NULL`. Single-helper cascade
   hits all ~10 existing policies. Restructure
   `workspace_members_select`'s `OR user_id = auth.uid()` short-circuit
   so deleted-workspace memberships also disappear from user view (β:
   workspace fully vanishes on delete; audit/history visibility is
   admin-tooling territory, not RLS-permitted SELECT).

6. **A1 Stripe gap framing** — soft-delete does NOT cancel active
   Stripe subscriptions. Until a future scheduled-cleanup task ships
   (Sprint 05+), users who delete a workspace continue to be billed.
   Two consequences for A1 scope:
   - Migration header documents the gap with the locked framing verbatim.
   - Deletion-confirm modal copy must include this disclosure verbatim:
     > Note: this does not cancel your billing — you remain subscribed
     > until you manage that separately.

7. **A2 previous-owner demoted role** — `'admin'` on transfer accept.
   Single-owner model preserved; multi-owner is Sprint 06+ candidate.

8. **A2 transfer-banner location** — offered workspace's layout (where
   the action is naturally taken). Pattern mirrors `PastDueBanner`; no
   new notification infrastructure. Switcher-badge enhancement deferred
   to polish.

9. **A3 user-deletion table** — new `public.user_profiles` table with
   `user_id uuid primary key references auth.users(id) on delete cascade`,
   `deleted_at timestamptz`. Single-column-purpose for now; future
   profile fields land here. Don't reuse `auth.users.raw_user_meta_data`.

10. **Branch name** — `chore-sprint-04-workspace-lifecycle` (matches
    Sprint 03's `chore-sprint-03-cleanup` pattern).

11. **Commit order** — A1 → A2 → A3 → B1 → C1. A2 precedes A3 because
    A3's β policy uses A2's transfer flow as the user's remediation
    path. B1 last to keep the auth layer isolated from feature work.

## Build-time confirmations (resolved during the relevant commit)

- **A1:** `/app/no-workspace` empty-state page existence — confirm
  during A1 build. If the route doesn't exist, A1's scope expands to
  introduce it (~30-60 lines).
- **A1:** `public.smoke_test` table still in-tree despite Sprint 02
  drop intent — tracked in `SPRINT_03_carryovers.md` under "Sprint 02
  lingering". Not blocking; future cleanup pass.

## Carryover items NOT in Sprint 04 (for future reference)

- `[04-4]` Resend domain verification + DNS — pair with `[04-10]`
- `[04-10]` Forgot-password via Resend SMTP — pair with `[04-4]`
- `[04-6]` typedRpcWithNullable helper — defer until 2nd instance
- `[04-7]` typedInsert helper — defer until 2nd instance
- `[04-8]` silentMembershipLookup hoist — pair with future layout-perf work
- `[04-5]` Polish items — future polish sprint