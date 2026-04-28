-- =============================================================================
-- Authently — post-sign-up reconciliation function
-- Sprint 01, Step 5
--
-- Adds the DB-side support for the /api/auth/post-signup HTTP endpoint
-- (apps/web). The endpoint is a reconciliation fallback: the
-- on_auth_user_created trigger from migration 20260428000001 is the primary
-- path that bootstraps a workspace + owner membership for a new user. This
-- migration adds an idempotent function that the API can call to handle
-- edge cases (trigger failed; trigger hasn't run yet; manual reconciliation).
--
-- Two functions are introduced:
--   1. private.ensure_workspace_for_user(uuid, text, text)
--      Worker. Idempotent. If the user already has any membership, returns
--      the workspace_id of their oldest one. Otherwise replicates the
--      handle_new_user logic to create a workspace + owner membership and
--      returns the new workspace_id. Off PostgREST.
--
--   2. public.api_ensure_my_workspace()
--      Public RPC wrapper. Reads the calling user via auth.uid(), pulls
--      their email + display name from auth.users, and dispatches to the
--      private worker. SECURITY DEFINER + postgres ownership lets it bypass
--      RLS for the bootstrap insert (the user is not yet a member, so the
--      regular INSERT path would be denied). Granted to `authenticated`
--      only — anonymous callers are rejected with 42501.
--
-- Same hardening as migration 1: search_path = '', fully-qualified object
-- references, EXECUTE revoked from public.
-- =============================================================================

create or replace function private.ensure_workspace_for_user(
  _user_id uuid,
  _base_name text,
  _email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_id uuid;
  workspace_slug text;
  derived_name text;
  attempt int := 0;
begin
  -- Idempotency: if the user already has any membership, return the
  -- oldest. Repeated calls always converge on the same workspace.
  select wm.workspace_id
    into workspace_id
    from public.workspace_members wm
    where wm.user_id = _user_id
    order by wm.created_at asc
    limit 1;

  if workspace_id is not null then
    return workspace_id;
  end if;

  -- No memberships — fallback path. Mirrors private.handle_new_user.
  derived_name := coalesce(
    nullif(trim(_base_name), ''),
    split_part(coalesce(_email, ''), '@', 1),
    'workspace'
  );

  loop
    attempt := attempt + 1;
    workspace_slug := private.generate_workspace_slug(derived_name);
    begin
      insert into public.workspaces (name, slug, template)
      values (
        derived_name || '''s Workspace',
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
  values (workspace_id, _user_id, 'owner');

  return workspace_id;
end;
$$;

revoke all on function private.ensure_workspace_for_user(uuid, text, text) from public;
grant execute on function private.ensure_workspace_for_user(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- public.api_ensure_my_workspace — RPC wrapper exposed on PostgREST
-- ---------------------------------------------------------------------------
create or replace function public.api_ensure_my_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  meta jsonb;
  user_email text;
  base_name text;
begin
  uid := auth.uid();
  if uid is null then
    -- 42501 maps to PostgREST 401/403 (insufficient_privilege). Authenticated
    -- callers shouldn't see this; the GRANT below also rejects anon.
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  select u.raw_user_meta_data, u.email
    into meta, user_email
    from auth.users u
    where u.id = uid;

  base_name := coalesce(
    nullif(trim(meta ->> 'full_name'), ''),
    nullif(trim(meta ->> 'name'), '')
  );

  return private.ensure_workspace_for_user(uid, base_name, user_email);
end;
$$;

revoke all on function public.api_ensure_my_workspace() from public;
grant execute on function public.api_ensure_my_workspace() to authenticated;
