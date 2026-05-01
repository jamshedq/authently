/*
 * Authently — Open-source AI content engine
 * Copyright (C) 2026 The Authently Contributors
 *
 * This file is part of Authently.
 *
 * Authently is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// Pure helper for the "N days remaining until auto-downgrade" countdown.
// The grace period is anchored on workspaces.past_due_since (set when
// process_stripe_event observes the first invoice.payment_failed); the
// scheduled task at apps/jobs/src/trigger/billing-grace-period.ts downgrades
// at exactly the same threshold this function reports as 0.
//
// Keep this in sync with the SQL predicate in
// public.find_workspaces_past_due_grace_expired (migration
// 20260430231812_billing_rpc_pattern_refactor):
//
//     past_due_since < (now() - interval '7 days')

const GRACE_PERIOD_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * Returns the number of whole days remaining before the grace task will
 * downgrade this workspace, given its past_due_since anchor.
 *
 *   - past_due_since null (workspace not past_due) → Infinity
 *   - past_due_since 0 days ago → 7
 *   - past_due_since 6.5 days ago → 1 (rounded up; "fewer than a day left")
 *   - past_due_since 7+ days ago → 0 (grace expired; "downgrades today")
 */
export function daysUntilDowngrade(
  pastDueSince: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!pastDueSince) return Infinity;
  const elapsedDays = (now.getTime() - pastDueSince.getTime()) / MS_PER_DAY;
  return Math.max(0, Math.ceil(GRACE_PERIOD_DAYS - elapsedDays));
}

/**
 * Format the countdown for UI display. Returns either "today" (when 0
 * days remain) or "{N} day" / "{N} days" (when N > 0). Returns null for
 * workspaces not in past_due status (so callers can `if (label) ...`).
 */
export function formatGracePeriodLabel(
  pastDueSince: Date | null | undefined,
  now: Date = new Date(),
): string | null {
  const days = daysUntilDowngrade(pastDueSince, now);
  if (!Number.isFinite(days)) return null;
  if (days === 0) return "today";
  return `${days} day${days === 1 ? "" : "s"}`;
}
