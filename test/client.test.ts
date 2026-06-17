import { describe, expect, it } from "vitest"
import { createClient } from "../src/index"

const ANON = "anon.key.jwt"
const USER_TOKEN = "user.access.jwt"

interface Call {
	url: string
	method: string
	headers: Headers
	body?: string
}

/**
 * A fake fetch that records every request and routes by URL suffix. Lets us
 * assert which token the SDK attached without standing up the backend.
 */
function makeFetch(routes: Record<string, () => Response>) {
	const calls: Call[] = []
	const fetchImpl = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = String(input)
		const headers = new Headers(init?.headers as HeadersInit | undefined)
		calls.push({
			url,
			method: init?.method ?? "GET",
			headers,
			body: typeof init?.body === "string" ? init.body : undefined,
		})
		const key = Object.keys(routes).find((k) => url.includes(k))
		if (!key) return new Response("not found", { status: 404 })
		return routes[key]!()
	}
	return { fetchImpl: fetchImpl as typeof fetch, calls }
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

const signinPayload = {
	user: { id: "u1", email: "a@b.dk" },
	access_token: USER_TOKEN,
	token_type: "bearer",
	expires_in: 3600,
	refresh_token: "refresh.1",
	refresh_expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
}

describe("createClient", () => {
	it("uses the anon key for data requests when signed out", async () => {
		const { fetchImpl, calls } = makeFetch({
			"/rest/v1/todos": () => json([{ id: "1", title: "x" }]),
		})
		const oc = createClient("https://api.example.com", ANON, {
			global: { fetch: fetchImpl },
			auth: { persistSession: false },
		})

		const { data } = await oc.from("todos").select("*")
		expect(data).toEqual([{ id: "1", title: "x" }])

		const rest = calls.at(-1)!
		expect(rest.url).toContain("/rest/v1/todos")
		expect(rest.headers.get("apikey")).toBe(ANON)
		expect(rest.headers.get("authorization")).toBe(`Bearer ${ANON}`)
		expect(rest.headers.get("x-client-info")).toMatch(/^onebase-js\//)
	})

	it("swaps in the user's access token for data requests after sign-in", async () => {
		const { fetchImpl, calls } = makeFetch({
			"/auth/v1/signin": () => json(signinPayload),
			"/rest/v1/todos": () => json([]),
		})
		const oc = createClient("https://api.example.com", ANON, {
			global: { fetch: fetchImpl },
			auth: { persistSession: false },
		})

		const { data, error } = await oc.auth.signInWithPassword({
			email: "a@b.dk",
			password: "pw",
		})
		expect(error).toBeNull()
		expect(data?.session.access_token).toBe(USER_TOKEN)
		expect(oc.auth.currentAccessToken()).toBe(USER_TOKEN)

		await oc.from("todos").insert({ title: "new" })
		const rest = calls.at(-1)!
		expect(rest.url).toContain("/rest/v1/todos")
		expect(rest.headers.get("authorization")).toBe(`Bearer ${USER_TOKEN}`)
		// apikey stays the anon key — PostgREST authorizes off the bearer token.
		expect(rest.headers.get("apikey")).toBe(ANON)
	})

	it("surfaces API errors as OneCodeError without throwing", async () => {
		const { fetchImpl } = makeFetch({
			"/auth/v1/signin": () =>
				json({ error: "invalid_credentials" }, 401),
		})
		const oc = createClient("https://api.example.com", ANON, {
			global: { fetch: fetchImpl },
			auth: { persistSession: false },
		})

		const { data, error } = await oc.auth.signInWithPassword({
			email: "a@b.dk",
			password: "wrong",
		})
		expect(data).toBeNull()
		expect(error?.code).toBe("invalid_credentials")
		expect(error?.status).toBe(401)
	})

	it("clears the session and notifies listeners on sign-out", async () => {
		const { fetchImpl } = makeFetch({
			"/auth/v1/signin": () => json(signinPayload),
			"/auth/v1/signout": () => json({ ok: true }),
		})
		const oc = createClient("https://api.example.com", ANON, {
			global: { fetch: fetchImpl },
			auth: { persistSession: false },
		})

		const events: string[] = []
		oc.auth.onAuthStateChange((e) => events.push(e))

		await oc.auth.signInWithPassword({ email: "a@b.dk", password: "pw" })
		await oc.auth.signOut()

		expect(oc.auth.currentAccessToken()).toBeNull()
		expect(events).toContain("SIGNED_IN")
		expect(events).toContain("SIGNED_OUT")
	})

	it("invokes edge functions with the bearer token and JSON body", async () => {
		const { fetchImpl, calls } = makeFetch({
			"/functions/v1/hello": () => json({ greeting: "hi" }),
		})
		const oc = createClient("https://api.example.com", ANON, {
			global: { fetch: fetchImpl },
			auth: { persistSession: false },
		})

		const { data } = await oc.functions.invoke<{ greeting: string }>(
			"hello",
			{
				body: { name: "x" },
			},
		)
		expect(data?.greeting).toBe("hi")

		const call = calls.at(-1)!
		expect(call.method).toBe("POST")
		expect(call.headers.get("content-type")).toBe("application/json")
		expect(call.body).toBe(JSON.stringify({ name: "x" }))
	})
})
