# Sprint 02 — Workspaces, Invitations, Billing, Account Basics

**Goal:** Turn Sprint 01's single-user, single-workspace scaffold into a coherent multi-user SaaS. Users can switch between workspaces, invite teammates with role-based access, manage their account, recover forgotten passwords, and pay for a plan via Stripe. End state: a product that a real customer could sign up for and use without hitting an obvious dead end.

**Phase 1 ship gate context:** Sprint 02 of 12 in Phase 1. Phase 1 launches at Sprint 12. This sprint puts the foundational tenancy, account, and billing pieces in place. Later sprints fill in the AI features (voice profile in Sprint 03+, source ingestion in Sprint 05+, social adapters in Sprint 10+).

## Stack additions

- **Resend** for transactional email — invitation emails, password reset emails
- **Stripe Checkout + Customer Portal** for subscription management
- **sonner** (shadcn-compatible toast library) for in-app feedback
- **No new infrastructure** — Postgres, Trigger.dev, S3, etc. all stay as-is

## Front-loaded tech debt (do these FIRST in Sprint 02)

These are cheap wins from the Sprint 01 handoff. Doing them at the start of Sprint 02 means every Sprint 02 migration uses the right naming convention, every schema change automatically regenerates types, and the dual-CLAUDE.md convention is documented for future sessions.

1. **Migration filename convention** — pnpm script that prints `YYYYMMDDHHMMSS_<name>.sql`. ALL new Sprint 02 migrations use this format. Prevents merge-conflict surprises when migrations land near each other.

2. **types.ts regeneration CI guard** — fail CI if `pnpm db:gen-types` produces a diff. Prevents schema-vs-types drift.

3. **Trigger.dev import migration** — 2 files, change `@trigger.dev/sdk/v3` → `@trigger.dev/sdk` per the v4 rule pack:
   - `apps/jobs/src/lib/tenant-task.ts`
   - `apps/jobs/src/trigger/workspace-noop.ts`

4. **Reference apps/jobs/CLAUDE.md from project-level CLAUDE.md** — note the dual-CLAUDE.md convention. Add to "Files Claude should ALWAYS read" section: "For jobs work: `apps/jobs/CLAUDE.md` (Trigger.dev v4 task development rules)".

5. **Remove `__debug/observability` endpoint** — flagged for removal by Sprint 01 Step 8. Update `docs/runbooks/observability.md` to point at the production verification path only.

6. **Sentry global-error.tsx** — Sprint 01.5 surfaced this warning. Add `apps/web/src/app/global-error.tsx` per Sentry's Next.js App Router docs.

7. **Favicon** — minimal SVG at `apps/web/public/favicon.svg` plus `.ico` fallback. Use Authently brand-green initial mark (just the letter "A" in brand-green) as a placeholder until proper brand work lands.

## Database — schema additions

```sql
-- Persistent webhook event dedup, replaces in-memory Set from Sprint 01
create table stripe_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  workspace_id uuid references workspaces(id) on delete set null,
  payload jsonb
);
-- No RLS — webhook handler runs as service-role only. Not user-facing.

-- Workspace invitation tokens
create table workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email citext not null,
  role text not null check (role in ('admin','editor','viewer')),
  token text unique not null,            -- generated via pgcrypto, 32+ chars
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,        -- default: 7 days from created_at
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
-- RLS: members of workspace can SELECT; only owners/admins can INSERT/UPDATE/DELETE.
-- Anonymous users can SELECT a single row by token (for the accept-invite page).

-- Add subscription state tracking to workspaces
alter table workspaces add column subscription_status text not null default 'active'
  check (subscription_status in ('active','past_due','canceled'));
alter table workspaces add column subscription_current_period_end timestamptz;
```

Modifications to existing tables:

- `workspaces.stripe_subscription_id` — already exists, populated for first time during Sprint 02
- `workspaces.plan_tier` — change check constraint to: `'free' | 'solo' | 'studio'` (was `'free' | 'creator' | 'team' | 'agency'` — corrected to match build_plan_v2.docx Phase 1 tiers)
- Update existing migration constants if they reference old tier names

Tables to drop:

- `smoke_test` — Sprint 01 RLS canary, no longer needed. Real cross-tenant tests on invitations + billing cover the surface area more thoroughly.

## Deliverables

### A. Account basics

**A1. Password reset flow**
- `/forgot-password` page — email input form
- `POST /api/auth/forgot-password` — calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: '${SITE_URL}/reset-password' })`
- Email sent via Resend (Supabase Auth integrates with custom SMTP; configure if needed, otherwise use Supabase's default email infrastructure for now)
- `/reset-password` page — token validation, new password input, confirm password
- `POST /api/auth/reset-password` — updates password via Supabase
- Link from `/login` page: "Forgot password?"
- Generic success messages — never reveal whether an email exists in the system (anti-enumeration)

**A2. Account settings page**
- `/app/account` — accessible from header user menu
- Update `full_name` (writes to `auth.users.raw_user_meta_data`)
- Update email (Supabase Auth flow with email confirmation)
- Show currently signed-in email (read-only display)
- Sign out button
- "Delete account" link → marked as "coming soon" placeholder for Sprint 03+

**A3. Header user menu**
- Replace the alpha badge spot in the header with a user avatar dropdown (initials avatar, hash-based color from user_id)
- Dropdown contents:
  - Current workspace name (header) + workspace switcher (list of memberships)
  - "Create new workspace" link
  - Divider
  - "Account settings" link
  - "Sign out" button
- The standalone sign-out button on the dashboard goes away — it's now in the menu
- Use sonner toast for all confirmations ("Switched to X workspace", "Signed out", etc.)

### B. Workspace switcher + management

**B1. Switcher (in header user menu, see A3)**
- List all `workspace_members` for current user, ordered by most-recently-active
- Click to navigate to `/app/{slug}/dashboard`
- "Create new workspace" form opens a modal/dialog with name input → creates workspace + owner membership → redirects to new dashboard

**B2. Workspace settings page**
- `/app/[slug]/settings` — owners + admins only (use `withMembership` middleware with role check)
- Rename workspace (also regenerates slug? **No — slug stable for URLs; only `name` updates**)
- Change template (creator/smb/community)
- Show workspace ID, created_at, member count, current plan
- Manage billing button → calls `/api/billing/portal`
- "Delete workspace" and "Transfer ownership" — placeholders showing "coming in Sprint 03"

**B3. Empty-state handling**
- If user lands on `/app` with zero memberships, render "Create your first workspace" page
- This shouldn't happen in normal flow (sign-up trigger creates one) but handles edge cases (workspace deleted while user wasn't a member of any other)

### C. Member invitations

**C1. Invitation creation**
- `/app/[slug]/members` page — owners + admins only
- Lists existing members (name, email, role, joined date) and pending invitations (email, role, invited date, expires date)
- "Invite member" form: email input + role selector (admin/editor/viewer; owner role NOT invitable, must be transferred separately in Sprint 03)
- `POST /api/ws/[slug]/invitations` — `withMembership` + role check (owner/admin)
- Generates cryptographic token via pgcrypto
- Sends email via Resend with accept link to `/invite/[token]`

**C2. Invitation acceptance**
- Public `/invite/[token]` page (no auth required)
- Token lookup: if invalid/expired/already-accepted → branded "invalid invitation" page with link to home
- If valid + not authenticated → show "Sign in or create account to accept invitation to {workspace.name}" with sign-up/sign-in CTAs (token preserved through auth flow)
- If valid + authenticated → "Accept invitation to {workspace.name} as {role}" button
- On accept: insert workspace_member row, mark invitation `accepted_at`, redirect to `/app/{slug}/dashboard` with toast "Joined {workspace.name}"

**C3. Member management**
- Members list with role-change dropdowns:
  - Owners can change any non-owner role (admin/editor/viewer)
  - Admins can change editor/viewer only (cannot change other admins, cannot promote to admin)
  - Editor/viewer cannot change any roles
- "Revoke invitation" button on pending invitations (owner/admin only)
- "Leave workspace" button at bottom of own member row
- **Last-owner protection**: enforced at DB level via trigger or RLS — last owner cannot leave; UI shows "Transfer ownership first" message (transfer feature deferred to Sprint 03)
- "Remove member" button for owner/admin to remove non-owner members

### D. Billing

**D1. Pricing page**
- `/pricing` — public landing page describing tiers
- Three tiers: Free (OSS), Solo ($49/mo), Studio ($129/mo) — placeholder copy, real marketing in Sprint 12
- "Upgrade" buttons go to `/api/billing/checkout?tier=solo` or `?tier=studio`
- Free tier is "Self-host or hosted with limits"; clear "Open source — fully self-hostable" callout

**D2. Stripe Checkout flow**
- `POST /api/billing/checkout` (auth required, owner-only)
- Creates Stripe Checkout session with:
  - `mode: 'subscription'`
  - `metadata: { workspace_id, plan_tier }`
  - Test-mode product/price IDs from environment variables: `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_STUDIO`
  - Success URL: `/app/[slug]/settings?checkout=success`
  - Cancel URL: `/pricing?canceled=true`
- Redirect user to Stripe Checkout

**D3. Customer Portal**
- `POST /api/billing/portal` (auth required, owner-only)
- Creates Stripe Customer Portal session for the workspace's `stripe_customer_id`
- Returns redirect URL
- Available from workspace settings page

**D4. Webhook handler — real event processing**
- Existing handler at `/api/webhooks/stripe` (Sprint 01 Step 8) gets real logic
- Persistent dedup via `stripe_events` table (drop in-memory dedup)
- Events handled:
  - `checkout.session.completed` → set `workspace.stripe_subscription_id`, set `plan_tier` from `metadata.plan_tier`, set `subscription_status='active'`, set `subscription_current_period_end`
  - `customer.subscription.updated` → update `plan_tier` based on subscription's price_id, update status + period_end
  - `customer.subscription.deleted` → set `plan_tier='free'`, `subscription_status='canceled'`
  - `invoice.payment_failed` → set `subscription_status='past_due'` (UI shows banner; no immediate downgrade)
  - **Past_due grace period**: 7 days. After 7 days of `past_due` (cron job, see D5), workspace `plan_tier` reverts to `free`. Workspace data is preserved.
- All event handling idempotent: insert into `stripe_events` with `event_id` as PK; `ON CONFLICT DO NOTHING` returns early

**D5. Past_due grace period enforcement**
- Trigger.dev scheduled task running daily: query workspaces where `subscription_status='past_due'` and `subscription_current_period_end < now() - interval '7 days'`
- For each: set `plan_tier='free'`, log event for observability
- This is the canonical example of a scheduled tenant task — uses `defineTenantTask` pattern? **No — this is system-level, not workspace-scoped. Document as the first non-tenant scheduled task, with security review of why it bypasses defineTenantTask.**

**D6. Workspace settings billing UI**
- Show current plan + "Manage billing" button → portal
- Show "Past due — please update payment method" banner if `subscription_status='past_due'`
- Show "Canceled — reverting to free in N days" if past_due is approaching grace expiry

### E. UI/UX baseline (catches Sprint 02 from feeling amateur)

**E1. Toast notifications**
- Install `sonner` package
- Add `<Toaster />` to root layout
- Use throughout the app for: invitation sent, role changed, member removed, workspace switched, account updated, sign-in error, etc.

**E2. 404 page**
- `apps/web/src/app/not-found.tsx`
- Branded message, "Back to dashboard" link

**E3. Error boundary**
- `apps/web/src/app/error.tsx` — root error boundary
- Branded "Something went wrong" message + retry button
- Captures to Sentry automatically via Sentry's Next.js integration

**E4. Loading states**
- `apps/web/src/app/app/[workspaceSlug]/dashboard/loading.tsx` — minimal skeleton
- Other authenticated routes get `loading.tsx` as appropriate

## Tests required

New RLS + integration tests (these become the cross-tenant gate going forward):

1. **Cross-tenant invitation creation blocked** — non-members and editor/viewer roles cannot create invitations for a workspace
2. **Cross-tenant invitation read blocked** — non-members cannot SELECT invitations from other workspaces
3. **Anonymous invitation lookup by token** — anonymous users CAN SELECT a single invitation by its token (for the accept page); verify they can ONLY get one row by exact token match
4. **Role-change permission gates**:
   - Only owners can change any non-owner role
   - Admins can change editor/viewer only (not admin/owner)
   - Editor/viewer cannot change any roles
5. **Last-owner protection** — last owner cannot leave the workspace via API or RLS bypass
6. **Webhook persistent idempotency** — same `event_id` twice → second is dedup'd via PK constraint, not in-memory state
7. **Subscription lifecycle**:
   - `checkout.session.completed` → `workspace.plan_tier` updates to metadata's tier
   - `customer.subscription.updated` → `plan_tier` reflects new state
   - `customer.subscription.deleted` → `plan_tier='free'`, `subscription_status='canceled'`
   - `invoice.payment_failed` → `subscription_status='past_due'` (no immediate downgrade)
8. **Past_due grace period** — after 7 days of `past_due`, scheduled task downgrades plan; data preserved
9. **Invitation acceptance**:
   - Valid token + authenticated user → workspace_member created, accepted_at set, no duplicates
   - Expired token → rejected, no membership created
   - Already-accepted token → rejected (token reuse)
10. **Password reset flow** — request → email sent (mock Resend), reset link valid; expired link rejected; old password no longer works after reset

## Out of scope

- **Workspace deletion** — soft-delete is more complex than it appears (every query needs `deleted_at` filter; what about invitations to deleted workspaces?). Defer to Sprint 03.
- **Ownership transfer** — also complex (old owner's role? new owner confirmation flow?). Defer to Sprint 03.
- **Account deletion** — GDPR scope. Defer to Sprint 03+ with proper data-handling review.
- **Trial periods** — not in Sprint 02 launch; revisit before Sprint 12 launch.
- **Email domain verification on Resend** — Sprint 03+; uses `onboarding@resend.dev` for now. Real authently.io sending requires DNS verification.
- **Real marketing copy for `/pricing`** — Sprint 12 launch polish.
- **Real pricing decisions** — Solo $49 / Studio $129 are placeholders matching build_plan_v2.docx; revisit before Sprint 12.
- **OAuth providers for sign-in** — email/password only continues through Phase 1.
- **Voice profile generation** — Sprint 03+
- **Source ingestion** — Sprint 05+
- **Real social platform adapters** — Sprint 10+
- **Public REST API (`/api/v1/*`)** — Sprint 04
- **Anything voice/Authenticity-Engine related** — Sprint 03+
- **E2E browser tests** — deferred to before Phase 2 launch (Sprint 18). Manual smoke test continues.
- **Mobile-responsive testing** — manually verify the four core pages on mobile viewport at end of sprint, but no formal mobile QA pass.

## Done criteria

- [ ] All 7 front-loaded tech debt items shipped
- [ ] All Sprint 02 schema migrations named `YYYYMMDDHHMMSS_*.sql`
- [ ] `types.ts` regeneration enforced in CI
- [ ] `__debug/observability` endpoint removed
- [ ] Sentry `global-error.tsx` in place
- [ ] Favicon visible
- [ ] Password reset flow works end-to-end (request → email → set new password → sign in with new)
- [ ] Account settings page allows updating `full_name`
- [ ] Header user menu replaces standalone sign-out + adds workspace switcher
- [ ] User can create a new workspace from the switcher; lands on new dashboard
- [ ] Workspace settings page (rename, template, members link, billing button) works for owners/admins
- [ ] Owner can invite a teammate by email; teammate receives email; accept flow works for both new-signup and existing-user paths
- [ ] Member-list page shows roles; role-change permissions enforced (owner > admin > editor/viewer)
- [ ] Last owner cannot leave the workspace
- [ ] Stripe Checkout works in test mode for Solo and Studio tiers
- [ ] Stripe Customer Portal accessible from workspace settings
- [ ] Webhook handler updates `plan_tier` on subscription events; idempotent via `stripe_events` table
- [ ] Past_due banner shows; 7-day grace period downgrade works (test by manipulating `subscription_current_period_end`)
- [ ] sonner toasts visible on user actions
- [ ] 404 page is branded
- [ ] Error boundary catches and displays branded message
- [ ] All new RLS tests pass
- [ ] `smoke_test` table dropped; old tests removed
- [ ] All 4 local gates pass (license-headers, typecheck, lint, test:rls)
- [ ] Manual smoke test (multi-user, multi-tier, end-to-end):
  1. Sign up as User A → land on dashboard
  2. Forget password → use reset flow → sign back in
  3. Update full name → workspace switcher reflects change (header avatar initials update)
  4. Invite User B as editor → User B receives email
  5. User B accepts (new sign-up flow with token) → both see workspace
  6. User A upgrades to Solo tier in Stripe Checkout → returns to settings → sees plan_tier = 'solo'
  7. User A opens Customer Portal → cancels → webhook fires → plan_tier returns to 'free'
  8. User A creates a second workspace → switcher works → both workspaces accessible

## Notes for Claude Code

- Sprint 02 touches 5 distinct subsystems (DB, API, UI, billing, account). Don't try to ship them together — work in clearly-scoped chunks. Suggested order: tech debt → account basics + header menu → workspace switcher + management → invitations → billing
- Idempotency is critical for billing — webhook events arrive in any order, can repeat, can race
- The "last owner can't leave" rule must be enforced at the DB level (trigger or RLS), not just in the API
- Invitation tokens must be cryptographically random; use pgcrypto's `gen_random_bytes` (already in extensions schema from Sprint 01)
- Resend's free tier rate limits — bulk-invite testing can hit them; throttle in test
- All price IDs (`STRIPE_PRICE_SOLO`, `STRIPE_PRICE_STUDIO`) must be created in Stripe Dashboard test mode and added to `apps/web/.env.local` before D2 work begins. Document the creation steps in a Sprint 02 runbook (`docs/runbooks/stripe-products.md`).
- The grace period scheduled task is the first non-workspace-scoped Trigger.dev task in the codebase — security review and document why it bypasses `defineTenantTask`
- All public-facing pages (login, sign-up, pricing, forgot-password, reset-password, invite/[token]) must work without authentication
