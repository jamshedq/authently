-- =============================================================================
-- Authently migration
-- Created: 2026-04-30T23:47:23.756Z
-- Slug: set_workspace_stripe_customer
--
-- Sprint 02 Section D Commit 2 — Stripe customer pre-creation support.
--
-- Background: Section D Commit 1 lets process_stripe_event populate
-- workspace.stripe_customer_id from the checkout.session.completed event
-- (via `coalesce(_customer_id, stripe_customer_id)` in the UPDATE). That
-- works, but the customer is created lazily by Stripe at session time and
-- has no metadata linking it back to a workspace_id. Result: support
-- debugging from the Stripe Dashboard side requires cross-referencing
-- session.metadata or subscription.metadata, never the customer record itself.
--
-- This migration adds the SECURITY DEFINER RPC the checkout flow uses to
-- persist a pre-created Stripe customer ID onto the workspace BEFORE
-- handing off to Stripe Checkout. The pattern is:
--
--   1. apps/web checks workspace.stripe_customer_id (read via service-role)
--   2. If null, calls stripe.customers.create({ metadata: { workspace_id }})
--   3. Calls public.svc_set_workspace_stripe_customer to persist the ID
--   4. Calls stripe.checkout.sessions.create({ customer: <id>, ... })
--
-- The RPC is idempotent: it only updates if the workspace's current
-- stripe_customer_id is null. A concurrent checkout that pre-created a
-- different customer (race) lands a no-op here, and Stripe reconciles via
-- the customer.subscription.updated event from Commit 1's webhook handler.
-- (In practice the route's withMembership owner-only gate makes this race
-- effectively impossible for a single workspace; the defensive WHERE is
-- belt-and-braces against future code that loosens that gate.)
--
-- Schema: follows the canonical pattern from migration
-- 20260430231812_billing_rpc_pattern_refactor — `private.<name>_impl`
-- worker + `public.svc_<name>` thin wrapper, both SECURITY DEFINER and
-- granted exclusively to service_role.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- private.set_workspace_stripe_customer_impl — worker
-- ---------------------------------------------------------------------------
create or replace function private.set_workspace_stripe_customer_impl(
  _workspace_id uuid,
  _stripe_customer_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _workspace_id is null then
    raise exception 'workspace_id is required'
      using errcode = '22023';
  end if;
  if _stripe_customer_id is null or length(_stripe_customer_id) = 0 then
    raise exception 'stripe_customer_id is required'
      using errcode = '22023';
  end if;

  -- Defensive idempotency: only set if currently null. A workspace that
  -- already has a customer_id keeps the original (the new one stripe.com
  -- created in the racing call is harmless — it has no subscription
  -- attached and Stripe garbage-collects unused customers).
  update public.workspaces
    set stripe_customer_id = _stripe_customer_id
    where id = _workspace_id
      and stripe_customer_id is null;
end;
$$;

revoke all on function private.set_workspace_stripe_customer_impl(uuid, text) from public;
revoke all on function private.set_workspace_stripe_customer_impl(uuid, text) from anon, authenticated;
grant execute on function private.set_workspace_stripe_customer_impl(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.svc_set_workspace_stripe_customer — wrapper
-- ---------------------------------------------------------------------------
create or replace function public.svc_set_workspace_stripe_customer(
  _workspace_id uuid,
  _stripe_customer_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.set_workspace_stripe_customer_impl(_workspace_id, _stripe_customer_id);
end;
$$;

revoke all on function public.svc_set_workspace_stripe_customer(uuid, text) from public;
revoke all on function public.svc_set_workspace_stripe_customer(uuid, text) from anon, authenticated;
grant execute on function public.svc_set_workspace_stripe_customer(uuid, text) to service_role;
