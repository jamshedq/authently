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

import { isAppError } from "@authently/shared";

/**
 * Map any thrown value to a JSON Response. Known AppError subclasses use
 * their statusCode + serialized body. Unknown errors collapse to an opaque
 * 500 (we never echo internal error messages to clients).
 */
export function errorResponse(error: unknown): Response {
  if (isAppError(error)) {
    return Response.json(error.toJSON(), { status: error.statusCode });
  }

  // Unknown — log on the server, return opaque 500.
  console.error("[api] unhandled error:", error);
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    { status: 500 },
  );
}
