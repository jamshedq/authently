-- =============================================================================
-- Authently migration — Sprint 07 C2b.1
-- Created: 2026-05-06T20:00:00.000Z
-- Slug: source_create_delete_rpcs
--
-- Sprint 07 C2b.1 — auth-callable RPCs for creating url_extraction and
-- pdf_extraction sources, and for soft-deleting any source. These RPCs are
-- the user-facing entry points; apps/web's action layer (lands in C2b.2)
-- calls them. C2a's Trigger.dev tasks transition the inserted rows from
-- 'processing' → 'ready' | 'failed' via the C1 service-role
-- svc_update_source_status RPC.
--
-- Three new api_* + impl pairs (locked at SPRINT_07.md B3):
--   - public.api_create_source_url(_workspace_id uuid, _source_url text)
--   - public.api_create_source_pdf(_workspace_id uuid, _title text)
--   - public.api_delete_source(_source_id uuid)
--
-- Convention. All three follow the api_* shape per CLAUDE.md naming
-- convention + Sprint 06 B5's api_create_source_audio precedent:
-- SECURITY DEFINER, REVOKE from public, GRANT execute to authenticated.
-- Anon callers reach the wrapper body and hit the `auth.uid() IS NULL`
-- defensive check (22023 — distinct from svc_* perimeter which rejects
-- anon at the GRANT layer with 42501; this api_* nuance is documented in
-- packages/db/tests/CLAUDE.md). Authenticated non-members hit the
-- `private.is_workspace_member` check (42501).
--
-- Insert pattern. Both create RPCs insert rows with:
--   status   = 'processing'    -- entry state for async extraction
--   content  = ''               -- empty-string placeholder; (A) lock at C1
--   error    = NULL             -- set by svc_update_source_status on failure
--   type     = hardcoded inside the function  -- NOT a parameter (narrows
--                                              -- the API surface; eliminates
--                                              -- a class of caller errors)
-- url_extraction stores the URL in source_url (title NULL — extraction will
-- fill it). pdf_extraction stores the user-supplied filename in title
-- (source_url NULL — Storage path is not stored). The Storage path for PDF
-- bytes is computed deterministically from (workspace_id, source_id) by
-- both the apps/web action layer (C2b.2) and C2a's extractFromPdfTask
-- (`ws/{workspace_id}/{source_id}.pdf` in the `sources-pdf` bucket); it is
-- NOT stored in any column, so no schema delta is needed.
--
-- Soft-delete pattern. api_delete_source is a soft-delete via
-- `deleted_at = now()`, matching the existing convention (Sprint 06 B5's
-- deleted_at column + Sprint 04 A1's workspace soft-delete pattern). The
-- RPC is idempotent — calling on an already-deleted or non-existent source
-- is a no-op (no error raised). Side-channel: the caller cannot distinguish
-- "source not found" from "already deleted" from the API response; this is
-- a minor information-leak mitigation, not a security boundary. Non-member
-- attempts on an existing active source still raise 42501 — that's the
-- cross-tenant perimeter, not a side-channel.
--
-- Storage cleanup. api_delete_source does NOT cascade to Storage cleanup.
-- Soft-deleted rows logically still exist and keep their Storage object
-- (`ws/{workspace_id}/{source_id}.pdf` for pdf rows) alongside them. Storage
-- orphans only surface from failed extractions or upload-without-row races
-- — see SPRINT_07_carryovers.md entry #2 [E6d-Storage addendum] for the
-- deferred sweeper.
--
-- RLS. No policy changes. The existing sources_select policy from Sprint 06
-- B5 continues to apply: workspace members see rows where
-- private.is_workspace_member(workspace_id) AND deleted_at IS NULL.
-- Soft-deleted rows are filtered from end-user views; service-role (used
-- by C2a's tasks) bypasses RLS.
--
-- Run `pnpm --filter @authently/db gen:types` after applying.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. private.create_source_url_impl — DEFINER worker
-- ---------------------------------------------------------------------------
-- Inserts a url_extraction row in 'processing' status and returns its id.
-- Caller (api_create_source_url) is responsible for asserting workspace
-- membership before calling this worker; no defensive checks here.
create or replace function private.create_source_url_impl(
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
    _workspace_id, _user_id, 'url_extraction', '', 'processing', _source_url
  )
  returning id into _source_id;

  return _source_id;
end;
$$;

revoke all on function private.create_source_url_impl(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 2. public.api_create_source_url — auth-callable wrapper
-- ---------------------------------------------------------------------------
-- Errcodes:
--   22023 (invalid_parameter_value) — missing user/source_url
--   42501 (insufficient_privilege)  — not a workspace member
create or replace function public.api_create_source_url(
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

  _source_id := private.create_source_url_impl(_workspace_id, _user_id, _source_url);
  return _source_id;
end;
$$;

revoke all on function public.api_create_source_url(uuid, text) from public;
grant execute on function public.api_create_source_url(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.create_source_pdf_impl — DEFINER worker
-- ---------------------------------------------------------------------------
-- Inserts a pdf_extraction row in 'processing' status with a user-supplied
-- title (typically the upload filename) and returns its id. The PDF bytes
-- live at `ws/{workspace_id}/{source_id}.pdf` in the `sources-pdf` Storage
-- bucket — the path is computed deterministically by the apps/web action
-- layer (C2b.2) after this RPC returns, and again by C2a's
-- extractFromPdfTask. Not stored in any column.
create or replace function private.create_source_pdf_impl(
  _workspace_id uuid,
  _user_id uuid,
  _title text
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
    workspace_id, user_id, type, content, status, title
  )
  values (
    _workspace_id, _user_id, 'pdf_extraction', '', 'processing', _title
  )
  returning id into _source_id;

  return _source_id;
end;
$$;

revoke all on function private.create_source_pdf_impl(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 4. public.api_create_source_pdf — auth-callable wrapper
-- ---------------------------------------------------------------------------
-- Errcodes:
--   22023 (invalid_parameter_value) — missing user/title
--   42501 (insufficient_privilege)  — not a workspace member
create or replace function public.api_create_source_pdf(
  _workspace_id uuid,
  _title text
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

  if _title is null or length(_title) = 0 then
    raise exception 'title is required'
      using errcode = '22023';
  end if;

  _source_id := private.create_source_pdf_impl(_workspace_id, _user_id, _title);
  return _source_id;
end;
$$;

revoke all on function public.api_create_source_pdf(uuid, text) from public;
grant execute on function public.api_create_source_pdf(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. private.delete_source_impl — DEFINER worker
-- ---------------------------------------------------------------------------
-- Soft-deletes the source row. Idempotent at the worker level: the WHERE
-- clause filters already-deleted rows, so calling on a row whose deleted_at
-- is non-null is a no-op (0 rows updated, no error). Caller (the wrapper)
-- is responsible for the membership check + the active-row lookup that
-- decides whether to delegate here at all.
create or replace function private.delete_source_impl(
  _source_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sources
    set deleted_at = now()
    where id = _source_id
      and deleted_at is null;
end;
$$;

revoke all on function private.delete_source_impl(uuid) from public;

-- ---------------------------------------------------------------------------
-- 6. public.api_delete_source — auth-callable wrapper
-- ---------------------------------------------------------------------------
-- Errcodes:
--   22023 (invalid_parameter_value) — missing user/source_id
--   42501 (insufficient_privilege)  — not a workspace member of the source
--
-- Behavior on missing source. If the source does not exist OR is already
-- soft-deleted, this RPC is a silent no-op (no error). The active-row
-- lookup happens before the membership check; if the lookup returns no
-- workspace_id, the caller cannot distinguish "source not found" from
-- "source already deleted." This is intentional — see header comment
-- under "Soft-delete pattern."
create or replace function public.api_delete_source(
  _source_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _user_id uuid := auth.uid();
  _workspace_id uuid;
begin
  if _user_id is null then
    raise exception 'user id is required'
      using errcode = '22023';
  end if;

  if _source_id is null then
    raise exception 'source_id is required'
      using errcode = '22023';
  end if;

  -- Active-source lookup. The deleted_at IS NULL filter is what makes the
  -- "already-deleted" case a silent no-op: a soft-deleted row's workspace_id
  -- is filtered out, _workspace_id stays NULL, the function returns below.
  select workspace_id into _workspace_id
    from public.sources
    where id = _source_id and deleted_at is null;

  if _workspace_id is null then
    return;
  end if;

  if not private.is_workspace_member(_workspace_id) then
    raise exception 'not a member of workspace'
      using errcode = '42501';
  end if;

  perform private.delete_source_impl(_source_id);
end;
$$;

revoke all on function public.api_delete_source(uuid) from public;
grant execute on function public.api_delete_source(uuid) to authenticated;
