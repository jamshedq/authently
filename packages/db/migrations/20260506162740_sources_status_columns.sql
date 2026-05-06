-- =============================================================================
-- Authently migration — Sprint 07 C1
-- Created: 2026-05-06T16:27:40.588Z
-- Slug: sources_status_columns
--
-- Sprint 07 schema migration. Extends public.sources to support B3 (URL/PDF
-- extraction) and the sources management surface (list page + polling +
-- delete) shipping in C2-C4. Schema-only commit; no callers added here for
-- the new RPC. The api_create_source_url / api_create_source_pdf /
-- api_delete_source RPCs land with the commits that need them (C2-C4),
-- per Sprint 07 C1 prompt narrowing.
--
-- Schema delta:
--   - status text NOT NULL DEFAULT 'ready' (lifecycle column)
--   - error text NULL (prefix-encoded same convention as Sprint 06 B1
--     audio errors: validation: / openai_rejected: / extraction_failed: /
--     network: / transient: / auth: / timeout: / save_failed:)
--   - source_url text NULL (URL provenance for B3 url_extraction; B2
--     reuses in Sprint 08 for youtube_transcript)
--   - title text NULL (display label; "Untitled" UI fallback per E5)
--   - Widen sources_type_check to admit 'url_extraction' and 'pdf_extraction'.
--     'youtube_transcript' intentionally excluded — that lands with B2 in
--     Sprint 08 via follow-up migration.
--
-- Empty-string content placeholder pattern (Sprint 07 (A) lock):
--   The existing `content text NOT NULL` constraint is preserved. B3's
--   source-creation RPCs (landing in C2) will insert with `content = ''`
--   and `status = 'processing'`; the service-role status RPC (this migration)
--   UPDATEs to real content + `status = 'ready'` when the Trigger.dev task
--   finishes. Empty string is a valid non-null value.
--
-- New RPC pair:
--   - private.update_source_status_impl — DEFINER worker. Validates state-
--     machine invariants (processing → ready | failed only); rejects
--     illegal transitions with 22023.
--   - public.svc_update_source_status — service-role-only HTTP entry point.
--     Per Sprint 07 pre-flight Item 5: public schema (no service.* schema
--     in this codebase; eight prior svc_* functions all live in public),
--     positional parameters with default null on optional fields, perimeter
--     enforced at the GRANT layer (anon + authenticated both rejected with
--     42501 from PostgREST).
--
-- RLS: no policy changes. The existing sources_select policy continues to
--   apply to the new columns. Workspace members see all rows in their
--   workspace regardless of status; the list page UI (C3) decides what to
--   render based on status. Status mutations bypass RLS via the service-
--   role-only svc_* path.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema: add lifecycle + provenance + display columns
-- ---------------------------------------------------------------------------
alter table public.sources
  add column status text not null default 'ready'
    check (status in ('processing', 'ready', 'failed')),
  add column error text,
  add column source_url text,
  add column title text;

-- ---------------------------------------------------------------------------
-- 2. Schema: widen type CHECK constraint
-- ---------------------------------------------------------------------------
-- 'youtube_transcript' intentionally excluded — Sprint 08 B2 widens again
-- via follow-up migration. Conservative widening matches Sprint 04 pattern
-- of not pre-anticipating future sprints in schema.
alter table public.sources
  drop constraint sources_type_check,
  add constraint sources_type_check
    check (type in ('audio_transcript', 'url_extraction', 'pdf_extraction'));

-- ---------------------------------------------------------------------------
-- 3. private.update_source_status_impl — DEFINER worker
-- ---------------------------------------------------------------------------
-- State machine (locked at S07 spec-lock):
--   processing → ready  (with content + optional title; clears error)
--   processing → failed (with error; preserves whatever title was set on
--                        insert by api_create_source_pdf — the user-supplied
--                        filename; preserves whatever content placeholder
--                        was set on insert)
--   any other transition rejected with 22023.
--
-- Required fields per transition:
--   - ready: content non-null + non-empty (matches Sprint 06 B1 convention
--     for content validation in private.create_source_audio_impl)
--   - failed: error non-null + non-empty (developer-mistake guard — the
--     Trigger.dev task wrapper must always classify failures into one of
--     the four prefix-encoded error classes per B3-Q3)
--
-- Row read uses FOR UPDATE to serialize concurrent transition attempts.
-- The first transition wins; the second hits the "illegal status transition"
-- branch since current_status will be 'ready' or 'failed' by then.
create or replace function private.update_source_status_impl(
  _source_id uuid,
  _status text,
  _content text default null,
  _title text default null,
  _error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if _source_id is null then
    raise exception 'source_id is required'
      using errcode = '22023';
  end if;
  if _status is null or _status not in ('ready', 'failed') then
    raise exception 'status must be ready or failed (got: %)', coalesce(_status, '<null>')
      using errcode = '22023';
  end if;

  -- Per-transition required-field validation. These are developer-mistake
  -- guards — the Trigger.dev task wrapper is the only caller, and it should
  -- always provide the right fields for the transition it's making.
  if _status = 'ready' and (_content is null or length(_content) = 0) then
    raise exception 'content is required for ready transition'
      using errcode = '22023';
  end if;
  if _status = 'failed' and (_error is null or length(_error) = 0) then
    raise exception 'error is required for failed transition'
      using errcode = '22023';
  end if;

  -- Read current status with row lock; serializes concurrent transitions.
  -- deleted_at filter ensures we don't transition a soft-deleted row.
  select status into current_status
    from public.sources
    where id = _source_id and deleted_at is null
    for update;

  if current_status is null then
    raise exception 'source not found or deleted (id: %)', _source_id
      using errcode = '22023';
  end if;

  if current_status <> 'processing' then
    raise exception 'illegal status transition from % to %', current_status, _status
      using errcode = '22023';
  end if;

  if _status = 'ready' then
    update public.sources
      set status = 'ready',
          content = _content,
          title = coalesce(_title, title),
          error = null
      where id = _source_id;
  else
    -- _status = 'failed' (validated above)
    update public.sources
      set status = 'failed',
          error = _error
      where id = _source_id;
  end if;
end;
$$;

revoke all on function private.update_source_status_impl(uuid, text, text, text, text) from public;
revoke all on function private.update_source_status_impl(uuid, text, text, text, text) from anon, authenticated;
grant execute on function private.update_source_status_impl(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. public.svc_update_source_status — service-role-only wrapper
-- ---------------------------------------------------------------------------
-- Signature locked at Sprint 07 pre-flight Item 5. Public schema with svc_
-- prefix per CLAUDE.md naming convention; granted to service_role only,
-- revoked from public/anon/authenticated. Anon and authenticated callers
-- are rejected at the PostgREST GRANT layer with 42501 — no defensive
-- check needed inside the wrapper body.
create or replace function public.svc_update_source_status(
  _source_id uuid,
  _status text,
  _content text default null,
  _title text default null,
  _error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.update_source_status_impl(_source_id, _status, _content, _title, _error);
end;
$$;

revoke all on function public.svc_update_source_status(uuid, text, text, text, text) from public;
revoke all on function public.svc_update_source_status(uuid, text, text, text, text) from anon, authenticated;
grant execute on function public.svc_update_source_status(uuid, text, text, text, text) to service_role;
