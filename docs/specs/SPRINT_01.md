# Sprint 01 — Foundation (Open-Source Multi-Tenant Scaffold)

**Goal:** Stand up the public open-source monorepo with multi-tenant primitives, Supabase, Stripe in test mode, deploy pipeline, and AGPL licensing infrastructure. End state: a public GitHub repo with the AGPL license, a deployed staging app where users can sign up and are auto-placed in a workspace, and the schema enforces RLS on a smoke-test table.

This sprint sets the foundation for everything. Get it right and 27 sprints inherit a clean base.

## Stack to scaffold

- pnpm + Turborepo monorepo
- `apps/web` — Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui (AGPL)
- `apps/jobs` — Trigger.dev v3 project (AGPL)
- `packages/db` — schema, migrations, RLS policies, generated types (AGPL)
- `packages/shared` — error classes, zod schemas, common types (AGPL)
- `packages/ui` — shadcn re-exports (AGPL)
- `packages/hosted-features` — proprietary stub for hosted-only features (PROPRIETARY)
- Supabase project (local via supabase CLI for dev, hosted for staging)
- Vercel for `apps/web`; Trigger.dev cloud for `apps/jobs`
- Sentry, Axiom (logs), Stripe test mode wired

## Open-source setup (this sprint!)

The repo is public from day 1. This is non-negotiable — it's the differentiator we committed to.

- [ ] Public GitHub repo created (you do this; Claude can't create repos)
- [ ] `LICENSE` file with full AGPL-3.0 text at repo root
- [ ] `LICENSE-PROPRIETARY` file at repo root explaining the hosted-only-features carve-out
- [ ] `README.md` with: what it is, why it's open-source, install/self-host instructions stub, contributing pointer, license summary
- [ ] `CONTRIBUTING.md` with PR process and CLA requirement
- [ ] `CLA.md` with CLA text (use Apache CLA as a base; don't invent legal text)
- [ ] CLA Assistant configured (free GitHub app)
- [ ] AGPL license header in every source file in OSS packages
- [ ] CI check that fails if a new OSS file is missing the header
- [ ] `packages/hosted-features/README.md` explains this directory is proprietary and excluded from OSS distribution
- [ ] `.gitattributes` configured so `packages/hosted-features` is treated correctly in any future tarball builds

## Database — initial schema

Tables for this sprint only. Multi-tenant rules apply to all of them.

```sql
-- workspaces is the tenant root
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  template text not null default 'creator' check (template in ('creator','smb','community')),
  plan_tier text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- workspace_members links users to workspaces
create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- smoke_test exists ONLY to validate RLS is wired correctly. Drop in S02.
create table smoke_test (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);
create index on smoke_test(workspace_id);
```

Note the `template` column on workspaces — this is how multi-audience support is wired in from day 1. New signups default to `creator`; we'll add UI in S02 to switch.

## RLS policies (applies to every tenant-scoped table)

```sql
alter table workspace_members enable row level security;
alter table smoke_test enable row level security;

create policy workspace_members_member_read on workspace_members
  for select using (
    user_id = auth.uid()
    or workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

create policy smoke_test_member_all on smoke_test
  for all using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  )
  with check (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );
```

## Sign-up flow

On first sign-up, atomically:
1. Create user in `auth.users` (Supabase handles)
2. Create a workspace named `'{first_name}'s Workspace'` with slug = generated, template = `'creator'`
3. Insert `workspace_members(workspace_id, user_id, role='owner')`
4. Redirect to `/app/{workspace_slug}/dashboard`

## API routes

- `POST /api/auth/post-signup` — runs the workspace creation
- `GET /api/me` — returns user + memberships
- All routes under `/api/ws/[workspaceSlug]/*` must validate membership

## Tests required

- **RLS test:** user A inserts a `smoke_test` row in workspace W1; user B (not member of W1) cannot read or update it. Both directions must fail.
- **Auth test:** unauthenticated request to `/api/ws/anything/*` returns 401.
- **Membership test:** authenticated user, not a member, returns 403.
- **Sign-up test:** new sign-up ends with exactly one workspace, user is owner, template = `'creator'`.
- **License header test:** every `.ts` and `.tsx` file in OSS packages has the AGPL header.

## Done criteria

- [ ] Public GitHub repo with first real commit history (not squashed)
- [ ] AGPL LICENSE + CONTRIBUTING + CLA + README in place
- [ ] CLA Assistant active on the repo
- [ ] Monorepo builds clean with `pnpm build`
- [ ] `pnpm test` green
- [ ] `pnpm test:rls` green (cross-tenant attempts fail)
- [ ] `pnpm test:license-headers` green
- [ ] Deployed to staging URL (e.g., staging.yourbrand.com)
- [ ] Sign up + see dashboard works end-to-end on staging
- [ ] Sentry and Axiom receiving events from staging
- [ ] Stripe webhook endpoint (no-op handler) configured and verified
- [ ] CLAUDE.md updated if anything in this spec changed during implementation
- [ ] First public build-in-public post written (X / LinkedIn / Indie Hackers): "Day 1: shipped the foundation, here's what's in it"

## Out of scope

- Workspace switcher UI (S02)
- Inviting members (S02)
- Billing flow (S02)
- Documentation site (S02)
- Any social platform code (S10+)
- Any media work (S08)
- Any voice / authenticity engine work (S04+)
- Public REST API endpoints (S04)

## Notes for Claude Code

- Do NOT generate the LICENSE file content yourself. Use the canonical AGPL-3.0 text from gnu.org and let the human paste it in.
- Do NOT generate the CLA text. Use Apache 2.0 CLA as a base, but the human approves the final wording.
- The product name is **Authently**. Domains: authently.io (primary), authently.app, authently.dev.
- The README should be honest and short. Do not write marketing copy. The build-in-public ethos starts here.
- Every commit message should be conventional commits. The commit history is public; treat it as documentation.
