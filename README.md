# onecodebase-js

Isomorphic JavaScript/TypeScript client for an [Onecodebase](https://github.com/OneCodeApS/Onecodebase) backend — Postgres + PostgREST + auth + storage + realtime + edge functions, behind one `api.<host>` surface. The ergonomics mirror `@supabase/supabase-js`, so if you've used that, this will feel familiar.

```bash
npm install onecodebase-js
```

## Quick start

```ts
import { createClient } from "onecodebase-js";

// URL = your API host. anonKey = dashboard → Admin → API keys.
const oc = createClient("https://api.example.com", ANON_KEY);

// Read public data with the anon key.
const { data, error } = await oc.from("todos").select("*").eq("done", false);

// Sign in — every subsequent request is automatically authorized as the user.
await oc.auth.signInWithPassword({ email, password });
await oc.from("todos").insert({ title: "Buy milk" });
```

`createClient` returns one object with five feature areas: `.from()`/`.rpc()` (data), `.auth`, `.storage`, `.functions`, and `.channel()` (realtime).

> 📖 **Full function-by-function reference: [docs/API.md](./docs/API.md).**

## How auth works

There's one rule, and the SDK handles it for you: **requests carry the signed-in user's access token when there is one, and the anon key otherwise.** Signing in, refreshing, and signing out all update which token gets attached to your data, storage, function, and realtime calls — no need to thread tokens through yourself.

```ts
oc.auth.onAuthStateChange((event, session) => {
  // INITIAL_SESSION | SIGNED_IN | SIGNED_OUT | TOKEN_REFRESHED
  console.log(event, session?.user.email);
});

await oc.auth.signUp({ email, password });
await oc.auth.signInWithPassword({ email, password });
const { data } = await oc.auth.getUser();
await oc.auth.signOut();
```

Sessions persist to `localStorage` in the browser and in-memory on the server; access tokens auto-refresh shortly before they expire. Configure via `createClient(url, key, { auth: { persistSession, autoRefreshToken, storage, storageKey } })`.

### OAuth (Microsoft)

```ts
// Redirects the browser to the provider.
await oc.auth.signInWithOAuth({ provider: "microsoft", redirectTo: location.href });

// On the page the provider returns to, complete sign-in (reads tokens from the
// URL fragment, fetches the user, stores the session, scrubs the URL).
await oc.auth.getSessionFromUrl();
```

## Data — `.from()` and `.rpc()`

These delegate to [`@supabase/postgrest-js`](https://github.com/supabase/postgrest-js), so the full PostgREST query builder is available (`.select`, `.eq`, `.order`, `.range`, `.single`, `.insert`, `.update`, `.upsert`, `.delete`, …).

```ts
await oc.from("todos").select("id,title").order("created_at", { ascending: false });
await oc.from("todos").update({ done: true }).eq("id", id);
await oc.rpc("my_function", { arg: 1 });
```

### Typed schema (optional)

Pass a `Database` type for end-to-end typing:

```ts
const oc = createClient<Database>(url, ANON_KEY);
```

## Storage

> Minting upload/sign URLs requires an **authenticated session** (or a service-role key). The anon key is rejected by the server, so sign in first.

```ts
const bucket = oc.storage.from("avatars");

await bucket.upload("me.png", file, { contentType: "image/png" });
const { data } = await bucket.createSignedUrl("me.png", 3600);   // → { signedUrl, expiresAt }
await bucket.createSignedUrls(["a.png", "b.png"]);               // batched, max 100
const { data: blob } = await bucket.download("me.png");
```

Under the hood `upload` is two hops — the SDK asks the server for a short-lived SigV4 URL (which enforces the bucket's size/MIME policy), then streams the bytes straight to MinIO. You just call `.upload()`.

## Realtime

Row changes stream over Server-Sent Events, one channel per table. **Requires an authenticated session** (the realtime endpoint rejects the anon key), and the table must have realtime enabled in the dashboard.

```ts
const channel = oc
  .channel("todos")                       // { schema: "public" } by default
  .on("INSERT", (msg) => console.log("new row", msg.new))
  .on("*", (msg) => console.log(msg.type, msg.new ?? msg.old))
  .subscribe((status) => console.log(status)); // SUBSCRIBED | CHANNEL_ERROR | CLOSED

channel.unsubscribe();
```

`EventSource` is native in browsers and Node 22+. On older Node, pass a polyfill:

```ts
import EventSource from "eventsource";
createClient(url, key, { realtime: { eventSource: EventSource } });
```

## Edge functions

```ts
const { data, error } = await oc.functions.invoke("hello", {
  method: "POST",                 // default
  body: { name: "world" },        // objects are JSON-encoded
  query: { debug: "1" },
});
```

## Errors

Every method returns `{ data, error }` — nothing throws for expected API failures. `error` is a `OneCodeError` with `.message`, `.status` (HTTP), `.code` (stable machine code, e.g. `invalid_credentials`), and `.detail`.

```ts
const { error } = await oc.auth.signInWithPassword({ email, password });
if (error?.code === "invalid_credentials") { /* … */ }
```

## CORS

Browser apps must have their origin allowlisted in the dashboard (**Authentication → CORS origins**) or via the `AUTH_ALLOWED_ORIGINS` env var on the server. Server-to-server callers aren't subject to CORS.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build      # → dist/ (ESM + CJS + .d.ts)
```

## License

MIT © OneCode ApS
