-- =============================================================================
-- Authently migration
-- Created: 2026-04-30T19:58:52.311Z
-- Slug: billing_schema
--
-- Sprint 02 Section D Commit 1 — billing data layer (schema only).
--
-- Adds:
--   1. workspaces.subscription_status            'active' | 'past_due' | 'canceled'
--   2. workspaces.subscription_current_period_end timestamptz nullable
--   3. workspaces.past_due_since                 timestamptz nullable
--      Anchor for the 7-day grace-period downgrade. Set by
--      private.process_stripe_event when a subscription transitions into
--      past_due, cleared on transition back to active. This is a deviation
--      from the spec text (which proposed anchoring on
--      subscription_current_period_end) — see docs/retrospectives/SPRINT_02.md
--      for the reasoning. Bottom line: Stripe's dunning runs after period_end,
--      so anchoring on period_end can downgrade a workspace mid-dunning.
--   4. plan_tier check constraint                'free' | 'solo' | 'studio'
--      (Sprint 01 left plan_tier unconstrained beyond a default of 'free'.)
--   5. public.stripe_events                       persistent dedup + forensics
--   6. public.stripe_price_tier_map               price-id → plan-tier lookup
--
-- Multi-tenant rules (per CLAUDE.md):
--   - stripe_events / stripe_price_tier_map are NOT tenant-scoped business
--     tables. They are infrastructure: webhook-handler bookkeeping and a
--     workspace-agnostic price catalog. RLS is intentionally NOT enabled.
--     Access is restricted via GRANT (service_role only).
--   - workspaces.{plan_tier, stripe_*, subscription_*, past_due_since} stay
--     write-protected from authenticated callers via the column-level GRANT
--     established in 20260429213717_create_workspace_rpc.sql. Service-role
--     (the webhook handler) bypasses RLS to mutate them.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- workspaces — subscription state columns
-- ---------------------------------------------------------------------------

alter table public.workspaces
  add column subscription_status text not null default 'active'
    check (subscription_status in ('active', 'past_due', 'canceled'));

alter table public.workspaces
  add column subscription_current_period_end timestamptz;

alter table public.workspaces
  add column past_due_since timestamptz;

-- plan_tier check constraint. Sprint 01 left plan_tier with default 'free'
-- and no constraint. Backfill any legacy non-conformant values to 'free'
-- before adding the constraint, defensively (no production data exists yet,
-- but this keeps the migration safe to re-run against any future fixture).
update public.workspaces
  set plan_tier = 'free'
  where plan_tier not in ('free', 'solo', 'studio');

alter table public.workspaces
  add constraint workspaces_plan_tier_valid
    check (plan_tier in ('free', 'solo', 'studio'));

-- ---------------------------------------------------------------------------
-- public.stripe_events — persistent webhook event dedup + forensics
-- ---------------------------------------------------------------------------
-- The Stripe `event_id` is the canonical idempotency key. INSERT ... ON
-- CONFLICT (event_id) DO NOTHING in private.process_stripe_event makes
-- replay handling atomic.
--
-- The `payload` jsonb stores a CURATED ALLOWLIST of event metadata for
-- forensics (what we observed, not full Stripe data). Authoritative list
-- in apps/web/src/services/webhooks/stripe/extract-event-fields.ts; the
-- absolute exclusion is customer email and any other PII. Never store
-- session.customer_details here.
--
-- `processed_outcome` records the value process_stripe_event returned, so
-- ops can correlate dedup-vs-processed-vs-skipped without re-running logs.
create table public.stripe_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  payload jsonb not null,
  processed_outcome text
);

create index stripe_events_received_at_idx
  on public.stripe_events (received_at desc);

-- No RLS. Webhook handler runs as service_role; this table is not user-facing.
-- Lock down by GRANT.
revoke all on table public.stripe_events from public;
revoke all on table public.stripe_events from anon, authenticated;
grant select, insert, update on table public.stripe_events to service_role;

-- ---------------------------------------------------------------------------
-- public.stripe_price_tier_map — price-id → plan-tier lookup
-- ---------------------------------------------------------------------------
-- Empty at migration time. The webhook handler upserts entries from env
-- vars (STRIPE_PRICE_SOLO, STRIPE_PRICE_STUDIO) on its first invocation
-- per process via private.upsert_stripe_price_tier_map. Tests seed this
-- table directly via service-role.
--
-- Future tier additions (Pro, Agency, etc.) extend this table with no
-- schema migration: add the price ID, plan tier, env var, and the
-- workspaces_plan_tier_valid check constraint above. Unrecognized price IDs
-- in webhook events surface as a process_stripe_event 'unknown_price'
-- outcome (with raise warning) — the table-driven mapping makes this a
-- natural left-join behavior, not a code switch.
create table public.stripe_price_tier_map (
  stripe_price_id text primary key,
  plan_tier text not null check (plan_tier in ('solo', 'studio')),
  created_at timestamptz not null default now()
);

revoke all on table public.stripe_price_tier_map from public;
revoke all on table public.stripe_price_tier_map from anon, authenticated;
grant select, insert, update, delete on table public.stripe_price_tier_map to service_role;
