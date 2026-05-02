# Sprint 04 carryover index — deferrals captured during Sprint 04 execution
# Inputs for Sprint 05+ planning. Mirrors SPRINT_03_carryovers.md's
# convention (per-sprint carryover doc, comment-block format,
# grep-friendly, planning-input tone — not user-facing docs).
#
# === Provenance ===
# Sprint 04 commits referenced by entries in this file
# (chore-sprint-04-workspace-lifecycle branch):
#   - d4f6a82  docs(sprint-04): lock spec
#   - 9a142b4  feat: workspace soft-deletion (A1)
#   - d0c5043  feat: workspace ownership transfer (A2)
#   - ecab82b  feat: account deletion (A3)
#   - 8f32112  docs(db): pin DEFINER convention
#   - 28f55cf  feat: PKCE migration (B1)
#   - fe437c7  chore: stale Sprint 03 reference cleanup
#
# === Status markers ===
# Items cleared in subsequent sprints retain their entry here for
# historical reference, prefixed with a STATUS line naming the sprint
# + sub-item that cleared them. Items reachable but not yet shipped
# may carry a STATUS line of "ready for SNN+ implementation" (e.g.,
# #4 below, post-Sprint-05 spec-lock 2026-05-02).
#
# === Entry schema ===
# Each entry uses: (a) what's deferred, (b) why deferred + origin commit,
# (c) approximate scope, (d) dependencies, (e) urgency-tell. Where (e)
# is "no urgency-tell; lands when scheduled," that's stated explicitly
# rather than omitted — keeps the schema uniform across entries and
# prevents future readers from wondering whether the absence means
# "no tell" or "didn't think about it."
#
# === Dependency tree (updated 2026-05-02 after Sprint 05 spec-lock) ===
#
#   Sprint 05 A1: hard-delete sweeper (workspaces) — CLEARED
#      ├──> CLEARED: #3 Stripe cancellation via Sprint 05 A2 (same
#      │             Trigger.dev task body; both A1 direct-delete and
#      │             A3 cascade are input paths)
#      └──> READY S06+: #4 extend sweeper scope to auth.users for
#                       ghost membership cleanup (Sprint 05's sweeper
#                       covers workspaces only; auth.users hard-delete
#                       is the S06+ extension)
#
#   Independent of the sweeper:
#      ├──> Revoke-all-sessions on account delete (#2)
#      ├──> user_profiles row-creation strategy reconsider (#5)
#      ├──> Multi-owner workspace model (#6) — Sprint 06+ candidate
#      ├──> Resend domain verification + DNS (#7)
#      ├──> Forgot-password via Resend SMTP (#8) — pairs with #7
#      ├──> typedRpcWithNullable helper (#9)
#      ├──> typedInsert helper (#10)
#      └──> silentMembershipLookup hoist (#11)
#
#   Cosmetic / lingering (low urgency):
#      ├──> Cosmetic UX (#12)
#      └──> public.smoke_test table drop (#13)

# === Sprint 04 origin ===

# 1. Sprint 05+ scheduled hard-delete sweeper for soft-deleted workspaces
#    STATUS: CLEARED by Sprint 05 A1 (commit hash filled in at sprint
#       close per the build_plan.md §5.2 amendment convention).
#    What: scheduled job that hard-deletes workspaces with
#       deleted_at < now() - interval '24 hours'. FK cascades sweep
#       workspace_members, workspace_invitations, billing rows.
#    Why deferred: A1's user-facing soft-delete is the action; the
#       sweeper is operational infrastructure. Out of scope for the
#       cleanup-branch sprint shape.
#    Origin: A1 migration 20260501224734 header (cited Sprint 05+);
#       A3 migration 20260501234834 reuses the same machinery.
#    Scope: medium. New scheduled task in apps/jobs (Trigger.dev),
#       calling a service-role-perimeter RPC that performs the
#       hard-delete. ~1-2 commits including tests.
#    Dependencies: keystone — see tree above.
#    Urgency-tell: a single user reports "I deleted a workspace and
#       Stripe still charged me" — this becomes urgent immediately.
#       The 7-day past-due grace window is unrelated; deletes don't
#       trigger any Stripe state change today.

# 2. Revoke-all-sessions on account delete
#    What: when a user deletes their account, force-sign-out all
#       devices/sessions. Today only the current browser's cookies
#       are cleared (B1 route handler).
#    Why deferred: locked Q4 of A3 — out of scope. Other-device
#       sessions remain valid until JWT expiry. The B1 route
#       handler's inline comment names this scope explicitly.
#    Origin: B1 commit 28f55cf —
#       apps/web/src/app/api/account/delete/route.ts:46.
#    Scope: small-medium. Supabase admin API exposes a "sign out
#       user from all sessions" endpoint via service-role; need to
#       decide whether to call it from the route handler (bypasses
#       our service-role allow-list) or wrap in a SECURITY DEFINER
#       RPC.
#    Dependencies: independent.
#    Urgency-tell: a user who deletes their account because of a
#       compromised device reports "the attacker is still signed in
#       on the other device." Compliance review (e.g., SOC 2) may
#       also flag the gap.

# 3. Stripe subscription cancellation for soft-deleted workspaces
#    STATUS: CLEARED by Sprint 05 A2 (paired with A1 in the same
#       Trigger.dev task body; commit hash filled in at sprint close
#       per the build_plan.md §5.2 amendment convention).
#    What: cancel active Stripe subscriptions when a workspace is
#       soft-deleted, regardless of which path soft-deleted it.
#       Two input paths produce the same cleanup need:
#         - A1 direct workspace delete (api_delete_workspace)
#         - A3 cascade soft-delete during account deletion
#       The deletion-confirm dialogs (delete-workspace-dialog.tsx,
#       delete-account-dialog.tsx) carry verbatim disclosure copy
#       informing users they remain billed until they manage
#       Stripe separately.
#    Why deferred: locked decision #6 of Sprint 04 spec ("Stripe
#       gap framing"). Out of scope for the cleanup-branch sprint;
#       Sprint 05+ candidate.
#    Origin: A1 migration 20260501224734 header; A3 migration
#       20260501234834 header; both dialog components.
#    Scope: medium. Likely lands as the action invoked by the
#       sweeper (#1) — for each workspace transitioning from
#       soft-deleted-<24h to hard-deleted, cancel the Stripe
#       subscription via the existing service-role billing client.
#    Dependencies: paired with #1 (same job loop).
#    Urgency-tell: same as #1 — single billed-after-delete report
#       tips both items together.

# 4. Hard-delete cleanup of ghost memberships post account deletion
#    STATUS: READY for S06+ implementation. Sprint 05's sweeper (#1)
#       covers workspaces only; #4's scope is to extend the sweeper
#       to also reap auth.users rows for accounts where
#       user_profiles.deleted_at crosses a TTL (FK cascade on
#       workspace_members fires automatically once auth.users is
#       hard-deleted). Now unblocked because A1's sweeper machinery
#       exists; the extension is additive.
#    What: when an account is soft-deleted via user_profiles.deleted_at,
#       the user's non-owner memberships are intentionally preserved
#       (locked Q6 of A3 — soft-delete is reversible-in-principle;
#       destructive drops would prevent that). Other-workspace member
#       lists still show the deleted user as a "ghost member."
#    Why deferred: locked Q6 of A3. Bounded by the Sprint 05+ hard-
#       delete sweeper, which FK-cascades through workspace_members
#       when auth.users rows are hard-deleted.
#    Origin: A3 migration 20260501234834 header + Q6 framing in the
#       commit body.
#    Scope: trivial once #1 is wired — the sweeper hard-deletes
#       auth.users rows for accounts where user_profiles.deleted_at
#       crosses a TTL; FK cascade on workspace_members fires.
#    Dependencies: Sprint 05 A1 sweeper exists (cleared); S06+
#       extension adds the auth.users reaper alongside the existing
#       workspaces reaper (likely the same Trigger.dev task with a
#       second per-row loop).
#    Urgency-tell: a member of an affected workspace reports
#       "deleted accounts still appear in our member list." UX leak
#       is bounded but visible.

# 5. user_profiles row-creation strategy reconsideration
#    What: when public.user_profiles grows new columns (anything
#       beyond deleted_at), the lazy-on-delete row-creation strategy
#       stops being correct. New columns will need values for live
#       users, not just deleted users — meaning eager creation via a
#       trigger on auth.users insert + a one-shot backfill migration
#       for existing users.
#    Why deferred: locked Q3 of A3. The table has only deleted_at
#       today; lazy-on-delete is correct only while that's true.
#    Origin: A3 migration 20260501234834 header + Q3 framing.
#    Scope: small per-column-addition. Eager-trigger migration +
#       backfill migration + adjust any service code that assumed
#       user_profiles existence is optional.
#    Dependencies: independent. Triggered by adding the next column.
#    Urgency-tell: no urgency-tell; lands when the next column is
#       added (e.g., display_name, avatar_url, locale).

# 6. Multi-owner workspace model
#    What: today every workspace has exactly one owner; A2's transfer
#       flow demotes the previous owner to 'admin' on accept.
#       Multi-owner support would allow multiple users with
#       role='owner', shared admin authority, either-can-transfer /
#       either-can-delete semantics.
#    Why deferred: locked decision in A2 — single-owner model
#       preserved. Multi-owner is Sprint 06+, not 05+.
#    Origin: A2 migration 20260501231519 line 16.
#    Scope: large. Policy redesign (last_owner_trigger semantics
#       change), UI surface for promotion + demotion, billing-
#       attribution decisions ("which owner is the Stripe customer?"),
#       account-deletion β policy revisions.
#    Dependencies: independent of #1-#5. May be load-bearing on
#       Sprint 12 launch decisions (team plans, agency mode).
#    Urgency-tell: customer demand. None documented today; lands
#       when team-plan pricing or agency-mode (build_plan.md hosted-
#       features roadmap) drives the requirement.

# === Sprint 03 carryovers still pending after Sprint 04 ===
# Items originally tracked in SPRINT_03_carryovers.md and routed to
# "Sprint 04+." Sprint 04 didn't pick them up; they remain active.
# Listed here so Sprint 05 planning sees the full active backlog
# without having to read multiple carryover files.

# 7. Resend domain verification + DNS records
#    Origin: SPRINT_03_carryovers.md "Sprint 04+ block A" item [04-4].
#    Why still deferred: Sprint 04's scope was workspace lifecycle +
#       auth hardening; email infrastructure was not in scope.
#    Scope: small. Cloudflare DNS records (CNAME / TXT for Resend
#       verification) + Resend Dashboard domain verification.
#    Dependencies: paired with #8 (#8 is testable only after #7).
#    Urgency-tell: a user invitation to a non-account-owner email
#       address gets silently dropped in production (Resend free-
#       tier limit). Today the dev-fallback console.info log
#       mitigates locally, but real prod multi-user flows expose
#       this.

# 8. Forgot-password via Resend SMTP
#    Origin: SPRINT_03_carryovers.md "Sprint 04+ block A" item
#       [04-10]. Reinforced by the post-fe437c7 forgot-password
#       route inline comment that points at this file.
#    Why still deferred: depends on #7. No point swapping the SMTP
#       provider before the domain is verified — the recovery
#       emails would either fail entirely or fall back to
#       onboarding@resend.dev which has the same free-tier limit.
#    Scope: small once #7 is done. Update Supabase Dashboard SMTP
#       config + supabase/config.toml [auth.email.smtp] section to
#       point at Resend SMTP credentials.
#    Dependencies: requires #7.
#    Urgency-tell: same as #7 — recovery email dropped to a non-
#       account-owner email address in production.

# 9. typedRpcWithNullable helper
#    Origin: SPRINT_03_carryovers.md A3-followup tech-debt block
#       item [04-6].
#    Why still deferred: defer-until-second-instance. Single
#       existing site at apps/web/src/services/webhooks/stripe/
#       handle-event.ts:99 does not justify the helper. Sprint 04
#       added DEFINER RPCs but none required nullable args, so no
#       second instance surfaced.
#    Scope: small. Helper adds ~30 lines paralleling typedRpc.
#    Dependencies: independent.
#    Urgency-tell: a second `as never` cast for nullable RPC args
#       appears. Periodic grep
#       (`grep -rn 'as never' apps/web/src/`) before Sprint 06
#       planning is the check.

# 10. typedInsert helper
#     Origin: SPRINT_03_carryovers.md A3-followup tech-debt block
#        item [04-7].
#     Why still deferred: defer-until-second-instance. Single
#        existing site at apps/web/src/services/invitations/
#        create-invitation.ts:76 does not justify the helper.
#        Sprint 04 didn't add bytea-shaped inserts.
#     Scope: small. Helper parallels typedUpdate.
#     Dependencies: independent.
#     Urgency-tell: a second bytea-insert site appears.

# 11. silentMembershipLookup hoist into workspace layout
#     Origin: SPRINT_03_carryovers.md A3-followup tech-debt block
#        item [04-8].
#     Why still deferred: Sprint 04 didn't touch the workspace
#        layout's bumpMemberActivity path. The 2-3 redundant DB
#        queries per workspace render persist (now also overlap
#        with the new TransferOfferBanner from A2).
#     Scope: small refactor (~80 lines). Hoist silentMembershipLookup
#        into the layout; pass the resolved membership context down
#        via props to PastDueBanner + TransferOfferBanner.
#     Dependencies: independent. Naturally pairs with other layout-
#        perf optimizations.
#     Urgency-tell: no urgency-tell; lands when layout-perf becomes
#        a measured concern (e.g., dashboard render latency in
#        Sprint 12 prep).

# 12. Cosmetic UX items (duplicate /invite header, "Wrong Account" CTA)
#     Origin: SPRINT_03_carryovers.md "Sprint 04+ block A" item
#        [04-5].
#     Why still deferred: Sprint 04 was workspace-lifecycle-focused;
#        cosmetic polish was not in scope.
#     Scope: trivial (~1-2 hours each).
#     Dependencies: independent.
#     Urgency-tell: no urgency-tell; lands in a polish sprint.

# 13. public.smoke_test table drop
#     Origin: SPRINT_03_carryovers.md "Sprint 02 lingering" section.
#     Why still deferred: not blocking. The table is gated by
#        private.is_workspace_member which inherited Sprint 04 A1's
#        soft-delete cascade automatically; behavior is fine. The
#        table itself is dead weight from S01.
#     Scope: trivial. One drop-table migration.
#     Dependencies: independent.
#     Urgency-tell: no urgency-tell; lands in any DB cleanup pass.
