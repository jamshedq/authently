-- =============================================================================
-- Authently migration — Sprint 06 B5
-- Created: 2026-05-04T21:15:33.518Z
-- Slug: sources_table
--
-- Creates the public.sources table — workspace-scoped storage for ingested
-- source content. Sprint 06 B5 ships only the 'audio_transcript' source
-- type (transcripts produced by B1's OpenAI Whisper service); Sprint 07
-- B2/B3/B4 widen the type check constraint via follow-up migration as
-- additional source types land (youtube_transcript, url_extraction,
-- pdf_extraction).
--
-- DEFINER write path: end-user clients are revoked from INSERT/UPDATE/
-- DELETE; mutations route through public.api_create_source_audio →
-- private.create_source_audio_impl. Matches Sprint 04/05 convention
-- (DEFINER worker + auth-callable wrapper). SELECT-only RLS sufficient.
--
-- Two-layer soft-delete (subtle, do NOT collapse):
--   - private.is_workspace_member helper already enforces
--     `workspaces.deleted_at IS NULL` via JOIN — every policy that uses
--     the helper inherits this filter. B5's policy does NOT need to
--     repeat the workspace deleted_at check.
--   - sources.deleted_at IS NULL is a SEPARATE check on the source row's
--     own lifecycle. Sources have their own soft-delete (deleted_at
--     column) independent of the workspace's. Both filters are correct
--     and necessary; future readers should NOT remove the
--     sources.deleted_at filter as redundant.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.sources table
-- ---------------------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  type text not null check (type in ('audio_transcript')),
  content text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Partial index on the active-row hot path. Most reads filter
-- deleted_at IS NULL by RLS policy + service-layer query; the index
-- covers that pattern without indexing soft-deleted rows.
create index sources_workspace_id_active_idx
  on public.sources (workspace_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. RLS — enable + SELECT policy + explicit revoke of write paths
-- ---------------------------------------------------------------------------
alter table public.sources enable row level security;

-- SELECT policy: workspace member only, source not soft-deleted.
-- The workspace soft-delete filter is enforced by
-- private.is_workspace_member's internal JOIN on workspaces.deleted_at;
-- the sources.deleted_at filter is the separate row-lifecycle check.
create policy sources_select on public.sources
  for select
  to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and deleted_at is null
  );

-- Explicit revoke of write paths from end-user roles. Default-revoked
-- without these statements (no INSERT/UPDATE/DELETE policies defined),
-- but the explicit revoke is grep-friendly and signals "writes go
-- through DEFINER wrappers" to future readers.
revoke insert, update, delete on public.sources from authenticated;
revoke insert, update, delete on public.sources from anon;

-- ---------------------------------------------------------------------------
-- 3. private.create_source_audio_impl — DEFINER worker
-- ---------------------------------------------------------------------------
-- Inserts the source row and returns its id. Caller (the public.api_*
-- wrapper) is responsible for asserting workspace membership before
-- calling this worker. No defensive checks here — the impl is the
-- write primitive.
create or replace function private.create_source_audio_impl(
  _workspace_id uuid,
  _user_id uuid,
  _content text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _source_id uuid;
begin
  insert into public.sources (workspace_id, user_id, type, content)
  values (_workspace_id, _user_id, 'audio_transcript', _content)
  returning id into _source_id;

  return _source_id;
end;
$$;

revoke all on function private.create_source_audio_impl(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 4. public.api_create_source_audio — auth-callable wrapper
-- ---------------------------------------------------------------------------
-- Reads auth.uid() inside, asserts workspace membership via
-- private.is_workspace_member, dispatches to the worker. Naming follows
-- the database function convention pinned in CLAUDE.md
-- (`api_<name>` for user-callable; `svc_<name>` reserved for
-- service-role-only).
--
-- Errcodes:
--   22023 (invalid_parameter_value) — missing user/content
--   42501 (insufficient_privilege) — not a workspace member
create or replace function public.api_create_source_audio(
  _workspace_id uuid,
  _content text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _user_id uuid := auth.uid();
  _source_id uuid;
begin
  if _user_id is null then
    raise exception 'user id is required'
      using errcode = '22023';
  end if;

  if not private.is_workspace_member(_workspace_id) then
    raise exception 'not a member of workspace'
      using errcode = '42501';
  end if;

  if _content is null or length(_content) = 0 then
    raise exception 'content is required'
      using errcode = '22023';
  end if;

  _source_id := private.create_source_audio_impl(_workspace_id, _user_id, _content);
  return _source_id;
end;
$$;

revoke all on function public.api_create_source_audio(uuid, text) from public;
grant execute on function public.api_create_source_audio(uuid, text) to authenticated;
