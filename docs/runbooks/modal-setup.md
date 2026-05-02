# Modal Setup — One-time Provisioning for Section B

Last updated: Sprint 05 spec-lock cycle (drafted by Claude, reviewed
and committed by human; runbook execution is human-driven). Future
updates by humans during account or billing changes, when Section B's
Modal usage profile shifts, or when new Modal-deployed surfaces are
added beyond `apps/media-worker/`.

This runbook is human-executed. Drafting follows the same
Claude-drafted + human-reviewed pattern as `observability.md` and
`stripe-products.md`. The locked decisions in `SPRINT_05.md`
(workspace budget cap, alert thresholds, GPU choice) are load-bearing;
the Modal Dashboard UI used to apply them is navigation. If the
Dashboard has shifted UI labels or flow since this was drafted
(2026-05-02), the locked decisions still hold — navigate to the
equivalent surface and apply them.

## Purpose

Stand up the Modal account, CLI, billing controls, and a verified
smoke deploy that Section B (B1 onward) depends on. After this runbook
is complete, the human-executor has:

- A Modal account with a payment method on file
- A workspace budget hard cap of $50/month (raisable post-Sprint-05)
- Billing alerts at $10 / $25 / $40
- The Modal CLI authenticated locally (`modal token new` complete)
- A verified hello-world deploy + invocation, confirming the deploy
  pipeline works end-to-end

This is a one-time human task per Modal account. Run it AFTER Section
A (A1 sweeper, A2 Stripe cancellation) merges to main and BEFORE B1
(Modal scaffolding + Whisper) begins. Locked sequencing per
`SPRINT_05.md` Commit Order:

```
spec-lock ✅ → modal-setup runbook ✅ → A1 → A2 → user runbook
execution (this runbook) → B1 → B2 → B3 → B4 → B5
```

The runbook is committed to the repo before A1 starts, but executed
between A2 merge and B1 start.

## Step 0 — Verify prerequisites

### Tools

- Local Python 3.11 available (matches `apps/media-worker/`'s pinned
  baseline; check with `python3.11 --version`). If absent, install
  via pyenv, asdf, or your preferred Python version manager.
- `pip` available in the same Python 3.11 environment.
- A modern web browser for the Modal Dashboard.
- A payment method (credit card) ready for Modal billing setup.
  Modal's free tier (verify amount in Step 4) covers Sprint 05's
  expected workload, but Modal requires a payment method on file
  before deploys can run.

### Existing repo state

The runbook does NOT yet require `apps/media-worker/` to exist —
that directory is created by B1's first commit. The smoke deploy in
Step 5 uses a temporary file at a path of your choice, outside the
repo, and is removed before B1 starts.

## Step 1 — Sign up for Modal

If you already have a Modal account, skip to Step 2.

1. Open https://modal.com/signup in a browser.
2. Sign up with an email address you control. Email verification is
   required.
3. Complete the workspace setup. Modal calls accounts "workspaces" —
   for solo development this is a single-user workspace named after
   you or your project.
4. Add a payment method. Settings → Billing → Payment methods.
   Without one, deploys are blocked even within the free tier.

> **Dashboard UI drift note:** The Modal Dashboard navigation has
> evolved over time. If a label below doesn't match what's on screen,
> look for the semantic equivalent. The locked decisions ($50/mo cap,
> alerts at $10 / $25 / $40, A10G GPU per Pass 2 Q15) are what
> matters; the path to apply them is navigation, not specification.

## Step 2 — Install Modal CLI and authenticate

Install the Modal Python SDK + CLI:

```bash
pip install --user modal
# or, in a venv: pip install modal
```

Verify the install:

```bash
modal --version
# Expect: a version string, e.g., "modal X.Y.Z"
```

Authenticate the CLI to your Modal account:

```bash
modal token new
```

This opens a browser, walks you through OAuth-style token issuance,
and writes credentials to `~/.modal.toml`. The two values stored
locally are:

- `token_id` — the Modal token identifier (referenced as
  `MODAL_TOKEN_ID` in CI environments).
- `token_secret` — the secret half (`MODAL_TOKEN_SECRET` in CI).

For Sprint 05 you only need local auth — these CLI tokens stay in
`~/.modal.toml` and are read implicitly by `modal deploy` and
`modal run`. CI-based deployment is out of scope for Sprint 05 (see
"Out of scope" below).

Verify auth:

```bash
modal token info
# Expect: workspace name, token id, optionally a token name (added
# in Modal CLI 1.3.2).
```

## Step 3 — Configure workspace budget cap + billing alerts

This is the load-bearing cost-control step. The $50/month workspace
budget is the **hard cap** locked in Pass 2 Q12 of the Sprint 05
pre-flight; Modal will halt jobs at the limit. The three alert
thresholds give early warning before the hard halt fires.

1. Modal Dashboard → Settings → Usage & Billing → Workspace budget.
2. Set the monthly cap to **$50/month**.
   - The cap is conservative for greenfield Sprint 05 work. Raise
     post-launch as usage stabilizes.
3. In the Workspace budget panel, configure dashboard alerts at:
   - **$10/month** — early signal
   - **$25/month** — half-cap signal
   - **$40/month** — pre-halt warning
4. Save.

> **Prior-charge-history constraint (expected behavior):** Modal
> bounds the maximum settable budget cap by the history of prior
> successful charges to your payment method. New accounts may not
> be able to set $50/month immediately — the cap ceiling rises
> with successful charges over time. If the UI rejects $50 on
> first attempt, set the highest value allowed and revisit after
> the first billing cycle. This is expected, not a problem.

Rationale: Modal bills per-second of compute. Whisper-on-A10G is the
most expensive per-job surface in Sprint 05 (verify current GPU
pricing at https://modal.com/pricing during runbook execution).
Sprint 05's daily 60-minute-per-workspace quota (B4's
`ingestion_usage` table) limits per-tenant exposure; the workspace
budget cap limits total exposure. Both layers are intentional.

## Step 4 — Verify free-tier credit amount

Modal's docs cite a $30/month free-tier compute credit (per
`modal.com/docs/examples/mongodb-search`). The actual current amount
may have shifted; verify on first dashboard login.

1. Modal Dashboard → Usage & Billing → current period.
2. Note the "Included compute" or "Free tier credit" line for the
   current month.
3. Record the value (e.g., as a comment in your personal notes).
   The value is informational — the $50 hard cap is the
   load-bearing guard.

If the free-tier amount is less than $30/month or zero, the $50 cap
absorbs the variance. Sprint 05's expected smoke-test workload during
B1 is well under $30 of compute (see Step 5 smoke deploy).

## Step 5 — Deploy + invoke a smoke function

Verifies that the CLI auth, deploy pipeline, and function invocation
all work end-to-end. The smoke file is **disposable** — copy the code
into a temp file outside the repo, run the deploy + invoke, then
delete. B1 creates the actual `apps/media-worker/` structure from
scratch.

### Build-time confirmation

Modal's `@app.function()` decorator without parameters runs on a
default CPU-only image with a default timeout. The smoke function
below relies on those defaults. **If Modal has shifted defaults in
a way that affects hello-world deploys** (e.g., requiring an
explicit image even for trivial functions, or removing the
`@app.local_entrypoint` decorator), surface the discrepancy and
pause — do not invent workarounds. Working assumption per Pass 2 Q14:
defaults are stable.

### Procedure

1. Create a temp file at a path of your choice, e.g.,
   `/tmp/modal-smoke/hello.py`:

   ```python
   import modal

   app = modal.App("authently-modal-smoke")

   @app.function()
   def hello() -> str:
       return "modal smoke deploy ok"

   @app.local_entrypoint()
   def main():
       print(hello.remote())
   ```

2. Deploy:

   ```bash
   cd /tmp/modal-smoke
   modal deploy hello.py
   # Expect: build output, then "✓ Created app authently-modal-smoke ..."
   ```

3. Invoke:

   ```bash
   modal run hello.py
   # Expect output: "modal smoke deploy ok"
   ```

4. Confirm in the Dashboard:

   Modal Dashboard → Apps → `authently-modal-smoke` should be
   listed with at least one successful invocation in the last few
   minutes.

5. Tear down:

   - `modal app stop authently-modal-smoke` (or via Dashboard:
     Apps → `authently-modal-smoke` → Stop).
   - `rm -rf /tmp/modal-smoke` (or wherever you put the temp file).

> Note: `modal run` is the local-iteration command for Modal apps.
> The usage patterns for local development against
> `apps/media-worker/` code (live-reload, log streaming, GPU-backed
> iteration) live in `apps/media-worker/CLAUDE.md`, created during
> B1's first commit.

## Step 6 — Confirm B1 readiness

Run the Output checklist below. If every item checks, B1 is ready to
begin. If any item fails, surface the specific failure rather than
proceeding — diagnostic now is cheaper than diagnostic mid-B1.

## Output checklist

After running this runbook end-to-end, you should have:

- [ ] Modal account created with payment method on file
- [ ] `modal --version` returns a version string from the local CLI
- [ ] `modal token info` returns workspace name and token id (CLI
      auth successful, credentials in `~/.modal.toml`)
- [ ] Workspace budget cap set to $50/month (or maximum allowed for
      new accounts; revisit after first invoice)
- [ ] Dashboard alerts configured at $10 / $25 / $40
- [ ] Free-tier credit amount recorded (informational)
- [ ] Smoke deploy of `authently-modal-smoke` succeeded
- [ ] Smoke invocation returned `"modal smoke deploy ok"`
- [ ] Smoke app stopped and temp file removed

When all nine items check, B1 (Modal scaffolding + Whisper) is
unblocked.

## Common failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `modal token new` browser flow stalls | Browser pop-up blocked, or third-party cookies disabled | Re-run; allow modal.com pop-ups; or copy the URL from the CLI output and open manually |
| `modal --version` fails after `pip install` | Wrong Python in PATH (Python 3.11 not the default) | Run with `python3.11 -m pip install modal`; verify with `python3.11 -m modal --version` |
| Workspace budget cap maximum is below $50 | New account billing-history restriction | Set the maximum allowed; revisit after the first invoice clears |
| `modal deploy hello.py` errors with "Image required" | Modal default image behavior shifted | Halt and surface — Pass 2 Q14 build-time confirmation case |
| `modal deploy` succeeds but `modal run` errors with "App not deployed" | App name mismatch, or token scoped to a different workspace | Confirm `modal token info` workspace matches the Dashboard workspace where the deploy landed |
| Dashboard shows no payment method, deploy still works | Free-tier covers it but billing setup is incomplete | Add payment method now; future deploys outside free tier will fail otherwise |

## Out of scope

This runbook covers one-time provisioning for Section B's Sprint 05
needs. The following are explicitly **NOT** in scope:

- **CI/CD Modal deploy.** GitHub Actions deployment via
  `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` secrets is a future
  workflow — Sprint 05 deploys are local from the developer machine.
- **Modal Secrets API** (`modal.Secret.from_name(...)`). None of
  B1-B5's workers require third-party API keys; future workers that
  do (e.g., a paid OpenAI fallback model, third-party transcription
  services, downstream notification APIs) will use Modal Secrets at
  that time.
- **HuggingFace authentication token.** B1's `whisper-large-v3` is
  a public HuggingFace model; the `huggingface_hub` library
  downloads it anonymously. No HF token is required for Sprint 05.
  If a future worker needs a gated model, the HF token will be
  added then via Modal Secrets.
- **Region pinning.** Modal's `auto` region placement is sufficient
  for Sprint 05. Explicit region pinning is a future optimization
  (latency profiling, GDPR / data-residency compliance), not Sprint
  05 territory.
- **Multi-app monorepo composition.** Sprint 05 deploys a single
  Modal app (`authently-media-worker`) for all five Section B
  components. Splitting into multiple Modal apps via `App.include`
  is a future scaling decision.
- **Production observability from Modal.** Modal's built-in logs
  are sufficient for Sprint 05 smoke testing. Production-grade
  tracing into Sentry or Axiom from Modal functions is a future
  hardening item.
- **Live-mode billing graduation.** Modal's free tier + $50 cap
  covers Sprint 05; raising the cap and graduating to a higher
  plan is a post-launch decision.

## Scope boundary

This runbook covers Modal provisioning for Sprint 05 Section B
specifically. When future sprints add new Modal-deployed surfaces
(video assembly per `build_plan.md` S08; voice cloning per S14;
etc.), this runbook may be superseded by a more comprehensive
Modal-ops runbook. Until that supersession, keep this file in tree
as the canonical Section B provisioning reference.

The code-level conventions for Modal functions in this repo
(`@app.function` patterns, image definition shape, deployment
commands from monorepo) live in `apps/media-worker/CLAUDE.md`,
created during B1's first commit. This runbook intentionally does
not duplicate those conventions — clean split between
one-time-provisioning (this file) and code-conventions (CLAUDE.md
sibling).
