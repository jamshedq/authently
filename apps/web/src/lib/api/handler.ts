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

import { errorResponse } from "./error-response.ts";

type RouteContext<P = Record<string, string>> = {
  params: Promise<P>;
};

/**
 * Wraps a route handler with structured-error → JSON-Response translation.
 * Routes throw `AppError` subclasses from @authently/shared; the wrapper
 * serializes them with the correct status code.
 */
export function withErrorHandling<P = Record<string, string>>(
  handler: (request: Request, ctx: RouteContext<P>) => Promise<Response>,
) {
  return async (
    request: Request,
    ctx: RouteContext<P>,
  ): Promise<Response> => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
