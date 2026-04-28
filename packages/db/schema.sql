-- =============================================================================
-- Authently — current schema reference
--
-- This file is the canonical "current state" view of the database schema. It
-- is NOT executed by Supabase or by `pnpm db:migrate` — migrations under
-- packages/db/migrations/ are the source of truth for what gets applied.
--
-- Keep this file in sync with the cumulative effect of all migrations. After
-- adding a new migration, regenerate this file (or hand-update it) to reflect
-- the new shape.
--
-- Suggested regeneration (once Supabase is running locally):
--   supabase db dump \
--     --schema public --schema private \
--     --data-only=false \
--     > packages/db/schema.sql
--
-- This file is licensed AGPL-3.0-or-later. See LICENSE at the repo root.
-- =============================================================================

-- ---------- schemas ----------------------------------------------------------

create schema if not exists private;

-- ---------- helpers ----------------------------------------------------------

-- public.set_updated_at(): trigger function used by tables with an updated_at
-- column to keep it current on UPDATE.

-- private.is_workspace_member(uuid): SECURITY DEFINER membership check used
-- by RLS policies to avoid self-referential recursion on workspace_members.

-- private.slugify(text): kebab-case-only sanitizer.
-- private.generate_workspace_slug(text): "{slugified-base}-{8-hex-suffix}".
-- private.handle_new_user(): AFTER INSERT trigger on auth.users that creates
-- a workspace and an owner membership for the new user.

-- ---------- tables -----------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  template text not null default 'creator'
    check (template in ('creator', 'smb', 'community')),
  plan_tier text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx
  on public.workspace_members(user_id);

-- S01-only; dropped in S02.
create table public.smoke_test (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

create index smoke_test_workspace_id_idx
  on public.smoke_test(workspace_id);

-- ---------- row-level security ----------------------------------------------

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.smoke_test        enable row level security;

-- workspaces: SELECT for members
create policy workspaces_member_select on public.workspaces
  for select to authenticated
  using (private.is_workspace_member(id));

-- workspace_members: SELECT for self or co-members
create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_workspace_member(workspace_id)
  );

-- smoke_test: full CRUD for workspace members; both USING and WITH CHECK.
create policy smoke_test_member_all on public.smoke_test
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- ---------- triggers ---------------------------------------------------------

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
