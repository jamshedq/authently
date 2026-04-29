-- =============================================================================
-- Authently migration
-- Created: 2026-04-29T23:14:11.155Z
-- Slug: workspace_members_list_rpc
--
-- Adds public.api_list_workspace_members(_workspace_slug text). The
-- members page (Section C) needs each member's email + display name,
-- which live in auth.users — not directly readable through PostgREST.
--
-- The caller's role on the workspace doesn't gate this RPC: any member
-- can see the full member list (matches the spec's "members list is
-- open to all roles" model). Membership IS gated — non-members get
-- back an empty result, never auth.users data.
--
-- This is the canonical pattern for "I need auth.users metadata about
-- co-members." Keeps SUPABASE_SERVICE_ROLE_KEY out of apps/web entirely.
-- =============================================================================

create or replace function public.api_list_workspace_members(_workspace_slug text)
returns table(
  user_id uuid,
  role text,
  email text,
  full_name text,
  joined_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  uid uuid;
  ws_id uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select w.id into ws_id from public.workspaces w where w.slug = _workspace_slug;
  if ws_id is null then
    -- Anti-enumeration: same shape as not-a-member.
    return;
  end if;

  if not private.is_workspace_member(ws_id) then
    -- Not a member — return empty rather than raising. The route
    -- handler runs withMembership before reaching here so this is
    -- defence-in-depth.
    return;
  end if;

  return query
    select wm.user_id,
           wm.role,
           u.email::text,
           nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), '')
             as full_name,
           wm.created_at as joined_at
      from public.workspace_members wm
      join auth.users u on u.id = wm.user_id
      where wm.workspace_id = ws_id
      order by wm.created_at asc;
end;
$$;

revoke all on function public.api_list_workspace_members(text) from public;
grant execute on function public.api_list_workspace_members(text) to authenticated;
