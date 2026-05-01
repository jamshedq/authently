-- =============================================================================
-- Authently migration
-- Created: 2026-05-01T17:13:26.383Z
-- Slug: billing_period_end_monotonic
--
-- Sprint 02 retro [CARRYOVER] → Sprint 03 Section A item A2.
--
-- Forward-only `subscription_current_period_end` predicate on the
-- `customer.subscription.updated` branch of process_stripe_event.
-- Defends against same-subscription out-of-order webhook delivery with
-- different period_ends — Stripe's "object snapshot" delivery semantics
-- mean each subscription.updated event carries the FULL current state
-- of the subscription, so an older event arriving after a newer one
-- would otherwise overwrite the newer state.
--
-- Strictly stronger guarantee than the null-vs-populated `coalesce` on
-- the checkout.session.completed branch (commit e950949): that fix only
-- handles `_current_period_end IS NULL` clobber; this fix handles
-- "older non-null timestamp" clobber as well.
--
-- Scope: ONLY customer.subscription.updated.
--
--   - checkout.session.completed: keeps the existing
--     `coalesce(_current_period_end, subscription_current_period_end)`
--     in the SET clause. Adding a WHERE-clause predicate would skip the
--     entire UPDATE when `_current_period_end` is null (which is always
--     the case for checkout sessions — the field lives on the
--     subscription object, not the session). That would un-fix
--     commit e950949's race-safe coalesce.
--
--   - customer.subscription.deleted: intentionally clears period_end
--     to null on cancellation. A forward-only predicate would prevent
--     the UPDATE from firing entirely.
--
--   - customer.subscription.updated: directly overwrites period_end
--     and is the actual case at risk from out-of-order delivery.
--     This is where the predicate goes.
--
-- Outcome semantics (broadened): when the predicate fails and the
-- UPDATE finds 0 rows, the function returns `subscription_mismatch`,
-- which previously meant strictly "subscription_id doesn't match the
-- workspace's stored value." It now ALSO covers "stale period_end
-- replay" for subscription.updated. The TS-side VALID_OUTCOMES set in
-- apps/web/src/services/webhooks/stripe/handle-event.ts is unchanged;
-- ops disambiguates via the SQL warning message which now reads
-- "subscription_mismatch_or_stale_period_end" and includes the
-- incoming period_end + the existing one for triage.
--
-- The wrapper public.svc_process_stripe_event in 20260430231812 is
-- unchanged; it still delegates to private.process_stripe_event_impl
-- by name and signature.
-- =============================================================================

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
                -- Race-safe (commit e950949): checkout.session.completed has
                -- no period_end on the wire; if customer.subscription.updated
                -- raced ahead and set this column to a real date, preserve it.
                -- Forward-only predicate is NOT applied here: it would skip
                -- the entire UPDATE when _current_period_end is null.
                subscription_current_period_end = coalesce(_current_period_end, subscription_current_period_end),
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

        if resolved_workspace_id is null and _customer_id is not null then
          -- Fallback: workspace pre-linked to this customer but never linked
          -- to the subscription (e.g. checkout.session.completed dropped on
          -- 'unknown_price'). The IS NULL guard prevents matching a workspace
          -- already linked to a different active subscription.
          select w.id into resolved_workspace_id
            from public.workspaces w
            where w.stripe_customer_id = _customer_id
              and w.stripe_subscription_id is null;
        end if;

        if resolved_workspace_id is null then
          raise warning 'process_stripe_event: workspace_not_found event_id=% type=% subscription_id=% customer_id=%',
            _event_id, _type, _subscription_id, _customer_id;
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
              set stripe_subscription_id = _subscription_id,
                  plan_tier = mapped_tier,
                  subscription_current_period_end = _current_period_end
              where id = resolved_workspace_id
                and (stripe_subscription_id = _subscription_id
                     or stripe_subscription_id is null)
                -- Forward-only period_end (Sprint 03 A2). Defends against
                -- Stripe's snapshot-semantics delivery: each subscription.updated
                -- carries the full subscription state, so an older event arriving
                -- after a newer one would otherwise overwrite the newer state.
                -- When _current_period_end is null, the < comparison evaluates
                -- to NULL (treated as false), so the IS NULL branch is the only
                -- way the predicate can match against a non-null existing value
                -- — meaning a null _current_period_end skips the UPDATE if
                -- existing is non-null. That's correct: subscription.updated
                -- always carries a real period_end on the wire; a null here
                -- would itself be a malformed/stale event.
                and (subscription_current_period_end is null
                     or subscription_current_period_end < _current_period_end);

            if not found then
              raise warning 'process_stripe_event: subscription_mismatch_or_stale_period_end event_id=% type=% subscription_id=% incoming_period_end=% — UPDATE matched 0 rows',
                _event_id, _type, _subscription_id, _current_period_end;
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

        if resolved_workspace_id is null and _customer_id is not null then
          select w.id into resolved_workspace_id
            from public.workspaces w
            where w.stripe_customer_id = _customer_id
              and w.stripe_subscription_id is null;
        end if;

        if resolved_workspace_id is null then
          raise warning 'process_stripe_event: workspace_not_found event_id=% type=% subscription_id=% customer_id=%',
            _event_id, _type, _subscription_id, _customer_id;
          outcome := 'workspace_not_found';
        else
          update public.workspaces
            set plan_tier = 'free',
                subscription_status = 'canceled',
                subscription_current_period_end = null,
                past_due_since = null,
                stripe_subscription_id = null
            where id = resolved_workspace_id
              and (stripe_subscription_id = _subscription_id
                   or stripe_subscription_id is null);

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

        if resolved_workspace_id is null and _customer_id is not null then
          select w.id into resolved_workspace_id
            from public.workspaces w
            where w.stripe_customer_id = _customer_id
              and w.stripe_subscription_id is null;
        end if;

        if resolved_workspace_id is null then
          raise warning 'process_stripe_event: workspace_not_found event_id=% type=% subscription_id=% customer_id=%',
            _event_id, _type, _subscription_id, _customer_id;
          outcome := 'workspace_not_found';
        else
          update public.workspaces
            set stripe_subscription_id = _subscription_id,
                subscription_status = 'past_due',
                past_due_since = coalesce(past_due_since, now())
            where id = resolved_workspace_id
              and (stripe_subscription_id = _subscription_id
                   or stripe_subscription_id is null);

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

        if resolved_workspace_id is null and _customer_id is not null then
          select w.id into resolved_workspace_id
            from public.workspaces w
            where w.stripe_customer_id = _customer_id
              and w.stripe_subscription_id is null;
        end if;

        if resolved_workspace_id is null then
          raise warning 'process_stripe_event: workspace_not_found event_id=% type=% subscription_id=% customer_id=%',
            _event_id, _type, _subscription_id, _customer_id;
          outcome := 'workspace_not_found';
        else
          update public.workspaces
            set stripe_subscription_id = _subscription_id,
                subscription_status = 'active',
                past_due_since = null
            where id = resolved_workspace_id
              and (stripe_subscription_id = _subscription_id
                   or stripe_subscription_id is null);

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

-- GRANTs unchanged from 20260430231812 — service_role only.
revoke all on function private.process_stripe_event_impl(text, text, jsonb, text, text, text, uuid, timestamptz) from public;
revoke all on function private.process_stripe_event_impl(text, text, jsonb, text, text, text, uuid, timestamptz) from anon, authenticated;
grant execute on function private.process_stripe_event_impl(text, text, jsonb, text, text, text, uuid, timestamptz) to service_role;
