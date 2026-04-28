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

import type { ZodError } from "zod";
import { AppError } from "./app-error.ts";

type ValidationErrorOptions = {
  message?: string;
  issues?: ZodError["issues"] | unknown;
  meta?: Record<string, unknown>;
  cause?: unknown;
};

export class ValidationError extends AppError {
  constructor(opts: ValidationErrorOptions = {}) {
    const issuesMeta =
      opts.issues !== undefined ? { issues: opts.issues } : {};
    const mergedMeta = { ...issuesMeta, ...(opts.meta ?? {}) };

    super({
      code: "VALIDATION_FAILED",
      message: opts.message ?? "Validation failed",
      statusCode: 400,
      ...(Object.keys(mergedMeta).length > 0 ? { meta: mergedMeta } : {}),
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    });
  }

  static fromZod(error: ZodError, message?: string): ValidationError {
    const opts: ValidationErrorOptions = { issues: error.issues };
    if (message !== undefined) opts.message = message;
    return new ValidationError(opts);
  }
}
