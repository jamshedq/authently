# Observability Runbook

Last updated: Sprint 01, Step 8 (initial). Future updates by humans during
incident response or operational changes.

## What's wired

| Tool   | Purpose                                            | SDK              | Init location                              |
| ------ | -------------------------------------------------- | ---------------- | ------------------------------------------ |
| Sentry | Exception tracking, performance traces, breadcrumbs | `@sentry/nextjs` | `apps/web/sentry.{client,server,edge}.config.ts` + `instrumentation.ts` |
| Axiom  | Structured logs, web-vitals                         | `next-axiom`     | `<AxiomWebVitals />` in `apps/web/src/app/layout.tsx`; `Logger` in routes |

Both SDKs are no-ops without env vars. With env vars set, they ship events
to their respective dashboards. There's no silent fallback path — if
events aren't arriving, it's almost always a missing env var.

## Required env vars

In `apps/web/.env.local` (local dev) or the deployment env:

| Var                       | Used by             | Required when                            |
| ------------------------- | ------------------- | ---------------------------------------- |
| `NEXT_PUBLIC_SENTRY_DSN`  | Sentry (client+server) | Capturing client-side errors           |
| `SENTRY_DSN`              | Sentry (server)     | Server-only DSN if it differs from public |
| `SENTRY_AUTH_TOKEN`       | Sentry (build)      | Source-map upload during `next build`    |
| `SENTRY_ORG`              | Sentry (build)      | Same — paired with auth token            |
| `SENTRY_PROJECT`          | Sentry (build)      | Same                                     |
| `AXIOM_TOKEN`             | Axiom               | Shipping logs upstream                   |
| `AXIOM_DATASET`           | Axiom               | Same                                     |

See `apps/web/.env.local.example` for the canonical template.

## Verifying locally

There's a dev-only debug endpoint that exercises both SDKs:

```sh
# 1. Set the relevant env vars in apps/web/.env.local
# 2. Boot the dev server
pnpm --filter @authently/web dev

# 3. Hit the probe
curl 'http://localhost:3000/api/__debug/observability?sentry=1&axiom=1'
```

Expected response (DSN/token set):

```json
{
  "ok": true,
  "sentry": "captured (DSN set — should appear in Sentry within seconds)",
  "axiom":  "logged (AXIOM_TOKEN set — should appear in dataset within ~1 minute)"
}
```

If a DSN/token is unset, the response is honest about it ("captured
locally", "logged locally") and nothing reaches the upstream service.

The endpoint returns `404` outside `NODE_ENV === "development"`, so it's
inert in production builds. **It will be removed in Sprint 02** — see
`apps/web/src/app/api/__debug/observability/route.ts` header.

## Verifying in production (or staging)

The debug endpoint is dev-only. To verify production:

### Sentry

1. Open the Sentry project dashboard (org/project from the env vars).
2. Trigger any unhandled error in the app — for example, hit an API route
   while STRIPE_WEBHOOK_SECRET is intentionally unset and the webhook
   handler returns 500.
3. Within ~30s the error should appear under "Issues".
4. If nothing arrives, check (a) DSN matches the project, (b) the build
   actually included `instrumentation.ts` (look for "Sentry initialised"
   in the function logs), (c) the rate-limit hasn't kicked in.

### Axiom

1. Open Axiom; switch to the dataset named in `AXIOM_DATASET`.
2. Hit any page that includes `<AxiomWebVitals />` (any page — it lives
   in the root layout). Web vitals should arrive within ~1 minute.
3. Or trigger any route that uses `Logger` from `next-axiom` —
   currently the Stripe webhook (`/api/webhooks/stripe`) and the debug
   endpoint.
4. If nothing arrives, check (a) `AXIOM_TOKEN` has ingest permission for
   the dataset, (b) the route actually called `await log.flush()`,
   (c) network egress isn't blocked.

## Common failure modes

| Symptom                                | Likely cause                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| No events in Sentry, no errors in app  | DSN unset or pointing at the wrong project                                             |
| Events in Sentry but no source maps    | `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` unset at build time              |
| No logs in Axiom dataset               | `AXIOM_TOKEN` unset, dataset name typo, or the route forgot `await log.flush()`        |
| Webhook 400s after deploy              | `STRIPE_WEBHOOK_SECRET` rotated in Stripe Dashboard but env var not updated in Vercel  |
| Sentry capturing duplicate events      | `instrumentation-client.ts` and `sentry.client.config.ts` both initialising — pick one |

## Stripe webhook ↔ observability

Every verified webhook event emits:

- A Sentry breadcrumb (`category: "webhook.stripe"`) — visible on any
  exception captured during the same request, useful for debugging
  handler crashes.
- An Axiom log line (`source: "webhook.stripe"`) at `info` level with
  `eventId` and `type`.

A failed signature check emits a Sentry `captureMessage` at `warning`
level — repeated patterns there indicate scanning or a misconfigured
Stripe CLI on the dev side. The raw body and signature are NEVER logged.

## Local Stripe webhook testing

Once you have a Stripe account and CLI installed:

```sh
# In one terminal: forward Stripe webhooks to your local dev server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Stripe CLI prints a webhook signing secret like `whsec_...`. Put it in
# apps/web/.env.local as STRIPE_WEBHOOK_SECRET. Restart `pnpm dev`.

# In another terminal: trigger a test event
stripe trigger checkout.session.completed
```

The webhook should:
1. Return 200 (signature verifies)
2. Show a breadcrumb in Sentry
3. Emit an Axiom log line

If you trigger the same event twice quickly, the second response will
include `"deduped": true` (in-memory dedup, single-process).

## Sprint 02 cleanup

When this runbook is no longer needed:
- Delete `apps/web/src/app/api/__debug/observability/`.
- Update or delete this runbook accordingly.
