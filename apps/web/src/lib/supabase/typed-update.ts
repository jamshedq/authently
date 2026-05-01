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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesUpdate } from "@authently/db";

// =============================================================================
// typedUpdate — centralized typed wrapper around supabase-js .from().update().
//
// Why this exists: supabase-js v2.105 + tsconfig's exactOptionalPropertyTypes
// mis-infers the `.update()` parameter to `never` for tables whose Update
// type contains optional fields (which is every table on UPDATE — Supabase's
// generator marks every column optional). The runtime call works correctly;
// only the type-check fails.
//
// This helper accepts a properly-typed `TablesUpdate<T>` body, casts it
// internally, and returns the same chainable query builder so callers can
// append `.eq()`, `.select()`, `.maybeSingle()`, etc.
//
// Column-level GRANT safety is unaffected — PostgREST validates writes at
// the database layer regardless of how the body was typed in TS. For
// `workspaces`, that means slug / plan_tier / stripe_* are still rejected
// for `authenticated` callers (see migration
// 20260429213717_create_workspace_rpc.sql).
//
// Tracking: Sprint 02 retrospective entry "Consolidate supabase-js
// type-inference workarounds" → Sprint 03 Section A item A3.
// =============================================================================

// Compatible with both @supabase/supabase-js's createClient<Database>() and
// @supabase/ssr's createServerClient<Database>() — they expose subtly
// different SupabaseClient generic forms (3- vs 4-generic). Use `any` in
// the structural shape rather than `unknown` so the variance check passes
// for both client types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { from: (...args: any[]) => any };

type TableName = keyof Database["public"]["Tables"];

/**
 * Centralized typed wrapper around `client.from(table).update(body)`.
 * Returns the chainable PostgREST query builder unchanged so callers can
 * keep the rest of their existing fluent chain (`.eq().select().maybeSingle()`).
 *
 * ```ts
 * const { data, error } = await typedUpdate(supabase, "workspaces", { name: "Foo" })
 *   .eq("id", workspaceId)
 *   .select("id, name")
 *   .maybeSingle();
 * ```
 */
export function typedUpdate<T extends TableName>(
  client: AnySupabaseClient,
  table: T,
  body: TablesUpdate<T>,
) {
  // The outer cast bridges the @supabase/supabase-js vs @supabase/ssr
  // SupabaseClient generic skew. Internal `as never` on the body bypasses
  // the broken `.update()` parameter inference. PostgREST receives the
  // same JSON either way.
  return (client as SupabaseClient<Database>)
    .from(table)
    .update(body as never);
}
