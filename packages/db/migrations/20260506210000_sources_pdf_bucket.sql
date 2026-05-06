-- =============================================================================
-- Authently migration — Sprint 07 C2b.2
-- Created: 2026-05-06T21:00:00.000Z
-- Slug: sources_pdf_bucket
--
-- Sprint 07 C2b.2 — Storage bucket creation + RLS policies for the
-- `sources-pdf` bucket. This is the first apps/web→Storage interaction in
-- the codebase; the bucket-creation pattern + storage.objects RLS shape are
-- established here (no precedent in prior migrations).
--
-- Bucket. `sources-pdf`, private, with infrastructure-level guards:
--   - file_size_limit = 50 MiB (matches supabase/config.toml's
--     file_size_limit baseline; aligning bucket-level + global limits
--     prevents "validation passes but Storage rejects" mismatches)
--   - allowed_mime_types = ['application/pdf'] (defense in depth — the
--     apps/web action layer ALSO validates via zod, but the bucket
--     enforces a final invariant at the Storage boundary)
--
-- Path structure (computed deterministically by both apps/web upload
-- action and apps/jobs extractFromPdfTask, per the "computed-not-passed"
-- pattern locked at C2a):
--
--   ws/{workspace_id}/{source_id}.pdf
--
-- Caller and task converge by construction — neither passes the path to
-- the other; both compute it from (workspace_id, source_id). This
-- eliminates the entire class of "what if the path got mangled in
-- transit" bugs.
--
-- RLS on storage.objects. Four policies (SELECT, INSERT, UPDATE, DELETE),
-- all scoped to `bucket_id = 'sources-pdf'` and enforcing workspace
-- membership via:
--
--   (storage.foldername(name))[1] = 'ws'
--   AND private.is_workspace_member(((storage.foldername(name))[2])::uuid)
--
-- The first segment must literally be 'ws' (defense against malformed
-- paths like /tmp/x.pdf escaping the workspace partition); the second
-- segment is the workspace_id, parsed as uuid and checked via the
-- existing membership helper. private.is_workspace_member is SECURITY
-- DEFINER + reads auth.uid() internally, granted to authenticated +
-- service_role at init.sql time — callable from storage policies.
--
-- Operation coverage. SELECT and INSERT are exercised by the apps/web
-- upload flow (apps/web uploads PDF bytes; apps/jobs reads via signed
-- URL — service-role bypasses these policies, so the SELECT policy is
-- primarily for any future user-facing read path). DELETE is exercised
-- by C2a's extractFromPdfTask cleanup (best-effort delete after
-- extraction). UPDATE is included for completeness — no current code
-- path mutates Storage objects in place — but is a one-line policy and
-- omitting it would be a silent gap if a future code path needs it.
--
-- Cross-tenant safety. The path-prefix check + membership check together
-- form the cross-tenant perimeter: a member of workspace A cannot
-- read/write/delete an object at `ws/{workspace_b_id}/...` because
-- private.is_workspace_member returns false for workspace B. The
-- perimeter tests in packages/db/tests/storage/sources-pdf-bucket.test.ts
-- exercise this explicitly.
--
-- Storage cleanup. C2a's extractFromPdfTask deletes the Storage object
-- after extraction (best-effort, per existing extract-from-pdf.ts logic).
-- api_delete_source soft-delete (C2b.1) does NOT cascade to Storage —
-- soft-deleted rows keep their Storage object alongside them. Storage
-- orphans from failed extractions are accepted per
-- SPRINT_07_carryovers.md entry #2 [E6d-Storage addendum]; no sweeper
-- in Sprint 07.
--
-- Run `pnpm --filter @authently/db gen:types` after applying (storage
-- bucket changes don't touch public/private schema, but the gen:types
-- pattern stays consistent for any storage-adjacent migration).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bucket creation
-- ---------------------------------------------------------------------------
-- Idempotent via ON CONFLICT: re-running the migration (e.g., supabase db
-- reset) is a no-op if the bucket already exists. The local dev path runs
-- this on every reset; the production path runs it once on initial
-- migration apply.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sources-pdf',
  'sources-pdf',
  false,
  52428800,                    -- 50 MiB
  array['application/pdf']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. RLS policies on storage.objects (sources-pdf scope)
-- ---------------------------------------------------------------------------
-- All four policies share the same predicate structure:
--   bucket_id = 'sources-pdf'
--   AND (storage.foldername(name))[1] = 'ws'
--   AND private.is_workspace_member(((storage.foldername(name))[2])::uuid)
--
-- They differ only in operation (SELECT/INSERT/UPDATE/DELETE) and clause
-- (USING for SELECT/UPDATE/DELETE; WITH CHECK for INSERT/UPDATE).

-- 2a. SELECT — workspace members can read objects in their workspace's path.
create policy "sources_pdf_workspace_member_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'sources-pdf'
    and (storage.foldername(name))[1] = 'ws'
    and private.is_workspace_member(((storage.foldername(name))[2])::uuid)
  );

-- 2b. INSERT — workspace members can upload objects to their workspace's path.
-- The WITH CHECK predicate ensures the new object's path passes the
-- membership check before insertion (rejects cross-tenant uploads).
create policy "sources_pdf_workspace_member_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'sources-pdf'
    and (storage.foldername(name))[1] = 'ws'
    and private.is_workspace_member(((storage.foldername(name))[2])::uuid)
  );

-- 2c. UPDATE — workspace members can update objects in their workspace's
-- path. No current code path mutates Storage objects in place; included
-- for completeness so a future flow that needs in-place updates doesn't
-- need a follow-up migration.
create policy "sources_pdf_workspace_member_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'sources-pdf'
    and (storage.foldername(name))[1] = 'ws'
    and private.is_workspace_member(((storage.foldername(name))[2])::uuid)
  )
  with check (
    bucket_id = 'sources-pdf'
    and (storage.foldername(name))[1] = 'ws'
    and private.is_workspace_member(((storage.foldername(name))[2])::uuid)
  );

-- 2d. DELETE — workspace members can delete objects in their workspace's
-- path. Exercised by C2a's extractFromPdfTask cleanup path (which uses
-- service-role and bypasses RLS in practice; this policy is for any
-- future user-facing delete path).
create policy "sources_pdf_workspace_member_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'sources-pdf'
    and (storage.foldername(name))[1] = 'ws'
    and private.is_workspace_member(((storage.foldername(name))[2])::uuid)
  );
