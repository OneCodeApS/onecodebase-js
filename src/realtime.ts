import { OneCodeError } from "./errors";
import type { ClientContext, RealtimeClientOptions } from "./types";

export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE";
export type RealtimeListenEvent = RealtimeEventType | "*";

/** A row-change event as emitted by the server's pg_notify trigger. */
export interface RealtimeMessage {
  type: RealtimeEventType;
  schema: string;
  table: string;
  /** Previous row, present on UPDATE and DELETE. */
  old?: Record<string, unknown> | null;
  /** New row, present on INSERT and UPDATE. */
  new?: Record<string, unknown> | null;
  /** Set when the row was too large for the notify payload (data omitted). */
  truncated?: boolean;
  ts: string;
}

export type SubscribeStatus = "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR";

type ChangeCallback = (message: RealtimeMessage) => void;

function resolveEventSource(opts?: RealtimeClientOptions): typeof EventSource {
  const impl = opts?.eventSource ?? (globalThis as { EventSource?: typeof EventSource }).EventSource;
  if (!impl) {
    throw new OneCodeError(
      "No EventSource implementation found. It's native in browsers and " +
        "Node 22+. On older Node, pass options.realtime.eventSource (e.g. the " +
        "`eventsource` package).",
    );
  }
  return impl;
}

export class RealtimeClient {
  #ctx: ClientContext;
  #opts?: RealtimeClientOptions;

  constructor(ctx: ClientContext, opts?: RealtimeClientOptions) {
    this.#ctx = ctx;
    this.#opts = opts;
  }

  /** Subscribe to row changes on a single table (realtime must be enabled for
   *  it in the dashboard). */
  channel(
    table: string,
    opts: { schema?: string } = {},
  ): RealtimeChannel {
    return new RealtimeChannel(this.#ctx, this.#opts, opts.schema ?? "public", table);
  }
}

export class RealtimeChannel {
  #ctx: ClientContext;
  #opts?: RealtimeClientOptions;
  #schema: string;
  #table: string;
  #listeners: Array<{ event: RealtimeListenEvent; cb: ChangeCallback }> = [];
  #es: EventSource | null = null;
  #statusCb?: (status: SubscribeStatus) => void;

  constructor(
    ctx: ClientContext,
    opts: RealtimeClientOptions | undefined,
    schema: string,
    table: string,
  ) {
    this.#ctx = ctx;
    this.#opts = opts;
    this.#schema = schema;
    this.#table = table;
  }

  /** Register a handler for a change type (or `*` for all). Chainable. */
  on(event: RealtimeListenEvent, callback: ChangeCallback): this {
    this.#listeners.push({ event, cb: callback });
    return this;
  }

  /**
   * Open the SSE stream. Requires an authenticated session — the realtime
   * endpoint rejects the anon key. `statusCallback` reports connection state.
   */
  subscribe(statusCallback?: (status: SubscribeStatus) => void): this {
    this.#statusCb = statusCallback;
    if (this.#es) return this;

    // EventSource can't set headers, so the JWT travels as a query param.
    const token = this.#ctx.getAccessToken();
    if (!token) {
      statusCallback?.("CHANNEL_ERROR");
      throw new OneCodeError(
        "Realtime requires an authenticated session (the anon key is not " +
          "accepted). Sign in before subscribing.",
        { status: 401 },
      );
    }

    const Impl = resolveEventSource(this.#opts);
    const url = new URL(`${this.#ctx.url}/realtime`);
    url.searchParams.set("schema", this.#schema);
    url.searchParams.set("table", this.#table);
    url.searchParams.set("token", token);

    const es = new Impl(url.toString());
    this.#es = es;

    es.onopen = () => statusCallback?.("SUBSCRIBED");
    es.onmessage = (ev: MessageEvent) => this.#dispatch(ev.data);
    es.onerror = () => statusCallback?.("CHANNEL_ERROR");

    return this;
  }

  /** Close the stream. */
  unsubscribe(): void {
    if (this.#es) {
      this.#es.close();
      this.#es = null;
      this.#statusCb?.("CLOSED");
    }
  }

  #dispatch(raw: unknown): void {
    if (typeof raw !== "string" || raw.length === 0) return;
    let message: RealtimeMessage;
    try {
      message = JSON.parse(raw) as RealtimeMessage;
    } catch {
      return;
    }
    for (const l of this.#listeners) {
      if (l.event === "*" || l.event === message.type) {
        try {
          l.cb(message);
        } catch {
          // Keep delivering to the remaining listeners.
        }
      }
    }
  }
}
