# @authently/jobs

Trigger.dev v3 project. Hosts every async/background task in Authently:
ingestion, remix, image processing, publishing, and (in S01) one no-op task
that proves the wiring.

## Multi-tenant invariants — non-negotiable

Per `CLAUDE.md`:

1. **Every task takes `workspace_id` as the first payload field.**
2. **Every task asserts workspace context before doing any business work.**

Both invariants are enforced by [`src/lib/tenant-task.ts`](./src/lib/tenant-task.ts) — call `defineTenantTask({ id, payloadSchema, run })` instead of the raw `task()` from `@trigger.dev/sdk/v3`. The helper:
- merges your payload schema with `{ workspace_id: uuid }`
- validates the runtime payload with zod (throws `ValidationError` on shape failure)
- calls `verifyWorkspaceExists(workspace_id)` — a narrow `select id` against `public.workspaces` that throws `NotFoundError` if absent
- only then dispatches to your `run` callback, which receives both the validated payload and the convenience `{ workspaceId }`

If you reach for `task(...)` directly, you've bypassed the tenant gate. Use `defineTenantTask`.

## Service-role usage

Tasks run server-side and outside any user request. They use the service-role Supabase client (see [`src/lib/supabase.ts`](./src/lib/supabase.ts)). This is the one place in the codebase where service-role is permitted by `CLAUDE.md` — the explicit workspace assertion is the safety mechanism.

Within a task body, after `defineTenantTask` has verified the workspace exists, your reads/writes should be scoped to `workspace_id` everywhere (e.g. `where workspace_id = ...`). Don't query across tenants.

## Local dev

```sh
# 1. Authenticate (one-time)
npx trigger.dev@latest login

# 2. Set apps/jobs/.env (copy from .env.example, populate keys)
#    - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  ← `supabase status -o env`
#    - TRIGGER_PROJECT_REF                        ← from your Trigger.dev dashboard

# 3. Run the dev server (polls Trigger.dev cloud for runs, executes locally)
pnpm --filter @authently/jobs dev
```

## Adding a new task

```ts
// src/trigger/example.ts
import { z } from "zod";
import { defineTenantTask } from "../lib/tenant-task.ts";

export const exampleTask = defineTenantTask({
  id: "example",
  payloadSchema: z.object({
    sourceUrl: z.string().url(),
  }),
  run: async (payload, { workspaceId }) => {
    // workspaceId === payload.workspace_id; both are validated and the
    // workspace is known to exist.
    return { ok: true, workspaceId, source: payload.sourceUrl };
  },
});
```

Triggering from `apps/web` (later in the sprint plan):

```ts
import { tasks } from "@trigger.dev/sdk/v3";
await tasks.trigger<typeof exampleTask>("example", {
  workspace_id: someWorkspaceId,
  sourceUrl: "https://...",
});
```
