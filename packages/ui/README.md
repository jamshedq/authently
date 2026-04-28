# @authently/ui

> AGPL-3.0-or-later. See [`LICENSE`](../../LICENSE) at the repo root.

Shared UI library — eventual home for shadcn/ui re-exports and any
component primitives that need to live across more than one app.

## Sprint 01 status

Empty placeholder. The first consumer (`apps/web`) currently has its own
local `components.json` and `lib/utils.ts` (the `cn()` helper). That's
deliberate: while there's only one app, colocating the shadcn config with
that app keeps the import graph short and avoids speculative
generalization. This package exists as the architectural placeholder for
when components need to be shared.

## When components move here

A shadcn component graduates from `apps/web/src/components/ui/*` into
`packages/ui/src/...` the first time **a second app needs it** — for
example, a marketing site, a self-host installer wizard, or an admin
console. At that point:

1. Run `pnpm dlx shadcn@latest init` from `packages/ui/` to set up
   `components.json` + a local `cn()` helper here.
2. Run `pnpm dlx shadcn@latest add <component>` for each component to
   share.
3. Update both apps' tsconfig path aliases to import from
   `@authently/ui` instead of `@/components/ui/*`.
4. Add `@authently/ui` as a `workspace:*` dependency on each consuming
   app's `package.json`.

Until that day, this package only exports a placeholder so it counts as
a real workspace member.

## What this package is not

- **Not a design system spec** — design tokens come from Tailwind +
  shadcn theme variables in `apps/web/src/app/globals.css`. A separate
  `packages/design-tokens` package may emerge later if tokens need to be
  shared across non-Tailwind contexts.
- **Not a brand asset library** — logos, marketing copy, etc. don't
  belong in app code at all.
- **Not a dumping ground for utility components** — only components that
  are genuinely shared across apps. One-off UI for `apps/web` lives in
  `apps/web/src/components/`.

## License

AGPL-3.0-or-later. Every `.ts` / `.tsx` file in this package carries the
canonical Authently AGPL header (verified by the
`pnpm test:license-headers` CI gate).
