# Test conventions — packages/db/tests

Notes for tests that exercise the database layer (RLS, billing, auth).
The helpers in `helpers/` are the shared fixture surface; this file
captures patterns and gotchas the helpers don't make obvious.

## Timestamp assertions

**Use `new Date(value).getTime()` for equality, not literal string
comparison.** Postgres serialises `timestamptz` with `+00:00`; JS
`Date.toISOString()` uses `Z`. Both represent the same instant but
the literal strings differ:

```ts
// ❌ Will fail intermittently:
const baselineIso = new Date(...).toISOString();   // "2026-05-01T15:05:51.666Z"
await setLastActiveAt(workspaceId, userId, baselineIso);
const fromDb = await readLastActiveAt(client, workspaceId, userId);
expect(fromDb).toBe(baselineIso);                   // "...+00:00" vs "...Z" mismatch

// ✅ Compare instants, not strings:
expect(new Date(fromDb).getTime()).toBe(new Date(baselineIso).getTime());
```

Surfaced in Sprint 03 A1
(`tests/rls/workspace-members-activity.test.ts`); pinned here so the
next test author doesn't rediscover it.

## Test user lifecycle

`TestUserPool` (in `helpers/test-user.ts`) creates real auth.users +
workspace + owner-membership rows via the service-role client. Always:
- `await pool.create({ fullName: ... })` in `beforeEach` or inline
- `await pool.cleanup()` in `afterEach` — drops the user, which
  cascades to memberships + the auto-created workspace

## Anonymous vs authenticated vs service-role clients

Three client constructors in `helpers/supabase-clients.ts`:
- `createAnonClient()` — no JWT; gets RLS-anon-role privileges
- `createAuthenticatedClient(accessToken)` — uses the user's JWT;
  RLS evaluates `auth.uid()` against this user
- `createServiceRoleClient()` — bypasses RLS; reserved for fixture
  setup and inspection that needs to see all rows

Pick the client matching what you're testing. Permission tests use
anon/authenticated; "did the right row land?" inspection uses
service-role.

## RPC perimeter tests

Every new `public.*` SECURITY DEFINER function gets a perimeter test:
- `anon` client call → expect `error.code === "42501"` (insufficient
  privilege from PostgREST)
- `authenticated` non-member call → expect either an explicit error
  OR a successful no-op (depends on the RPC body — document which)

See `tests/billing/process-stripe-event-rls.test.ts` for the canonical
shape.

## Write-path convention: DEFINER RPCs as sole write path

For tables that gate on multi-row or cross-table invariants, **SECURITY
DEFINER RPCs are the sole write path**. RLS on those tables is
SELECT-only; INSERT/UPDATE/DELETE are revoked from `authenticated` (and
`anon`), and mutations are routed through `private.*_impl` workers
wrapped by `public.api_*` functions granted to `authenticated` only.

**Why.** Check-and-mutate logic stays in SQL — single function-level
transaction, no TOCTOU window between an application-layer check and a
write. The service-role key is never expanded for this. The grants on
`authenticated` stay narrow and auditable: SELECT on the table, EXECUTE
on the wrapper, nothing else.

**Read/write split rule.** SELECT policies on the table express what
authenticated users can *see*. Mutations are not expressed as RLS
policies — they're expressed as DEFINER functions that read
`auth.uid()` themselves, validate the relevant invariants (caller is
owner, target is a member, workspace not soft-deleted, etc.), then
write.

**Current examples** (cite the migration where each lands):
- `public.workspaces` soft-delete — Sprint 04 A1, migration
  `20260501224734_workspaces_soft_delete.sql`
- `public.workspace_ownership_transfers` — Sprint 04 A2, migration
  `20260501231519_workspace_ownership_transfers.sql`
- `public.user_profiles` — Sprint 04 A3, migration
  `20260501234834_account_deletion.sql`

**Forward note.** New tables that introduce mutation should follow this
pattern by default. If a table genuinely needs RLS-driven writes (the
invariants are single-row and reducible to `auth.uid()` membership
predicates, e.g. the existing `workspaces.name` UPDATE via
`workspaces_owner_admin_update` policy), the migration header should
say so explicitly. The reason gets captured at write time, not
discovered later from the absence of the pattern.
