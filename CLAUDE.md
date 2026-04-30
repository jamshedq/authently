# CLAUDE.md — Project Context

## What this project is

An open-source, multi-tenant AI content engine for technical creators who want to publish across social platforms without losing their voice to AI generic-ness. Hosted product available for non-technical creators and teams.

This is NOT a Blotato clone. It is a head-on competitor with a sharp differentiation strategy: open-source core (AGPL) + Authenticity Engine (voice preservation, anti-slop) + power-user/API-first design.

## Six product principles — every decision goes through these

1. **Voice over volume.** We help users sound more like themselves, not less.
2. **Authenticity over engagement.** We do not optimize for hooks, hashtag stuffing, or AI-tell-tales.
3. **Transparency over magic.** Every AI change is visible, diff-able, and reversible.
4. **Ownership over lock-in.** Open-source core, BYO keys, no vendor capture.
5. **Power-user respect.** Real APIs, real webhooks, real automation — not toy integrations.
6. **Build in public.** The product story is told as it's lived, not as a marketing campaign.

If a feature would violate one of these, do not ship it — even if a competitor does it.

## Architecture in one paragraph

Next.js 15 monorepo with Turbo. Web app + API routes in `apps/web`. Trigger.dev v4 for async work in `apps/jobs`. Modal-hosted Python worker for heavy media processing. Supabase Postgres with RLS as source of truth. Redis (Upstash) for rate limits + caching. S3 + CloudFront for media. Stripe for billing. All AI calls go through `packages/ai` with a model router. All platform calls go through `packages/adapters`. The Authenticity Engine lives in `packages/voice` and sits between source ingestion and remix output.

## Audiences (multi-tenant from day 1)

Three tenant templates served by one platform:
- **Individual creators** (PRIMARY — homepage speaks here)
- **SMBs** (secondary — supported via tenant templates and approval workflows)
- **Faith communities** (secondary — supported via tenant templates and multilingual packs)

The technical architecture treats them identically. Marketing and onboarding emphasize creators first.

## Open-source rules

- Repo is public from day 1. AGPL-3.0 license on the core engine.
- All code in `apps/web`, `apps/jobs`, `apps/media-worker`, `packages/db`, `packages/adapters`, `packages/ai`, `packages/voice`, `packages/shared`, `packages/ui` is AGPL.
- `packages/n8n-node` and `packages/make-module` use MIT for ecosystem reasons.
- Hosted-only features live in `packages/hosted-features` and are PROPRIETARY (clearly fenced; excluded from the OSS distribution).
- Every file in OSS packages has the AGPL license header. CI gates on missing/wrong headers.
- A CONTRIBUTING.md and CLA process exists — Claude Code may be asked to update them but should not invent terms.

## Multi-tenant rules — NON-NEGOTIABLE

1. Every business table has `workspace_id uuid not null references workspaces(id)`.
2. Every business table has an RLS policy: users can only access rows where they are a member of that workspace.
3. Every API route resolves `workspace_id` from the JWT or path parameter and asserts membership BEFORE any query.
4. Every Trigger.dev task takes `workspace_id` as the first payload field.
5. Every S3 key is namespaced as `ws/{workspace_id}/...`.
6. Service-role DB access is allowed only inside Trigger.dev tasks that explicitly assert workspace context.
7. CI runs the RLS test suite on every PR; cross-tenant access tests must fail.

## Coding rules

- TypeScript strict everywhere. No `any` without a `// @ts-expect-error` comment explaining why.
- Validate ALL external input with zod. API routes, webhooks, OAuth callbacks, AI outputs.
- Errors are structured: throw classes from `packages/shared/errors`, never strings.
- No business logic in API routes — routes are thin (validate → call service → return).
- Services live in `apps/web/src/services/{domain}/` and own all DB access for that domain.
- Tests required: unit tests for services, integration tests for API routes, RLS tests for every new table.
- Conventional commits. PRs reference the sprint spec they implement.
- Public API endpoints (`/api/v1/*`) are versioned and stable. Breaking changes require a new version, not a silent update.

## Authenticity Engine rules

When working in `packages/voice` or anywhere it's invoked:

- Voice profiles are NEVER silent. The user can always see why a draft was generated the way it was.
- Anti-slop guards are SUGGESTIONS, not silent rewrites. Every detection surfaces in the UI.
- Source Fidelity tracking must produce a diff. The user must be able to revert any AI change with one click.
- Refinement Chat must respect locked phrases. If a user says "don't change this sentence," subsequent generations must preserve it character-for-character.
- Voice profile generation should ASK the user for past posts, not assume access. Privacy matters here.

## Style

- Prefer composition over inheritance.
- Prefer explicit over clever. No magic.
- One file = one concern. Files over 300 lines need a reason.
- Server Components by default; `'use client'` only when needed.
- Tailwind + shadcn for UI. No custom CSS unless specifically necessary.

## Files Claude should ALWAYS read before changing anything

- This file (CLAUDE.md)
- `docs/specs/SPRINT_CURRENT.md` (the current sprint spec)
- `packages/db/schema.sql` (current schema)
- The relevant service file in `apps/web/src/services/`
- For voice work: `packages/voice/README.md`
- For jobs work: `apps/jobs/CLAUDE.md` (Trigger.dev v4 task development rules)
- For UI work: `DESIGN.md` at repo root (visual design system)

## Files Claude should NEVER touch without explicit instruction

- `.env*` files (secrets)
- `packages/db/migrations/*` (migrations are append-only; Claude may CREATE new ones, never edit existing)
- `infrastructure/` (deploy config — human-only)
- `docs/runbooks/` (operational truth, human-curated)
- `LICENSE`, `CONTRIBUTING.md`, `CLA.md` (legal docs — human-only)
- Anything in `packages/hosted-features/` unless explicitly working on a hosted feature
- For UI work: DESIGN.md at repo root (visual design system)

## Tools & commands

- `pnpm dev` — runs web + jobs locally
- `pnpm db:migrate` — applies new migrations to local DB
- `pnpm db:reset` — wipes local DB and reapplies all migrations
- `pnpm test` — runs full test suite
- `pnpm test:rls` — runs the cross-tenant isolation test suite (CI gate)
- `pnpm test:license-headers` — verifies AGPL headers on all OSS files (CI gate)
- `pnpm typecheck` — TypeScript-only check
- `pnpm lint` — eslint + prettier

## When stuck

If a task is ambiguous or a decision isn't documented, STOP and ask the human. Don't guess at:
- Pricing decisions
- UX flows not specified in the sprint spec
- Anything involving external system credentials
- Schema changes that affect existing data
- Anything that touches RLS policies — Claude proposes, human approves
- Anything that affects the OSS / proprietary boundary
- Anything that affects the Authenticity Engine's user-visible behavior

## Git workflow

- Direct pushes to `main` are blocked by GitHub branch protection.
- Each Section/Commit happens on a feature branch named for its scope:
  - `section-c-commit-2-ui`
  - `section-d-commit-1-billing`
  - etc.
- Push to feature branch via terminal: `git push -u origin <branch-name>` (first time) or `git push` (subsequent).
- After CI is green on the branch and manual smoke test passes, open a PR via `gh pr create` (or GitHub web UI) and merge.
- Never attempt `git push origin main` directly — branch protection will reject it.
- GitHub Desktop is closed during agent sessions.
- If a commit auto-pushes via some unidentified mechanism, it lands on the feature branch only — main stays clean by structural enforcement (branch protection), not discipline.

## Definition of done (every task)

- [ ] Code compiles, typechecks clean
- [ ] Lint passes
- [ ] License headers correct (AGPL on OSS files)
- [ ] Unit tests added for new logic
- [ ] Integration test added if route or worker changed
- [ ] RLS test added if a new tenant-scoped table was introduced
- [ ] Sprint spec checklist all checked
- [ ] Updated CLAUDE.md or docs if behavior changed for future Claude sessions
