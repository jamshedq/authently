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

// Zod schemas for the Section A account flows. Used both server-side
// (API route validation) and client-side (form-level UX validation).
// Defense-in-depth: client-side parsing surfaces clear errors before a
// network round-trip; server-side parsing is the actual security
// boundary.

import { z } from "zod";

export const ForgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

// Supabase Auth's default minimum is 6 characters. We tighten to 8 here
// for a small UX improvement; if Supabase's project setting is higher
// than 8 the server reject still wins.
export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be 72 characters or fewer");

export const ResetPasswordSchema = z
  .object({
    password: PasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const UpdateFullNameSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(100, "Name must be 100 characters or fewer"),
});
export type UpdateFullNameInput = z.infer<typeof UpdateFullNameSchema>;

export const UpdateEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});
export type UpdateEmailInput = z.infer<typeof UpdateEmailSchema>;
