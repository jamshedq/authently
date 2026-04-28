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

export type AppErrorInit = {
  code: string;
  message: string;
  statusCode?: number;
  cause?: unknown;
  meta?: Record<string, unknown>;
};

export type AppErrorJSON = {
  error: {
    code: string;
    message: string;
    meta?: Record<string, unknown>;
  };
};

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly meta: Readonly<Record<string, unknown>>;

  constructor(init: AppErrorInit) {
    super(
      init.message,
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.name = this.constructor.name;
    this.code = init.code;
    this.statusCode = init.statusCode ?? 500;
    this.meta = init.meta ?? {};
  }

  toJSON(): AppErrorJSON {
    const body: AppErrorJSON["error"] = {
      code: this.code,
      message: this.message,
    };
    if (Object.keys(this.meta).length > 0) {
      body.meta = this.meta as Record<string, unknown>;
    }
    return { error: body };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
