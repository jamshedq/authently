-- =============================================================================
-- Authently migration
-- Created: 2026-05-01T02:56:54.720Z
-- Slug: billing_customer_id_fallback
--
-- Defense-in-depth fix for the chicken-and-egg deadlock surfaced during
-- Section D Commit 2's manual smoke test (PR #6, 2026-05-01):
--
-- Before: customer.subscription.updated / .deleted / invoice.payment_failed /
-- invoice.payment_succeeded resolved the workspace ONLY by stripe_subscription_id.
-- If the prior checkout.session.completed event failed to write
-- stripe_subscription_id (e.g. because line_items wasn't expanded and the
-- price_id lookup failed → 'unknown_price'), every subsequent event for that
-- subscription became 'workspace_not_found' even though we knew the customer.
--
-- After: each of the four subscription-bound branches falls back to a
-- stripe_customer_id lookup if the subscription_id lookup misses, GUARDED by
-- `stripe_subscription_id IS NULL`. The guard prevents accidental matches
-- against a workspace that is already linked to a different active
-- subscription (which would be a hard subscription_mismatch on the original
-- path anyway). When fallback fires, the UPDATE links the subscription_id
-- in the same statement so subsequent events for the same subscription
-- resolve via the primary path.
--
-- The companion fix in apps/web (stripe.checkout.sessions.retrieve with
-- expand: ['line_items']) addresses the upstream cause; this migration is
-- defense-in-depth for out-of-order events, manual Stripe Dashboard actions,
-- and any future cases where customer_id is the only resolvable signal.
--
-- Wrapper public.svc_process_stripe_event in 20260430231812 is unchanged;
-- it still delegates to private.process_stripe_event_impl by name.
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
                -- Race-safe: checkout.session.completed has no period_end on
                -- the wire; if customer.subscription.updated raced ahead and
                -- set this column to a real date, preserve it.
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
