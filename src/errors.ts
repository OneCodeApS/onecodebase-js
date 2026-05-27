// Single error type for everything the SDK surfaces. The Onecodebase HTTP APIs
// return errors as JSON of the shape `{ error: "<code>", detail?: "<human>" }`
// with a non-2xx status; this captures all three so callers can branch on
// `.code` (stable) and show `.message`/`.detail` (human).
export class OneCodeError extends Error {
  /** HTTP status code, or 0 for client-side errors raised before a request. */
  readonly status: number;
  /** Machine-readable code from the API body's `error` field, when present. */
  readonly code?: string;
  /** Human-readable detail from the API body's `detail` field, when present. */
  readonly detail?: string;

  constructor(
    message: string,
    opts: { status?: number; code?: string; detail?: string } = {},
  ) {
    super(message);
    this.name = "OneCodeError";
    this.status = opts.status ?? 0;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

type ApiErrorBody = { error?: string; detail?: string };

/** Build a OneCodeError from a failed Response and its (already-parsed) body. */
export function errorFromBody(res: Response, body: unknown): OneCodeError {
  if (body && typeof body === "object") {
    const b = body as ApiErrorBody;
    const message = b.detail || b.error || res.statusText || `HTTP ${res.status}`;
    return new OneCodeError(message, {
      status: res.status,
      code: b.error,
      detail: b.detail,
    });
  }
  const message =
    typeof body === "string" && body
      ? body
      : res.statusText || `HTTP ${res.status}`;
  return new OneCodeError(message, { status: res.status });
}
