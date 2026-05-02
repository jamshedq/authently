<!--
docs/specs/build_plan.md — converted from build_plan_v2.docx (initial commit
0acd0c4, removed in 176a7fc, restored here as authoritative reference for
sprint planning). The plan covers a 14-month / 28-sprint roadmap; refer
to this doc when scoping individual sprints. If the plan needs to change,
update this markdown directly so the diff lives in PR review.

Source baseline: build_plan_v2.docx, validated April 2026.
-->

**Build Plan v2**

Open-source AI content engine — authenticity-first, power-user, multi-audience

*14 months · 28 sprints · AGPL core + hosted product · validated April 2026 · amended May 2026 (post-Sprint-04)*

# 0. Strategic positioning

## 0.1 What this product is

An open-source, multi-tenant AI content engine for technical creators who want to publish across social platforms without losing their voice to AI generic-ness. Hosted product available for non-technical creators and teams. Architecturally and philosophically built to respect the creator's authenticity and their automation tooling — not to maximize engagement-bait output.

## 0.2 Six product principles

Every product decision over 14 months runs through these. If something violates a principle, it doesn't ship — even if a competitor does it.

- Voice over volume. We help users sound more like themselves, not less.
- Authenticity over engagement. We do not optimize for hooks, hashtag stuffing, or AI-tell-tales.
- Transparency over magic. Every AI change is visible, diff-able, and reversible.
- Ownership over lock-in. Open-source core, BYO keys, no vendor capture.
- Power-user respect. Real APIs, real webhooks, real automation — not toy integrations.
- Build in public. The product story is told as it's lived, not as a marketing campaign.

## 0.3 Audiences

Three audiences are served by the same multi-tenant platform. Each is a tenant template (a default workspace configuration), not a separate product. The plan leads with individual creators because that's where Phase 1 marketing energy concentrates; the other two are explicitly supported but not the homepage hero.

| **Audience** | **Posture** | **Phase 1 priority** | **Marketing** | **Tenant template** |
|---|---|---|---|---|
| Individual creators (PRIMARY) | Power-user, technical, values authenticity | Headline audience — homepage speaks here | Lead all messaging; dev-community + content marketing | 'Solo Creator' WS template |
| SMBs (SECONDARY) | Operations-minded, want approval workflows + brand control | Supported via tenant templates + approval workflows in P2 | Mentioned in pricing page; case studies in P2 | 'Small Business' WS template |
| Faith communities (SECONDARY) | Volunteer-driven, multilingual, community-serving | Supported via tenant templates; Arabic/Spanish/Hebrew packs in P3 | Soft-launch in P2; community-led growth | 'Community Org' WS template |

## 0.4 Differentiation moat

Five compounding advantages that together create a position Blotato cannot easily match without strategic reinvention. These are the source of the answer to the question 'why would anyone pick this over Blotato.'

| **Differentiator** | **What it means** | **How it shows up in the build** | **Why Blotato can't easily copy** |
|---|---|---|---|
| Open-source core (AGPL) | Engine, adapters, schemas all OSS; hosted product is the proprietary monetization | Public repo from S01; all code under AGPL; hosted-only features clearly fenced | Would require rebuilding; AGPL is one-way; community trust accumulates over time |
| Authenticity Engine | Voice profiles, anti-slop guards, AI-tell removal — built into the remix engine | First-class feature from S04–S05; not bolted on | Their entire brand is volume-first ('1 week in 1 minute'); incompatible reposition |
| API + MCP first-class | Public API, MCP server, n8n+Make nodes ship in P1, not P2 | S04 ships API v1; S11 ships MCP; S12 ships nodes | They have these but they're afterthoughts; we're built around them |
| BYO-key model | Power users supply their own AI keys, escape per-credit billing | S17 ships BYO keys; flat hosted pricing | Their business model relies on credit metering; hard to walk back |
| Build-in-public + Autonomy Gap | 5–10 hrs/week of authentic content marketing tied to a values-based YouTube channel | Marketing isn't a launch event; it's a 14-month continuous activity | Their distribution depends on one founder's personal channel; ours is values-aligned |

## 0.5 Honest competitive read

This is a head-on competitive play, not a niche wedge. Blotato has a creator with 1.5M+ followers as its founder-led marketing engine and a 12-18 month head start. The expected outcome is slower revenue ramp than the faith-wedge alternative would have produced, with a higher ceiling if the open-source + power-user strategy compounds. First 100 paying customers will be hard. First 1,000 will be much easier if the OSS adoption signal is real.

**What success looks like at month 6: **OSS repo with 500–2,000 GitHub stars, 50–150 paying hosted customers, 5–15 self-host installs we know about, weekly Autonomy Gap content cadence, organic dev-community presence.

**What failure looks like: **Generic Blotato clone with no OSS traction, single-digit paying customers, content marketing abandoned by month 3. If we hit failure signals, the documented pivot is to lean harder into the API-first dev-tool angle and reduce hosted UI investment.

# 1. Phase roadmap

| **Phase** | **Months** | **Sprints** | **Theme** | **Ship gate** |
|---|---|---|---|---|
| Phase 1 — Core + API + Voice | 1–6 | 1–12 | OSS launch, multi-tenant publisher with Authenticity Engine, public API, MCP server, n8n+Make nodes | Public OSS release + paid hosted: $19 Free-OSS / $49 Solo / $129 Studio |
| Phase 2 — Video + Power-User Depth | 7–10 | 13–20 | Faceless video, long-to-short clipper, advanced API, BYO-key flows, approval workflows, OSS adoption push | Launch $249 Pro tier with video + advanced API |
| Phase 3 — Agency, Mobile, Full Platform Set | 11–14 | 21–28 | All 9 platforms, unified inbox, translation, content vault, link-in-bio, mobile PWA, agency multi-tenant features | Launch $599 Agency tier |

### Phase 1 — Core + API + Voice (months 1–6)

Multi-tenant SaaS with OSS core. Five-platform publishing (X, LinkedIn, Facebook, Instagram, TikTok). Authenticity Engine (voice profiles, anti-slop guards). Public REST API and MCP server ship in P1, not later — they are the differentiation, not extras. Brand kits, carousels, draft refinement chat. Open-source repo public from Sprint 1; AGPL license; build-in-public from day 1. Ships paid hosted product alongside OSS launch.

### Phase 2 — Video + Power-User Depth (months 7–10)

Faceless AI video generation, long-to-short clipper, voice cloning. BYO-key infrastructure (customers supply their own AI keys to escape per-credit billing). Advanced webhooks with replay-safe signing. Approval workflows. Content Vault foundations with pgvector. OSS adoption push: contributor program, public roadmap, dev-community campaign.

### Phase 3 — Agency, Mobile, Full Platform Set (months 11–14)

Four more platforms (YouTube, Pinterest, Threads, Bluesky) bring total to 9. Unified inbox with AI triage and voice-locked drafted replies. Translation pipeline. Mobile PWA composer. Content Vault v2 with semantic search. Link-in-bio builder (also OSS). Thumbnail A/B testing. Agency tier launch with white-label and advanced analytics.

# 2. Architectural diagram

Seven layers. Multi-tenant by workspace_id throughout. The new layer this version adds — the Authenticity Engine — sits between source ingestion and remix output, so voice preservation and anti-slop guards are baked into every generation, not bolted on top.

**CLIENT — open-source UI + hosted dashboard + composer**

| **Web App (OSS)** / Next.js 15 / Self-host or hosted / Workspace model | **Mobile Composer** / PWA in P2 / Native iOS/Android P3 | **Auth + Workspaces** / Supabase Auth / Multi-workspace / Tenant-aware | **Stripe Billing** / Hosted-only / Flat tiers / BYO-key bypass |
|---|---|---|---|

▼

**API LAYER — public-first by design**

| **Public REST API** / v1 from S04 / Versioned + stable / OpenAPI spec | **MCP Server** / First-class / Claude / Cursor / IDE / Ships in P1 | **Webhooks** / Outbound events / Signed payloads / Replay protection | **n8n + Make Nodes** / Official / Community-maintained / Ships in P1 | **Internal API** / UI-driven routes / Same primitives as public |
|---|---|---|---|---|

▼

**AUTHENTICITY ENGINE — the philosophical differentiator**

| **Voice Profile** / Learns from past posts / Per-workspace fingerprint / Style preservation | **Anti-Slop Guards** / Cliché detection / Generic phrase filters / AI tell-tale removal | **Source Fidelity** / Preserves user voice / Annotates AI changes / Diff-aware editing | **Refinement Chat** / Conversational edits / Voice-locked / Tracks every change |
|---|---|---|---|

▼

**ASYNC JOB LAYER — Trigger.dev v3**

| **Ingestion** / yt-dlp + Whisper / Trafilatura / PDF + docs | **Remix Engine** / Voice-aware prompts / Multi-model router / BYO-key support | **Image + Carousel** / Replicate + Flux / Slide generator / Brand-locked styling | **Video Engine (P2)** / Faceless video / Long→short clipper / Voice + caption | **Publisher** / Adapter routing / Retries + backoff / Token refresh | **Inbox + Trends (P3)** / Comments + DMs / AI triage / Best-time calc |
|---|---|---|---|---|---|

▼

**PLATFORM ADAPTERS — 9 channels**

| **X / Twitter** / v2 · pay-per-use | **LinkedIn** / UGC + Page | **Facebook** / Pages + Groups | **Instagram** / Feed/Reels/Carousel | **TikTok** / Direct + inbox | **YouTube** / Shorts + long | **Threads** / Meta API | **Pinterest** / Pin + Idea | **Bluesky** / AT Protocol |
|---|---|---|---|---|---|---|---|---|

▼

**INTELLIGENCE LAYER — analytics, vault, agency**

| **Analytics Pipeline** / Per-post metrics / Voice-fit scoring / Best-time calc | **Content Vault** / Semantic search / Voice training corpus / Cross-WS reuse | **Approval Workflow** / Draft → Review / Diff + comments / Roles per WS | **Translation (P3)** / DeepL + Claude polish / Per-region schedule | **Link-in-Bio (P3)** / Hosted page / Open-source theme |
|---|---|---|---|---|

▼

**DATA & STORAGE — multi-tenant from day 1**

| **Postgres (Supabase)** / RLS by workspace_id / Self-host: own DB / pgvector for vault | **Redis (Upstash)** / Rate limits per WS / Job dedupe / Hot session cache | **S3 + CloudFront** / Self-host: any S3 / WS-namespaced keys / CDN URLs | **Search + Vectors** / pgvector for vault / Voice fingerprints / Embedding store |
|---|---|---|---|

# 3. Open-source strategy

Open source is core to the differentiation. This is the GitLab / Cal.com / Plausible model: AGPL core that anyone can self-host, proprietary hosted product that funds development, commercial license available for enterprises that can't accept AGPL.

## 3.1 What's open vs closed

| **Component** | **License** | **Hosted-only?** | **Notes** |
|---|---|---|---|
| Core engine (ingestion, remix, AI router) | AGPL-3.0 | No | Anyone can self-host. AGPL prevents SaaS competitors from forking without contributing back |
| Platform adapters | AGPL-3.0 | No | Critical to OSS value — community can contribute new platforms |
| Public REST API + MCP server | AGPL-3.0 | No | Standardizes the interface; encourages ecosystem |
| n8n + Make nodes | MIT | No | Looser license to maximize adoption (n8n is itself MIT) |
| Authenticity Engine (voice profiles, anti-slop) | AGPL-3.0 core / proprietary models | Partial | Code is OSS; trained voice models are hosted-only |
| Web UI | AGPL-3.0 | No | Self-hosters get the same UI; lowers our marketing burden |
| Hosted infrastructure (queues, S3 layer) | AGPL-3.0 | No | Documented; self-hosters wire their own |
| Hosted-only features | Proprietary | Yes | Approval workflows, agency multi-tenant management, advanced analytics, white-label, support |

## 3.2 Why AGPL specifically

AGPL-3.0 is chosen deliberately because it's the only OSS license that prevents a competitor (including a well-funded incumbent) from forking the code and offering it as a competing SaaS without contributing changes back. MIT or Apache would let Blotato fork and ship; AGPL effectively prevents that. The trade-off is some enterprises will not accept AGPL — they get a commercial license tier in Phase 3.

## 3.3 Operating the open-source project

- Public GitHub repo from Sprint 1. Initial commits are real, not a 'big bang' release
- Public roadmap (GitHub Projects or Linear public)
- Issues triaged weekly; community contributors welcomed from day 1
- Contributor License Agreement (CLA) required so we retain the right to dual-license
- Documentation site (Mintlify or Docusaurus) public from Sprint 2
- Discord or Discourse for community; Discord for speed, Discourse if we want indexable knowledge
- Self-host docs are first-class — not an afterthought
- Versioned releases on a regular cadence (every 2–4 weeks)
- Contributor recognition: README hall-of-fame, optional revenue share for major features later

## 3.4 Hosted vs self-hosted feature matrix

- All ingestion, remix, image gen, video gen, publishing, scheduling: OSS — works self-hosted
- All platform adapters: OSS — works self-hosted
- Public API + MCP server: OSS — works self-hosted
- Approval workflows: hosted-only (or available with commercial license)
- Agency multi-tenant management: hosted-only
- Advanced analytics with cross-WS comparisons: hosted-only
- White-label / custom domain: hosted-only
- SLAs and customer support: hosted-only
- Trained voice models (the actual ML weights): hosted-only

# 4. The Authenticity Engine

The most important new system in this plan. Sits in the remix pipeline; activates between source ingestion and platform-specific output. Four subcomponents:

## 4.1 Voice Profile

- Per-workspace fingerprint built from the user's past published posts (provided at onboarding or learned over time)
- Captures: typical sentence length distribution, vocabulary richness, common openers, punctuation patterns, emoji usage, formality register, hashtag conventions
- Stored as structured features + a small trained classifier; not just an embedding
- Used as a constraint in every remix prompt: 'Generate this in a voice consistent with these features'
- User can edit, lock, or disable the voice profile per draft

## 4.2 Anti-Slop Guards

A library of detectors that flag AI-generic phrases and patterns before output ships. Not a single LLM check — a deterministic filter pass plus an LLM judge. Examples of what it catches:

- Cliché AI openers: 'In today's fast-paced world…', 'Let's dive in', 'Here's the thing…'
- Hedged commitment phrases: 'It's worth noting that…', 'It's important to remember…'
- Empty intensifiers and vague qualifiers: 'incredibly', 'truly', 'absolutely'
- Hashtag-stuffing patterns
- Em-dash overuse and other AI tell-tales
- Generic hook formulas that don't match the user's voice profile
**Output: **each detected pattern shows in the draft as a highlighted suggestion the user can accept (rephrase) or reject. Not silently rewritten — visible.

## 4.3 Source Fidelity

- Tracks the diff between user's source content and AI-generated output
- Highlights what changed; the user can revert any change with one click
- Distinguishes 'paraphrase' (low risk) from 'invented detail' (high risk; requires user verification)
- Annotates the final draft with a confidence/fidelity score

## 4.4 Refinement Chat

- Conversational editing of a draft, with the voice profile as a hard constraint
- Every chat turn is recorded; each version of the draft is retrievable
- User can lock specific phrasing ('don't change this sentence') and the model respects it
- Built on Claude Sonnet by default; BYO-key in Phase 2

# 5. Sprint plan (28 sprints / 56 weeks)

Two-week sprints. Cowork column shows primary working mode: 🤖 Cowork-ready, 🔀 Hybrid (human handles external systems), 👤 Human-driven.

| **Sprint** | **Wks** | **Phase** | **Deliverable** | **Cowork** |
|---|---|---|---|---|
| S01 | 1–2 | P1 | Foundation: Next.js scaffold, Supabase, Stripe test, multi-tenant schema with workspace_id, RLS policies, deploy pipeline. Open-source repo public from day 1 (AGPL) | 🤖 |
| S02 | 3–4 | P1 | Workspace + RBAC: invite flow, roles, workspace switcher, seat-based billing scaffolding, public OSS docs site (Mintlify) | 🤖 |
| S03 | 5–6 | P1 | Source ingestion: yt-dlp worker, Whisper, Trafilatura, pdfplumber, file upload UI | 🤖 |
| S04 | 7–8 | P1 | Public REST API v1 + Voice Profile foundation: API keys per WS, OpenAPI spec, voice fingerprint extraction from past posts | 🔀 |
| S05 | 9–10 | P1 | Remix engine v1 + Authenticity Engine: voice-aware prompts, multi-model router (Claude/GPT/o3), anti-slop guards, BYO-key support | 🔀 |
| S06 | 11–12 | P1 | Brand Kit + draft refinement chat: per-WS brand kit, conversational draft editing with voice locking | 🤖 |
| S07 | 13–14 | P1 | AI Image + Carousel: Replicate Flux, aspect-ratio variants, multi-slide carousel generation, fix-text + remix | 🤖 |
| S08 | 15–16 | P1 | Media pipeline: presigned S3, FFmpeg on Modal, format compliance, CDN delivery, video transcoding for user uploads | 🤖 |
| S09 | 17–18 | P1 | Scheduler + content queue + bulk: cron scheduler, calendar UI, cadence rules, bulk CSV upload, drafts library | 🤖 |
| S10 | 19–20 | P1 | Twitter/X + LinkedIn adapters + X credit tracker: OAuth, publish, threads, pay-per-use cost ledger; submit LinkedIn dev portal app | 🔀 |
| S11 | 21–22 | P1 | Facebook + Instagram + MCP server v1: Meta App, OAuth, Reels + Carousel + Feed; SUBMIT META APP REVIEW; ship MCP server for Claude Desktop | 🔀 |
| S12 | 23–24 | P1 | TikTok + n8n/Make nodes + LAUNCH: Content Posting API, audit prep with inbox-fallback; n8n + Make community nodes; failed-post UX, onboarding, basic analytics, OSS LAUNCH + paid hosted launch | 🔀 |
| S13 | 25–26 | P2 | Video Engine v1: faceless video pipeline (script → AI images → ElevenLabs voice → captions → FFmpeg), 3 templates | 🔀 |
| S14 | 27–28 | P2 | Video Engine v2 + voice clone: more templates, voice cloning option, music bed, brand-kit injection | 🔀 |
| S15 | 29–30 | P2 | Long-form to short-form clipper: AI highlight detection, smart cropping for 9:16, auto-captions, batch export | 🔀 |
| S16 | 31–32 | P2 | API v2 + advanced webhooks: webhook signing, retries, replay-safe handlers, public webhook docs, dev playground | 🤖 |
| S17 | 33–34 | P2 | BYO-key infrastructure: customer-supplied Anthropic / OpenAI / Replicate keys, encrypted at rest, usage tracking & limits | 🤖 |
| S18 | 35–36 | P2 | Approval workflows + draft diffing: review → publish gating, comment threads on drafts, role-based gating | 🤖 |
| S19 | 37–38 | P2 | Voice training v2 + content vault foundation: pgvector for past posts, semantic search, repurpose-from-history flow | 🤖 |
| S20 | 39–40 | P2 | Pro tier launch + OSS adoption push: Pro billing, marketing + dev-community campaign, public roadmap, contributor program | 👤 |
| S21 | 41–42 | P3 | YouTube + Pinterest adapters: long + Shorts, Pin + Idea Pin, OAuth + publish flows | 🔀 |
| S22 | 43–44 | P3 | Threads + Bluesky adapters: thread-aware multi-platform composer, cross-posting smart-defaults | 🔀 |
| S23 | 45–46 | P3 | Unified inbox v1: comment + DM ingest from FB, IG, LinkedIn, X, YouTube; AI triage classification | 🤖 |
| S24 | 47–48 | P3 | Inbox v2: AI-drafted replies (voice-locked!), routing rules, response analytics | 🤖 |
| S25 | 49–50 | P3 | Translation pipeline + mobile PWA: DeepL + Claude polish, per-region scheduling, mobile composer PWA | 🤖 |
| S26 | 51–52 | P3 | Content Vault v2 + link-in-bio: semantic search UI, repurposing flows, hosted bio pages with custom domains | 🤖 |
| S27 | 53–54 | P3 | Thumbnail A/B + best-time advanced: video thumbnail generation + rotation, advanced posting time analytics | 🤖 |
| S28 | 55–56 | P3 | Agency polish + launch: white-label, client report exports, advanced analytics, AGENCY TIER LAUNCH | 🔀 |

## 5.1 Phase gates (non-negotiable)

- **End of Sprint 12 (month 6):** OSS public release + paid hosted launch. 5 platforms, Authenticity Engine, public API, MCP server, n8n+Make nodes all live. Free-OSS / $49 Solo / $129 Studio tiers active.
- **End of Sprint 20 (month 10):** Pro tier with video + BYO-key. Public roadmap, contributor program, dev-community campaign live. If OSS metrics (stars, contributors, self-host installs) are weak, pivot to API-first dev-tool focus before Phase 3.
- **End of Sprint 28 (month 14):** Agency tier launch. 9 platforms, inbox, vault, translation, link-in-bio, mobile PWA. Commercial license offering for enterprises.

## 5.2 Sprint plan amendments

This section captures the gap between the §5 sprint table (canonical-as-planned) and the actual ship state as the plan unfolds. The §5 table itself is preserved as the original 28-sprint roadmap; this section records where reality has updated the plan. The convention is exceptions-only — sprints whose actual deliverables match the original plan are not listed, only those whose actual state diverges. Sprints 01–02 shipped as planned and are not listed here. The full deferral index lives in `SPRINT_04_carryovers.md`; the amendments below surface only the structural drift that bears on Phase 1 / Phase 2 risk.

| **Sprint** | **Original plan** | **Actual state** | **Notes** |
|---|---|---|---|
| S03 | Source ingestion: yt-dlp worker, Whisper, Trafilatura, pdfplumber, file upload UI | Deferred — none of the ingestion stack shipped in S03; the sprint was re-scoped to workspace + RBAC follow-on work (workspace_members activity tracking, billing predicate hardening, parallelised DB suites) | Original ingestion deliverables re-scheduled into Sprint 05+; see `SPRINT_04_carryovers.md` |
| S04 | Public REST API v1 + Voice Profile foundation: API keys per WS, OpenAPI spec, voice fingerprint extraction from past posts | Partial — workspace lifecycle shipped (soft-delete, ownership transfer, account deletion in A1/A2/A3) and PKCE-style password recovery shipped in B1; the planned API + voice-fingerprint deliverables did not ship | Voice fingerprint and public REST API v1 carried into Sprint 05+; see `SPRINT_04_carryovers.md`. The single-owner workspace constraint stands and pairs with the multi-owner gap surfaced below |
| S05 | Remix engine v1 + Authenticity Engine: voice-aware prompts, multi-model router (Claude/GPT/o3), anti-slop guards, BYO-key support | Re-scoped — original S05 deliverables presume S03 ingestion + S04 voice fingerprint as upstream dependencies, neither of which has shipped | Recommended Sprint 05 covers ingestion catch-up plus the highest-priority Sprint 04 carryover items (sweeper, Stripe cancellation); confirmation belongs at Sprint 05 spec-lock |

### Multi-owner workspace — structural gap

The build plan does not currently represent workspace co-ownership anywhere. Sprint 04 A2 shipped ownership transfer with a single-owner constraint as its structural premise — the partial unique index on `workspace_ownership_transfers` and the atomic role swap inside the accept worker both assume exactly one owner per workspace at any given time. That constraint is fine for Phase 1 individual-creator workflows but becomes a hard problem for Phase 2 SMB approval flows and a forcing function for the Phase 3 agency tier. The most defensible technical fit is Sprint 18 (approval workflows + draft diffing), since approval flows already carry multi-actor semantics that pair naturally with multi-owner. This is a recommendation, not a lock; the placement decision belongs at Sprint 18's spec-lock cycle.

### Phase 1 launch gate (S12) — concentration risk

S12 currently carries the densest deliverable list in the entire plan: TikTok adapter, n8n + Make community nodes, Content Posting API audit prep, failed-post UX, onboarding, basic analytics, plus the OSS launch and the paid hosted launch themselves. The §5.1 phase-gate language treats these as a single ship event — five platforms, Authenticity Engine, public API, MCP server, n8n+Make nodes all live at end of S12. If upstream sprints slip (and post-Sprint-04 the plan has already absorbed one sprint of slip via the S05 re-scope), the gate slips. The recommendation is to anchor an explicit S12 readiness check at Sprint 09 or Sprint 10 spec-lock, with the mechanics — what gets checked, what triggers a stop, who runs it — settled in the relevant sprint's spec rather than prescribed here.

### Carryover index

`SPRINT_04_carryovers.md` is the canonical deferral index; entries there carry their own urgency-tells and dependency notes. The build plan calls out only items whose placement materially shifts Phase 1 or Phase 2 risk: Stripe cancellation (Phase 1 paywall correctness — must land before any S12 launch), Resend domain + SMTP (Phase 1 hosted-launch deliverability — must land before S12 or the launch sends email from a generic shared sender), and the multi-owner workspace gap surfaced above. Everything else stays in the carryovers doc and gets scheduled at the relevant sprint's spec-lock.

# 6. Distribution plan (5–10 hrs/week, all 14 months)

Distribution is not a launch event. It's a 14-month continuous activity that runs alongside the build. Without it, the head-on competitive strategy fails — there's no path to first 100 customers without a distribution engine for an open-source-first product against a 1.5M-follower incumbent.

| **Channel** | **Cadence** | **Goal** | **Time/wk** |
|---|---|---|---|
| Autonomy Gap YouTube | 1 video / 2 wks | Authority + audience growth; tie content philosophy to product story | 3 hrs |
| Build-in-public on X + LinkedIn | 3–5 posts/wk | Show the work; attract dev/creator audience; authentic content as marketing for content tool | 2 hrs |
| Open-source presence (GitHub, HN, Indie Hackers) | 1 milestone post / wk | Community formation; OSS contributor recruitment; trust signal | 1.5 hrs |
| Customer interviews (P1) / community calls (P2+) | 2–3 calls/wk | Continuous customer research; content fuel | 2 hrs |
| Dev community engagement (Reddit, dev.to, n8n / MCP forums) | Async, daily check-in | Niche authority; product feedback; bug reports as marketing | 1.5 hrs |

## 6.1 Build-in-public approach

- Repo public from S01. First commit, first README, first issue all visible
- Weekly milestone post on X, LinkedIn, GitHub Discussions
- Sprint reviews public — show what shipped, what didn't, what's next
- Customer interviews summarized publicly (with permission) as content
- Mistakes and pivots posted honestly — the audience for an authenticity-first tool rewards authenticity from its founder

## 6.2 Autonomy Gap as a marketing asset

Your existing YouTube channel is already a values-aligned platform. Continue producing channel-native content (psychology, autonomy, manipulation dynamics) — but layer in product-relevant videos that connect the philosophy to the tool. Examples:

- 'Why AI content sounds AI' — the slop problem, broadly
- 'I scanned 100 LinkedIn posts. Here's what AI tells on'
- 'Building a content tool that doesn't make you sound generic' — the build journey
- 'Open-source vs closed-source AI tools' — the trust angle

## 6.3 Dev-community presence

- Indie Hackers — milestone posts, revenue updates, build journey
- Hacker News — major releases (Show HN: ...), thoughtful long-form
- dev.to / Hashnode — technical writeups (multi-tenant RLS deep-dive, Trigger.dev v3 in production, AGPL strategy)
- n8n community + Make community — when nodes ship, post in their forums
- MCP / Claude developer communities — when MCP server ships
- r/SideProject, r/SaaS — judiciously, when there's a real milestone

# 7. Operating costs

| **Item** | **Type** | **P1 / 100 paying** | **P3 / 1,000 paying** |
|---|---|---|---|
| Vercel (frontend + API) | Fixed | $50–150 | $300–500 |
| Supabase (DB + Auth + Storage) | Fixed | $25–100 | $400–800 |
| Trigger.dev v3 cloud | Fixed | $10–50 | $200–400 |
| Modal (Python media workers) | Variable | $50–200 | $800–2,000 |
| S3 + CloudFront | Variable | $30–100 | $400–1,200 |
| X/Twitter API (pay-per-use) | Variable | $50–150 | $500–1,500 |
| Sentry + Axiom + monitoring | Fixed | $60 | $200 |
| Email (Resend) | Fixed | $20 | $80 |
| Anthropic Claude (text) | Per WS | $50–300 total | $500–3,000 total |
| Replicate (images + video) | Per WS | $50–500 total | $800–8,000 total |
| ElevenLabs (P2+) | Per WS | $30–200 total | $400–3,000 total |
| BYO-key offset (savings!) | Negative | −$30 to −$100 | −$2,000 to −$8,000 |
| Stripe fees | % revenue | ~2.9% + $0.30/charge | Same |

### Margin analysis (revised for new pricing)

- P1 (~100 paying, ~$3,500 MRR mixed Solo+Studio): infrastructure + variable costs ≈ $700–1,800; net contribution $1,500–2,800/mo
- P2 (~250 paying, ~$15,000 MRR with Pro tier and BYO-key): costs $1,500–4,000; net contribution $9,500–13,000
- P3 (~1,000 paying, ~$70,000 MRR with Agency tier): costs $5,000–18,000; net $50,000–65,000
**Note on BYO-key pricing: **BYO-key plans cost LESS to operate but should not be priced as discounts. Price them at the actual support + hosting cost ($29-39/mo flat). Power users will pay this happily because it's still cheaper than their previous credit-burn while preserving full control.

# 8. Risks

| **Risk** | **Likelihood** | **Impact** | **Mitigation** |
|---|---|---|---|
| Head-on competition with Blotato | Certain | High | Differentiate hard on philosophy + OSS + power-user; don't try to match feature-for-feature |
| OSS doesn't drive expected adoption | Medium | High | Track GitHub stars, contributors, self-host instances by S20; pivot to dev-tool focus if signals weak |
| Distribution time eats build time | High | High | Hard rule: 5–10 hrs distro is a CEILING not a floor; if build slips two sprints, cut distro to 3 hrs |
| AGPL scares enterprise customers | Medium | Medium | Offer commercial license tier in P3 for enterprises that need it |
| BYO-key reduces hosted revenue | High | Medium | Price BYO-key plans for the actual support cost; not a discount |
| Voice profile quality disappoints | Medium | High | Ship voice profile as opt-in beta in P1; iterate against real user posts; don't over-promise |
| Burnout over 14 months | High | Critical | Hard 4hr/day build rule; one full day/wk off; pause if shipping degrades |
| Meta / TikTok review delays | High | High | Submit by S11 / S12; have launch plan that works without them (ship 3 platforms first if needed) |
| Forks become real competitors | Low | Medium | AGPL prevents SaaS forks; commercial features stay proprietary; community focus stays on contributing back |
| Cowork generates code that violates AGPL boundaries | Low | High | CLAUDE.md spells out OSS / proprietary boundaries; CI gate on license headers |

# 9. Tech stack (locked)

- **Frontend: **Next.js 15 App Router, Tailwind, shadcn/ui, TypeScript strict. PWA wrapper for mobile in Sprint 25.
- **Backend: **Next.js Route Handlers; separate Node worker service for jobs (Trigger.dev v3).
- **Database: **Supabase (Postgres + Auth + Storage). pgvector for content vault and voice embeddings. RLS on every table.
- **Job queue: **Trigger.dev v3 — Bun-based long-running workers; no serverless timeout issues.
- **Heavy workers: **Modal for FFmpeg, Whisper, yt-dlp, video assembly.
- **Payments: **Stripe with metered billing for credit overages; flat tiers for BYO-key plans.
- **Auth: **Supabase Auth with email + Google + GitHub providers.
- **Monitoring: **Sentry, Axiom, Stripe webhook log table.
- **Media: **S3 + CloudFront. Workspace-namespaced keys (s3://bucket/ws/{workspace_id}/...).
- **AI providers: **Anthropic (primary), OpenAI (model picker), Replicate (images + video), ElevenLabs (voice), DeepL + Claude (translation).
- **Docs: **Mintlify for hosted docs; same content open-source.

# 10. Decisions still open

- S01 — Product name. Not 'AI Content Engine'. Recommend something short, ownable, vaguely literary or technical. Suggest committing by S03.
- S02 — CLA tooling. CLA Assistant (free) vs EasyCLA. Recommend CLA Assistant.
- S04 — Default text model. Claude Sonnet vs router. Recommend Claude Sonnet default.
- S05 — Voice profile architecture. Pure prompt engineering vs small fine-tuned classifier. Recommend prompt engineering for P1, fine-tune in P2 if signal demands.
- S12 — Pricing tiers final. Recommend Free-OSS / $49 Solo (1 workspace, 5 socials) / $129 Studio (3 workspaces, 15 socials, BYO-key) for launch.
- S20 — Pro tier price. Recommend $249 with video + advanced API.
- S22 — Bluesky vs Mastodon priority. Recommend Bluesky first; Mastodon as community contribution.
- S28 — Commercial license pricing. Recommend custom-quote-only at launch; productize later.

# 11. Closing

This plan is a head-on competitive play with a sharp differentiation strategy. It's harder than the faith-wedge alternative and the expected revenue ramp is slower in months 1–6. The compensating strengths are real: an open-source moat that compounds, an authenticity-first philosophy that aligns with your existing audience and brand, and a power-user feature set that is genuinely defensible against an incumbent built around volume and credit-metering.

**The plan succeeds if three things stay true: **

- You ship the Authenticity Engine well in Phase 1. It's the philosophical claim that becomes a real product feature.
- OSS adoption signals are real by month 10 (stars, contributors, self-host installs). If they're not, pivot to API-first dev-tool focus.
- Distribution work happens every week, not in bursts. 5–10 hrs/week is real time, not aspirational.
**Last word: **the rewrite kept the technical architecture mostly intact because the architecture was sound — multi-tenant from day 1, Trigger.dev v3, Supabase with RLS, all of it. What changed is the ordering, the prioritization of API-first features into Phase 1, the addition of the Authenticity Engine as a first-class system, and the explicit OSS strategy. The 14 months are real. Build it.
