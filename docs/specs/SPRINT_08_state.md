<!--
  Sprint 08 — working state file
  Created: 2026-05-12 at B0 close.
  Status: active (Sprint 08 in flight)
  Lifecycle: updated as commits land; archived or deleted at sprint close.

  Wayfinding, not comprehensive documentation. Points at canonical
  sources rather than duplicating them. For sprint-level decisions and
  spec contracts, source of truth is:
    - docs/specs/SPRINT_08.md            (locked spec; B0/B2/B4
                                          sub-sequencing at the
                                          Sequencing section)
    - docs/specs/SPRINT_07_carryovers.md (entry #1 covers B2 + B4;
                                          B0 provenance is build_plan
                                          §1.2, not a carryover)
    - docs/specs/build_plan.md §1.2      (packages/ai canonical-as-planned;
                                          B0 instantiates this package)
    - docs/specs/build_plan.md §5.3      (launch shape, strategic locks)
-->

# Sprint 08 — working state

## 1. Where we are (as of 2026-05-12 post-B0)

### Shipped to `main`

| Commit | SHA | PR |
|---|---|---|
| B0: instantiate packages/ai with transcription extraction | `98bee6b` | #46 |

PR #46 included both the Sprint 08 spec-lock commit and the B0 implementation commit on the same branch; squash-merged.

### Pending (in sequence)

- **B2** — YouTube transcript extraction via yt-dlp + shared transcription service. Schema CHECK widens to admit `'youtube_transcript'`; new `api_create_source_youtube` wrapper + worker; yt-dlp Python module; new Trigger.dev task consuming `@authently/ai/transcription`; apps/web 4th upload-tab + action handler; ~9 new tests. Manual smoke required (new server action + modified upload page). See §4 for B2 framing.
- **B4** — Source orchestration. Unified `public.api_create_source(_workspace_id, _type, _payload)` wrapper collapsing the four parallel `api_create_source_*` wrappers (audio + URL + PDF + YouTube); single-commit full migration of apps/web callers; ~-6 net DB test count from perimeter consolidation. **Manual smoke required on all four source types end-to-end** per A5.3 refinement (4x larger smoke surface than B2).

### Active gate baseline (8 standing — `test:ai` added at B0)

| Gate | Count |
|---|---|
| `test:license-headers` | 273 |
| `typecheck` | 7/7 (was 6/6; +1 `packages/ai` target at B0) |
| `lint` | 7/7 (was 6/6; +1 `packages/ai` target at B0) |
| `test:db` | 174 / 30 (unchanged from Sprint 07 close) |
| `test:web` | 83 / 20 (was 92 / 21 pre-B0; -9 tests + -1 file moved to `test:ai`) |
| `test:jobs` | 32 / 5 (unchanged) |
| `test:python` | 23 / 3 (unchanged) |
| `test:ai` | 9 / 1 (**NEW** at B0; transcription suite moved from `test:web`) |

**Drift B resolution** (per SPRINT_08.md verification section): `packages/ai` introduces `test:ai` as a new standing gate following the per-package convention (`test:db`, `test:web`, `test:jobs`, `test:python`). The "0 net across the project" framing from the SPRINT_08.md gate-predictions section resolves to: `test:web` lost 9 tests; `test:ai` gained 9 tests; total project test count unchanged. Standing gates moved from 7 → 8.

### Tracking observations

**Supabase Docker image pull slowness flake** (first observed PR #44, 2026-05-11): one non-recurrence at PR #46 (2026-05-12, both CI checks SUCCESS on first push). Evidence base after B0: 1 occurrence + 1 non-recurrence. **Not yet at the 3/3 confirmation threshold or 4/4 reclassification threshold** per `feedback_probabilistic_tracking.md`; observation stays in flight, logging the non-recurrence so the pattern's evidence base stays accurate. Future PRs continue to widen the evidence base.

**Recurrence-as-new-observation rule applies** if the flake re-fires post-reclassification (when/if that lands), per the same probabilistic-tracking discipline.

## 2. Durable conventions established

- **`packages/ai` package scaffolding pattern** — hybrid template: `packages/shared` shape for package skeleton (private workspace package, `type: "module"`, `main`+`types`→`./src/index.ts`, narrow `rootDir`, minimal scripts); `packages/db` shape for test infrastructure (vitest devDep + `vitest.config.ts`). Runtime deps strictly bounded to what the package's source files actually import (B0 = `openai` only; no speculative deps like `zod`). Origin B0; canonical example at `packages/ai/package.json`.
- **Subpath exports for AI subdomains** — `packages/ai/package.json` declares `"."` (reserved for cross-cutting AI infrastructure; root export currently a stub) + `"./transcription"` (first consumer surface, exports `transcribeAudio` + types). S09–S11 extensions land as additional subpaths (`./router`, `./prompts`, `./guards`, etc.) when their consumers materialize. Origin B0.
- **Mid-flight finding discipline at package extraction** — pre-flight B0.3's grep targeted imports from `@/services/transcription/` only; missed the test's transitive dependency on `apps/web/tests/helpers/openai-mock.ts`. Surfaced during typecheck failure when the moved test couldn't resolve `../../helpers/openai-mock.ts`. Resolved inline by relocating the helper alongside its sole consumer (`packages/ai/tests/helpers/openai-mock.ts`); helper stays test-internal (not promoted to public exports). **Lesson for future package-extraction commits:** pre-flight grep at extraction time should include test-helper dependencies of moved tests, not just source-module import paths. Origin B0.
- **Test helper relocation discipline** — when a test moves out of its original location, its test-helper dependencies (sole-consumer helpers in particular) should move alongside via the same `git mv` that preserves history. Avoids cross-package fragile relative imports (`../../../../apps/web/tests/helpers/...`) and avoids promoting test-only helpers to a public exports surface. Origin B0 mid-flight finding.
- **A4.1 outcome-vs-mechanism distinction** — A4.1's locked "reuse B1 Whisper service" framing is about OUTCOME (Whisper transcription quality + error classification surface preserved), not MECHANISM (literal code reuse via direct cross-app import). Mechanism can soften (shared-package consumption replaces direct reuse) without invalidating the lock as long as outcome holds. Origin B0 lock-revisit at pre-flight Finding 3.

## 3. Cleanup flags

None as of B0 close. Section retained as a slot for future cleanup tracking through B2 / B4.

## 4. B2 framing

B2 ships YouTube transcript extraction via yt-dlp's audio path terminating in the shared transcription service from `@authently/ai/transcription`. Single sub-commit; manual smoke required per CLAUDE.md "Framework rules not caught by automated gates" (new server action `youtube-action.ts` + modified upload page with 4th tab).

**Smoke-window prerequisite (load-bearing — DO NOT START WITHOUT VERIFYING):** B2's manual smoke surface is the 7-item checklist in SPRINT_08.md's "B2 smoke (after Commit 2 lands)" section. Commit + smoke happen in the same focused work session per smoke-window discipline; this same checklist is the smoke-on-bump fixture per A2.1's yt-dlp pinning lock (paste a known-good YouTube URL → row reaches `'ready'`). Do not draft the B2 prompt until the smoke window is real.

**B0 dependency is now satisfied** — `@authently/ai/transcription` exports `transcribeAudio` + `TranscribeAudioInput` + `TranscribeAudioResult`; apps/jobs adds `@authently/ai: workspace:*` to its dependencies as part of B2's scope.

Open questions worth naming upfront so B2's discovery opens warmer:

- **yt-dlp audio-only download config**: pre-flight Item 2 surfaced that `FFmpegExtractAudio` postprocessor depends on the FFmpeg binary not bundled by the Trigger.dev Python build extension. Workaround locked at spec time: skip the postprocessor; download `bestaudio[ext=m4a]/bestaudio` native stream directly. Both m4a and webm are accepted by `ALLOWED_MIME_TYPES` in the transcription service. Confirm yt-dlp Python API shape at B2 discovery.
- **B1 (now @authently/ai) Whisper input adaptation**: `transcribeAudio` takes `TranscribeAudioInput = { file: File; fileName: string }` — a web-standard `File` object. The apps/jobs Trigger.dev task receives an audio file path from the yt-dlp Python subprocess; must read the file bytes and construct a Node-compatible `File` (e.g., `new File([buffer], name, { type: 'audio/m4a' })`) before handing to `transcribeAudio`. Pattern check at B2 implementation.
- **Error-prefix mapping in Python**: yt-dlp's `DownloadError` and `ExtractorError` are the two catchable exception types; failure mode encoded in the error message string, not in separate exception classes. The Python module must string-match on error message content to dispatch to the four locked YouTube prefixes (`youtube_unavailable:` / `youtube_age_restricted:` / `youtube_invalid_url:` / `transient:`). Pattern check at B2 implementation.
- **`uploadYoutubeAction` shape mirrors `urlAction`** per A5.2 forward-coupling — ensures B4's caller migration is a uniform `createSourceX()` → `createSource()` swap across all four action handlers. Don't diverge from C4's `url-tab.tsx` / `url-action.ts` pattern at B2 implementation.

Same divergence-detection discipline as B0 (zero divergences from locked spec — trajectory worth preserving).

## 5. Downstream sequencing

- **B2**: YouTube transcript extraction (manual smoke required; smoke checklist = smoke-on-bump fixture per A2.1)
- **B4**: source orchestration + unified RPC + full apps/web migration (manual smoke required on all four source types end-to-end per A5.3 refinement)

## 6. Strategic locks still in force

From 2026-05-06 re-baseline (PR #23). Authoritative source: `docs/specs/build_plan.md §5.3`.

- Launch target: S15 (was S12)
- Threading: serial — Authenticity Engine block before adapter work
- MCP v1: early S14 bounded adjunct with pre-committed escape valve (cut MCP not launch if it slips)
- Two-adapter Phase 1 footprint (X + LinkedIn)
- Phase 2 deferrals: brand kit + refinement chat, AI image + carousel, REST API v1, Meta + TikTok adapters, n8n/Make nodes

**Sprint 08-specific locks** with forward-pointing triggers:

- **A2.1 downgrade trigger** (fires 6 weeks post-S15 launch): if observed YouTube extraction volume is below 10% of total source extractions over a trailing 30-day window, downgrade yt-dlp verification from (iii)+(α) to (iii)+(γ) per SPRINT_08.md A2.1 lock language.
- **A4 upgrade trigger** (fires 6 weeks post-S15 launch): if (1) volume crosses 30% AND Whisper cost on YouTube exceeds $200/month, OR (2) three or more distinct users report transcript quality observably worse than the source's available captions within any 30-day window, evaluate upgrade to route (b) captions-first.
- **`packages/ai` second consumer trigger**: S09–S11 Authenticity Engine block consumes `packages/ai` as additional subpaths land (model router, voice-aware prompts, anti-slop guards per build_plan §1.2). Annotation note for build_plan §1.2 ("packages/ai instantiated in Sprint 08 B0; model router + additional consumers land S09–S11") is a sprint-close consolidation item.

## 7. Sprint-close consolidation queue

Items deferred from per-commit close to sprint-close consolidation (per the design partner's lock at B0 prompt drafting):

- **Drift A** (SPRINT_08.md "All 6 gates green at every commit" framing): stale at draft time; Sprint 07 close was 7 gates (`test:python` added in C2.5); after B0, count is 8 (`test:ai` added). Update SPRINT_08.md lines around 1004-1006 + 1010-1027 to reflect actual gate count and per-commit deltas including `test:ai` row.
- **build_plan §1.2 annotation**: §1.2 currently reads as fully aspirational ("All AI calls go through `packages/ai` with a model router"). After B0, packages/ai is partially shipped (transcription consumer landed; model router + other AI services land at S09–S11). Annotate §1.2 inline with a `[NOTE 2026-05-12]` marker pointing to B0's first-consumer instantiation and forward-pointing to S09–S11 for additional consumers.
- **SPRINT_07_carryovers.md entry #1 STATUS line update**: at sprint close (after B4 lands), mark entry #1 as cleared. B0 wasn't part of entry #1 (provenance is build_plan §1.2); only B2 + B4 close that entry.
