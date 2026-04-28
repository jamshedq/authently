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

// Tenant template — keep in sync with the CHECK constraint on
// public.workspaces.template in packages/db/migrations.
export const workspaceTemplateSchema = z.enum(["creator", "smb", "community"]);
export type WorkspaceTemplate = z.infer<typeof workspaceTemplateSchema>;

// Membership role — keep in sync with the CHECK constraint on
// public.workspace_members.role.
export const workspaceRoleSchema = z.enum([
  "owner",
  "admin",
  "editor",
  "viewer",
]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const workspacePlanTierSchema = z.string().min(1);
export type WorkspacePlanTier = z.infer<typeof workspacePlanTierSchema>;
