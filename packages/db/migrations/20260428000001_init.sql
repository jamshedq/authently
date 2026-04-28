-- =============================================================================
-- Authently — initial schema migration
-- Sprint 01, Step 2
--
-- Establishes the multi-tenant foundation:
--   public.workspaces              tenant root
--   public.workspace_members       user <-> workspace junction (role per pair)
--   public.smoke_test              S01-only RLS validation table; dropped in S02
--
-- Correctness invariants enforced here:
--   1. RLS is enabled on every tenant-scoped table BEFORE any policy exists
--      and BEFORE any data could land. The migration runs in a single
--      transaction, so the table is unreachable until commit.
--   2. The smoke_test policy is FOR ALL with both USING and WITH CHECK
--      clauses, so reads, inserts, and updates are all gated.
--   3. The workspace_members SELECT policy uses a SECURITY DEFINER helper
--      (private.is_workspace_member) to avoid the self-referential recursion
--      that the spec's example pattern would produce.
--   4. The auth.users sign-up trigger (private.handle_new_user) is
--      SECURITY DEFINER, owned by postgres (which has BYPASSRLS), and pins
--      search_path to '' with fully-qualified object references. It creates
--      the workspace + membership in a single transaction, with up to three
--      retries on slug collision.
--
-- This file is licensed AGPL-3.0-or-later. See LICENSE at the repo root.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schemas
-- -----------------------------------------------------------------------------

-- The `private` schema houses SECURITY DEFINER helpers that must not be
-- callable through PostgREST. Supabase's PostgREST exposes the `public` schema
-- by default; `private` is intentionally excluded.
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to postgres, service_role;

-- -----------------------------------------------------------------------------
-- updated_at trigger helper (lives in public for re-use across tables)
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- public.workspaces
-- -----------------------------------------------------------------------------
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

alter table public.workspaces enable row level security;

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- public.workspace_members
-- -----------------------------------------------------------------------------
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx
  on public.workspace_members(user_id);

alter table public.workspace_members enable row level security;

-- -----------------------------------------------------------------------------
-- private.is_workspace_member — RLS recursion-breaker
--
-- A SELECT policy that does
--   workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
-- recurses through the policy when evaluated against workspace_members itself.
-- Wrapping the membership check in a SECURITY DEFINER function lets the
-- query plan run without RLS for the duration of the helper call, breaking
-- the loop. The function is in `private` so it cannot be invoked over PostgREST.
-- -----------------------------------------------------------------------------
create or replace function private.is_workspace_member(_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = _workspace_id
      and user_id = auth.uid()
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public;
grant execute on function private.is_workspace_member(uuid)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------

-- workspaces: a member of the workspace can read it.
-- Inserts/updates/deletes are not exposed to clients in S01; they happen via
-- the sign-up trigger (RLS-bypassing) or service-role calls from server code.
create policy workspaces_member_select on public.workspaces
  for select
  to authenticated
  using (private.is_workspace_member(id));

-- workspace_members: a user sees their own memberships, plus other members of
-- workspaces they belong to.
create policy workspace_members_select on public.workspace_members
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_workspace_member(workspace_id)
  );

-- -----------------------------------------------------------------------------
-- public.smoke_test (S01-only RLS validation table; dropped in S02)
-- -----------------------------------------------------------------------------
create table public.smoke_test (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

create index smoke_test_workspace_id_idx
  on public.smoke_test(workspace_id);

alter table public.smoke_test enable row level security;

-- FOR ALL: same predicate gates SELECT, INSERT, UPDATE, DELETE.
-- USING is checked for existing rows (read/update/delete visibility).
-- WITH CHECK is checked for new/updated rows (write authorization).
-- Both are required for FOR ALL to fully gate writes.
create policy smoke_test_member_all on public.smoke_test
  for all
  to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- -----------------------------------------------------------------------------
-- Slug helpers
--
-- Strategy: derive a kebab-case base slug from a human-readable name, then
-- append 8 hex chars from gen_random_bytes(4). Collision space is 2^32 per
-- attempt; with retry-up-to-3 the practical failure rate is ~10^-29 per
-- sign-up. This avoids:
--   - nanoid: needs an extension or app-side generation (trigger should be
--             self-contained in the DB)
--   - slug-N counter: requires SELECT before INSERT (race window) or LOCK
-- -----------------------------------------------------------------------------
create or replace function private.slugify(_input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      lower(coalesce(_input, '')),
      '[^a-z0-9]+',
      '-',
      'g'
    ),
    '(^-+)|(-+$)',
    '',
    'g'
  );
$$;

create or replace function private.generate_workspace_slug(_base text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  base_slug text;
  suffix text;
begin
  base_slug := nullif(private.slugify(_base), '');
  if base_slug is null then
    base_slug := 'workspace';
  end if;
  -- Truncate the base to leave headroom for the "-XXXXXXXX" suffix and stay
  -- well under any reasonable URL/slug-column limit.
  base_slug := substr(base_slug, 1, 48);
  suffix := encode(extensions.gen_random_bytes(4), 'hex'); -- 8 hex chars
  return base_slug || '-' || suffix;
end;
$$;

-- -----------------------------------------------------------------------------
-- private.handle_new_user — atomic sign-up workspace bootstrap
--
-- Fires AFTER INSERT on auth.users. SECURITY DEFINER + postgres ownership
-- means the function bypasses RLS, which it must — at this instant the new
-- user is not yet a member of any workspace, so they cannot satisfy any
-- policy USING clause for the bootstrap inserts.
--
-- search_path is pinned to '' and every object is fully qualified, per
-- Supabase's hardening guidance against schema-injection.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_id uuid;
  workspace_slug text;
  base_name text;
  attempt int := 0;
begin
  -- Prefer the user-supplied display name from auth metadata, fall back to
  -- the email local-part, then a generic placeholder.
  base_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1),
    'workspace'
  );

  -- Slug-collision retry. After 3 attempts, surface the unique_violation;
  -- the surrounding auth.users insert will roll back, and the user is never
  -- created — preserving atomicity.
  loop
    attempt := attempt + 1;
    workspace_slug := private.generate_workspace_slug(base_name);
    begin
      insert into public.workspaces (name, slug, template)
      values (
        base_name || '''s Workspace',
        workspace_slug,
        'creator'
      )
      returning id into workspace_id;
      exit;
    exception when unique_violation then
      if attempt >= 3 then
        raise;
      end if;
    end;
  end loop;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
