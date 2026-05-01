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

import type { PostgrestError } from "@supabase/supabase-js";
import type { Database } from "@authently/db";

// Compatible with both @supabase/supabase-js's createClient<Database>() and
// @supabase/ssr's createServerClient<Database>() — they expose subtly
// different SupabaseClient generic forms (3- vs 4-generic). Use `any` in
// the structural shape rather than `unknown` so the variance check passes
// for both client types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { rpc: (...args: any[]) => any };

// =============================================================================
// typedRpc — centralized typed wrapper around supabase-js .rpc().
//
// Why this exists: supabase-js v2.105 + tsconfig's exactOptionalPropertyTypes
// mis-infers .rpc() overloads to `never` for both args and return types.
// The runtime call works correctly; only the type-check fails. Each call
// site historically shipped its own one-off cast (`as never`, custom inline
// signature, etc.). This helper centralizes the cast so the workaround can
// be removed in a single place when supabase-js fixes the inference.
//
// Tracking: Sprint 02 retrospective entry "Consolidate supabase-js
// type-inference workarounds" → Sprint 03 Section A item A3.
//
// Generics infer args + return shape from the generated `Database` type;
// callers get a normal typed response with no per-site casting.
// =============================================================================

type FnName = keyof Database["public"]["Functions"];
type FnArgs<T extends FnName> = Database["public"]["Functions"][T]["Args"];
type FnReturns<T extends FnName> = Database["public"]["Functions"][T]["Returns"];

/**
 * Conditionally require an `args` parameter only when the function declares
 * non-`never` Args. Parameterless RPCs (e.g. `api_ensure_my_workspace`)
 * become a one-arg call; args-bearing RPCs require the args object.
 */
type RpcRest<T extends FnName> = [FnArgs<T>] extends [never]
  ? []
  : [args: FnArgs<T>];

/**
 * Centralized typed wrapper around `supabase.rpc()`. Returns
 * `{ data, error }` with `data` typed to the function's actual return shape.
 *
 * ```ts
 * // Parameterless RPC, returns string:
 * const { data, error } = await typedRpc(supabase, "api_ensure_my_workspace");
 *
 * // Args-bearing RPC, returns table (array of rows):
 * const { data, error } = await typedRpc(supabase, "api_create_workspace", { _name: "Foo" });
 *
 * // Args-bearing RPC, returns void:
 * const { error } = await typedRpc(supabase, "svc_set_workspace_stripe_customer", {
 *   _workspace_id: id,
 *   _stripe_customer_id: customer.id,
 * });
 * ```
 */
export async function typedRpc<T extends FnName>(
  client: AnySupabaseClient,
  fnName: T,
  ...rest: RpcRest<T>
): Promise<{ data: FnReturns<T> | null; error: PostgrestError | null }> {
  // Call client.rpc directly (do NOT extract to a variable — supabase-js's
  // .rpc method internally references `this.rest`, which is lost if we
  // unbind). Cast affects types only.
  const args = rest[0];
  const response = await (
    client.rpc as unknown as (
      fn: T,
      a?: FnArgs<T>,
    ) => Promise<{ data: FnReturns<T> | null; error: PostgrestError | null }>
  ).call(
    client,
    fnName,
    args as FnArgs<T>,
  );
  return response;
}
