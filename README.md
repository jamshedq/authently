# CONTENT_ENGINE

> Working name. Final brand to be selected.

An open-source, multi-tenant AI content engine for technical creators who want
to publish across social platforms without losing their voice to AI generic-ness.

This is alpha software, in active development, built in public. Sprint 1 of 28.

## Status

| Sprint | Focus                                              | Status      |
| ------ | -------------------------------------------------- | ----------- |
| 01     | Foundation — monorepo, RLS, AGPL, deploy pipeline  | in progress |

## What it is

- A Next.js 15 + Turborepo monorepo
- Multi-tenant from day 1 — every business table is workspace-scoped with RLS
- An "Authenticity Engine" (later sprints) designed to preserve voice instead of flattening it
- Bring-your-own keys, real APIs, real webhooks

## What it is not

- Not a Blotato clone
- Not a closed-source SaaS with a "free tier"
- Not optimized for engagement-bait, hashtag stuffing, or AI-tell-tale defaults

## License

- Core: **AGPL-3.0-or-later** — see [`LICENSE`](./LICENSE)
- Hosted-only features under [`packages/hosted-features/`](./packages/hosted-features) (added in later sprints): **proprietary** — see [`LICENSE-PROPRIETARY`](./LICENSE-PROPRIETARY)
- Ecosystem connectors (`packages/n8n-node`, `packages/make-module`): **MIT** when added in a later sprint

## Self-hosting

Self-host instructions land in Sprint 02. The repo does not yet build to a
runnable end-to-end product without the operational stack (Supabase, Stripe,
Trigger.dev, Vercel) — wiring is in progress.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). All contributors must sign the CLA
([`CLA.md`](./CLA.md)) before their PRs are merged.

## Build in public

Updates posted on X, LinkedIn, and Indie Hackers as each sprint ships.
