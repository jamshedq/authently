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

/**
 * Compute a 1- or 2-letter initials string from a user's display info.
 * Falls back through full name → email's local part. Always uppercase.
 */
export function initialsFromUser(opts: {
  fullName?: string | null;
  email: string;
}): string {
  const fullName = opts.fullName?.trim();
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts.at(-1)![0]!).toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0]![0]!.toUpperCase();
    }
  }
  // Email is required by the schema; first char is always present.
  return opts.email[0]!.toUpperCase();
}
