-- =============================================================================
-- Authently migration — Sprint 08 B2
-- Created: 2026-05-12T14:00:00.000Z
-- Slug: sources_youtube
--
-- Sprint 08 B2 — widen sources.type CHECK constraint to admit
-- 'youtube_transcript', plus auth-callable RPC for creating youtube
-- source rows. Closes out the source-ingestion vertical slice's third
-- source-type addition (Sprint 06 introduced 'audio_transcript';
-- Sprint 07 widened to add 'url_extraction' + 'pdf_extraction';
-- this migration widens to add 'youtube_transcript').
--
-- The RPC pair follows the Sprint 06 / Sprint 07 wrapper-and-worker
-- pattern from packages/db/migrations/20260506200000_source_create_delete_rpcs.sql:
-- public.api_create_source_youtube wraps private.create_source_youtube_impl;
-- the wrapper enforces auth.uid() + workspace membership; the worker
-- INSERTs the row with type='youtube_transcript', status='processing',
-- content='' (empty-string placeholder per Sprint 07 (A) lock),
-- source_url=<original user-pasted URL per A3.4>.
--
-- These RPCs are TEMPORARY by Sprint 08 design — Sprint 08 B4 will
-- collapse api_create_source_audio + api_create_source_url +
-- api_create_source_pdf + api_create_source_youtube into a unified
-- public.api_create_source(workspace_id, type, payload) wrapper per
-- the A5.1 HTTP-boundary-collapse lock. The four private worker impls
-- (including the one introduced here) stay parallel because their
-- type-specific INSERT logic is the actual non-duplicated work.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen sources.type CHECK constraint
-- ---------------------------------------------------------------------------
-- Drop the existing CHECK (admits audio + url + pdf) and recreate to
-- admit youtube_transcript. The drop-and-recreate shape matches Sprint
-- 07 C1's widening; Postgres's CHECK constraints are immutable so
-- ALTER CONSTRAINT doesn't apply.
alter table public.sources
  drop constraint if exists sources_type_check;

alter table public.sources
  add constraint sources_type_check
    check (type in (
      'audio_transcript',
      'url_extraction',
      'pdf_extraction',
      'youtube_transcript'
    ));

-- ---------------------------------------------------------------------------
-- 2. private.create_source_youtube_impl — DEFINER worker
-- ---------------------------------------------------------------------------
-- Inserts a youtube_transcript row in 'processing' status and returns
-- its id. Stores the original user-pasted YouTube URL in source_url
-- (per A3.4 — preserves provenance; yt-dlp normalizes the ~8 URL forms
-- internally at extraction time). Title is NULL at insert time; the
-- task will fill it from yt-dlp metadata during extraction (per A3.5
-- server-extracted-from-metadata lock).
--
-- Caller (api_create_source_youtube) is responsible for asserting
-- workspace membership before calling this worker; no defensive checks
-- here.
create or replace function private.create_source_youtube_impl(
  _workspace_id uuid,
  _user_id uuid,
  _source_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _source_id uuid;
begin
  insert into public.sources (
    workspace_id, user_id, type, content, status, source_url
  )
  values (
    _workspace_id, _user_id, 'youtube_transcript', '', 'processing', _source_url
  )
  returning id into _source_id;

  return _source_id;
end;
$$;

revoke all on function private.create_source_youtube_impl(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 3. public.api_create_source_youtube — auth-callable wrapper
-- ---------------------------------------------------------------------------
-- Errcodes:
--   22023 (invalid_parameter_value) — missing user/source_url
--   42501 (insufficient_privilege)  — not a workspace member
create or replace function public.api_create_source_youtube(
  _workspace_id uuid,
  _source_url text
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

  if _source_url is null or length(_source_url) = 0 then
    raise exception 'source_url is required'
      using errcode = '22023';
  end if;

  _source_id := private.create_source_youtube_impl(_workspace_id, _user_id, _source_url);
  return _source_id;
end;
$$;

revoke all on function public.api_create_source_youtube(uuid, text) from public;
grant execute on function public.api_create_source_youtube(uuid, text) to authenticated;
