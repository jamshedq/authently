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

// Zod schemas for Sprint 02 Section B workspace flows. Used by the
// /api/workspaces (create) and /api/ws/[workspaceSlug] (update) routes,
// and by the workspace dialog + settings form on the client. Bounds match
// the DB layer: name length 1..80 mirrors the api_create_workspace and
// has_workspace_role check from migration 20260429213717.

import { z } from "zod";

const WorkspaceTemplateSchema = z.enum(["creator", "smb", "community"]);

export const CreateWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required")
    .max(80, "Workspace name must be 80 characters or fewer"),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

// PATCH body — every field optional, but at least one must be provided.
// Server returns 422 when no recognised field is present, mirroring the
// account-update endpoint's behaviour.
export const UpdateWorkspaceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Workspace name is required")
      .max(80, "Workspace name must be 80 characters or fewer")
      .optional(),
    template: WorkspaceTemplateSchema.optional(),
  })
  .refine((d) => d.name !== undefined || d.template !== undefined, {
    message: "Provide at least one field to update",
  });
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;
