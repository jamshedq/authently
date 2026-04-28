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

type NotFoundErrorOptions = {
  message?: string;
  resource?: string;
  meta?: Record<string, unknown>;
  cause?: unknown;
};

export class NotFoundError extends AppError {
  constructor(opts: NotFoundErrorOptions = {}) {
    const message =
      opts.message ??
      (opts.resource ? `${opts.resource} not found` : "Resource not found");
    const baseMeta =
      opts.resource !== undefined ? { resource: opts.resource } : {};
    const mergedMeta = { ...baseMeta, ...(opts.meta ?? {}) };

    super({
      code: "NOT_FOUND",
      message,
      statusCode: 404,
      ...(Object.keys(mergedMeta).length > 0 ? { meta: mergedMeta } : {}),
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    });
  }
}
