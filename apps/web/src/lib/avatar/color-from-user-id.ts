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

// Stable per-user avatar tint. UUIDs share a prefix space (a-f, 0-9), so
// charCodeAt(0) % N collapses to ~16 buckets with heavy clustering. Summing
// all chars distributes evenly with negligible cost. Not cryptographic —
// just stable + balanced.
//
// Palette excludes brand-green (reserved for CTAs) and red (reserved for
// destructive). All entries pair a 500-shade fill with a 950 text shade
// for high contrast.
const PALETTE: readonly string[] = [
  "bg-amber-500 text-amber-950",
  "bg-rose-500 text-rose-950",
  "bg-violet-500 text-violet-950",
  "bg-blue-500 text-blue-950",
  "bg-cyan-500 text-cyan-950",
  "bg-emerald-500 text-emerald-950",
  "bg-fuchsia-500 text-fuchsia-950",
  "bg-orange-500 text-orange-950",
];

export function colorFromUserId(userId: string): string {
  let sum = 0;
  for (let i = 0; i < userId.length; i++) {
    sum += userId.charCodeAt(i);
  }
  return PALETTE[sum % PALETTE.length]!;
}
