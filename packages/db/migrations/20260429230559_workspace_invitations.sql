-- =============================================================================
-- Authently migration
-- Created: 2026-04-29T23:05:59.980Z
-- Slug: workspace_invitations
--
-- Sprint 02 Section C — member invitations + last-owner protection.
--
-- Adds:
--   1. extensions.citext            (idempotent — case-insensitive email
--                                    comparison without app-side lower())
--   2. public.workspace_invitations (the table)
--      - token_hash bytea (NOT raw token — DB compromise leaks hashes,
--        not valid invite tokens; see api_accept_invitation for matching)
--      - email citext (case-insensitive equality with auth.users.email)
--      - expires_at timestamptz default now() + 7 days (Sprint 02 spec)
--      - immutable from the PostgREST surface (no UPDATE policy)
--   3. RLS policies                 (member SELECT, owner/admin INSERT,
--                                    owner/admin DELETE; anon access
--                                    routed only through SECURITY DEFINER
--                                    api_lookup_invitation)
--   4. private.prevent_last_owner_loss + trigger on workspace_members
--      (BEFORE DELETE OR UPDATE — covers both leave and demote paths)
--   5. SECURITY DEFINER RPCs:
--      - public.api_lookup_invitation(_token)   anon + authenticated
--        Anti-enumeration envelope: {valid|expired|accepted|invalid} with
--        workspace_name + role surfaced ONLY on `valid`. Same shape on
--        `expired`/`accepted`/`invalid` so a probe can't distinguish.
--      - public.api_accept_invitation(_token)   authenticated only
--        Strict email match (case-insensitive). Atomic UPDATE on
--        accepted_at races safely under concurrent acceptance.
--      - public.api_revoke_invitation(_invitation_id) authenticated only
--        Role-gated (owner/admin) via private.has_workspace_role; hard DELETE.
--
-- The CREATE-invitation path runs through PostgREST + RLS (no SECURITY
-- DEFINER) — the API route generates the raw token in Node, hashes it
-- server-side via crypto.createHash, and INSERTs through the user's
-- RLS-subject client. The owner/admin gate is enforced by the RLS INSERT
-- policy plus an API-layer requireRole check (defence-in-depth).
--
-- Multi-tenant rules (per CLAUDE.md):
--   - workspace_invitations.workspace_id FK + cascade
--   - RLS gates every read/write to workspace members or higher
--   - SUPABASE_SERVICE_ROLE_KEY is NOT used by apps/web for any of
--     these flows; SECURITY DEFINER RPCs handle the privilege elevation
--     entirely at the DB layer.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- citext extension (case-insensitive text)
-- ---------------------------------------------------------------------------
create extension if not exists citext schema extensions;

-- ---------------------------------------------------------------------------
-- workspace_invitations
-- ---------------------------------------------------------------------------
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  email extensions.citext not null,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  token_hash bytea unique not null,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Lookup by workspace (members listing the pending invites for one
-- workspace) and by token_hash (acceptance flow) — both covered by
-- the unique constraint on token_hash + this btree index.
create index workspace_invitations_workspace_id_idx
  on public.workspace_invitations (workspace_id);

alter table public.workspace_invitations enable row level security;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

-- SELECT: any workspace member can list their workspace's invitations.
-- Editor/viewer can see who's pending; this matches the spec's "members
-- list page is open to all roles, mutations gated by role" model.
create policy invitations_member_select on public.workspace_invitations
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- INSERT: owner + admin only. Defense-in-depth alongside the API
-- requireRole gate.
create policy invitations_owner_admin_insert on public.workspace_invitations
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin']));

-- DELETE: owner + admin only. Revoke is a hard delete; revocation is
-- forever and we don't need a soft-delete state for Sprint 02.
create policy invitations_owner_admin_delete on public.workspace_invitations
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['owner', 'admin']));

-- (No UPDATE policy.) Invitations are write-once from the PostgREST
-- surface. The accepted_at column is set exclusively by
-- public.api_accept_invitation, which runs SECURITY DEFINER and bypasses
-- RLS for that single column update.

-- ---------------------------------------------------------------------------
-- private.prevent_last_owner_loss — trigger guarding workspace_members
-- ---------------------------------------------------------------------------
-- Fires BEFORE DELETE and BEFORE UPDATE. Two demotion paths exist:
--   - DELETE the owner's membership row     (leave / remove)
--   - UPDATE role from 'owner' to anything  (demote)
-- Both require at least one OTHER owner to remain. Cross-tenant attempts
-- can't reach the trigger (RLS hides the row), so this fires only on
-- legitimate same-tenant calls.
--
-- Error class 23514 (check_violation) so app code can match it cleanly.
-- The application layer translates this to a UX message; users never see
-- raw codes.
create or replace function private.prevent_last_owner_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners int;
begin
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select count(*)
      into remaining_owners
      from public.workspace_members
      where workspace_id = old.workspace_id
        and role = 'owner'
        and not (workspace_id = old.workspace_id and user_id = old.user_id);
    if remaining_owners = 0 then
      raise exception
        'cannot remove or demote the last owner of workspace %', old.workspace_id
        using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger workspace_members_prevent_last_owner_loss
  before delete or update on public.workspace_members
  for each row execute function private.prevent_last_owner_loss();

-- ---------------------------------------------------------------------------
-- public.api_lookup_invitation — anon + authenticated lookup by raw token
-- ---------------------------------------------------------------------------
-- Hashes the incoming token (so the raw token is never logged in slow-
-- query / pg_stat_statements with full-text-key visibility — only the
-- hash flows past the function boundary).
--
-- ANTI-ENUMERATION CONTRACT: the caller cannot distinguish between
-- "no such token", "expired", and "already accepted". Each case returns
-- status='invalid' with workspace/role columns NULL. Only `valid` exposes
-- the workspace name + role + (anonymised) inviter info. Probing the
-- table is therefore equivalent to brute-forcing 256 bits of entropy —
-- not feasible.
--
-- Bytea comparison on a fixed-length SHA-256 digest is byte-wise on
-- 32 bytes; the comparison short-circuits but the constant 32-byte
-- width and the entropy budget of the hash mean timing attacks are
-- not viable.
create or replace function public.api_lookup_invitation(_token text)
returns table(
  status text,
  workspace_name text,
  workspace_slug text,
  role text,
  email_hint text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  hashed bytea;
  inv_row public.workspace_invitations%rowtype;
  ws_row public.workspaces%rowtype;
  hint text;
begin
  if _token is null or length(_token) = 0 then
    return query select 'invalid'::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  hashed := extensions.digest(_token, 'sha256');

  select * into inv_row
    from public.workspace_invitations
    where token_hash = hashed;

  if not found
     or inv_row.accepted_at is not null
     or inv_row.expires_at <= now() then
    return query select 'invalid'::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- Valid + pending. Surface the workspace identity + role so the accept
  -- page can render "Join Acme Studio as editor". Email gets a privacy
  -- hint (first char + domain) — the calling user might not yet be
  -- signed in, so we don't reveal the full address.
  select * into ws_row
    from public.workspaces
    where id = inv_row.workspace_id;

  hint := substr(inv_row.email::text, 1, 1)
       || '***@'
       || split_part(inv_row.email::text, '@', 2);

  return query select 'valid'::text,
                       ws_row.name,
                       ws_row.slug,
                       inv_row.role,
                       hint;
end;
$$;

revoke all on function public.api_lookup_invitation(text) from public;
grant execute on function public.api_lookup_invitation(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.api_accept_invitation — authenticated, atomic, email-matched
-- ---------------------------------------------------------------------------
-- Failure modes (each raises with errcode app code can switch on):
--   42501  authentication required
--   22023  invitation expired / not found / for a different email
--   23505  invitation already accepted (concurrent claim or replay)
--
-- Concurrency: the accepted_at UPDATE is the atomic claim. Two
-- simultaneous calls both pass the up-front checks, both reach the
-- UPDATE; the row's `accepted_at IS NULL` predicate ensures only one
-- UPDATE matches. The other gets rows_updated = 0 and raises 23505.
-- Validated by tests/rls/invitation-acceptance.test.ts.
create or replace function public.api_accept_invitation(_token text)
returns table(workspace_slug text, workspace_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  user_email extensions.citext;
  inv_id uuid;
  inv_workspace_id uuid;
  inv_email extensions.citext;
  inv_role text;
  inv_accepted_at timestamptz;
  inv_expires_at timestamptz;
  hashed bytea;
  rows_updated int;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if _token is null or length(_token) = 0 then
    raise exception 'invitation token is required' using errcode = '22023';
  end if;

  hashed := extensions.digest(_token, 'sha256');

  -- Read calling user's email (citext for case-insensitive match).
  select u.email::extensions.citext into user_email
    from auth.users u
    where u.id = uid;
  if user_email is null then
    raise exception 'caller has no email' using errcode = 'P0001';
  end if;

  -- Look up the invitation. Up-front checks for clear error messages.
  select id, workspace_id, email, role, accepted_at, expires_at
    into inv_id, inv_workspace_id, inv_email, inv_role,
         inv_accepted_at, inv_expires_at
    from public.workspace_invitations
    where token_hash = hashed;

  if not found then
    raise exception 'invitation not found' using errcode = '22023';
  end if;
  if inv_accepted_at is not null then
    raise exception 'invitation already accepted' using errcode = '23505';
  end if;
  if inv_expires_at <= now() then
    raise exception 'invitation expired' using errcode = '22023';
  end if;
  if user_email <> inv_email then
    raise exception 'invitation is for a different email address'
      using errcode = '22023';
  end if;

  -- Atomic claim. The WHERE accepted_at IS NULL predicate is the race-
  -- protection: under concurrent calls, only one UPDATE matches.
  update public.workspace_invitations
     set accepted_at = now()
     where id = inv_id
       and accepted_at is null;
  get diagnostics rows_updated = row_count;
  if rows_updated = 0 then
    -- Another concurrent caller claimed it between our up-front check
    -- and the UPDATE. Surface as already-accepted (the user-visible
    -- truth, regardless of who won the race).
    raise exception 'invitation already accepted' using errcode = '23505';
  end if;

  -- Insert the membership. ON CONFLICT DO NOTHING handles the rare case
  -- where the user is already a member (e.g. duplicate invitation paths
  -- in flight); the accepted_at is already set so the invitation is
  -- "spent" either way.
  insert into public.workspace_members (workspace_id, user_id, role)
    values (inv_workspace_id, uid, inv_role)
    on conflict (workspace_id, user_id) do nothing;

  return query
    select w.slug, w.name
      from public.workspaces w
      where w.id = inv_workspace_id;
end;
$$;

revoke all on function public.api_accept_invitation(text) from public;
grant execute on function public.api_accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.api_revoke_invitation — owner/admin only, hard delete
-- ---------------------------------------------------------------------------
-- The DELETE is gated by the invitations_owner_admin_delete policy when
-- called through PostgREST directly. This RPC additionally checks the
-- role explicitly so the error mode is a clean 42501 rather than the
-- silent "0 rows affected" RLS gives back.
create or replace function public.api_revoke_invitation(_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  inv_workspace_id uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select workspace_id into inv_workspace_id
    from public.workspace_invitations
    where id = _invitation_id;
  if inv_workspace_id is null then
    -- Not found OR caller can't see it. Same error envelope either way
    -- (anti-enumeration).
    raise exception 'invitation not found' using errcode = '22023';
  end if;

  if not private.has_workspace_role(inv_workspace_id, array['owner', 'admin']) then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  delete from public.workspace_invitations where id = _invitation_id;
end;
$$;

revoke all on function public.api_revoke_invitation(uuid) from public;
grant execute on function public.api_revoke_invitation(uuid) to authenticated;
