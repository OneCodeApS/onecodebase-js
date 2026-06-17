import { PostgrestClient } from "@supabase/postgrest-js"
import { AuthClient } from "./auth"
import { FunctionsClient } from "./functions"
import { RealtimeChannel, RealtimeClient } from "./realtime"
import { StorageClient } from "./storage"
import { resolveFetch, stripTrailingSlash } from "./fetch"
import { SDK_VERSION } from "./version"
import type { ClientContext, Fetch, OneCodeClientOptions } from "./types"

/**
 * The onebase client. One object, four feature areas:
 *   - `.from(table)` / `.rpc(fn)` — Postgres data via PostgREST
 *   - `.auth` — end-user sign-up / sign-in / sessions
 *   - `.storage` — S3-compatible object storage
 *   - `.functions` — edge functions
 *   - `.channel(table)` — realtime row changes over SSE
 *
 * Requests are authorized with the signed-in user's access token when there is
 * one, falling back to the anon key otherwise — exactly like the dashboard's
 * API-keys page describes.
 */
export class OneCodeClient<Database = any> {
	readonly url: string
	readonly auth: AuthClient
	readonly storage: StorageClient
	readonly functions: FunctionsClient
	readonly realtime: RealtimeClient

	/** Build a query against a table or view (PostgREST). */
	readonly from: PostgrestClient<Database>["from"]
	/** Call a Postgres function (PostgREST RPC). */
	readonly rpc: PostgrestClient<Database>["rpc"]

	#rest: PostgrestClient<Database>

	constructor(
		url: string,
		anonKey: string,
		options: OneCodeClientOptions = {},
	) {
		if (!url) throw new Error("onebase-js: `url` is required.")
		if (!anonKey) throw new Error("onebase-js: `anonKey` is required.")

		this.url = stripTrailingSlash(url)

		const fetchImpl = resolveFetch(options.global?.fetch)
		const globalHeaders = options.global?.headers ?? {}

		// Auth manages its own token, so its context never needs to read one back.
		const authCtx: ClientContext = {
			url: this.url,
			anonKey,
			fetch: fetchImpl,
			globalHeaders,
			version: SDK_VERSION,
			getAccessToken: () => null,
		}
		this.auth = new AuthClient(authCtx, options.auth)

		// Every other sub-client reads the live token from auth.
		const ctx: ClientContext = {
			...authCtx,
			getAccessToken: () => this.auth.currentAccessToken(),
		}
		this.storage = new StorageClient(ctx)
		this.functions = new FunctionsClient(ctx)
		this.realtime = new RealtimeClient(ctx, options.realtime)

		// PostgREST is reached directly under /rest/v1. We inject auth via a custom
		// fetch (rather than fixed constructor headers) so the token always
		// reflects the current session without re-instantiating the client.
		this.#rest = new PostgrestClient<Database>(`${this.url}/rest/v1`, {
			fetch: makeRestFetch(ctx),
		})

		// Delegate the data API straight to PostgREST, binding the methods so their
		// full generic signatures (and your typed Database schema) pass through.
		this.from = this.#rest.from.bind(this.#rest)
		this.rpc = this.#rest.rpc.bind(this.#rest)
	}

	/** Shorthand for `realtime.channel(table)`. */
	channel(table: string, opts?: { schema?: string }): RealtimeChannel {
		return this.realtime.channel(table, opts)
	}
}

/**
 * Custom fetch for PostgREST: sets the auth headers from the live session on
 * every call without clobbering the content-type / Prefer / Range headers
 * PostgREST sets itself.
 */
function makeRestFetch(ctx: ClientContext): Fetch {
	return (input, init = {}) => {
		const headers = new Headers(init.headers as HeadersInit | undefined)
		const token = ctx.getAccessToken() ?? ctx.anonKey
		headers.set("apikey", ctx.anonKey)
		headers.set("Authorization", `Bearer ${token}`)
		if (!headers.has("x-client-info")) {
			headers.set("x-client-info", `onebase-js/${ctx.version}`)
		}
		for (const [k, v] of Object.entries(ctx.globalHeaders)) {
			if (!headers.has(k)) headers.set(k, v)
		}
		return ctx.fetch(input, { ...init, headers })
	}
}
