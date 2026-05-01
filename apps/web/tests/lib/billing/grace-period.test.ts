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

import { describe, expect, test } from "vitest";
import {
  daysUntilDowngrade,
  formatGracePeriodLabel,
} from "@/lib/billing/grace-period";

const NOW = new Date("2026-05-01T12:00:00.000Z");
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

describe("daysUntilDowngrade", () => {
  test("null past_due_since → Infinity (not past_due)", () => {
    expect(daysUntilDowngrade(null, NOW)).toBe(Infinity);
    expect(daysUntilDowngrade(undefined, NOW)).toBe(Infinity);
  });

  test("0 days ago → 7", () => {
    expect(daysUntilDowngrade(NOW, NOW)).toBe(7);
  });

  test("3 days ago → 4", () => {
    expect(daysUntilDowngrade(daysAgo(3), NOW)).toBe(4);
  });

  test("6 days ago → 1 (rounded up: 'fewer than a day left')", () => {
    expect(daysUntilDowngrade(daysAgo(6), NOW)).toBe(1);
  });

  test("6.5 days ago → 1 (still rounds up while any time remains)", () => {
    expect(daysUntilDowngrade(daysAgo(6.5), NOW)).toBe(1);
  });

  test("7 days ago → 0 (grace expired exactly)", () => {
    expect(daysUntilDowngrade(daysAgo(7), NOW)).toBe(0);
  });

  test("8 days ago → 0 (clamped — past expiry)", () => {
    expect(daysUntilDowngrade(daysAgo(8), NOW)).toBe(0);
  });

  test("100 days ago → 0 (still clamped)", () => {
    expect(daysUntilDowngrade(daysAgo(100), NOW)).toBe(0);
  });
});

describe("formatGracePeriodLabel", () => {
  test("null → null (caller skips rendering)", () => {
    expect(formatGracePeriodLabel(null, NOW)).toBeNull();
  });

  test("0 days remaining → 'today'", () => {
    expect(formatGracePeriodLabel(daysAgo(7), NOW)).toBe("today");
    expect(formatGracePeriodLabel(daysAgo(8), NOW)).toBe("today");
  });

  test("1 day remaining → '1 day' (singular)", () => {
    expect(formatGracePeriodLabel(daysAgo(6), NOW)).toBe("1 day");
  });

  test("plural days → '{N} days'", () => {
    expect(formatGracePeriodLabel(daysAgo(3), NOW)).toBe("4 days");
    expect(formatGracePeriodLabel(NOW, NOW)).toBe("7 days");
  });
});
