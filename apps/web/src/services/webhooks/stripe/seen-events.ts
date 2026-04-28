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

// In-process Stripe event-id dedup. Sprint 01 only.
//
// Limitations (intentional):
//   - Per-process: serverless cold starts and multi-instance deployments
//     defeat this. A duplicate event arriving on a fresh instance won't be
//     caught.
//   - Bounded: we cap the set at SEEN_EVENT_LIMIT and evict the oldest half
//     when full. There is no LRU semantics.
//   - No persistence: the set is wiped on restart.
//
// Real dedup ships with the billing flow in S12+ via a `stripe_events`
// table with the event_id as the primary key and an INSERT … ON CONFLICT
// path. Until then, in-memory tracking is enough to make repeated calls
// during local testing observably loud rather than silently duplicate.

const SEEN_EVENT_LIMIT = 1000;
const seenEventIds = new Set<string>();

/**
 * Returns true if this event_id was already seen in this process; false on
 * first sight. Records the id in either case.
 */
export function recordSeenEvent(id: string): boolean {
  if (seenEventIds.has(id)) return true;

  if (seenEventIds.size >= SEEN_EVENT_LIMIT) {
    const it = seenEventIds.values();
    const drop = Math.floor(SEEN_EVENT_LIMIT / 2);
    for (let i = 0; i < drop; i++) {
      const next = it.next();
      if (next.done) break;
      seenEventIds.delete(next.value);
    }
  }

  seenEventIds.add(id);
  return false;
}
