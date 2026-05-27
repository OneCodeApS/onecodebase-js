import type { OneCodeError } from "./errors";

/** Minimal fetch signature the SDK depends on. */
export type Fetch = typeof fetch;

/**
 * Pluggable session persistence. Browsers default to `localStorage`; Node and
 * other runtimes fall back to in-memory. Methods may be sync or async — the
 * SDK awaits them either way.
 */
export interface SessionStorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/** A signed-in user as returned by the auth endpoints. */
export interface AuthUser {
  id: string;
  email: string;
  email_verified_at?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/** An active session: the access token plus everything needed to refresh it. */
export interface AuthSession {
  access_token: string;
  token_type: string;
  /** Lifetime of the access token in seconds, as issued. */
  expires_in: number;
  /** Epoch milliseconds when the access token expires (computed client-side). */
  expires_at: number;
  refresh_token: string;
  /** ISO timestamp when the refresh token itself expires (from the server). */
  refresh_expires_at: string;
  user: AuthUser;
}

export type AuthChangeEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED";

export type AuthChangeCallback = (
  event: AuthChangeEvent,
  session: AuthSession | null,
) => void;

/** Uniform `{ data, error }` envelope, mirroring the supabase-js ergonomics. */
export type Result<T> =
  | { data: T; error: null }
  | { data: null; error: OneCodeError };

export interface AuthClientOptions {
  /** Persist the session across reloads/restarts. Default: true. */
  persistSession?: boolean;
  /** Refresh the access token shortly before it expires. Default: true. */
  autoRefreshToken?: boolean;
  /** Where to persist the session. Default: localStorage or in-memory. */
  storage?: SessionStorageAdapter;
  /** Storage key for the persisted session. */
  storageKey?: string;
}

export interface RealtimeClientOptions {
  /**
   * EventSource implementation to use. Defaults to `globalThis.EventSource`
   * (native in browsers and Node 22+). Provide a polyfill for older Node.
   */
  eventSource?: typeof EventSource;
}

export interface OneCodeClientOptions {
  auth?: AuthClientOptions;
  realtime?: RealtimeClientOptions;
  global?: {
    /** Extra headers merged into every request. */
    headers?: Record<string, string>;
    /** Custom fetch (e.g. for older Node or instrumentation). */
    fetch?: Fetch;
  };
}

/**
 * Internal context shared with every sub-client. `getAccessToken()` returns the
 * current signed-in user's access token, or null when signed out — callers fall
 * back to the anon key in that case.
 *
 * @internal
 */
export interface ClientContext {
  /** Base API URL, no trailing slash, e.g. `https://api.example.com`. */
  url: string;
  anonKey: string;
  fetch: Fetch;
  globalHeaders: Record<string, string>;
  version: string;
  getAccessToken: () => string | null;
}
