# Stripe Products & Webhook — Test Mode Setup

Last updated: Sprint 02 (initial setup before Section D code work).
Future updates by humans when price IDs rotate, when adding tiers, or
when graduating to live mode.

## Purpose

Stand up the Stripe test-mode resources Sprint 02 Section D depends on:
two products (Solo, Studio), their recurring price IDs, and a local
webhook listener so `/api/webhooks/stripe` receives real Stripe events
during dev. After this runbook is complete, `apps/web/.env.local` has
the three Stripe-related env vars Section D Commits 2+ assume exist
(`STRIPE_PRICE_SOLO`, `STRIPE_PRICE_STUDIO`, `STRIPE_WEBHOOK_SECRET`).

This is a one-time human task per Stripe account. Run it before starting
Section D Commit 2 (Stripe Checkout). Section D Commit 1 (DB migrations
+ webhook handler scaffolding) can proceed without it, but smoke testing
the webhook handler requires the `stripe listen` workflow set up below.

## Step 0 — Verify prerequisites

### Tools
- Stripe account with test-mode access (no live mode required for Sprint 02)
- Stripe CLI: `brew install stripe/stripe-cli/stripe` then `stripe login`
- Local dev server runnable via `pnpm dev` on `http://localhost:3000`

### Existing Stripe env vars (from Sprint 01 Step 8)
The Sprint 01 webhook scaffolding requires `STRIPE_SECRET_KEY` already
exists in `apps/web/.env.local`. Verify with:

```bash
grep -c '^STRIPE_SECRET_KEY=' apps/web/.env.local || echo "missing"
```

If missing, create one:
1. Stripe Dashboard → top-right user menu → Developers → API keys
2. Confirm "Test mode" toggle is on (URL contains `/test/`)
3. Copy the **Secret key** (starts with `sk_test_...`)
4. Add to `apps/web/.env.local`: `STRIPE_SECRET_KEY=sk_test_...`

`STRIPE_WEBHOOK_SECRET` will be (re)set in Step 4 below — Sprint 01's
value used a transient `stripe listen` secret that may already be stale.

Note: there is no `STRIPE_PUBLISHABLE_KEY` requirement. Section D uses
server-side Checkout and Customer Portal redirects only — no Stripe.js
on the client. If a future sprint adds client-side Elements, this
runbook will need updating.

## Step 1 — Confirm test mode

Stripe Dashboard top-right toggle → "Test mode" on. Every URL below
should contain `/test/` in the path. All product creation, price
creation, and webhook listening in this runbook is test-mode only.

Live-mode setup ships in Sprint 12 as a separate runbook.

## Step 2 — Create the Solo product

Dashboard → Product catalog → **+ Add product**.

| Field             | Value                                                      |
| ----------------- | ---------------------------------------------------------- |
| Name              | `Authently Solo`                                           |
| Description       | (placeholder — real marketing copy lands in Sprint 12)     |
| Pricing model     | Recurring                                                  |
| Price             | `$49.00` USD                                               |
| Billing period    | Monthly                                                    |
| Tax behavior      | Exclusive (revisit during Sprint 12 launch prep)           |

Save. On the resulting product page, copy the price ID — it starts with
`price_...`. This is `STRIPE_PRICE_SOLO`.

## Step 3 — Create the Studio product

Same flow as Step 2 with these values:

| Field             | Value              |
| ----------------- | ------------------ |
| Name              | `Authently Studio` |
| Price             | `$129.00` USD      |
| Billing period    | Monthly            |
| Tax behavior      | Exclusive          |

Copy the price ID. This is `STRIPE_PRICE_STUDIO`.

There is intentionally no Free product. `plan_tier='free'` is the
default state in the `workspaces` table — represented as the absence
of an active subscription, not a $0 Stripe product.

## Step 4 — Configure local webhook listener

Dashboard webhook endpoints cannot reach `localhost`, so local dev uses
the Stripe CLI's `stripe listen` to forward events to `http://localhost:3000`.
A real Dashboard endpoint at `https://api.authently.io/api/webhooks/stripe`
is configured later in the Sprint 12 production runbook.

Why `--print-secret` over a tunnel (e.g. ngrok / localhost.run): the
CLI's printed secret is stable across `stripe listen` restarts as long
as you reuse the same Stripe account, so .env.local doesn't drift every
time you restart the listener. Tunnels add a moving DNS dependency and
a second moving-parts service for no dev benefit at this stage.

### Print the stable secret (one-time)

```bash
stripe listen --print-secret
```

Output is a single line: `whsec_...`. Copy it. This is `STRIPE_WEBHOOK_SECRET`.

### Run the listener (separate terminal, leave running while developing)

```bash
stripe listen \
  --forward-to localhost:3000/api/webhooks/stripe \
  --events checkout.session.completed,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed
```

The `--events` filter matches the four events Section D's webhook
handler processes (Sprint 02 spec D4). Forwarding all events would also
work but produces noisier logs. Add events here when future sprints
extend the handler.

## Step 5 — Update apps/web/.env.local

Append (or update if values from Sprint 01 are stale):

```
STRIPE_PRICE_SOLO=price_...
STRIPE_PRICE_STUDIO=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Restart `pnpm dev` so Next.js picks up the new env. (Hot reload does
not re-read `.env.local`.)

## Step 6 — End-to-end verification

Three terminals:

| Terminal | Command                                          | Expectation                               |
| -------- | ------------------------------------------------ | ----------------------------------------- |
| A        | `stripe listen --forward-to ...` (from Step 4)   | Shows "Ready! Your webhook signing secret is..." |
| B        | `pnpm dev`                                       | Web app on :3000, env vars loaded          |
| C        | `stripe trigger checkout.session.completed`      | Triggers a synthetic event                |

Expected:
- Terminal A logs the event being forwarded with HTTP 200 from `/api/webhooks/stripe`
- Terminal B logs the event reaching the handler (in Sprint 02 Commit 1, the
  handler ack-and-noops; later commits add real DB writes)

If you see HTTP 400 ("invalid signature"), the secret in `.env.local`
doesn't match the one Terminal A is using — re-run `stripe listen --print-secret`,
update `.env.local`, restart `pnpm dev`.

## Step 7 — Test card reference

For the Section D manual smoke test (Sprint 02 spec lines 290–298),
these are the standard Stripe test cards. CVC: any 3 digits. Expiry:
any future date.

| Card                  | Behavior                                              | Use for                                    |
| --------------------- | ----------------------------------------------------- | ------------------------------------------ |
| `4242 4242 4242 4242` | Succeeds; subscription becomes active                 | Happy path: Free → Solo → Studio upgrades  |
| `4000 0000 0000 0341` | Card attaches; first invoice payment fails            | Testing `invoice.payment_failed` → past_due |
| `4000 0000 0000 0002` | Declines at checkout                                  | Testing checkout cancel / error UX         |

Full list: <https://docs.stripe.com/testing#cards>.

## Step 8 — Price ID drift (read before rotating)

If you ever rotate a price ID (Stripe doesn't let you edit a price
in-place — you archive the old one and create a new one), update it in
**both** places at the same commit:

1. `apps/web/.env.local` (local dev)
2. The corresponding Vercel Project env var (`STRIPE_PRICE_SOLO` /
   `STRIPE_PRICE_STUDIO`) in Preview and Production environments

The webhook handler reads price IDs from `customer.subscription.updated`
events to determine which `plan_tier` the new subscription corresponds
to (Sprint 02 spec D4). If the env var is stale, an upgrade event from
Stripe will arrive carrying a price ID the handler doesn't recognize,
and the workspace will silently keep its old `plan_tier` — a tier
mis-assignment with no error surfaced. The webhook handler should log
unrecognized price IDs at WARN level for exactly this reason; verify
that log in Axiom after any rotation.

This drift class also applies if Sprint 12 introduces separate live-mode
price IDs — the handler matches against whichever Stripe environment
issued the event, so test and live IDs must both be wired correctly per
deployment environment.

## Output checklist

After running this runbook end-to-end, you should have:

- [ ] `STRIPE_PRICE_SOLO=price_...` in `apps/web/.env.local`
- [ ] `STRIPE_PRICE_STUDIO=price_...` in `apps/web/.env.local`
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_...` in `apps/web/.env.local` (stable across CLI restarts)
- [ ] `STRIPE_SECRET_KEY=sk_test_...` confirmed present (from Sprint 01)
- [ ] `stripe listen --forward-to ...` workflow documented and runnable
- [ ] `stripe listen` printed a webhook signing secret that matches what's in `.env.local`
- [ ] `stripe trigger checkout.session.completed` returns 200 from local handler

## Common failures

| Symptom                                     | Likely cause                                    | Fix                                                            |
| ------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| HTTP 400 "invalid signature" in handler log | `STRIPE_WEBHOOK_SECRET` mismatch                | Re-run `--print-secret`, update `.env.local`, restart dev      |
| HTTP 404 from `stripe listen` forwarder     | Handler route missing or dev server down        | Confirm `pnpm dev` running; route exists at `/api/webhooks/stripe` |
| HTTP 500 with no log in handler             | Env var not loaded (forgot to restart `pnpm dev`) | Restart `pnpm dev`                                            |
| Checkout redirects to "No such price"       | `STRIPE_PRICE_*` value wrong or from live mode  | Re-verify in Dashboard with test mode toggle on                |
| Listener prints a different secret each run | Used `stripe listen` without `--print-secret` first | Run `stripe listen --print-secret` once and use that value    |

## Out of scope (Sprint 12+)

- Live-mode product/price creation (separate Sprint 12 runbook)
- Production webhook endpoint at `api.authently.io` (Sprint 12)
- Tax configuration via Stripe Tax (Sprint 12)
- Coupons, promotion codes, trial periods (post-launch)
- Annual billing tiers (post-launch — Sprint 02 ships monthly only)
- Live publishable key (no client-side Stripe.js until further notice)

## Scope boundary

This runbook covers test-mode dev setup only. The production webhook
and live-mode price configuration runbook ships in Sprint 12 launch
prep. Once that runbook exists, this file becomes historical reference
for how the dev workflow was originally established — keep it in tree
but mark it superseded at that time.
