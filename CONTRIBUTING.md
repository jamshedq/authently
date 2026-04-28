# Contributing

Thanks for your interest in contributing to Authently.

## Process

1. Open an issue first for non-trivial changes — discussion is faster than re-work.
2. Fork the repo and create a feature branch (`feat/short-description` or `fix/short-description`).
3. Follow the coding rules in [`CLAUDE.md`](./CLAUDE.md):
   - TypeScript strict everywhere.
   - All external input validated with `zod`.
   - Errors are structured (no string throws).
   - No business logic in API routes — routes are thin.
   - AGPL license header on every `.ts` / `.tsx` file in OSS packages.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages. The history is public and treated as documentation.
5. Open a PR. CI must pass:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test`
   - `pnpm test:rls`
   - `pnpm test:license-headers`
6. Sign the CLA. The CLA Assistant bot will comment on your PR with a link.

## CLA

We require all contributors to sign a Contributor License Agreement before
their code can be merged. This protects both you and the project. See
[`CLA.md`](./CLA.md). The current CLA text is **draft** and pending legal
review — the bot will be activated once the wording is finalized.

## What gets merged

- Code that has tests.
- Code that respects the multi-tenant rules in `CLAUDE.md` (every business table is workspace-scoped, RLS is enforced).
- Code that fits the six product principles documented in `CLAUDE.md`.

## What does not get merged

- Anything that adds engagement-bait, hashtag stuffing, or AI-tell-tale defaults.
- Silent rewrites of user content. The Authenticity Engine never silently rewrites.
- New dependencies without justification.
- Code without tests.
- Cross-tenant access paths. The RLS test suite is a hard gate.

## Code of Conduct

Be kind. Disagree on substance, not on people. Harassment of any kind is not
tolerated and will result in removal from the project.

## Reporting security issues

Do **not** open a public issue. Email the maintainer (see the repository
profile page) and allow up to 7 days for a response before disclosing.
