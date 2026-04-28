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

import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().email().max(320);

// kebab-case slug: lowercase alphanumerics joined by single hyphens, no
// leading/trailing hyphens. Mirrors the Postgres `private.slugify` helper.
export const slugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "must be lowercase kebab-case (a-z, 0-9, single hyphens)",
  });

export const isoTimestampSchema = z.string().datetime({ offset: true });

export const nonEmptyStringSchema = z.string().min(1).trim();

export type Uuid = z.infer<typeof uuidSchema>;
export type Slug = z.infer<typeof slugSchema>;
export type IsoTimestamp = z.infer<typeof isoTimestampSchema>;
