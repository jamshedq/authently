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

## 1. Where we are (as of 2026-05-08 post-C3.2 + cleanup PRs)

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
| State file compaction at C3.1 close | `0aa3844` | #36 |
| C3.2: status polling on sources list page | `f188aea` | #37 |
| Cleanup: stale `extract_trafilatura.py` references + classification rationale | `78ee478` | #38 |
| State file §3 cleared by PR #38 | `69df7cc` | #39 |

### Pending (in sequence)

- **C3.3** — delete UI + failed-row error display per E6b/E6c. See §4 — smoke-window prerequisite is the load-bearing constraint before drafting. Two distinct UI surfaces (E6b modal + E6c error display); manual smoke required for both.
- **C4** — tabbed upload page extension (audio/URL/PDF tabs).

### Active gate baseline (7 standing)

| Gate | Count |
|---|---|
| `test:license-headers` | 263 |
| `typecheck` | 6/6 |
| `lint` | 6/6 |
| `test:db` | 174 / 30 (vitest projects: rls, auth, billing, sources, storage) |
| `test:web` | 89 / 21 (was 86/21 pre-C3.2; +3 polling tests at C3.2) |
| `test:jobs` | 32 / 5 |
| `test:python` | 23 / 3 |

### Tracking observations

**`post-signup-reconcile` flake** (PostgREST upstream-server error, first observed PR #26): **Reclassified resolved-by-attrition at PR #30, 2026-05-07 (4/4 threshold met).** PR #27, #28, #29 were the first three consecutive clean PRs since first observation; PR #30 was the fourth and triggered reclassification per the strict-threshold discipline.

**Continued post-reclassification baseline**: clean streak extending across docs and implementation PRs alike since PR #31. The reclassification wasn't premature; the flake genuinely resolved by attrition. Use `git log` + `gh pr list` to verify the current count if needed; the durable point is the reclassification holds.

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

## 3. Cleanup flags

**[CLEARED 2026-05-08 by PR #38 (`78ee478`). No active flags remaining.]**

The two original flags from C2a/C2b.1 carryover:

1. ~~`apps/jobs/python/extract_from_url.py:137`~~ — validation message old-filename reference (cleared)
2. ~~`apps/jobs/python/extract_from_url.py` `main()` dispatch branch~~ — `network: unsupported_content_type:<type>` classification rationale comment (cleared)

**§3 listed two flags; cleanup discovered three.** The third was `apps/jobs/python/extract_pdfplumber.py:18` — co-located residue from the same C2a Checkpoint 2 rename, silent (no test asserting it) which is why §3 didn't track it. Surfaced during the cleanup grep for `extract_trafilatura` references, included in PR #38's scope per the scope-expansion diagnostic (no defensible alternative — leaving it would create inconsistency with §3's fixes; expansion surfaced explicitly in the PR body so the review surface saw the fork).

**Carryover-flags discipline note for future readers:** the §3 list was authoritative-as-of-the-time-it-was-written, not authoritative-and-complete. Future cleanups should grep beyond listed flags to catch silent residues from the same rename/refactor. Same retrospective-structure shape as the C2b sub-sequencing amendment at SPRINT_07.md lines 584-613 — work locked at section-write time, structure that emerged during implementation documented retrospectively rather than presented as if it had been pre-known.

(Section retained as resolution record.)

## 4. C3.3 framing (CRITICAL — DO NOT TRIM)

C3.3 ships two distinct UI surfaces — delete confirmation modal (E6b) wrapping `api_delete_source` from C2b.2, and failed-row error display (E6c) with error class label mapping (`extraction_failed:` / `network:` / `timeout:` / `transient:` → human-readable) + click-to-expand error text. Larger than C3.2 because two distinct concerns; different cognitive shape from C3.2's narrow polling work.

**Smoke-window prerequisite (load-bearing — DO NOT START WITHOUT VERIFYING):** both surfaces are spec-assigned manual smoke per the smoke checklist. C3.3 ships clean only when commit + smoke happen in the same session — splitting them is the verification-strategy drift `feedback_spec_verification_strategy.md` warns against. **Do not draft the C3.3 prompt until the smoke window is real.** "Smoke verified the implementation" only holds when smoke runs against fresh implementation; the longer the gap between commit and smoke, the weaker the verification. This is the load-bearing reason 2026-05-08's session stopped at C3.2 with C3.3 deferred.

Automated tests cover the component surface only (~3-4 tests: modal renders, expansion toggles, delete action wires correctly). The verification-strategy discipline applies: let the spec's mechanism lead, don't automate what smoke already covers.

Discovery shape per the C3.1/C3.2 precedent: codebase-precedent-first, ecosystem survey if codebase is silent. Open questions worth naming upfront so the next session opens warmer:

- **Modal pattern**: codebase has a Dialog/Modal precedent (Radix/shadcn), or first instance?
- **Server action delete pattern**: where do `delete-action.ts` siblings live; what's the wrapping convention; how does the action invoke the service module from C2b.2?
- **Error class string format**: exact tokens emitted at C2a/C2b.2 — prefix-only (`extraction_failed:`) or full-string (`extraction_failed: no_content`); label-mapping granularity is downstream of this.
- **Click-to-expand state placement**: per-row state inline in `SourcesList`'s map vs. extracted `<SourceRow>` component; codebase convention determines.

Same divergence-detection discipline as C3.1/C3.2 (zero divergences for two consecutive commits — trajectory worth preserving).

## 5. Downstream sequencing

- **C3.3:** delete UI + failed-row error display (manual smoke required for both surfaces; see §4 prerequisite)
- **C4:** tabbed upload page extension (audio/URL/PDF tabs)

## 6. Strategic locks still in force

From 2026-05-06 re-baseline (PR #23). Authoritative source: `docs/specs/build_plan.md §5.3`.

- Launch target: S15 (was S12)
- Threading: serial — Authenticity Engine block before adapter work
- MCP v1: early S14 bounded adjunct with pre-committed escape valve (cut MCP not launch if it slips)
- Two-adapter Phase 1 footprint (X + LinkedIn)
- Phase 2 deferrals: brand kit + refinement chat, AI image + carousel, REST API v1, Meta + TikTok adapters, n8n/Make nodes
