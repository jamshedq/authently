<!--
  Sprint 07 — working state file
  Created: 2026-05-06
  Status: active (Sprint 07 in flight)
  Lifecycle: updated as commits land; archived or deleted at sprint close.

  Wayfinding, not comprehensive documentation. Points at canonical
  sources rather than duplicating them. For sprint-level decisions and
  spec contracts, source of truth is:
    - docs/specs/SPRINT_07.md           (locked spec, including B3/E4/E6d)
    - docs/specs/SPRINT_07_preflight.md (pre-flight verification items)
    - docs/specs/SPRINT_07_carryovers.md (deferrals + revisit triggers)
    - docs/specs/build_plan.md §5.3      (launch shape, strategic locks)
-->

# Sprint 07 — working state

## 1. Where we are (as of 2026-05-06)

### Shipped to `main`

| Commit | SHA | PR |
|---|---|---|
| Re-baseline 2026-05-06 (S15 launch target) | `fd3f26b` | #23 |
| Sprint 07 pre-flight verification | `1fba2c9` | #24 |
| C1: schema migration + `svc_update_source_status` | `56a296a` | #25 |
| C2a: B3 backend infrastructure | `a218de7` | #26 |
| C2.5: pytest infrastructure + 7th gate `test:python` | `9fdba05` | #27 |
| C2b.1: `api_create_source_url` + `api_create_source_pdf` + `api_delete_source` | `933406a` | #28 |
| C2b.2: apps/web action layer + sources-pdf bucket + Trigger.dev wiring | `70ae37a` | #29 |

### Pending (in sequence)

- **C2b.3** — end-to-end integration tests at the user-action-to-task seam (next session). See §4.
- **C3** — sources list page UI + polling + delete UI (calls `api_delete_source`; service shipped in C2b.2, action lands here).
- **C4** — tabbed upload page extension.

### Active gate baseline (7 standing)

| Gate | Count |
|---|---|
| `test:license-headers` | 254 |
| `typecheck` | 6/6 |
| `lint` | 6/6 |
| `test:db` | 174 / 30 (vitest projects: rls, auth, billing, sources, storage) |
| `test:web` | 72 / 15 |
| `test:jobs` | 32 / 5 |
| `test:python` | 23 / 3 |

### Tracking observations

**`post-signup-reconcile` flake** (PostgREST upstream-server error, first observed PR #26): **Reclassified resolved-by-attrition at PR #30, 2026-05-07 (4/4 threshold met).** PR #27, #28, #29 were the first three consecutive clean PRs since first observation; PR #30 was the fourth and triggered reclassification per the strict-threshold discipline (no "one more for safety" creep). PR #31 was clean on first push (5/5 post-threshold confirmation) but was not required for reclassification.

**Recurrence-as-new-observation rule applies** — if `post-signup-reconcile` surfaces on a future PR, that's data point one of a new observation, not data point N+1 of the old one. Reclassification at threshold doesn't invalidate the test from future tracking; it just stops the carry of this specific prior observation. See `feedback_probabilistic_tracking.md` (memory) for the full discipline.

Probabilistic thresholds need mechanical counts, not vibes-based — three feels like four when the trajectory is good; the threshold exists exactly to defend against that pull, and the reclassification *at* threshold (not past it) is the honest reading.

## 2. Durable conventions established (with canonical doc pointers)

**Venv-detection idiom for Python gate commands.** See `apps/jobs/CLAUDE.md ## Python gate (test:python)`. Origin: C2.5. Replaces ad-hoc local-vs-CI Python invocation. `PY=$(test -x .venv/bin/python && echo .venv/bin/python || echo python3) && $PY -m pytest` — future Python gate commands follow the same detection pattern.

**`api_*` vs `svc_*` perimeter test convention (22023 vs 42501).** See `packages/db/tests/CLAUDE.md ## RPC perimeter tests`. Origin: C2b.1. Replaces inline comment in `api-create-source-audio.test.ts`. `svc_*` anon → 42501 at the GRANT layer; `api_*` anon → 22023 at the `auth.uid() IS NULL` defensive check inside the wrapper body. Different mechanisms, different codes — disambiguated centrally to prevent silently-wrong future tests.

**Storage bucket creation as migration.** Canonical example: `packages/db/migrations/20260506210000_sources_pdf_bucket.sql`. Origin: C2b.2 (no prior precedent). Bucket creation via `INSERT INTO storage.buckets ... ON CONFLICT DO NOTHING` (idempotent for `supabase db reset`). RLS policies in the same migration. Perimeter tests in `test:storage` vitest project (parallel to rls / auth / billing / sources).

**`storage.objects` RLS shape for path-scoped buckets.** Canonical example: same migration, sections 2a–2d. 4 policies (SELECT / INSERT / UPDATE / DELETE) all using `bucket_id = '<name>'` AND `(storage.foldername(name))[1] = '<prefix>'` AND `private.is_workspace_member(((storage.foldername(name))[2])::uuid)`. Path-prefix literal at index 1 is defense against malformed paths; membership check at index 2 is the cross-tenant perimeter.

**apps/web → Trigger.dev wiring at `apps/web/src/lib/trigger.ts`.** Origin: C2b.2 (no prior precedent — first apps/web → Trigger.dev integration). Typed wrappers around `tasks.trigger()` with wire payload types defined inline (cross-package type imports avoided to keep the wire contract self-contained). Comments cross-reference `apps/jobs/src/lib/tenant-task.ts:68-71` (defineTenantTask schema-merge) as source of truth. **Trade-off accepted:** type-decoupling means runtime integration tests carry weight that no unit test substitutes for — see §4.

**Computed-not-passed vs required-at-wire contract distinction.** Origin: C2b.2 Divergence 1 review. **Computed-not-passed** when both sides have the same derivation rule and inputs (storage_path = `ws/{workspace_id}/{source_id}.pdf`, derivable on both apps/web and apps/jobs sides). **Required-at-wire** when the value needs server-side validation against tenant boundaries before any task body runs (workspace_id, validated by defineTenantTask's merged schema). Different mechanisms, different correctness properties; generalizable to any future contract decision.

**Service module rollback discipline (frequency-reduction, not guarantee).** Canonical examples: `apps/web/src/services/sources/create-source-{url,pdf}.ts`. Origin: C2b.2. Trigger-failure → best-effort rollback via `api_delete_source`. If rollback itself fails, the row falls back to the E6d accept-orphan case. Rollback is a frequency-reduction mechanism, not bulletproof. PDF Storage object on trigger-failure becomes orphan accepted per `SPRINT_07_carryovers.md` entry #2 [E6d-Storage addendum].

**Effective Python runtime floor: 3.10.** See `SPRINT_07_preflight.md` Item 1 `[NOTE 2026-05-06]`. Origin: C2.5. Driven by `pdfminer.six` transitive dep (current versions require Python ≥ 3.10). CI pins 3.12. If Trigger.dev production runtime is older than 3.10, the dep tree won't resolve — verify at deployment via `--log-level debug --dry-run` per Item 2's existing path.

## 3. Active flags awaiting cleanup commits

Surfaced during Sprint 07 implementation but deferred to separate small commits per negative-scope discipline:

1. **`apps/jobs/python/extract_from_url.py:137`** — validation message references the old filename `extract_trafilatura.py` (script renamed during C2a; the f-string in `main()` wasn't updated). Tests assert what the code currently emits.
2. **`apps/jobs/python/extract_from_url.py main()` dispatch branch** — the `network: unsupported_content_type:<type>` classification choice (vs. `extraction_failed:`) could use an inline rationale comment. Defensible either way; making the rationale visible would help future readers.

## 4. C2b.3 framing (CRITICAL — DO NOT TRIM)

The next session is C2b.3. The framing locked at C2b.2 close: end-to-end integration tests are not optional polish. They are the runtime verification mechanism for three deliberate architectural choices in C2b.2:

- **Wire boundary deliberately decoupled** (inline payload types in `apps/web/src/lib/trigger.ts` rather than cross-package type imports). If apps/jobs's defineTenantTask schema changes and apps/web isn't updated, no compile-time error fires; only the integration test catches it.
- **Rollback discipline explicitly best-effort.** C2b.3 verifies the rollback fires when triggered AND falls back cleanly to E6d accept-orphan when rollback itself fails.
- **Computed-not-passed Storage path.** apps/web computes `ws/{workspace_id}/{source_id}.pdf`; apps/jobs computes the same. Convergence is by construction at the type level only; integration test verifies it actually converges in production-shaped paths.

The natural pull at C2b.3 kickoff will be *"C2b.2 has good unit tests, C2b.3 can be lean."* That is the failure mode to defend against. C2b.3 carries weight specifically because of the deliberate architectural choices in C2b.2.

## 5. Downstream sequencing

- **C2b.3:** end-to-end integration tests (next session)
- **C3:** sources list page UI + polling + delete UI (calls `api_delete_source`; service shipped in C2b.2, action lands in C3)
- **C4:** tabbed upload page extension

## 6. Strategic locks still in force

From 2026-05-06 re-baseline (PR #23). Authoritative source: `docs/specs/build_plan.md §5.3`.

- Launch target: S15 (was S12)
- Threading: serial — Authenticity Engine block before adapter work
- MCP v1: early S14 bounded adjunct with pre-committed escape valve (cut MCP not launch if it slips)
- Two-adapter Phase 1 footprint (X + LinkedIn)
- Phase 2 deferrals: brand kit + refinement chat, AI image + carousel, REST API v1, Meta + TikTok adapters, n8n/Make nodes
