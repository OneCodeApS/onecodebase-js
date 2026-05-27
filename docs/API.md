# API Reference

Complete reference for every public function in `onecodebase-js`. For a guided
overview see the [README](../README.md).

- [`createClient()`](#createclient)
- [The `{ data, error }` convention](#the--data-error--convention)
- [Client](#client)
- [Auth — `oc.auth`](#auth--ocauth)
- [Data — `oc.from()` / `oc.rpc()`](#data--ocfrom--ocrpc)
- [Storage — `oc.storage`](#storage--ocstorage)
- [Functions — `oc.functions`](#functions--ocfunctions)
- [Realtime — `oc.channel()`](#realtime--occhannel)
- [Errors](#errors)
- [Types](#types)

---

## `createClient()`

```ts
function createClient<Database = any>(
  url: string,
  anonKey: string,
  options?: OneCodeClientOptions,
): OneCodeClient<Database>
```

Creates a client. `url` is your API host (e.g. `https://api.example.com`);
`anonKey` is the anon key from the dashboard (**Admin → API keys**).

```ts
import { createClient } from "onecodebase-js";

const oc = createClient("https://api.example.com", ANON_KEY);
```

### `OneCodeClientOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `auth.persistSession` | `boolean` | `true` | Persist the session across reloads/restarts. |
| `auth.autoRefreshToken` | `boolean` | `true` | Refresh the access token ~60s before it expires. |
| `auth.storage` | `SessionStorageAdapter` | `localStorage` or in-memory | Where the session is stored. |
| `auth.storageKey` | `string` | `"onecodebase.auth.session"` | Key under which the session is stored. |
| `realtime.eventSource` | `typeof EventSource` | `globalThis.EventSource` | EventSource implementation (polyfill for old Node). |
| `global.headers` | `Record<string,string>` | `{}` | Extra headers merged into every request. |
| `global.fetch` | `typeof fetch` | global `fetch` | Custom fetch (e.g. Node < 18, instrumentation). |

```ts
const oc = createClient<Database>(url, ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { headers: { "x-app": "my-app" } },
});
```

---

## The `{ data, error }` convention

Every async method returns an object with exactly one of `data` / `error` set —
**nothing throws for expected API failures.** Always check `error` first.

```ts
const { data, error } = await oc.from("todos").select("*");
if (error) {
  console.error(error.code, error.message);
  return;
}
use(data);
```

`error` is always a [`OneCodeError`](#errors).

---

## Client

The object returned by `createClient`.

| Member | Type | Description |
| --- | --- | --- |
| `oc.url` | `string` | Normalized base URL (no trailing slash). |
| `oc.from(table)` | method | PostgREST query builder. [↓](#ocfromrelation) |
| `oc.rpc(fn, args?, opts?)` | method | Call a Postgres function. [↓](#ocrpcfn-args-options) |
| `oc.channel(table, opts?)` | method | Open a realtime channel. [↓](#realtime--occhannel) |
| `oc.auth` | `AuthClient` | [↓](#auth--ocauth) |
| `oc.storage` | `StorageClient` | [↓](#storage--ocstorage) |
| `oc.functions` | `FunctionsClient` | [↓](#functions--ocfunctions) |
| `oc.realtime` | `RealtimeClient` | [↓](#realtime--occhannel) |

---

## Auth — `oc.auth`

The auth client manages the session and decides which token authorizes your
requests: the signed-in user's access token when present, the anon key
otherwise. You never pass tokens manually.

### `signUp(credentials)`

```ts
signUp(credentials: { email: string; password: string })
  : Promise<Result<{ user: AuthUser; session: AuthSession }>>
```

Registers a new user and signs them in. Fires a `SIGNED_IN` event on success.

```ts
const { data, error } = await oc.auth.signUp({ email, password });
// error?.code can be: signups_disabled | email_provider_disabled |
//   invalid_email | password_too_short | password_too_weak |
//   password_pwned | email_taken
```

### `signInWithPassword(credentials)`

```ts
signInWithPassword(credentials: { email: string; password: string })
  : Promise<Result<{ user: AuthUser; session: AuthSession }>>
```

Signs in with email + password. Fires `SIGNED_IN`.

```ts
const { data, error } = await oc.auth.signInWithPassword({ email, password });
if (error?.code === "invalid_credentials") { /* wrong email or password */ }
```

### `signInWithOAuth(options)`

```ts
signInWithOAuth(options: { provider: "microsoft"; redirectTo?: string })
  : Promise<Result<{ provider: string; url: string }>>
```

In a browser, redirects to the provider's login. In other environments returns
`{ url }` without navigating. Pass `redirectTo` to control where the provider
sends the user back; complete sign-in there with `getSessionFromUrl()`.

```ts
await oc.auth.signInWithOAuth({ provider: "microsoft", redirectTo: location.href });
```

### `getSessionFromUrl(url?)`

```ts
getSessionFromUrl(url?: string)
  : Promise<Result<{ session: AuthSession } | { session: null }>>
```

Completes an OAuth round-trip: reads the tokens the callback put in the URL
fragment (`#access_token=…&refresh_token=…`), fetches the user, stores the
session, and scrubs the fragment from the address bar. If no tokens are present,
returns `{ data: { session: null }, error: null }`. Defaults to
`window.location.href`.

```ts
// On the page the provider redirected back to:
const { data } = await oc.auth.getSessionFromUrl();
if (data?.session) { /* signed in */ }
```

### `signOut()`

```ts
signOut(): Promise<{ error: OneCodeError | null }>
```

Revokes the refresh token server-side and clears the local session (idempotent).
Fires `SIGNED_OUT`. Note: returns only `{ error }` (no `data`).

```ts
await oc.auth.signOut();
```

### `refreshSession(refreshToken?)`

```ts
refreshSession(refreshToken?: string)
  : Promise<Result<{ session: AuthSession; user: AuthUser }>>
```

Exchanges a refresh token for a fresh access token (and rotates the refresh
token). Uses the stored refresh token if none is passed. Auto-refresh calls this
for you; you rarely need it directly. A failed refresh clears the session and
fires `SIGNED_OUT`.

### `getUser(jwt?)`

```ts
getUser(jwt?: string): Promise<Result<{ user: AuthUser }>>
```

Fetches the current user from the server. Uses `jwt` if provided, else the stored
access token. Returns `error` (status 401) when there's no token.

```ts
const { data } = await oc.auth.getUser();
console.log(data?.user.email);
```

### `getSession()`

```ts
getSession(): Promise<Result<{ session: AuthSession | null }>>
```

Returns the locally stored session — no network call. Awaits storage hydration
first, so it's safe to call at startup.

### `onAuthStateChange(callback)`

```ts
onAuthStateChange(callback: (event: AuthChangeEvent, session: AuthSession | null) => void)
  : { unsubscribe: () => void }
```

Subscribe to auth changes. The callback fires once immediately with
`INITIAL_SESSION` (after storage loads), then on every change.
`AuthChangeEvent` = `INITIAL_SESSION | SIGNED_IN | SIGNED_OUT | TOKEN_REFRESHED | USER_UPDATED`.

```ts
const sub = oc.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN") show(session!.user);
  if (event === "SIGNED_OUT") redirectToLogin();
});
// later: sub.unsubscribe();
```

### `currentAccessToken()`

```ts
currentAccessToken(): string | null
```

The current user's access token, or `null` when signed out. Synchronous.

### `initialize()`

```ts
initialize(): Promise<void>
```

Resolves once any persisted session has been read back in. Useful on the server
or with an async storage adapter to ensure the session is loaded before the first
request.

---

## Data — `oc.from()` / `oc.rpc()`

These delegate to [`@supabase/postgrest-js`](https://github.com/supabase/postgrest-js),
so the entire PostgREST query builder is available. Authorization is injected
automatically (user token or anon key).

### `oc.from(relation)`

Returns a query builder for a table or view. Chain filters and modifiers, then
`await` (or call `.then`) to execute. Resolves to `{ data, error, count, status, statusText }`.

```ts
// Select with filters, ordering, pagination
const { data } = await oc
  .from("todos")
  .select("id, title, done")
  .eq("done", false)
  .order("created_at", { ascending: false })
  .range(0, 19);

// Single row
const { data: one } = await oc.from("todos").select("*").eq("id", id).single();

// Insert (and return the inserted rows)
const { data: created } = await oc.from("todos").insert({ title: "Buy milk" }).select();

// Update / upsert / delete
await oc.from("todos").update({ done: true }).eq("id", id);
await oc.from("todos").upsert({ id, title: "x" });
await oc.from("todos").delete().eq("id", id);
```

Common builder methods: `select`, `insert`, `update`, `upsert`, `delete`,
`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`, `contains`,
`or`, `filter`, `order`, `limit`, `range`, `single`, `maybeSingle`. See the
[PostgREST JS docs](https://supabase.com/docs/reference/javascript/select) for
the full list — the builder is identical.

> What you can read/write is governed by Postgres Row-Level Security. Signed out,
> you act as `anon`; signed in, as `authenticated`.

### `oc.rpc(fn, args?, options?)`

```ts
oc.rpc(fn: string, args?: object, options?: { head?: boolean; get?: boolean; count?: "exact" | "planned" | "estimated" })
```

Calls a Postgres function and resolves like a query.

```ts
const { data, error } = await oc.rpc("search_todos", { term: "milk" });
```

---

## Storage — `oc.storage`

S3-compatible object storage.

> **Minting upload/sign URLs requires an authenticated session** (or a
> service-role key). The anon key is rejected — sign in first.

### `oc.storage.from(bucket)`

Returns a `StorageBucketApi` scoped to one bucket.

```ts
const bucket = oc.storage.from("avatars");
```

### `bucket.upload(path, body, options?)`

```ts
upload(
  path: string,
  body: Blob | ArrayBuffer | ArrayBufferView | string,
  options?: { contentType?: string },
): Promise<Result<{ path: string }>>
```

Uploads an object. Internally: requests a SigV4 PUT URL from the server (which
enforces the bucket's size and MIME policy), then streams the bytes to MinIO.
`contentType` is inferred from a `Blob`/`File` when omitted.

```ts
const { data, error } = await bucket.upload("user/me.png", file, {
  contentType: "image/png",
});
// error?.code: file_too_large | mime_not_allowed | missing_or_invalid_token |
//   forbidden_role
```

### `bucket.createSignedUrl(path, expiresIn?)`

```ts
createSignedUrl(path: string, expiresIn = 3600)
  : Promise<Result<{ signedUrl: string; expiresAt: string }>>
```

Mints a time-limited signed GET URL (TTL in seconds, max 7 days).

```ts
const { data } = await bucket.createSignedUrl("user/me.png", 600);
img.src = data!.signedUrl;
```

### `bucket.createSignedUrls(paths, expiresIn?)`

```ts
createSignedUrls(paths: string[], expiresIn = 3600)
  : Promise<Result<Array<{ bucket: string; key: string; url?: string; expires_at?: string; error?: string }>>>
```

Mints many signed GET URLs in one round-trip (max 100). Per-item failures appear
as `{ key, error }` rather than failing the whole call.

```ts
const { data } = await bucket.createSignedUrls(["a.png", "b.png"]);
for (const item of data!) {
  if (item.url) preload(item.url);
}
```

### `bucket.download(path, options?)`

```ts
download(path: string, options?: { expiresIn?: number }): Promise<Result<Blob>>
```

Signs a URL then GETs it, returning the bytes as a `Blob`.

```ts
const { data: blob } = await bucket.download("user/me.png");
```

---

## Functions — `oc.functions`

### `oc.functions.invoke(name, options?)`

```ts
invoke<T = unknown>(
  name: string,
  options?: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; // default POST
    body?: unknown;                  // plain objects are JSON-encoded
    headers?: Record<string, string>;
    query?: Record<string, string>;
  },
): Promise<Result<T>>
```

Invokes an edge function at `/functions/v1/<name>`. The current token (user or
anon) is attached automatically; the function can branch on the caller's role.
Plain objects in `body` are JSON-encoded with the right `Content-Type`;
strings/`Blob`/`FormData`/binary are sent as-is.

```ts
const { data, error } = await oc.functions.invoke<{ greeting: string }>("hello", {
  body: { name: "world" },
  query: { debug: "1" },
});
// error?.code: missing_token | invalid_token | function_not_found | function_error
```

---

## Realtime — `oc.channel()`

Row changes stream over Server-Sent Events, one channel per table.

> **Requires an authenticated session** (the realtime endpoint rejects the anon
> key), and the table must have realtime enabled in the dashboard. `subscribe()`
> throws a `OneCodeError` if called while signed out.

### `oc.channel(table, options?)`

```ts
oc.channel(table: string, options?: { schema?: string }): RealtimeChannel
```

Creates a channel (default schema `"public"`). Equivalent to
`oc.realtime.channel(...)`.

### `channel.on(event, callback)`

```ts
on(event: "INSERT" | "UPDATE" | "DELETE" | "*", callback: (message: RealtimeMessage) => void): this
```

Registers a handler for a change type (`"*"` for all). Chainable.

### `channel.subscribe(statusCallback?)`

```ts
subscribe(statusCallback?: (status: "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR") => void): this
```

Opens the stream. `statusCallback` reports `SUBSCRIBED` on connect,
`CHANNEL_ERROR` on failure, `CLOSED` after `unsubscribe()`.

### `channel.unsubscribe()`

```ts
unsubscribe(): void
```

Closes the stream.

```ts
const channel = oc
  .channel("todos")
  .on("INSERT", (m) => console.log("inserted", m.new))
  .on("DELETE", (m) => console.log("deleted", m.old))
  .subscribe((status) => console.log(status));

// when done
channel.unsubscribe();
```

### `RealtimeMessage`

```ts
interface RealtimeMessage {
  type: "INSERT" | "UPDATE" | "DELETE";
  schema: string;
  table: string;
  old?: Record<string, unknown> | null; // present on UPDATE, DELETE
  new?: Record<string, unknown> | null; // present on INSERT, UPDATE
  truncated?: boolean;                   // row too large for the notify payload
  ts: string;
}
```

If a changed row is too large for the notification payload, `truncated: true`
arrives without `old`/`new` — you still learn *that* a change happened.

---

## Errors

All failures surface as `error` of type `OneCodeError`:

| Property | Type | Description |
| --- | --- | --- |
| `message` | `string` | Human-readable (the API's `detail`, or its `error` code, or the HTTP status). |
| `status` | `number` | HTTP status, or `0` for client-side errors raised before a request. |
| `code` | `string \| undefined` | Stable machine code from the API (e.g. `invalid_credentials`). Branch on this. |
| `detail` | `string \| undefined` | Extra human-readable context, when the API provides it. |

```ts
import { OneCodeError } from "onecodebase-js";

const { error } = await oc.auth.signInWithPassword({ email, password });
if (error) {
  switch (error.code) {
    case "invalid_credentials": showError("Wrong email or password"); break;
    case "email_provider_disabled": showError("Email login is off"); break;
    default: showError(error.message);
  }
}
```

---

## Types

All exported from the package root:

```ts
import type {
  AuthChangeCallback,
  AuthChangeEvent,
  AuthClientOptions,
  AuthSession,
  AuthUser,
  Fetch,
  OneCodeClientOptions,
  RealtimeClientOptions,
  RealtimeEventType,
  RealtimeListenEvent,
  RealtimeMessage,
  Result,
  SessionStorageAdapter,
  SubscribeStatus,
  // re-exported from @supabase/postgrest-js:
  PostgrestError,
  PostgrestResponse,
  PostgrestSingleResponse,
} from "onecodebase-js";
```

### `AuthSession`

```ts
interface AuthSession {
  access_token: string;
  token_type: string;
  expires_in: number;        // seconds, as issued
  expires_at: number;        // epoch ms (computed client-side)
  refresh_token: string;
  refresh_expires_at: string; // ISO timestamp
  user: AuthUser;
}
```

### `AuthUser`

```ts
interface AuthUser {
  id: string;
  email: string;
  email_verified_at?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}
```

### `SessionStorageAdapter`

Implement this to plug in custom persistence (e.g. React Native
`AsyncStorage`, a cookie store, a secure keychain). Methods may be sync or async.

```ts
interface SessionStorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
```
