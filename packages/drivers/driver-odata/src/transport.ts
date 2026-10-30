// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * HTTP to one OData service: authentication, timeout, same-origin links and
 * the error shape the engine's floor reads.
 *
 * ## What a failure looks like to the engine
 *
 * The floor (objectql `external-driver-floor.ts`) reads `status` on a thrown
 * error. So a response the service REFUSED is an {@link ODataRequestError}
 * carrying the HTTP status and the service's own message (`error.message` of
 * the OData error body): a 400 / 404 / 422 on a read reaches the caller as
 * `400 INVALID_QUERY`, a request-shaped 4xx on a write as
 * `422 EXTERNAL_WRITE_REFUSED`, and anything else — a 401, a 429, a 5xx — as
 * `503 ERR_DATASOURCE_UNAVAILABLE` with this message only in the server log.
 * A network failure, a timeout, and a credential that cannot be resolved throw
 * with no status at all, which the floor also answers 503.
 *
 * ⛔ No message built here carries the service URL, a header or a credential:
 * a read refusal's message may be shown to the caller.
 */

import type { ODataDialect } from './dialect.js';

/** The `fetch` this transport calls — the global one unless the host passes its own. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The auth scheme, as the config names it. */
export type ODataAuth = { scheme: 'none' } | { scheme: 'bearer' } | { scheme: 'basic'; username: string };

/** A refusal or failure answered by the service, with the HTTP status the engine's floor reads. */
export class ODataRequestError extends Error {
  readonly status: number;
  /** The OData error body's `code`, when the service sent one. Not an ADR-0112 code. */
  readonly odataCode?: string;

  constructor(message: string, status: number, odataCode?: string) {
    super(message);
    this.name = 'ODataRequestError';
    this.status = status;
    if (odataCode !== undefined) this.odataCode = odataCode;
  }
}

export interface ODataTransportOptions {
  serviceRoot: string;
  dialect: ODataDialect;
  auth: ODataAuth;
  requestTimeoutMs: number;
  pageSize: number;
  fetch?: FetchLike;
  /**
   * The secret behind the datasource's `external.credentialsRef`. Called at
   * the first request that needs it and again after a 401, never at boot.
   */
  credential?: () => Promise<string | undefined>;
}

export interface ODataResponse {
  status: number;
  headers: Headers;
  /** The parsed JSON body; the text when the body is not JSON; `undefined` when empty. */
  body: unknown;
}

export interface ODataRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: URL;
  /** What the request is about, for messages: an entity set name or `$metadata`. */
  subject: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Answer these statuses instead of throwing (e.g. 404 on a by-key read). */
  accept?: readonly number[];
  /** Read the body as text, not JSON (`$metadata`). */
  text?: boolean;
}

export class ODataTransport {
  readonly root: URL;
  private readonly opts: ODataTransportOptions;
  private readonly fetchImpl: FetchLike;
  private secret?: Promise<string | undefined>;

  constructor(opts: ODataTransportOptions) {
    this.opts = opts;
    this.root = new URL(opts.serviceRoot.endsWith('/') ? opts.serviceRoot : `${opts.serviceRoot}/`);
    const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (typeof fetchImpl !== 'function') {
      throw new Error('driver-odata: no fetch implementation is available; pass `fetch` in the driver options');
    }
    this.fetchImpl = fetchImpl;
  }

  /** A URL under the service root. */
  resolve(path: string): URL {
    return new URL(path, this.root);
  }

  /**
   * A link the service returned (`@odata.nextLink`, `Location`), resolved
   * against the request it came with. ⛔ A link to another origin is refused:
   * following it would send this datasource's credential to a host the
   * operator never configured.
   */
  followLink(link: string, base: URL): URL {
    const url = new URL(link, base);
    if (url.origin !== this.root.origin) {
      throw new Error('driver-odata: the service returned a link to another origin; it is not followed');
    }
    return url;
  }

  /** Forget the resolved credential, so the next request resolves it again. */
  reset(): void {
    this.secret = undefined;
  }

  async request(req: ODataRequest): Promise<ODataResponse> {
    let response = await this.send(req);
    if (response.status === 401 && this.opts.auth.scheme !== 'none') {
      // The credential may have been rotated in the secret store: resolve it once more.
      this.reset();
      response = await this.send(req);
    }
    const body = await readBody(response, req.text === true);
    if (response.ok || req.accept?.includes(response.status)) {
      return { status: response.status, headers: response.headers, body };
    }
    const { code, message } = this.opts.dialect.readError(body);
    throw new ODataRequestError(
      `OData service refused ${req.method} on '${req.subject}' (HTTP ${response.status})`
        + (message ? `: ${message}` : ''),
      response.status,
      code,
    );
  }

  private async send(req: ODataRequest): Promise<Response> {
    const headers: Record<string, string> = {
      ...this.opts.dialect.requestHeaders(),
      ...(req.text ? { Accept: 'application/xml' } : {}),
      ...(req.method === 'GET' && !req.text ? { Prefer: `odata.maxpagesize=${this.opts.pageSize}` } : {}),
      ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...req.headers,
    };
    const authorization = await this.authorization();
    if (authorization) headers.Authorization = authorization;
    try {
      return await this.fetchImpl(req.url.toString(), {
        method: req.method,
        headers,
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.opts.requestTimeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError'
        ? `timed out after ${this.opts.requestTimeoutMs} ms`
        : 'could not be reached';
      throw new Error(`driver-odata: ${req.method} on '${req.subject}' ${reason}`, { cause: error });
    }
  }

  private async authorization(): Promise<string | undefined> {
    const { auth } = this.opts;
    if (!this.opts.credential) {
      if (auth.scheme === 'none') return undefined;
      throw new Error(
        `driver-odata: auth scheme '${auth.scheme}' needs the datasource's external.credentialsRef, `
        + 'and no credential source was wired',
      );
    }
    // Asked even under `none`, so a source can refuse a declared credential the scheme would ignore.
    if (!this.secret) {
      const pending = this.opts.credential();
      this.secret = pending;
      // A failed resolution is not cached: the next request tries again.
      pending.catch(() => { if (this.secret === pending) this.secret = undefined; });
    }
    const secret = await this.secret;
    if (auth.scheme === 'none') return undefined;
    if (!secret) {
      this.secret = undefined;
      throw new Error(`driver-odata: the credential for auth scheme '${auth.scheme}' resolved to nothing`);
    }
    return auth.scheme === 'bearer'
      ? `Bearer ${secret}`
      : `Basic ${Buffer.from(`${auth.username}:${secret}`, 'utf8').toString('base64')}`;
  }
}

async function readBody(response: Response, asText: boolean): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  if (asText) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
