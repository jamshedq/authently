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

import { AppError } from "./app-error.ts";

type ForbiddenErrorOptions = {
  message?: string;
  meta?: Record<string, unknown>;
  cause?: unknown;
};

export class ForbiddenError extends AppError {
  constructor(opts: ForbiddenErrorOptions = {}) {
    super({
      code: "FORBIDDEN",
      message: opts.message ?? "Forbidden",
      statusCode: 403,
      ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    });
  }
}
