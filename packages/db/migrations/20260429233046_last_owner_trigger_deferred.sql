-- =============================================================================
-- Authently migration
-- Created: 2026-04-29T23:30:46.487Z
-- Slug: last_owner_trigger_deferred
--
-- Fixes the last-owner protection trigger to play nice with cascade
-- deletes from public.workspaces.
--
-- The original trigger (migration 20260429230559) fires BEFORE DELETE
-- on workspace_members. When a workspace is dropped, the FK CASCADE
-- triggers the BEFORE DELETE on every membership row — including the
-- owner — and the trigger raises 23514 because no other owner remains.
-- The workspace was about to disappear anyway, but the trigger doesn't
-- know that during cascade.
--
-- Fix: convert to a DEFERRED constraint trigger that fires AT COMMIT
-- (or earlier on SET CONSTRAINTS IMMEDIATE). At that point cascade
-- deletes have settled, and we can read public.workspaces / auth.users
-- to detect the two cascade scenarios that should skip the check:
--   1. Workspace was deleted (cascade removed its memberships).
--   2. User was deleted from auth.users (cascade removed their
--      memberships across every workspace they belonged to).
-- Both are "the row going away is incidental, not a leave attempt."
-- Skip the check in either case. Otherwise count remaining owners and
-- raise 23514 if zero.
-- =============================================================================

drop trigger if exists workspace_members_prevent_last_owner_loss
  on public.workspace_members;

create or replace function private.prevent_last_owner_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners int;
  workspace_still_exists boolean;
  user_still_exists boolean;
begin
  if not (
    (tg_op = 'DELETE' and old.role = 'owner')
    or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner')
  ) then
    return null; -- AFTER trigger return value is ignored
  end if;

  -- The trigger is DEFERRED, so this fires at commit time. Two cascade
  -- scenarios cause the membership row to go away "incidentally":
  --   * workspace was deleted (cascade-via-FK on workspace_id)
  --   * user was deleted from auth.users (cascade-via-FK on user_id)
  -- In either case the leave-protection is moot — skip the check.
  select exists (
    select 1 from public.workspaces where id = old.workspace_id
  ) into workspace_still_exists;
  if not workspace_still_exists then
    return null;
  end if;

  select exists (
    select 1 from auth.users where id = old.user_id
  ) into user_still_exists;
  if not user_still_exists then
    return null;
  end if;

  select count(*)
    into remaining_owners
    from public.workspace_members
    where workspace_id = old.workspace_id
      and role = 'owner';
  -- AFTER the DELETE / UPDATE has settled, this count reflects the
  -- post-mutation owner count directly.
  if remaining_owners = 0 then
    raise exception
      'cannot remove or demote the last owner of workspace %', old.workspace_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger workspace_members_prevent_last_owner_loss
  after delete or update on public.workspace_members
  deferrable initially deferred
  for each row execute function private.prevent_last_owner_loss();
