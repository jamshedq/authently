<!--
  Sprint 07 — Pre-flight verification
  Locked: 2026-05-06
  Status: pre-flight
  Predecessor: Sprint 07 spec-lock at commit b4b1966.
  Scope: resolves the five open verification items pinned in
    SPRINT_07.md "Pre-flight verification items" section.
    Implementation questions only — does not re-litigate locked
    design decisions. Findings unlock C1 (schema migration) and
    later commits as noted per item.

  Reading guide for future Claude sessions:
  - Each item carries: locked design context (one or two
    sentences from SPRINT_07.md), the question being resolved,
    the verification method used, the resolution, and an
    implementation note tying the resolution to the relevant
    commit in the four-commit sequencing (commit 1 schema, 2
    B3 backend, 3 list page, 4 tabbed upload).
  - Two findings warrant the spec author's attention before
    C2 begins (Item 1 import path, Item 3 storage pattern).
    Both flagged inline in their respective items.
  - This is a docs-only artifact. No code, no schema, no spec
    changes.
-->

# Sprint 07 — Pre-flight verification

## Item 1 — Trigger.dev v4 Python build extension API

**Locked design context.** SPRINT_07.md E3: Python execution via
Trigger.dev v4 build extension. Python files in `apps/jobs/python/`.
JSON-over-stdout protocol. Exit codes 0 (success) / 1 (failure).
Two Trigger.dev tasks (`extractFromUrlTask`, `extractFromPdfTask`)
wrap two Python modules (`extract_trafilatura.py`,
`extract_pdfplumber.py`).

**Question.** Exact build extension API shape: how is the Python
runtime declared in `trigger.config.ts`? How are dependencies
specified? How does the task invoke a Python script and capture
stdout?

**Verification method.** Context7 against `/triggerdotdev/trigger.dev`
+ cross-reference with the Python build extension snippet already
documented in [apps/jobs/CLAUDE.md](apps/jobs/CLAUDE.md).

**Resolution.**

`trigger.config.ts` configuration (per Trigger.dev v4 official docs):

```ts
import { defineConfig } from "@trigger.dev/sdk";
import { pythonExtension } from "@trigger.dev/python/extension";

export default defineConfig({
  project: process.env["TRIGGER_PROJECT_REF"] ?? "proj_authently_placeholder",
  runtime: "node",
  // ... existing fields ...
  build: {
    extensions: [
      pythonExtension({
        scripts: ["./python/**/*.py"],
        requirementsFile: "./python/requirements.txt",
        devPythonBinaryPath: ".venv/bin/python",
      }),
    ],
  },
});
```

Task invocation pattern (per Trigger.dev v4 official docs):

```ts
import { task } from "@trigger.dev/sdk";
import { python } from "@trigger.dev/python";

export const extractFromUrlTask = task({
  id: "extract-from-url",
  run: async (payload: { workspaceId: string; sourceId: string; sourceUrl: string }) => {
    const result = await python.runScript(
      "./python/extract_trafilatura.py",
      [payload.sourceUrl],
    );
    // result.stdout contains the JSON line printed by the Python module
    // result.stderr / result.exitCode also available on the result object
    const parsed = JSON.parse(result.stdout);
    // ... dispatch to svc_update_source_status based on parsed shape
  },
});
```

Per the Trigger.dev v4 README, the extension creates a Python
virtual environment at `/opt/venv` inside the deployment container
and installs `requirementsFile` packages via pip at build time.
`devPythonBinaryPath` points at the local venv used during
`pnpm --filter @authently/jobs dev` so the same scripts run locally
without rebuilds.

**⚠️ Discrepancy flag.** The Python extension import path in the
current [apps/jobs/CLAUDE.md](apps/jobs/CLAUDE.md) reads
`@trigger.dev/build/extensions/python`. Current Trigger.dev v4 docs
on Context7 show `@trigger.dev/python/extension` (different package
namespace). Both reference v4, so this is a docs-vs-current-API
divergence rather than a v3-to-v4 migration issue. **Recommend the
C2 commit (B3 backend) uses the Context7-current path
`@trigger.dev/python/extension` and updates apps/jobs/CLAUDE.md in
the same commit to match.** Do not silently update CLAUDE.md as a
drive-by — surface the change in the C2 commit body so future readers
see the resolution.

**⚠️ Existing trigger.config.ts import.** The current
[apps/jobs/trigger.config.ts](apps/jobs/trigger.config.ts) imports
`defineConfig` from `@trigger.dev/sdk/v3`. Trigger.dev v4 conventions
in apps/jobs/CLAUDE.md and Context7 docs both use `@trigger.dev/sdk`
(no `/v3` suffix). The C2 commit must update this import alongside
adding the Python extension; the existing file is mid-migration to
v4 conventions.

**Implementation note (unlocks C2).** Schema migration (C1) does not
depend on this resolution — it lands first as planned. C2 (B3 backend)
uses the resolved import path, configures `pythonExtension`, and
updates apps/jobs/CLAUDE.md as part of the same commit.

## Item 2 — Trafilatura + pdfplumber pinned versions

**Locked design context.** SPRINT_07.md E3: dependencies pinned in
`apps/jobs/python/requirements.txt`. Exact versions to be locked
at pre-flight.

**Question.** Current latest stable versions of `trafilatura` and
`pdfplumber` on PyPI; compatibility with the Python runtime version
that Trigger.dev v4's `pythonExtension` uses.

**Verification method.** PyPI lookup via WebSearch.

**Resolution.**

```
trafilatura==2.0.0
pdfplumber==0.11.9
```

- `trafilatura==2.0.0` — current stable. Requires Python `>=3.8`.
  Sources: [Trafilatura 2.0.0 docs](https://trafilatura.readthedocs.io/en/latest/installation.html),
  [trafilatura on PyPI](https://pypi.org/project/trafilatura/).
- `pdfplumber==0.11.9` — current stable, released 2026-01-05.
  Sources: [pdfplumber on PyPI](https://pypi.org/project/pdfplumber/),
  [pdfplumber GitHub releases](https://github.com/jsvine/pdfplumber/releases).

**Python runtime compatibility.** Trigger.dev v4's `pythonExtension`
documentation does not pin a specific Python minor version in the
`/opt/venv` it creates; the runtime is whatever Python the
deployment container ships. Both libraries support Python `>=3.8`,
which covers any reasonable runtime Trigger.dev would ship in 2026.
Verification via the `--log-level debug --dry-run` build flag
(per apps/jobs/CLAUDE.md best practices) at C2 commit time will
surface the actual installed Python version; pin a tighter floor
in requirements.txt if needed.

**Implementation note (unlocks C2).** `apps/jobs/python/requirements.txt`
is created in C2 with the two pins above. No version ranges
(per SPRINT_07.md pre-flight item: "Pin in `apps/jobs/python/
requirements.txt` with exact versions (no version ranges)").

## Item 3 — PDF file transfer mechanism

**Locked design context.** SPRINT_07.md B3-Q1: PDF upload is a
separate UI entry but reuses the pdfplumber Python module. PDFs
arrive via drag-and-drop on the tabbed upload page. The
`fileTransfer` shape between apps/web and the
`extractFromPdfTask` was explicitly deferred to pre-flight in
SPRINT_07.md.

**Question.** How does the PDF binary get from the browser upload
to the Python pdfplumber task running in Trigger.dev?

**Verification method.** Context7 against Trigger.dev v4 docs for
payload limits + recommended large-payload pattern. Cross-reference
with Sprint 06 audio upload code at
[apps/web/src/app/app/\[workspaceSlug\]/sources/upload/actions.ts](apps/web/src/app/app/[workspaceSlug]/sources/upload/actions.ts)
to check whether an existing storage-then-task pattern exists in
this codebase.

**⚠️ Factual correction to the spec-lock prompt's premise.** The
prompt assumed Sprint 06 B5 already uses Supabase Storage for audio
files. **It does not.** SPRINT_06.md's non-goals state explicitly:
*"Audio persistence — files stream through B5 → server action →
OpenAI without storing the bytes anywhere."* Sprint 06's
[actions.ts](apps/web/src/app/app/[workspaceSlug]/sources/upload/actions.ts)
calls `transcribeAudio({ file, fileName })` then
`createSourceAudio({ workspaceId, content })`; the file bytes pass
through the server action directly to OpenAI's `audio.transcriptions.create`
endpoint and are not persisted. There is no existing storage-then-task
pattern in this codebase to extend. Sprint 07 is establishing the
first such pattern.

**Resolution: option (b), Supabase Storage + signed URL in task
payload.**

Trigger.dev v4 documents a payload size constraint: per the
batchTrigger snippet in [apps/jobs/CLAUDE.md](apps/jobs/CLAUDE.md),
"up to 1,000 items, 3MB per payload." Single-trigger payload limits
are in the same order of magnitude. Sprint 07 PDFs can be up to 25MB
(matching the audio cap from Sprint 06 B5-Q4) — definitively above
the payload threshold. Trigger.dev's official docs explicitly call
out this case and recommend offloading large payloads to object
storage and passing a signed URL: *"This is useful when payloads
exceed Trigger.dev's automatic limits."*

Concrete pattern:

1. Browser drag-and-drop submits PDF to `pdf-action.ts`
   (`'use server'`).
2. Server action validates (size ≤ 25MB, MIME `application/pdf`,
   server-side re-validation per the Sprint 06 both-side validation
   precedent).
3. Server action calls `api_create_source_pdf(_workspace_id, _title)`
   → returns `sourceId` with `status='processing'`, `content=''`.
4. Server action uploads PDF bytes to Supabase Storage bucket
   `sources-pdf` at key `ws/{workspaceId}/{sourceId}.pdf`. Bucket
   created in C1 schema migration as a Supabase Storage bucket
   policy alongside the table changes (or in C2 as part of the
   B3 backend commit — locked at C2 spec-lock).
5. Server action triggers `extractFromPdfTask` with payload
   `{ workspaceId, sourceId, storagePath }`.
6. Trigger.dev task uses the service-role Supabase client
   (already in apps/jobs via `getJobsSupabaseClient`) to download
   the PDF bytes from the bucket → writes to a tmpfile in the
   task's container → invokes `python.runScript("./python/
   extract_pdfplumber.py", [tmpFilePath])`.
7. On task completion (success or failure), task deletes the PDF
   from Storage. Privacy-respecting per Sprint 06 B5-Q3's
   "stream through, don't store" pattern, adapted: store
   transiently for the extraction window, delete after. Storage
   path lives only as long as the task runs.

Why not (a) — payload-embedded base64? Crosses the documented
3MB-per-payload limit for any meaningful PDF. Even <3MB PDFs would
work, but the upper bound at 25MB hard-rules out the approach.

Why not (c) — ephemeral tmpdir on shared volume? Trigger.dev's
execution model puts each task run in its own container; there is
no shared filesystem across the apps/web → apps/jobs boundary.

**⚠️ Forward-flagged: the URL-extraction-that-resolves-to-PDF case
(B3-Q1 second clause).** When `extractFromUrlTask` HEAD-checks a
URL and Content-Type is `application/pdf`, the task already has
the URL — the most natural pattern is to fetch the PDF inside the
task (download to tmpfile, run pdfplumber on it). No Storage
round-trip needed for that path; only the user-uploaded-PDF entry
goes through Storage. This asymmetry should be locked at C2 spec-lock,
since it changes whether `extract_pdfplumber.py` accepts a file path
or a URL (or both, branching internally).

**Implementation note (unlocks C2 + may affect C1).** If the
`sources-pdf` Storage bucket is created via SQL in the same
migration as the table changes, C1 carries it. If created via
Supabase config or a separate `supabase/storage.sql` file, C1
is purely table changes and the bucket lands in C2. Lock at
C2 spec-lock. The RPC surface (`api_create_source_pdf`) does not
take a storage path — the upload-then-trigger sequencing happens
in the apps/web server action layer.

## Item 4 — Trafilatura HEAD-request behavior

**Locked design context.** SPRINT_07.md B3-Q1: URL extraction task
does HEAD request, branches on Content-Type. `text/html` →
Trafilatura; `application/pdf` → pdfplumber.

**Question.** Does Trafilatura do its own HEAD request internally
before fetching, or must the task wrapper do the HEAD request
explicitly before deciding which Python module to invoke?

**Verification method.** WebSearch against Trafilatura 2.0.0 docs +
GitHub issues + source modules.

**Resolution: case (b) — task wrapper does HEAD itself.**

Trafilatura's documented scope is HTML-only. From the Trafilatura
project: *"Trafilatura currently focuses on HTML documents and
does not extract information from PDF files"*
([source: trafilatura GitHub issue #105](https://github.com/adbar/trafilatura/issues/105)).
Its `fetch_url()` decodes the HTTP response body as Unicode text
([source: trafilatura.utils](https://trafilatura.readthedocs.io/en/stable/_modules/trafilatura/utils.html)),
which means a PDF binary fed in would be lossy-decoded and then
fail extraction silently rather than rejecting cleanly via
Content-Type. There is no documented HEAD-and-branch behavior at
the library boundary.

The task wrapper (TypeScript, in `extractFromUrlTask`) must do
the HEAD request before deciding which Python module to invoke.
Pseudocode:

```ts
const headResponse = await fetch(payload.sourceUrl, { method: "HEAD" });
const contentType = (headResponse.headers.get("content-type") ?? "")
  .split(";")[0]
  .trim()
  .toLowerCase();

if (!headResponse.ok) {
  // network: error class — non-2xx HEAD response
  await updateStatus({ status: "failed", error: `network: ${headResponse.status}` });
  return;
}

if (contentType === "text/html" || contentType === "application/xhtml+xml") {
  const result = await python.runScript("./python/extract_trafilatura.py", [payload.sourceUrl]);
  // ... dispatch
} else if (contentType === "application/pdf") {
  // Fetch PDF inside the task; write to tmpfile; pass to pdfplumber.
  // Per Item 3's forward-flag, this is the URL-resolves-to-PDF path
  // that bypasses Supabase Storage.
  const pdfBytes = await (await fetch(payload.sourceUrl)).arrayBuffer();
  const tmpPath = await writeTmpFile(pdfBytes);
  const result = await python.runScript("./python/extract_pdfplumber.py", [tmpPath]);
  // ... dispatch
} else {
  await updateStatus({ status: "failed", error: `network: unsupported_content_type: ${contentType}` });
}
```

**Content-Type variations to handle.** Real-world `Content-Type`
headers can include parameters (`application/pdf;charset=utf-8`),
mixed case (`Application/PDF`), or be absent entirely (some servers
omit the header on HEAD responses). The pseudocode above
defensively splits on `;`, trims, and lowercases. Missing header is
treated as `network: unsupported_content_type` — conservative
default. C2 implementation should preserve this defensive parsing.

**HEAD-request HTTP client.** Native Node.js `fetch` (Node 22 ships
it stable, and Trigger.dev v4 supports `runtime: "node-22"`). No
third-party dependency needed. Timeout via `AbortController` with
a tight budget (e.g. 5-second HEAD timeout) so a slow HEAD doesn't
eat the whole task budget.

**Implementation note (unlocks C2).** C2 ships the HEAD-and-branch
logic inside `extractFromUrlTask`. The `extract_trafilatura.py`
Python module is invoked only on confirmed-HTML responses; it does
not need internal Content-Type guards.

## Item 5 — `svc_update_source_status` scope and payload

**Locked design context.** SPRINT_07.md schema-migration sub-item
defines `private.update_source_status_impl` + `public.svc_update_source_status`
as the service-role-only status-mutation pair. Sprint 07 (C) lock
flagged the perimeter test framing as dependent on this scope
question.

**Question.** (5a) Is the function `public.svc_*` (existing
convention) or a new `service.*` schema namespace? (5b) Positional
parameters or JSONB payload?

**Verification method.** File review of
[packages/db/migrations/](packages/db/migrations/) — every existing
`svc_*` and `private.*_impl` definition.

**Resolution.**

**(5a) Schema: `public.svc_update_source_status`.** No `service`
schema exists in this codebase. All eight existing service-role-only
functions live in `public` with the `svc_` prefix:

| Function | Migration |
|---|---|
| `public.svc_set_workspace_stripe_customer` | `20260430234723_set_workspace_stripe_customer.sql` |
| `public.svc_sweep_soft_deleted_workspaces` | `20260502194315_workspaces_sweep_columns.sql` |
| `public.svc_finalize_workspace_hard_delete` | `20260502194315_workspaces_sweep_columns.sql` |
| `public.svc_record_workspace_sweep_error` | `20260502194315_workspaces_sweep_columns.sql` |
| `public.svc_upsert_stripe_price_tier_map` | `20260430231812_billing_rpc_pattern_refactor.sql` |
| `public.svc_process_stripe_event` | `20260430231812_billing_rpc_pattern_refactor.sql` |
| `public.svc_find_workspaces_past_due_grace_expired` | `20260430231812_billing_rpc_pattern_refactor.sql` |
| `public.svc_downgrade_workspace_to_free` | `20260430231812_billing_rpc_pattern_refactor.sql` |

[CLAUDE.md](CLAUDE.md)'s database-function naming convention is
explicit: *"`public.svc_<name>` — service-role-only HTTP entry
points. SECURITY DEFINER, granted to `service_role` only (revoked
from `public, anon, authenticated`)."* Establishing a `service`
schema would be a brand-new convention with no existing precedent;
the locked convention covers this case cleanly.

**Perimeter test implication for Sprint 07 (C) lock:** the perimeter
tests for `svc_update_source_status` follow the existing `svc_*`
shape — anon caller → `42501` (insufficient privilege from
PostgREST's GRANT layer); authenticated caller → `42501` (also from
GRANT layer; not granted to `authenticated`). Distinct from `api_*`
perimeters which return `22023` (defensive `auth.uid() IS NULL`
check) for anon and `42501` (`is_workspace_member` check) for
non-members. Sprint 07's spec-lock B5 perimeter test commentary
already documents this distinction.

**(5b) Payload: positional parameters.** The dominant convention
across existing `svc_*` functions is positional parameters, with
JSONB reserved for genuinely structured/nested data (e.g.,
`svc_upsert_stripe_price_tier_map(_entries jsonb)` takes an array
of price-tier mappings; `svc_process_stripe_event` takes one nested
`_payload jsonb` carrying the raw Stripe event among 7 other
positional fields).

`svc_update_source_status` takes 5 named columns
(`source_id`, `status`, `content`, `title`, `error`) — flat,
not nested, not array-shaped. Positional fits.

Concrete signature:

```sql
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
```

`content`, `title`, `error` carry `default null` so the task
wrapper can pass only the fields relevant to the transition
(success path: `content` + `title` non-null, `error` null;
failure path: `error` non-null, `content` + `title` null).

`private.update_source_status_impl` enforces the state-machine
invariant per the spec's "validates status transition (`processing`
→ `ready` | `failed`); rejects illegal transitions with `22023`"
clause. The `_status text` argument validation lives in the
worker, not the wrapper — matches the existing
`private.set_workspace_stripe_customer_impl` pattern where
non-null + non-empty checks live in the worker.

**Implementation note (unlocks C1).** C1 schema migration ships
this exact RPC signature. No new convention introduced — the
function follows the `public.svc_*` + `private.*_impl` pattern
established across eight prior migrations. Perimeter tests in C1
follow the `svc_*` perimeter shape (anon + authenticated both
rejected with `42501` from the GRANT layer).

## Pre-flight summary

| Item | Status | Resolution / blocker |
|---|---|---|
| 1. Trigger.dev Python build extension | **RESOLVED** | `pythonExtension` config + `python.runScript` invocation pattern locked. Two cross-reference flags (apps/jobs/CLAUDE.md import path, existing trigger.config.ts v3 import) to address inline in C2. |
| 2. Trafilatura + pdfplumber versions | **RESOLVED** | `trafilatura==2.0.0`, `pdfplumber==0.11.9`. Both compatible with Python `>=3.8`; Trigger.dev runtime version verified via `--dry-run` at C2. |
| 3. PDF file transfer mechanism | **RESOLVED** | Supabase Storage `sources-pdf` bucket + signed URL in task payload, with transient storage cleared post-extraction. New pattern (Sprint 06 has no existing storage pattern — premise correction surfaced inline). URL-resolves-to-PDF asymmetry forward-flagged for C2 spec-lock. |
| 4. Trafilatura HEAD-request behavior | **RESOLVED** | Case (b): task wrapper does HEAD itself. Native Node `fetch` + `AbortController`. Defensive `Content-Type` parsing pseudocode locked. |
| 5. `svc_update_source_status` scope and payload | **RESOLVED** | `public.svc_update_source_status` (no new schema). Positional parameters with `default null` on optional fields. Perimeter tests follow existing `svc_*` shape (anon + authenticated → `42501` at GRANT layer). |

**No items UNRESOLVED. No items DEFERRED.** All five questions
answered concretely; C1 (schema migration) is unblocked. C2 (B3
backend) inherits two cross-reference flags from Item 1 and one
sub-item-spec-lock decision from Item 3 (Storage bucket creation
location: C1 SQL vs. C2 config).

**Two findings warrant the spec author's attention:**

1. **Item 1 import path discrepancy.** Current
   [apps/jobs/CLAUDE.md](apps/jobs/CLAUDE.md) shows
   `@trigger.dev/build/extensions/python`; current Trigger.dev v4
   docs (Context7) show `@trigger.dev/python/extension`. The C2
   commit must update apps/jobs/CLAUDE.md alongside adopting the
   extension, with the change called out in the commit body.

2. **Item 3 premise correction.** The Sprint 07 spec-lock prompt
   for Item 3 referenced an existing Sprint 06 audio-storage
   pattern that does not exist (Sprint 06 deliberately did not
   persist audio bytes per B5-Q3). Sprint 07 establishes the
   first storage-then-task pattern in this codebase. SPRINT_07.md
   itself does not need amendment — the spec already lists "PDF
   file transfer mechanism" as a pre-flight verification item
   without prescribing the answer. The premise correction is
   purely a clarification for the spec author and future readers.
