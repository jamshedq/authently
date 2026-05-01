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

// Section C zod schemas. Bounds align with the DB layer:
//   - role: 'admin' | 'editor' | 'viewer' (mirrors the CHECK on
//     workspace_invitations.role; owner is NOT invitable — the
//     ownership transfer flow handles owner assignment)
//   - email: lowercased + trimmed, then RFC-validated; the DB column is
//     citext so case-insensitive equality is preserved either way

import { z } from "zod";

const InvitableRoleSchema = z.enum(["admin", "editor", "viewer"]);

export const CreateInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role: InvitableRoleSchema,
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;
