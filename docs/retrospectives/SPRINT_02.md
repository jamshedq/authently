# Sprint 02 retrospective — running notes

This file is a living record of learnings, surprises, and follow-up tech
debt discovered during Sprint 02. Append as the sprint progresses; do not
defer to a single end-of-sprint write-up. Items here become candidates for
front-loaded tech debt in Sprint 03.

## Tech debt tracked for late S02 / early S03

### Consolidate supabase-js type-inference workarounds

**Discovered:** Sprint 02 Section B, Commit 1.

**Sites with the same workaround pattern (3):**

- `apps/web/src/services/workspaces/ensure-primary-workspace.ts` — parameterless RPC; `as PostgrestSingleResponse<...>` cast on the awaited result.
- `apps/web/src/services/workspaces/create-workspace.ts` — args-bearing RPC; typed wrapper around `supabase.rpc` to pin both args and return shape.
- `apps/web/src/services/workspaces/update-workspace.ts` — `.update()` whose parameter type collapses to `never` because every column on `workspaces` is optional in the generated Update type.

**Root cause:** supabase-js v2.105 + `exactOptionalPropertyTypes: true` interaction. The library's overloaded function types narrow incorrectly under that compiler flag, producing a `never` parameter or `never` return chain at the call site. Runtime behaviour is correct in all three cases; only the type-check fails.

**Why it matters:** Each site needs a hand-rolled cast that future readers must verify is safe. We've already had three independent rediscoveries of the same fix; without consolidation we'll see it again every time we touch a new RPC or an UPDATE on an all-optional table.

**Proposed work:**

1. Single `lib/supabase/typed-rpc.ts` helper that takes `(client, fnName, args)` and returns a properly-typed `PostgrestResponse`.
2. Single `lib/supabase/typed-update.ts` helper or a `Database`-aware `.update()` wrapper.
3. Migrate the three existing sites to use the helpers; delete their inline workarounds.
4. Add an upstream issue reference (or update a stale one) so we can drop the helpers when supabase-js fixes the inference.

**Sizing:** ~30-60 minutes. No behaviour change, just a centralisation refactor with the existing RLS test suite as the regression net.

**When:** late Sprint 02 (after Section C/D land) or early Sprint 03's front-loaded tech debt block — same time slot used in S02 prep.
