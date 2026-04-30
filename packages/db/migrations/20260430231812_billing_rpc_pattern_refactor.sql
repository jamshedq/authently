-- =============================================================================
-- Authently migration
-- Created: 2026-04-30T23:18:12.153Z
-- Slug: billing_rpc_pattern_refactor
--
-- Sprint 02 Section D Commit 1 — refactor billing RPCs to canonical pattern.
--
-- Background: migrations 20260430200155_billing_event_processor and
-- 20260430200413_billing_grace_period created the four billing RPCs
-- directly in `public` schema with service-role-only GRANTs:
--   public.upsert_stripe_price_tier_map
--   public.process_stripe_event
--   public.find_workspaces_past_due_grace_expired
--   public.downgrade_workspace_to_free
--
-- The functional behavior is correct (perimeter holds via GRANT), but the
-- placement deviates from the Sprint 01/02 architectural pattern that the
-- rest of the codebase follows: SECURITY DEFINER workers in `private`,
-- thin wrappers in `public.api_*` (user-callable) or `public.svc_*`
-- (service-role-only callable).
--
-- This migration restores pattern consistency:
--
--   private.<name>_impl                  — the implementation (worker)
--   public.svc_<name>                    — thin wrapper, delegates to the worker
--
-- Naming convention now formally documented in CLAUDE.md:
--   public.api_<name> + private.<name>(_impl)   — user-callable boundary + worker
--   public.svc_<name> + private.<name>_impl     — service-role-only boundary + worker
--   private.<name>                              — never HTTP-callable (RLS helpers)
--
-- App code, tests, and the Trigger.dev grace-period task all switch to
-- the public.svc_<name> entry points. The private.<name>_impl bodies
-- carry the full logic from migrations 200155/200413, unchanged.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: drop the original public.* functions.
-- ---------------------------------------------------------------------------
-- DROP requires exact signature. Order of drops doesn't matter; no internal
-- references between them.

drop function if exists public.upsert_stripe_price_tier_map(jsonb);
drop function if exists public.process_stripe_event(text, text, jsonb, text, text, text, uuid, timestamptz);
drop function if exists public.find_workspaces_past_due_grace_expired();
drop function if exists public.downgrade_workspace_to_free(uuid);

-- ---------------------------------------------------------------------------
-- Step 2a: private.upsert_stripe_price_tier_map_impl — worker
-- ---------------------------------------------------------------------------
-- Body identical to the original public.upsert_stripe_price_tier_map.
create or replace function private.upsert_stripe_price_tier_map_impl(_entries jsonb)
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
      using errcode = '22023';
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

revoke all on function private.upsert_stripe_price_tier_map_impl(jsonb) from public;
revoke all on function private.upsert_stripe_price_tier_map_impl(jsonb) from anon, authenticated;
grant execute on function private.upsert_stripe_price_tier_map_impl(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Step 2b: public.svc_upsert_stripe_price_tier_map — wrapper
-- ---------------------------------------------------------------------------
-- Service-role-only callable via PostgREST. Delegates to the private worker.
-- SECURITY DEFINER + postgres ownership lets the wrapper invoke the private
-- worker without needing per-caller grants on the worker.
create or replace function public.svc_upsert_stripe_price_tier_map(_entries jsonb)
returns int
language sql
security definer
set search_path = ''
as $$
  select private.upsert_stripe_price_tier_map_impl(_entries);
$$;

revoke all on function public.svc_upsert_stripe_price_tier_map(jsonb) from public;
revoke all on function public.svc_upsert_stripe_price_tier_map(jsonb) from anon, authenticated;
grant execute on function public.svc_upsert_stripe_price_tier_map(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Step 3a: private.process_stripe_event_impl — worker
-- ---------------------------------------------------------------------------
-- Body identical to the original public.process_stripe_event from migration
-- 20260430200155 (full state-machine: dedup PK, six-outcome dispatch,
-- defensive subscription_id WHERE on each subscription-bound branch,
-- outcome-not-set developer-mistake guard, persisted forensics).
create or replace function private.process_stripe_event_impl(
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
  outcome text := null;
begin
  insert into public.stripe_events (event_id, type, payload, processed_outcome)
  values (_event_id, _type, coalesce(_payload, '{}'::jsonb), null)
  on conflict (event_id) do nothing;

  if not found then
    return 'deduplicated';
  end if;

  case _type

    when 'checkout.session.completed' then
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
          update public.workspaces
            set subscription_status = 'past_due',
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

  if outcome is null then
    raise warning 'process_stripe_event: outcome unset for event_id=% type=% — implementation bug',
      _event_id, _type;
    outcome := 'processed';
  end if;

  update public.stripe_events
    set processed_outcome = outcome,
        workspace_id = resolved_workspace_id
    where event_id = _event_id;

  return outcome;
end;
$$;

revoke all on function private.process_stripe_event_impl(text, text, jsonb, text, text, text, uuid, timestamptz) from public;
revoke all on function private.process_stripe_event_impl(text, text, jsonb, text, text, text, uuid, timestamptz) from anon, authenticated;
grant execute on function private.process_stripe_event_impl(text, text, jsonb, text, text, text, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Step 3b: public.svc_process_stripe_event — wrapper
-- ---------------------------------------------------------------------------
create or replace function public.svc_process_stripe_event(
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
language sql
security definer
set search_path = ''
as $$
  select private.process_stripe_event_impl(
    _event_id, _type, _payload, _customer_id,
    _subscription_id, _price_id, _workspace_id_hint, _current_period_end
  );
$$;

revoke all on function public.svc_process_stripe_event(text, text, jsonb, text, text, text, uuid, timestamptz) from public;
revoke all on function public.svc_process_stripe_event(text, text, jsonb, text, text, text, uuid, timestamptz) from anon, authenticated;
grant execute on function public.svc_process_stripe_event(text, text, jsonb, text, text, text, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Step 4a: private.find_workspaces_past_due_grace_expired_impl — worker
-- ---------------------------------------------------------------------------
create or replace function private.find_workspaces_past_due_grace_expired_impl()
returns table(workspace_id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select w.id
    from public.workspaces w
    where w.subscription_status = 'past_due'
      and w.past_due_since is not null
      and w.past_due_since < (now() - interval '7 days')
$$;

revoke all on function private.find_workspaces_past_due_grace_expired_impl() from public;
revoke all on function private.find_workspaces_past_due_grace_expired_impl() from anon, authenticated;
grant execute on function private.find_workspaces_past_due_grace_expired_impl() to service_role;

-- ---------------------------------------------------------------------------
-- Step 4b: public.svc_find_workspaces_past_due_grace_expired — wrapper
-- ---------------------------------------------------------------------------
create or replace function public.svc_find_workspaces_past_due_grace_expired()
returns table(workspace_id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select * from private.find_workspaces_past_due_grace_expired_impl();
$$;

revoke all on function public.svc_find_workspaces_past_due_grace_expired() from public;
revoke all on function public.svc_find_workspaces_past_due_grace_expired() from anon, authenticated;
grant execute on function public.svc_find_workspaces_past_due_grace_expired() to service_role;

-- ---------------------------------------------------------------------------
-- Step 5a: private.downgrade_workspace_to_free_impl — worker
-- ---------------------------------------------------------------------------
create or replace function private.downgrade_workspace_to_free_impl(_workspace_id uuid)
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

  update public.workspaces
    set plan_tier = 'free',
        subscription_status = 'canceled',
        past_due_since = null,
        subscription_current_period_end = null,
        stripe_subscription_id = null
    where id = _workspace_id
      and subscription_status = 'past_due';
end;
$$;

revoke all on function private.downgrade_workspace_to_free_impl(uuid) from public;
revoke all on function private.downgrade_workspace_to_free_impl(uuid) from anon, authenticated;
grant execute on function private.downgrade_workspace_to_free_impl(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Step 5b: public.svc_downgrade_workspace_to_free — wrapper
-- ---------------------------------------------------------------------------
create or replace function public.svc_downgrade_workspace_to_free(_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.downgrade_workspace_to_free_impl(_workspace_id);
end;
$$;

revoke all on function public.svc_downgrade_workspace_to_free(uuid) from public;
revoke all on function public.svc_downgrade_workspace_to_free(uuid) from anon, authenticated;
grant execute on function public.svc_downgrade_workspace_to_free(uuid) to service_role;
