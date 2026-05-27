import { OneCodeError, errorFromBody } from "./errors";
import { authHeaders, parseBody } from "./fetch";
import type { ClientContext, Result } from "./types";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface InvokeOptions {
  method?: HttpMethod;
  /** Plain objects are JSON-encoded; strings/Blob/FormData are sent as-is. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Query-string params appended to the function URL. */
  query?: Record<string, string>;
}

/** Invoke edge functions hosted at `/functions/v1/<name>`. */
export class FunctionsClient {
  #ctx: ClientContext;

  constructor(ctx: ClientContext) {
    this.#ctx = ctx;
  }

  async invoke<T = unknown>(
    name: string,
    opts: InvokeOptions = {},
  ): Promise<Result<T>> {
    try {
      const method = opts.method ?? "POST";
      const url = new URL(`${this.#ctx.url}/functions/v1/${name}`);
      for (const [k, v] of Object.entries(opts.query ?? {})) {
        url.searchParams.set(k, v);
      }

      const headers = authHeaders(this.#ctx, opts.headers);
      let body: BodyInit | undefined;
      if (opts.body !== undefined && method !== "GET") {
        if (isPlainObject(opts.body)) {
          headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
          body = JSON.stringify(opts.body);
        } else {
          body = opts.body as BodyInit;
        }
      }

      const res = await this.#ctx.fetch(url.toString(), { method, headers, body });
      const parsed = await parseBody(res);
      if (!res.ok) throw errorFromBody(res, parsed);
      return { data: parsed as T, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  if (v instanceof Blob) return false;
  if (typeof FormData !== "undefined" && v instanceof FormData) return false;
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return false;
  if (v instanceof URLSearchParams) return false;
  return true;
}

function asError(e: unknown): OneCodeError {
  if (e instanceof OneCodeError) return e;
  if (e instanceof Error) return new OneCodeError(e.message);
  return new OneCodeError("Unknown error");
}
