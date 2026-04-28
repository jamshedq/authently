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

import { ValidationError } from "@authently/shared";
import type { z } from "zod";

/**
 * Parse a Request's JSON body against a zod schema. Throws ValidationError
 * (400) on parse failure or invalid shape — the handler wrapper converts
 * that to a structured 400 response.
 *
 * For requests with no body (e.g. POST /api/auth/post-signup with no
 * payload), pass z.object({}).strict() and skip calling json() yourself.
 */
export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    // Empty body or invalid JSON. Schemas can choose to accept this by
    // including .default({}) or passing z.object({}).
    raw = undefined;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw ValidationError.fromZod(parsed.error);
  }
  return parsed.data;
}
