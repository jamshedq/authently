# @authently/hosted-features

> **PROPRIETARY — NOT AGPL.** See [`./LICENSE`](./LICENSE) and the repo-root
> [`LICENSE-PROPRIETARY`](../../LICENSE-PROPRIETARY) for full terms.

This package is the carve-out from the AGPL-licensed core. Code that lives
here is reserved for the operator of the hosted commercial offering of
Authently. Self-hosters, forkers, and contributors to the open-source
project may **NOT** redistribute, modify, sublicense, or use the contents of
this directory without a separate commercial agreement.

## What lives here

Sprint 01 ships this directory empty as an architectural placeholder. As
hosted-only features land, they slot in here:

| Future feature                                  | Sprint        |
| ----------------------------------------------- | ------------- |
| Approval workflows (multi-step content review)  | Phase 2 / S18 |
| Agency multi-tenant management                  | Phase 3 / S28 |
| Cross-workspace analytics + comparisons         | Phase 3       |
| White-label / custom-domain support             | Phase 3       |
| Trained voice models (ML weights, not engine)   | Phase 1+      |

The Authenticity Engine itself (`packages/voice/`, future) stays AGPL — the
hosted-only piece is *trained model artifacts*, not the engine code.

## Distribution boundary

The repository's [.gitattributes](../../.gitattributes) marks
`packages/hosted-features/` as `export-ignore`, so `git archive` tarballs
of the OSS distribution omit this directory by default. The license-header
CI check (`pnpm test:license-headers`) explicitly skips this directory
because files here intentionally do **not** carry the AGPL header — they
fall under the proprietary license at [`./LICENSE`](./LICENSE) instead.

## What does NOT belong here

To preserve the "ownership over lock-in" principle (`CLAUDE.md`),
hosted-only features are scoped narrowly. The bar is high. In particular:

- The Authenticity Engine code itself (lives in `packages/voice/`, AGPL)
- Voice profile generation logic (AGPL)
- Anti-slop guard implementations (AGPL)
- Source fidelity / diff logic (AGPL)
- Anything that prevents self-hosters from running a complete, functional
  Authently stack

The hosted/OSS line is where features that *require our infrastructure or
our training pipelines* sit — not anywhere we'd be tempted to fence off
product value.

## Adding code here

If a feature genuinely belongs here:

1. Confirm it can't work in the OSS core. If it can, put it in `apps/`,
   `packages/voice/`, `packages/adapters/`, or another AGPL package.
2. Do NOT add the AGPL license header to new files in this directory —
   the license-header check explicitly excludes this path, and a header
   here would misrepresent the licensing.
3. Add a brief notice at the top of new files referencing this README and
   `../../LICENSE-PROPRIETARY` for clarity.
