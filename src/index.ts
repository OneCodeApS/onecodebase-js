import { OneCodeClient } from "./client";
import type { OneCodeClientOptions } from "./types";

/**
 * Create an Onecodebase client.
 *
 * @param url     Your API base URL, e.g. `https://api.example.com`.
 * @param anonKey The anon key from the dashboard (Admin → API keys).
 *
 * @example
 * ```ts
 * import { createClient } from "onecodebase-js";
 *
 * const oc = createClient("https://api.example.com", ANON_KEY);
 * const { data } = await oc.from("todos").select("*").eq("done", false);
 * ```
 */
export function createClient<Database = any>(
  url: string,
  anonKey: string,
  options?: OneCodeClientOptions,
): OneCodeClient<Database> {
  return new OneCodeClient<Database>(url, anonKey, options);
}

export { OneCodeClient } from "./client";
export { AuthClient } from "./auth";
export { StorageClient, StorageBucketApi } from "./storage";
export { FunctionsClient } from "./functions";
export { RealtimeClient, RealtimeChannel } from "./realtime";
export { OneCodeError } from "./errors";

export type {
  AuthChangeCallback,
  AuthChangeEvent,
  AuthClientOptions,
  AuthSession,
  AuthUser,
  Fetch,
  OneCodeClientOptions,
  RealtimeClientOptions,
  Result,
  SessionStorageAdapter,
} from "./types";
export type {
  RealtimeEventType,
  RealtimeListenEvent,
  RealtimeMessage,
  SubscribeStatus,
} from "./realtime";

// Re-export the PostgREST query-builder types so consumers can type results
// without adding @supabase/postgrest-js as a direct dependency.
export type {
  PostgrestError,
  PostgrestResponse,
  PostgrestSingleResponse,
} from "@supabase/postgrest-js";
