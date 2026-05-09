<!--
  Sprint 07 — working state file
  Created: 2026-05-06; last updated 2026-05-07 post-C3.1.
  Status: active (Sprint 07 in flight)
  Lifecycle: updated as commits land; archived or deleted at sprint close.

  Wayfinding, not comprehensive documentation. Points at canonical
  sources rather than duplicating them. For sprint-level decisions and
  spec contracts, source of truth is:
    - docs/specs/SPRINT_07.md           (locked spec; [AMENDED 2026-05-07]
                                          C2b sub-sequencing at lines 584-613,
                                          C3 sub-sequencing at lines 636-672)
    - docs/specs/SPRINT_07_preflight.md (pre-flight verification items)
    - docs/specs/SPRINT_07_carryovers.md (deferrals + revisit triggers)
    - docs/specs/build_plan.md §5.3      (launch shape, strategic locks)
-->

# Sprint 07 — working state

## 1. Where we are (as of 2026-05-07 post-C3.1)

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
| State file compaction at C2b.2 close | `f02251c` | #30 |
| C2b sub-sequencing amendment + smoke checklist cleanup | `dd89138` | #31 |
| State file post-signup-reconcile reclassification update | `0fd7104` | #32 |
| C2b.3: integration boundary tests at apps/web ↔ apps/jobs seam | `d1998cc` | #33 |
| C3 sub-sequencing amendment | `618a52a` | #34 |
| C3.1: sources list page baseline (read-only render + empty state) | `de313e0` | #35 |

### Pending (in sequence)

- **C3.2** — status polling at 3-5s while any row in `'processing'`; halts on resolution per E2 lock. See §4 — polling-mechanism question is the load-bearing unlocked decision.
- **C3.3** — delete UI + failed-row error display per E6b/E6c. Manual smoke required (new server action `delete-action.ts`).
- **C4** — tabbed upload page extension.

### Active gate baseline (7 standing)

| Gate | Count |
|---|---|
| `test:license-headers` | 263 |
| `typecheck` | 6/6 |
| `lint` | 6/6 |
| `test:db` | 174 / 30 (vitest projects: rls, auth, billing, sources, storage) |
| `test:web` | 86 / 21 |
| `test:jobs` | 32 / 5 |
| `test:python` | 23 / 3 |

### Tracking observations

**`post-signup-reconcile` flake** (PostgREST upstream-server error, first observed PR #26): **Reclassified resolved-by-attrition at PR #30, 2026-05-07 (4/4 threshold met).** PR #27, #28, #29 were the first three consecutive clean PRs since first observation; PR #30 was the fourth and triggered reclassification per the strict-threshold discipline. PR #31, #32, #33, #34, #35 all clean on first push (5+ post-reclassification confirmation).

**Recurrence-as-new-observation rule applies** — if `post-signup-reconcile` surfaces on a future PR, that's data point one of a NEW observation, not data point N+1 of the old one. See `feedback_probabilistic_tracking.md` (memory) for the full discipline.

## 2. Durable conventions established (one-line pointers to canonical sources)

- **Venv-detection idiom for Python gate commands** — see `apps/jobs/CLAUDE.md ## Python gate (test:python)`. Origin C2.5.
- **`api_*` vs `svc_*` perimeter test convention (22023 vs 42501)** — see `packages/db/tests/CLAUDE.md ## RPC perimeter tests`. Origin C2b.1.
- **Storage bucket creation as migration** — canonical example: `packages/db/migrations/20260506210000_sources_pdf_bucket.sql`. Origin C2b.2.
- **`storage.objects` RLS shape for path-scoped buckets** — same migration, sections 2a–2d. Path-prefix literal at index 1 + membership at index 2 = cross-tenant perimeter.
- **apps/web → Trigger.dev wiring** — `apps/web/src/lib/trigger.ts`, typed wrappers + inline wire payload types. Wire-decoupling verified at runtime by `apps/web/tests/services/sources/wire-boundary.test.ts` (C2b.3).
- **Computed-not-passed vs required-at-wire contract distinction** — Storage path computed both sides (`ws/{workspace_id}/{source_id}.pdf`); workspace_id required-at-wire and validated by `defineTenantTask`. Origin C2b.2.
- **Service module rollback discipline (frequency-reduction, not guarantee)** — `apps/web/src/services/sources/create-source-{url,pdf}.ts`. Trigger-failure → best-effort rollback via `api_delete_source`. Rollback-itself-fails → E6d accept-orphan state by design, verified in `rollback-edges.test.ts` (C2b.3).
- **Cross-package import for testing-only coupling** — relative paths from apps/web tests to apps/jobs source (e.g., `../../../../jobs/src/trigger/extract-from-pdf`). Visual ugliness is deliberate documentation. Origin C2b.3.
- **Effective Python runtime floor: 3.10** — see `SPRINT_07_preflight.md` Item 1 `[NOTE 2026-05-06]`. Origin C2.5.

## 3. Active flags awaiting cleanup commits

1. **`apps/jobs/python/extract_from_url.py:137`** — validation message references the old filename `extract_trafilatura.py`. Tests assert what the code currently emits.
2. **`apps/jobs/python/extract_from_url.py main()` dispatch branch** — the `network: unsupported_content_type:<type>` classification choice (vs. `extraction_failed:`) could use an inline rationale comment.

## 4. C3.2 framing (CRITICAL — DO NOT TRIM)

C3.2 introduces client-side polling, which has its own failure modes (memory leaks if intervals don't clean up, network thrash if polling continues after navigation, race conditions if state updates arrive out of order). The spec locks the polling interval (3-5s) and the stopping condition (no rows in `'processing'`). **What it doesn't lock — and what discovery should resolve — is the polling mechanism: SWR / React Query / native `useEffect` / server-sent events / some other pattern. Each has different reliability profiles and different test surfaces.**

Discovery shape per the C3.1 precedent: codebase-precedent-first, ecosystem survey if codebase is silent. The spec's prescription at SPRINT_07.md lines 405-410 is *"client-side `setInterval` (3-5s) calls `router.refresh()` while at least one visible row has `status = 'processing'`. Polling halts when no rows remain in `'processing'`."* Discovery confirms whether the codebase has any other polling pattern that should be preferred or that extends this naturally. Tests use `vi.useFakeTimers` per spec lines 447-449. ~2-3 tests covering interval setup/teardown.

## 5. Downstream sequencing

- **C3.2:** status polling (next session)
- **C3.3:** delete UI + failed-row error display (manual smoke required)
- **C4:** tabbed upload page extension

## 6. Strategic locks still in force

From 2026-05-06 re-baseline (PR #23). Authoritative source: `docs/specs/build_plan.md §5.3`.

- Launch target: S15 (was S12)
- Threading: serial — Authenticity Engine block before adapter work
- MCP v1: early S14 bounded adjunct with pre-committed escape valve (cut MCP not launch if it slips)
- Two-adapter Phase 1 footprint (X + LinkedIn)
- Phase 2 deferrals: brand kit + refinement chat, AI image + carousel, REST API v1, Meta + TikTok adapters, n8n/Make nodes
