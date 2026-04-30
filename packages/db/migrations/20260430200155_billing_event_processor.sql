-- =============================================================================
-- Authently migration
-- Created: 2026-04-30T20:01:55.642Z
-- Slug: billing_event_processor
--
-- Sprint 02 Section D Commit 1 — billing event processor RPC.
--
-- Adds:
--   1. public.upsert_stripe_price_tier_map(_entries jsonb)
--      Bulk upsert helper for the price-id → plan-tier map. Called once
--      per webhook handler cold-start with [{stripe_price_id, plan_tier},
--      ...] entries derived from STRIPE_PRICE_SOLO and STRIPE_PRICE_STUDIO
--      env vars.
--
--   2. public.process_stripe_event(...)
--      The atomic dedup-and-process function for the five Stripe event
--      types Sprint 02 D handles:
--          checkout.session.completed
--          customer.subscription.updated
--          customer.subscription.deleted
--          invoice.payment_failed
--          invoice.payment_succeeded
--      Returns an outcome string from the set:
--          'processed'
--          'deduplicated'
--          'unknown_event_type'
--          'unknown_price'
--          'workspace_not_found'
--          'subscription_mismatch'
--      Idempotency: stripe_events.event_id is the dedup PK. INSERT ... ON
--      CONFLICT DO NOTHING combined with FOUND tells us first-time vs replay.
--      Anti-enumeration: workspace lookup failures and unknown price IDs
--      log RAISE WARNING and return early without raising. Stripe retries
--      problematic events; we don't 500 them into permanent retry loops.
--
-- Schema choice — public, not private:
--   The Sprint 01 `private` schema convention is for SECURITY DEFINER helpers
--   that are NEVER HTTP-callable (RLS helpers like is_workspace_member;
--   workers like ensure_workspace_for_user that are only called from inside
--   another public.api_* SECURITY DEFINER wrapper). PostgREST does not
--   expose `private` to any role.
--
--   The Stripe webhook handler is itself a PostgREST client (it uses
--   supabase-js → REST). For it to invoke these functions over HTTP, the
--   functions must live in a PostgREST-exposed schema. The security
--   perimeter is therefore the GRANT (service_role only), not the schema.
--   anon and authenticated callers are rejected at the GRANT layer; tests
--   in packages/db/tests/billing/process-stripe-event-rls.test.ts cover
--   that perimeter.
--
-- All functions follow the Sprint 01/02 SECURITY DEFINER hardening pattern:
--   - search_path pinned to ''
--   - all object refs fully qualified
--   - revoke all from public; explicit grant to service_role only
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- public.upsert_stripe_price_tier_map — bulk upsert from app env
-- ---------------------------------------------------------------------------
-- Caller passes a JSON array: [{"stripe_price_id":"price_...","plan_tier":"solo"}, ...]
-- Each entry is upserted by stripe_price_id. If plan_tier changes (e.g., a
-- price ID is reused for a different tier — should never happen but defensive),
-- the new value wins. Returns the count of rows upserted (debugging).
create or replace function public.upsert_stripe_price_tier_map(_entries jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected int := 0;
begin
  if _entries is null or jsonb_typeof(_entries) <> 'array' then
    raise exception '_entries must be a JSON array of {stripe_price_id, plan_tier} objects'
      using errcode = '22023'; -- invalid_parameter_value
  end if;

  with parsed as (
    select
      (entry ->> 'stripe_price_id')::text as stripe_price_id,
      (entry ->> 'plan_tier')::text as plan_tier
    from jsonb_array_elements(_entries) as entry
  ),
  upserted as (
    insert into public.stripe_price_tier_map (stripe_price_id, plan_tier)
    select stripe_price_id, plan_tier
      from parsed
      where stripe_price_id is not null
        and plan_tier is not null
    on conflict (stripe_price_id) do update
      set plan_tier = excluded.plan_tier
    returning 1
  )
  select count(*) from upserted into affected;

  return affected;
end;
$$;

revoke all on function public.upsert_stripe_price_tier_map(jsonb) from public;
revoke all on function public.upsert_stripe_price_tier_map(jsonb) from anon, authenticated;
grant execute on function public.upsert_stripe_price_tier_map(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- public.process_stripe_event — atomic dedup + state mutation dispatch
-- ---------------------------------------------------------------------------
-- Parameter contract:
--   _event_id            Stripe event ID (text). PK in stripe_events.
--   _type                Stripe event type. Branched on; unknown types
--                        record outcome='unknown_event_type' and return.
--   _payload             Curated allowlist jsonb. Stored in
--                        stripe_events.payload for forensics. NEVER contains
--                        customer email or other PII (assertion enforced in
--                        the route handler — see extract-event-fields.ts).
--   _customer_id         Stripe customer ID. Nullable.
--   _subscription_id     Stripe subscription ID. Nullable for events that
--                        don't carry one.
--   _price_id            Stripe price ID. Used to look up plan_tier via
--                        stripe_price_tier_map.
--   _workspace_id_hint   Set from session.metadata.workspace_id for
--                        checkout.session.completed events. Null otherwise;
--                        in those branches we resolve the workspace via
--                        stripe_subscription_id lookup.
--   _current_period_end  Set for subscription events; null for invoice
--                        events (which don't carry a period end directly).
--
-- Return value enum (text):
--   'processed'             — first-time event; state mutation applied
--   'deduplicated'          — event_id already in stripe_events; no-op
--   'unknown_event_type'    — _type not in our switch; row recorded but no mutation
--   'unknown_price'         — recognized event but _price_id not in map; warning logged
--   'workspace_not_found'   — couldn't resolve a workspace from the event; warning logged
--   'subscription_mismatch' — workspace's current stripe_subscription_id no longer
--                             matches _subscription_id (late/superseded event for an
--                             OLD subscription that's already been replaced).
--                             Defense-in-depth: in normal flow the prior SELECT
--                             validates subscription_id, so this branch is
--                             unreachable within a single transaction. The
--                             defensive WHERE on the UPDATE makes the invariant
--                             local to the mutation and survives future refactors.
--
-- All return paths persist outcome to stripe_events.processed_outcome via a
-- final UPDATE so ops can correlate from the table alone.
create or replace function public.process_stripe_event(
  _event_id text,
  _type text,
  _payload jsonb,
  _customer_id text,
  _subscription_id text,
  _price_id text,
  _workspace_id_hint uuid,
  _current_period_end timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_workspace_id uuid;
  mapped_tier text;
  -- Initialized to NULL so the developer-mistake guard at the end of the
  -- dispatch (before Step 3) can detect a forgotten branch assignment and
  -- raise a warning instead of writing NULL to processed_outcome.
  outcome text := null;
begin
  -- Step 1: dedup. INSERT ... ON CONFLICT DO NOTHING is the atomic
  -- idempotency primitive. If FOUND is false after the INSERT, this
  -- event_id was already in the table — replay; return early.
  insert into public.stripe_events (event_id, type, payload, processed_outcome)
  values (_event_id, _type, coalesce(_payload, '{}'::jsonb), null)
  on conflict (event_id) do nothing;

  if not found then
    return 'deduplicated';
  end if;

  -- Step 2: dispatch on event type.
  case _type

    when 'checkout.session.completed' then
      -- workspace_id_hint comes from session.metadata.workspace_id, set
      -- when we created the Checkout session (Sprint 02 D Commit 2).
      -- Fall back to subscription_id lookup if hint is missing (defensive).
      --
      -- This branch is exempt from the defensive UPDATE WHERE on
      -- stripe_subscription_id: it's the event that LINKS subscription_id
      -- to the workspace, so there's no current binding to compare against.
      if _workspace_id_hint is not null then
        resolved_workspace_id := _workspace_id_hint;
      elsif _subscription_id is not null then
        select w.id into resolved_workspace_id
          from public.workspaces w
          where w.stripe_subscription_id = _subscription_id;
      end if;

      if resolved_workspace_id is null then
        raise warning 'process_stripe_event: workspace_not_found event_id=% type=% subscription_id=%',
          _event_id, _type, _subscription_id;
        outcome := 'workspace_not_found';
      else
        select m.plan_tier into mapped_tier
          from public.stripe_price_tier_map m
          where m.stripe_price_id = _price_id;

        if mapped_tier is null then
          raise warning 'process_stripe_event: unknown_price event_id=% type=% price_id=%',
            _event_id, _type, _price_id;
          outcome := 'unknown_price';
        else
          update public.workspaces
            set stripe_subscription_id = coalesce(_subscription_id, stripe_subscription_id),
                stripe_customer_id = coalesce(_customer_id, stripe_customer_id),
                plan_tier = mapped_tier,
                subscription_status = 'active',
                subscription_current_period_end = _current_period_end,
                past_due_since = null
            where id = resolved_workspace_id;
          outcome := 'processed';
        end if;
      end if;

    when 'customer.subscription.updated' then
      if _subscription_id is null then
        raise warning 'process_stripe_event: workspace_not_found event_id=% type=% (no subscription_id)',
          _event_id, _type;
        outcome := 'workspace_not_found';
      else
        select w.id into resolved_workspace_id
          from public.workspaces w
          where w.stripe_subscription_id = _subscription_id;

        if resolved_workspace_id is null then
          raise warning 'process_stripe_event: workspace_not_found event_id=% type=% subscription_id=%',
            _event_id, _type, _subscription_id;
          outcome := 'workspace_not_found';
        else
          select m.plan_tier into mapped_tier
            from public.stripe_price_tier_map m
            where m.stripe_price_id = _price_id;

          if mapped_tier is null then
            raise warning 'process_stripe_event: unknown_price event_id=% type=% price_id=%',
              _event_id, _type, _price_id;
            outcome := 'unknown_price';
          else
            -- This branch updates plan_tier and current_period_end ONLY.
            -- It deliberately does NOT touch subscription_status or
            -- past_due_since. Recovery from past_due is the canonical job
            -- of invoice.payment_succeeded; a subscription.updated for a
            -- past_due customer (e.g. Stripe extending the period during
            -- dunning) should not silently flip status back to active.
            --
            -- Both event-ordering cases for "past_due customer upgrades
            -- tier via Checkout" yield the correct final state:
            --
            --   Case A — subscription.updated arrives first:
            --     [this branch]
            --       plan_tier=new, status=past_due (unchanged), past_due_since=preserved
            --     [next event: invoice.payment_succeeded]
            --       status='active', past_due_since=null
            --     Final: plan_tier=new, status='active', past_due_since=null   ✓
            --
            --   Case B — invoice.payment_succeeded arrives first:
            --     [recovery]
            --       status='active', past_due_since=null
            --     [this branch]
            --       plan_tier=new, status=unchanged ('active'), past_due_since=unchanged (null)
            --     Final: plan_tier=new, status='active', past_due_since=null   ✓
            --
            -- For a subscription.updated on an active customer (normal
            -- renewal-period extension or admin-driven price change), the
            -- branch leaves status='active' and past_due_since=null intact;
            -- this is the trivially-correct case.
            --
            -- Defensive subscription_id check on the UPDATE: protects against
            -- late/superseded events whose _subscription_id is for an
            -- already-replaced subscription. The prior SELECT also filters
            -- by subscription_id, so within this transaction the check is
            -- redundant — but it makes the invariant local to the UPDATE
            -- and survives future refactors that might decouple the two.
            update public.workspaces
              set plan_tier = mapped_tier,
                  subscription_current_period_end = _current_period_end
              where id = resolved_workspace_id
                and stripe_subscription_id = _subscription_id;

            if not found then
              raise warning 'process_stripe_event: subscription_mismatch event_id=% type=% subscription_id=%',
                _event_id, _type, _subscription_id;
              outcome := 'subscription_mismatch';
            else
              outcome := 'processed';
            end if;
          end if;
        end if;
      end if;

    when 'customer.subscription.deleted' then
      if _subscription_id is null then
        raise warning 'process_stripe_event: workspace_not_found event_id=% type=% (no subscription_id)',
          _event_id, _type;
        outcome := 'workspace_not_found';
      else
        select w.id into resolved_workspace_id
          from public.workspaces w
          where w.stripe_subscription_id = _subscription_id;

        if resolved_workspace_id is null then
          raise warning 'process_stripe_event: workspace_not_found event_id=% type=% subscription_id=%',
            _event_id, _type, _subscription_id;
          outcome := 'workspace_not_found';
        else
          -- Defensive subscription_id check on the UPDATE: see the matching
          -- comment in customer.subscription.updated.
          update public.workspaces
            set plan_tier = 'free',
                subscription_status = 'canceled',
                subscription_current_period_end = null,
                past_due_since = null,
                stripe_subscription_id = null
            where id = resolved_workspace_id
              and stripe_subscription_id = _subscription_id;

          if not found then
            raise warning 'process_stripe_event: subscription_mismatch event_id=% type=% subscription_id=%',
              _event_id, _type, _subscription_id;
            outcome := 'subscription_mismatch';
          else
            outcome := 'processed';
          end if;
        end if;
      end if;

    when 'invoice.payment_failed' then
      if _subscription_id is null then
        raise warning 'process_stripe_event: workspace_not_found event_id=% type=% (no subscription_id)',
          _event_id, _type;
        outcome := 'workspace_not_found';
      else
        select w.id into resolved_workspace_id
          from public.workspaces w
          where w.stripe_subscription_id = _subscription_id;

        if resolved_workspace_id is null then
          raise warning 'process_stripe_event: workspace_not_found event_id=% type=% subscription_id=%',
            _event_id, _type, _subscription_id;
          outcome := 'workspace_not_found';
        else
          -- Defensive subscription_id check on the UPDATE: see the matching
          -- comment in customer.subscription.updated.
          update public.workspaces
            set subscription_status = 'past_due',
                -- Anchor the grace period at the FIRST observed past_due.
                -- coalesce keeps the original timestamp on repeat failures.
                past_due_since = coalesce(past_due_since, now())
            where id = resolved_workspace_id
              and stripe_subscription_id = _subscription_id;

          if not found then
            raise warning 'process_stripe_event: subscription_mismatch event_id=% type=% subscription_id=%',
              _event_id, _type, _subscription_id;
            outcome := 'subscription_mismatch';
          else
            outcome := 'processed';
          end if;
        end if;
      end if;

    when 'invoice.payment_succeeded' then
      -- Recovery path. Stripe sends this when dunning succeeds (or when
      -- a normal renewal invoice is paid). For past_due workspaces we
      -- clear the past_due_since anchor and flip status back to active.
      -- For already-active workspaces the SET values match current state,
      -- so this is a no-op confirmation (still 'processed' — we observed
      -- the event correctly; there was nothing to do).
      if _subscription_id is null then
        raise warning 'process_stripe_event: workspace_not_found event_id=% type=% (no subscription_id)',
          _event_id, _type;
        outcome := 'workspace_not_found';
      else
        select w.id into resolved_workspace_id
          from public.workspaces w
          where w.stripe_subscription_id = _subscription_id;

        if resolved_workspace_id is null then
          raise warning 'process_stripe_event: workspace_not_found event_id=% type=% subscription_id=%',
            _event_id, _type, _subscription_id;
          outcome := 'workspace_not_found';
        else
          -- The WHERE clause matches the workspace by id AND subscription_id.
          -- It does NOT filter on past_due_since — we want this UPDATE to
          -- match exactly 1 row whether or not the workspace is currently
          -- past_due. Setting status='active' / past_due_since=null on an
          -- already-active workspace is a no-op SET; the row count is still
          -- 1, and the outcome is correctly 'processed'.
          --
          -- 'subscription_mismatch' (FOUND=false) only fires if the workspace's
          -- current stripe_subscription_id no longer matches _subscription_id
          -- — which is the late/superseded-event defensive case, distinct
          -- from the legitimate already-active idempotent case.
          update public.workspaces
            set subscription_status = 'active',
                past_due_since = null
            where id = resolved_workspace_id
              and stripe_subscription_id = _subscription_id;

          if not found then
            raise warning 'process_stripe_event: subscription_mismatch event_id=% type=% subscription_id=%',
              _event_id, _type, _subscription_id;
            outcome := 'subscription_mismatch';
          else
            outcome := 'processed';
          end if;
        end if;
      end if;

    else
      outcome := 'unknown_event_type';

  end case;

  -- Defensive guard against a developer mistake. Every branch above must
  -- assign `outcome` exactly once. If we reach here with outcome=null, a
  -- branch was added or modified without setting it — surface loudly in
  -- logs and treat as 'processed' so we don't write NULL to the forensics
  -- column. The dedup-insert at Step 1 has already happened, so callers
  -- have already observed the side effect of being "first time"; the
  -- coercion to 'processed' keeps the contract intact while making the
  -- bug impossible to miss in observability.
  if outcome is null then
    raise warning 'process_stripe_event: outcome unset for event_id=% type=% — implementation bug',
      _event_id, _type;
    outcome := 'processed';
  end if;

  -- Step 3: persist outcome + resolved workspace_id for forensics.
  update public.stripe_events
    set processed_outcome = outcome,
        workspace_id = resolved_workspace_id
    where event_id = _event_id;

  return outcome;
end;
$$;

revoke all on function public.process_stripe_event(text, text, jsonb, text, text, text, uuid, timestamptz) from public;
revoke all on function public.process_stripe_event(text, text, jsonb, text, text, text, uuid, timestamptz) from anon, authenticated;
grant execute on function public.process_stripe_event(text, text, jsonb, text, text, text, uuid, timestamptz) to service_role;
