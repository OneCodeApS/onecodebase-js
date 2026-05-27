import type { ClientContext, Fetch } from "./types";

/** Resolve a usable fetch, preferring an explicit override, then the global. */
export function resolveFetch(custom?: Fetch): Fetch {
  if (custom) return custom;
  if (typeof fetch !== "undefined") {
    return (...args: Parameters<Fetch>) => fetch(...args);
  }
  throw new Error(
    "onecodebase-js: no global fetch found. Pass options.global.fetch " +
      "(required on Node < 18 or runtimes without a built-in fetch).",
  );
}

/**
 * Standard auth headers for the non-PostgREST APIs (auth/storage/functions).
 * Sends both `apikey` (anon) and `Authorization: Bearer <token>`, where token
 * is the signed-in user's access token or, when signed out, the anon key.
 */
export function authHeaders(
  ctx: ClientContext,
  extra?: Record<string, string>,
): Record<string, string> {
  const token = ctx.getAccessToken() ?? ctx.anonKey;
  return {
    apikey: ctx.anonKey,
    Authorization: `Bearer ${token}`,
    "x-client-info": `onecodebase-js/${ctx.version}`,
    ...ctx.globalHeaders,
    ...extra,
  };
}

/** Parse a response body as JSON when the content-type says so, else text. */
export async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  const text = await res.text();
  return text.length ? text : null;
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Percent-encode each segment of an object key path independently. */
export function encodePath(path: string): string {
  return path
    .split("/")
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join("/");
}
