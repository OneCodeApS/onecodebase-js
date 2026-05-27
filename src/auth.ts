import { OneCodeError, errorFromBody } from "./errors";
import { authHeaders, parseBody } from "./fetch";
import type {
  AuthChangeCallback,
  AuthChangeEvent,
  AuthClientOptions,
  AuthSession,
  AuthUser,
  ClientContext,
  Result,
  SessionStorageAdapter,
} from "./types";

// Shape the /auth/v1/* endpoints return on a successful sign-in/up/refresh.
interface AuthApiResponse {
  user: AuthUser;
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_at: string;
}

interface Credentials {
  email: string;
  password: string;
}

// Refresh this many ms before the access token actually expires, so an
// in-flight request never races the expiry.
const REFRESH_MARGIN_MS = 60_000;

function toSession(p: AuthApiResponse): AuthSession {
  return {
    access_token: p.access_token,
    token_type: p.token_type,
    expires_in: p.expires_in,
    expires_at: Date.now() + p.expires_in * 1000,
    refresh_token: p.refresh_token,
    refresh_expires_at: p.refresh_expires_at,
    user: p.user,
  };
}

/** In-memory fallback when no persistent storage is available. */
function memoryStorage(): SessionStorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function defaultStorage(): SessionStorageAdapter {
  try {
    if (typeof globalThis.localStorage !== "undefined") {
      return globalThis.localStorage;
    }
  } catch {
    // Accessing localStorage can throw (e.g. sandboxed iframes) — fall through.
  }
  return memoryStorage();
}

export class AuthClient {
  #ctx: ClientContext;
  #storage: SessionStorageAdapter;
  #storageKey: string;
  #persist: boolean;
  #autoRefresh: boolean;
  #session: AuthSession | null = null;
  #listeners = new Set<AuthChangeCallback>();
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #ready: Promise<void>;

  constructor(ctx: ClientContext, opts: AuthClientOptions = {}) {
    this.#ctx = ctx;
    this.#persist = opts.persistSession ?? true;
    this.#autoRefresh = opts.autoRefreshToken ?? true;
    this.#storageKey = opts.storageKey ?? "onecodebase.auth.session";
    this.#storage = opts.storage ?? defaultStorage();
    this.#ready = this.#load();
  }

  /** Resolves once any persisted session has been read back in. */
  initialize(): Promise<void> {
    return this.#ready;
  }

  /** The current access token, or null when signed out. Used to authorize
   *  REST, storage, functions and realtime calls. */
  currentAccessToken(): string | null {
    return this.#session?.access_token ?? null;
  }

  // --- Public API -----------------------------------------------------------

  async signUp(
    credentials: Credentials,
  ): Promise<Result<{ user: AuthUser; session: AuthSession }>> {
    try {
      const payload = await this.#post<AuthApiResponse>("/auth/v1/signup", credentials);
      const session = toSession(payload);
      this.#setSession(session, "SIGNED_IN");
      return { data: { user: session.user, session }, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  }

  async signInWithPassword(
    credentials: Credentials,
  ): Promise<Result<{ user: AuthUser; session: AuthSession }>> {
    try {
      const payload = await this.#post<AuthApiResponse>("/auth/v1/signin", credentials);
      const session = toSession(payload);
      this.#setSession(session, "SIGNED_IN");
      return { data: { user: session.user, session }, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  }

  /**
   * Redirect the browser to the Microsoft OAuth flow. After the user returns to
   * `redirectTo`, call {@link getSessionFromUrl} to complete sign-in.
   * In non-browser environments this returns the URL without navigating.
   */
  async signInWithOAuth(opts: {
    provider: "microsoft";
    redirectTo?: string;
  }): Promise<Result<{ provider: string; url: string }>> {
    if (opts.provider !== "microsoft") {
      return {
        data: null,
        error: new OneCodeError(`Unsupported OAuth provider: ${opts.provider}`),
      };
    }
    const u = new URL(`${this.#ctx.url}/auth/v1/microsoft/start`);
    if (opts.redirectTo) u.searchParams.set("return_to", opts.redirectTo);
    const url = u.toString();
    if (typeof globalThis.window !== "undefined") {
      globalThis.window.location.assign(url);
    }
    return { data: { provider: opts.provider, url }, error: null };
  }

  /**
   * Complete an OAuth sign-in by reading tokens from the URL fragment the
   * callback redirects to (`#access_token=…&refresh_token=…`). Looks up the
   * user with the new token, stores the session, and clears the fragment.
   */
  async getSessionFromUrl(
    urlString?: string,
  ): Promise<Result<{ session: AuthSession } | { session: null }>> {
    try {
      const href =
        urlString ??
        (typeof globalThis.window !== "undefined"
          ? globalThis.window.location.href
          : "");
      const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) {
        return { data: { session: null }, error: null };
      }

      const userRes = await this.getUser(accessToken);
      if (userRes.error) return { data: null, error: userRes.error };

      const session = toSession({
        user: userRes.data.user,
        access_token: accessToken,
        token_type: params.get("token_type") ?? "bearer",
        expires_in: Number(params.get("expires_in") ?? 3600),
        refresh_token: refreshToken,
        refresh_expires_at:
          params.get("refresh_expires_at") ??
          new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      });
      this.#setSession(session, "SIGNED_IN");

      // Scrub the tokens from the address bar.
      if (typeof globalThis.window !== "undefined" && !urlString) {
        const clean =
          globalThis.window.location.pathname +
          globalThis.window.location.search;
        globalThis.history?.replaceState(null, "", clean);
      }
      return { data: { session }, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  }

  async signOut(): Promise<{ error: OneCodeError | null }> {
    const rt = this.#session?.refresh_token;
    try {
      if (rt) await this.#post("/auth/v1/signout", { refresh_token: rt });
      return { error: null };
    } catch (e) {
      // Sign-out is best-effort; the server treats it as idempotent.
      return { error: asError(e) };
    } finally {
      this.#setSession(null, "SIGNED_OUT");
    }
  }

  async refreshSession(
    refreshToken?: string,
  ): Promise<Result<{ session: AuthSession; user: AuthUser }>> {
    const rt = refreshToken ?? this.#session?.refresh_token;
    if (!rt) {
      return {
        data: null,
        error: new OneCodeError("No refresh token available", { status: 400 }),
      };
    }
    try {
      const payload = await this.#post<AuthApiResponse>("/auth/v1/refresh", {
        refresh_token: rt,
      });
      const session = toSession(payload);
      this.#setSession(session, "TOKEN_REFRESHED");
      return { data: { session, user: session.user }, error: null };
    } catch (e) {
      // A failed refresh means the session is dead — drop it.
      this.#setSession(null, "SIGNED_OUT");
      return { data: null, error: asError(e) };
    }
  }

  /** Fetch the current user from the server. Uses `jwt` if given, else the
   *  stored access token. */
  async getUser(jwt?: string): Promise<Result<{ user: AuthUser }>> {
    const token = jwt ?? this.currentAccessToken();
    if (!token) {
      return {
        data: null,
        error: new OneCodeError("Not authenticated", { status: 401 }),
      };
    }
    try {
      const res = await this.#ctx.fetch(`${this.#ctx.url}/auth/v1/user`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, apikey: this.#ctx.anonKey },
      });
      const body = await parseBody(res);
      if (!res.ok) throw errorFromBody(res, body);
      return { data: { user: body as AuthUser }, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  }

  /** The locally stored session, without a network round-trip. */
  async getSession(): Promise<Result<{ session: AuthSession | null }>> {
    await this.#ready;
    return { data: { session: this.#session }, error: null };
  }

  /**
   * Subscribe to auth state changes. The callback fires immediately with the
   * current session (`INITIAL_SESSION`) once storage has loaded, then on every
   * subsequent sign-in / sign-out / token refresh.
   */
  onAuthStateChange(callback: AuthChangeCallback): {
    unsubscribe: () => void;
  } {
    this.#listeners.add(callback);
    void this.#ready.then(() => {
      if (this.#listeners.has(callback)) {
        callback("INITIAL_SESSION", this.#session);
      }
    });
    return {
      unsubscribe: () => {
        this.#listeners.delete(callback);
      },
    };
  }

  // --- Internals ------------------------------------------------------------

  async #post<T = unknown>(path: string, json: unknown): Promise<T> {
    const res = await this.#ctx.fetch(`${this.#ctx.url}${path}`, {
      method: "POST",
      headers: { ...authHeaders(this.#ctx), "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
    const body = await parseBody(res);
    if (!res.ok) throw errorFromBody(res, body);
    return body as T;
  }

  #setSession(session: AuthSession | null, event: AuthChangeEvent): void {
    this.#session = session;
    this.#scheduleRefresh();
    void this.#save();
    this.#emit(event, session);
  }

  #emit(event: AuthChangeEvent, session: AuthSession | null): void {
    for (const cb of this.#listeners) {
      try {
        cb(event, session);
      } catch {
        // A throwing listener must not break the others.
      }
    }
  }

  async #save(): Promise<void> {
    if (!this.#persist) return;
    try {
      if (this.#session) {
        await this.#storage.setItem(
          this.#storageKey,
          JSON.stringify(this.#session),
        );
      } else {
        await this.#storage.removeItem(this.#storageKey);
      }
    } catch {
      // Persistence is best-effort; ignore quota/availability errors.
    }
  }

  #load(): Promise<void> {
    try {
      const raw = this.#storage.getItem(this.#storageKey);
      if (raw instanceof Promise) {
        return raw.then((v) => this.#hydrate(v)).catch(() => undefined);
      }
      this.#hydrate(raw);
      return Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  }

  #hydrate(raw: string | null): void {
    if (!raw) return;
    try {
      const session = JSON.parse(raw) as AuthSession;
      if (session?.access_token) {
        this.#session = session;
        this.#scheduleRefresh();
      }
    } catch {
      // Corrupt stored value — ignore and start signed out.
    }
  }

  #scheduleRefresh(): void {
    if (this.#refreshTimer) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    if (!this.#autoRefresh || !this.#session) return;

    const delay = Math.max(0, this.#session.expires_at - Date.now() - REFRESH_MARGIN_MS);
    this.#refreshTimer = setTimeout(() => {
      void this.refreshSession();
    }, delay);
    // Don't let the refresh timer keep a Node process alive on its own.
    (this.#refreshTimer as { unref?: () => void }).unref?.();
  }
}

function asError(e: unknown): OneCodeError {
  if (e instanceof OneCodeError) return e;
  if (e instanceof Error) return new OneCodeError(e.message);
  return new OneCodeError("Unknown error");
}
