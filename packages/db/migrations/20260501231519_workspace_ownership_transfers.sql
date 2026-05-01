-- =============================================================================
-- Authently migration
-- Created: 2026-05-01T23:15:19.717Z
-- Slug: workspace_ownership_transfers
--
-- Sprint 04 A2 — Workspace ownership transfer flow.
--
-- Two-step transfer: (1) current owner initiates a transfer to a target
-- member; (2) target accepts (consent — not a one-way push). Owner or
-- target can cancel at any time before accept. Atomic on accept: in a
-- single plpgsql function the transfer row is marked accepted_at, the
-- previous owner is demoted to 'admin', and the target is promoted to
-- 'owner'. RAISE EXCEPTION rolls all three back if anything fails.
--
-- Single-owner model preserved (locked decision: previous owner becomes
-- 'admin'); multi-owner is a Sprint 06+ candidate. Email notification on
-- initiate is omitted until [04-4] Resend domain verification ships.
--
-- Adds:
--   1. public.workspace_ownership_transfers — pending/historical transfers.
--      Partial unique index enforces at-most-one-pending per workspace.
--      ON DELETE CASCADE on workspace_id, from_user_id, to_user_id handles
--      auth.users deletion + workspace soft-delete edge cases without
--      orphan rows.
--
--   2. SELECT-only RLS (locked decision Q1): owner OR target can SELECT;
--      INSERT/UPDATE/DELETE revoked from anon and authenticated. The
--      DEFINER RPCs below are the sole write path. Pinning a convention:
--      when all writes go through DEFINER RPCs that own the invariant
--      checks, per-method write policies are dead weight + future
--      foot-gun (a future direct-INSERT could bypass the higher-level
--      "is this the workspace owner?" invariant; the partial unique
--      still saves us at the DB level, but app-layer invariants live
--      in the RPC).
--
--   3. private.initiate_ownership_transfer_impl(_workspace_id, _to_user_id)
--      - Verifies caller is owner via private.has_workspace_role
--      - Verifies workspace is not soft-deleted (Q6 defensive predicate)
--      - Verifies target is a non-owner member of the workspace (this
--        also enforces no-self-transfer: the caller is the owner, so a
--        non-owner target can't be the caller)
--      - Verifies no pending transfer exists (cleaner error than letting
--        the partial unique constraint raise 23505)
--      - Inserts the transfer row
--
--   4. private.accept_ownership_transfer_impl(_transfer_id)
--      - Looks up the transfer row; verifies caller is to_user_id
--      - Verifies workspace is not soft-deleted (Q6)
--      - Verifies pending (accepted_at IS NULL AND cancelled_at IS NULL)
--      - Verifies from_user_id is still the workspace owner (defense
--        against unexpected role drift; under current rules this can't
--        happen, but the check is cheap and prevents future silent
--        breakage if owner-demotion paths are introduced)
--      - Verifies to_user_id is still a member of the workspace
--        (defense: if the target left the workspace between initiate
--        and accept, abort)
--      - Atomic in this function: set accepted_at, demote from_user to
--        'admin', promote to_user to 'owner'. plpgsql function = implicit
--        transaction; any RAISE rolls all three back.
--
--   5. private.cancel_ownership_transfer_impl(_transfer_id)
--      - Looks up the transfer row; verifies caller is from_user_id OR
--        to_user_id
--      - Verifies workspace is not soft-deleted (Q6)
--      - Verifies pending
--      - Sets cancelled_at
--
--   6. Three public.api_* wrappers, all SECURITY DEFINER + revoke from
--      anon + grant to authenticated. Each is a thin auth.uid() check +
--      perform call to the worker.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.workspace_ownership_transfers
-- ---------------------------------------------------------------------------
create table public.workspace_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  cancelled_at timestamptz,
  -- Belt + suspenders: a row can be pending, accepted, or cancelled but
  -- never both accepted and cancelled. The application path won't do this,
  -- but the constraint locks the invariant.
  constraint ownership_transfer_terminal_state_excl
    check (accepted_at is null or cancelled_at is null)
);

create index workspace_ownership_transfers_workspace_id_idx
  on public.workspace_ownership_transfers(workspace_id);

create index workspace_ownership_transfers_to_user_id_idx
  on public.workspace_ownership_transfers(to_user_id)
  where accepted_at is null and cancelled_at is null;

-- Partial unique — at-most-one-pending per workspace.
create unique index workspace_ownership_transfers_pending_uniq
  on public.workspace_ownership_transfers(workspace_id)
  where accepted_at is null and cancelled_at is null;

alter table public.workspace_ownership_transfers enable row level security;

-- ---------------------------------------------------------------------------
-- 2. RLS — SELECT-only (owner + target); writes locked to DEFINER RPCs
-- ---------------------------------------------------------------------------
create policy workspace_ownership_transfers_party_select
  on public.workspace_ownership_transfers
  for select to authenticated
  using (
    from_user_id = (select auth.uid())
    or to_user_id = (select auth.uid())
  );

-- Defense-in-depth: revoke any implicit write grants from authenticated
-- (and anon, which had none anyway). PostgREST will reject INSERT/UPDATE/
-- DELETE attempts with 42501. The DEFINER RPCs below are the sole write
-- path; they own the invariant checks (owner-only, target-only, etc).
revoke all on public.workspace_ownership_transfers from anon, authenticated;
grant select on public.workspace_ownership_transfers to authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.initiate_ownership_transfer_impl
-- ---------------------------------------------------------------------------
create or replace function private.initiate_ownership_transfer_impl(
  _workspace_id uuid,
  _to_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  target_role text;
  new_id uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if _workspace_id is null or _to_user_id is null then
    raise exception 'workspace id and target user id are required'
      using errcode = '22023';
  end if;

  -- Q6: workspace must exist and not be soft-deleted.
  if not exists (
    select 1
    from public.workspaces
    where id = _workspace_id
      and deleted_at is null
  ) then
    raise exception 'workspace not found or deleted'
      using errcode = '22023';
  end if;

  -- Caller must be current owner. has_workspace_role doesn't filter by
  -- workspaces.deleted_at, but the explicit check above already gated
  -- soft-deleted workspaces.
  if not private.has_workspace_role(_workspace_id, array['owner']) then
    raise exception 'caller is not the workspace owner'
      using errcode = '42501';
  end if;

  -- Target must be a member of the workspace, and not already an owner.
  -- A non-owner target also implicitly excludes self-transfer (caller is
  -- owner, so any non-owner member is by definition not the caller).
  select wm.role into target_role
  from public.workspace_members wm
  where wm.workspace_id = _workspace_id
    and wm.user_id = _to_user_id;

  if target_role is null then
    raise exception 'target is not a member of this workspace'
      using errcode = '22023';
  end if;

  if target_role = 'owner' then
    raise exception 'target is already the workspace owner'
      using errcode = '22023';
  end if;

  -- At-most-one-pending check. The partial unique would catch this at
  -- the constraint level (raising 23505), but the explicit check returns
  -- a cleaner application error code.
  if exists (
    select 1
    from public.workspace_ownership_transfers
    where workspace_id = _workspace_id
      and accepted_at is null
      and cancelled_at is null
  ) then
    raise exception 'a pending transfer already exists for this workspace'
      using errcode = '22023';
  end if;

  insert into public.workspace_ownership_transfers
    (workspace_id, from_user_id, to_user_id)
  values (_workspace_id, uid, _to_user_id)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function
  private.initiate_ownership_transfer_impl(uuid, uuid) from public;
revoke all on function
  private.initiate_ownership_transfer_impl(uuid, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.accept_ownership_transfer_impl
-- ---------------------------------------------------------------------------
create or replace function private.accept_ownership_transfer_impl(
  _transfer_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  t_workspace_id uuid;
  t_from_user_id uuid;
  t_to_user_id uuid;
  t_accepted_at timestamptz;
  t_cancelled_at timestamptz;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if _transfer_id is null then
    raise exception 'transfer id is required'
      using errcode = '22023';
  end if;

  select t.workspace_id, t.from_user_id, t.to_user_id,
         t.accepted_at, t.cancelled_at
    into t_workspace_id, t_from_user_id, t_to_user_id,
         t_accepted_at, t_cancelled_at
  from public.workspace_ownership_transfers t
  where t.id = _transfer_id;

  if t_workspace_id is null then
    raise exception 'transfer not found'
      using errcode = '22023';
  end if;

  if uid <> t_to_user_id then
    raise exception 'caller is not the transfer target'
      using errcode = '42501';
  end if;

  if t_accepted_at is not null or t_cancelled_at is not null then
    raise exception 'transfer is no longer pending'
      using errcode = '22023';
  end if;

  -- Q6: workspace must not be soft-deleted (defense — the target
  -- normally couldn't reach here because the workspace would be hidden
  -- by RLS, but they could call the RPC directly with a stored id).
  if not exists (
    select 1
    from public.workspaces
    where id = t_workspace_id
      and deleted_at is null
  ) then
    raise exception 'workspace not found or deleted'
      using errcode = '22023';
  end if;

  -- Defense: from_user_id should still hold the owner role. Under
  -- current rules they can't be demoted, but if a future path
  -- introduces such a thing we want this transfer to fail loudly.
  if not exists (
    select 1
    from public.workspace_members
    where workspace_id = t_workspace_id
      and user_id = t_from_user_id
      and role = 'owner'
  ) then
    raise exception 'original owner is no longer the owner'
      using errcode = '22023';
  end if;

  -- Defense: target must still be a member of the workspace.
  if not exists (
    select 1
    from public.workspace_members
    where workspace_id = t_workspace_id
      and user_id = t_to_user_id
  ) then
    raise exception 'target is no longer a member of this workspace'
      using errcode = '22023';
  end if;

  -- Atomic block — three statements, function-level transaction. Any
  -- RAISE in this body rolls all three back.
  update public.workspace_ownership_transfers
    set accepted_at = now()
    where id = _transfer_id;

  update public.workspace_members
    set role = 'admin'
    where workspace_id = t_workspace_id
      and user_id = t_from_user_id;

  update public.workspace_members
    set role = 'owner'
    where workspace_id = t_workspace_id
      and user_id = t_to_user_id;
end;
$$;

revoke all on function
  private.accept_ownership_transfer_impl(uuid) from public;
revoke all on function
  private.accept_ownership_transfer_impl(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. private.cancel_ownership_transfer_impl
-- ---------------------------------------------------------------------------
create or replace function private.cancel_ownership_transfer_impl(
  _transfer_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  t_workspace_id uuid;
  t_from_user_id uuid;
  t_to_user_id uuid;
  t_accepted_at timestamptz;
  t_cancelled_at timestamptz;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if _transfer_id is null then
    raise exception 'transfer id is required'
      using errcode = '22023';
  end if;

  select t.workspace_id, t.from_user_id, t.to_user_id,
         t.accepted_at, t.cancelled_at
    into t_workspace_id, t_from_user_id, t_to_user_id,
         t_accepted_at, t_cancelled_at
  from public.workspace_ownership_transfers t
  where t.id = _transfer_id;

  if t_workspace_id is null then
    raise exception 'transfer not found'
      using errcode = '22023';
  end if;

  if uid <> t_from_user_id and uid <> t_to_user_id then
    raise exception 'caller is neither the original owner nor the target'
      using errcode = '42501';
  end if;

  if t_accepted_at is not null or t_cancelled_at is not null then
    raise exception 'transfer is no longer pending'
      using errcode = '22023';
  end if;

  -- Q6: workspace must not be soft-deleted.
  if not exists (
    select 1
    from public.workspaces
    where id = t_workspace_id
      and deleted_at is null
  ) then
    raise exception 'workspace not found or deleted'
      using errcode = '22023';
  end if;

  update public.workspace_ownership_transfers
    set cancelled_at = now()
    where id = _transfer_id;
end;
$$;

revoke all on function
  private.cancel_ownership_transfer_impl(uuid) from public;
revoke all on function
  private.cancel_ownership_transfer_impl(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Public wrappers — granted EXECUTE to authenticated only
-- ---------------------------------------------------------------------------
create or replace function public.api_initiate_ownership_transfer(
  _workspace_id uuid,
  _to_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;
  return private.initiate_ownership_transfer_impl(_workspace_id, _to_user_id);
end;
$$;

revoke all on function
  public.api_initiate_ownership_transfer(uuid, uuid) from public;
revoke all on function
  public.api_initiate_ownership_transfer(uuid, uuid) from anon;
grant execute on function
  public.api_initiate_ownership_transfer(uuid, uuid) to authenticated;

create or replace function public.api_accept_ownership_transfer(
  _transfer_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;
  perform private.accept_ownership_transfer_impl(_transfer_id);
end;
$$;

revoke all on function
  public.api_accept_ownership_transfer(uuid) from public;
revoke all on function
  public.api_accept_ownership_transfer(uuid) from anon;
grant execute on function
  public.api_accept_ownership_transfer(uuid) to authenticated;

create or replace function public.api_cancel_ownership_transfer(
  _transfer_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;
  perform private.cancel_ownership_transfer_impl(_transfer_id);
end;
$$;

revoke all on function
  public.api_cancel_ownership_transfer(uuid) from public;
revoke all on function
  public.api_cancel_ownership_transfer(uuid) from anon;
grant execute on function
  public.api_cancel_ownership_transfer(uuid) to authenticated;
