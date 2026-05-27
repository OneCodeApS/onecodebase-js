import { OneCodeError, errorFromBody } from "./errors";
import { authHeaders, encodePath, parseBody } from "./fetch";
import type { ClientContext, Result } from "./types";

// Body types we know how to size and stream up to MinIO via a PUT.
type UploadBody = Blob | ArrayBuffer | ArrayBufferView | string;

interface UploadOptions {
  /** MIME type; inferred from a Blob/File, else defaults to octet-stream. */
  contentType?: string;
}

interface SignResponse {
  url: string;
  expires_at: string;
}

interface UploadUrlResponse {
  upload_url: string;
  expires_at: string;
  max_upload_mb: number;
}

interface BatchSignItem {
  bucket: string;
  key: string;
  url?: string;
  expires_at?: string;
  error?: string;
}

function byteLength(body: UploadBody): number {
  if (typeof body === "string") return new TextEncoder().encode(body).length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return body.byteLength;
}

function inferContentType(body: UploadBody, explicit?: string): string {
  if (explicit) return explicit;
  if (body instanceof Blob && body.type) return body.type;
  if (typeof body === "string") return "text/plain;charset=utf-8";
  return "application/octet-stream";
}

/**
 * Object storage. Note: minting upload/sign URLs requires an **authenticated**
 * session (or a service-role key) — the anon key is rejected by the server.
 */
export class StorageClient {
  #ctx: ClientContext;

  constructor(ctx: ClientContext) {
    this.#ctx = ctx;
  }

  from(bucket: string): StorageBucketApi {
    return new StorageBucketApi(this.#ctx, bucket);
  }
}

export class StorageBucketApi {
  #ctx: ClientContext;
  #bucket: string;

  constructor(ctx: ClientContext, bucket: string) {
    this.#ctx = ctx;
    this.#bucket = bucket;
  }

  /**
   * Upload an object. Two hops under the hood: ask the server for a short-lived
   * SigV4 PUT URL (which validates bucket size/MIME policy), then stream the
   * bytes straight to MinIO. Returns the stored object's `path`.
   */
  async upload(
    path: string,
    body: UploadBody,
    opts: UploadOptions = {},
  ): Promise<Result<{ path: string }>> {
    try {
      const contentType = inferContentType(body, opts.contentType);
      const size = byteLength(body);

      const issued = await this.#post<UploadUrlResponse>(
        `/storage/v1/object/upload/${encodePath(this.#bucket)}/${encodePath(path)}`,
        { size, content_type: contentType },
      );

      // The signed URL carries its own auth (SigV4); send only Content-Type so
      // we don't disturb the canonical request MinIO recomputes.
      const put = await this.#ctx.fetch(issued.upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: body as BodyInit,
      });
      if (!put.ok) {
        const detail = await put.text().catch(() => "");
        throw new OneCodeError(`Upload failed (${put.status})`, {
          status: put.status,
          detail: detail || undefined,
        });
      }
      return { data: { path }, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  }

  /** Mint a time-limited signed GET URL for a single object. */
  async createSignedUrl(
    path: string,
    expiresIn = 3600,
  ): Promise<Result<{ signedUrl: string; expiresAt: string }>> {
    try {
      const res = await this.#post<SignResponse>(
        `/storage/v1/object/sign/${encodePath(this.#bucket)}/${encodePath(path)}`,
        { expires_in: expiresIn },
      );
      return {
        data: { signedUrl: res.url, expiresAt: res.expires_at },
        error: null,
      };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  }

  /** Mint signed GET URLs for many objects in one round-trip (max 100). */
  async createSignedUrls(
    paths: string[],
    expiresIn = 3600,
  ): Promise<Result<BatchSignItem[]>> {
    try {
      const res = await this.#post<{ items: BatchSignItem[] }>(
        `/storage/v1/object/sign-batch`,
        {
          items: paths.map((key) => ({ bucket: this.#bucket, key })),
          expires_in: expiresIn,
        },
      );
      return { data: res.items, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  }

  /** Download an object's bytes. Signs a URL, then GETs it. */
  async download(
    path: string,
    opts: { expiresIn?: number } = {},
  ): Promise<Result<Blob>> {
    const signed = await this.createSignedUrl(path, opts.expiresIn ?? 3600);
    if (signed.error) return { data: null, error: signed.error };
    try {
      const res = await this.#ctx.fetch(signed.data.signedUrl, { method: "GET" });
      if (!res.ok) {
        throw new OneCodeError(`Download failed (${res.status})`, {
          status: res.status,
        });
      }
      return { data: await res.blob(), error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  }

  async #post<T>(path: string, json: unknown): Promise<T> {
    const res = await this.#ctx.fetch(`${this.#ctx.url}${path}`, {
      method: "POST",
      headers: { ...authHeaders(this.#ctx), "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
    const body = await parseBody(res);
    if (!res.ok) throw errorFromBody(res, body);
    return body as T;
  }
}

function asError(e: unknown): OneCodeError {
  if (e instanceof OneCodeError) return e;
  if (e instanceof Error) return new OneCodeError(e.message);
  return new OneCodeError("Unknown error");
}
