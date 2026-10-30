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

import {
  callWithBorrowedCredential,
  withoutBorrowedCredential,
  type BorrowedConnectorAuth,
  type ConnectorCredentialHandle,
} from '@objectstack/types';
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
  /**
   * The credential borrowed from the connector instance the datasource names
   * in `external.connector` (ADR-0015 D7), or `undefined` when it names none.
   * When it answers a handle, every request is sent through
   * `callWithBorrowedCredential` — refreshed on expiry, once on a 401, then a
   * 503 — and {@link credential} is not asked.
   */
  borrowed?: () => Promise<ConnectorCredentialHandle | undefined>;
}

/** Where one request carries its credential: a header, or (an API key declared that way) a query parameter. */
interface PresentedCredential {
  header?: readonly [string, string];
  query?: readonly [string, string];
}

/** A borrowed credential as the instance declares it is sent. */
function presentBorrowed(auth: BorrowedConnectorAuth): PresentedCredential {
  if (auth.type === 'bearer') return { header: ['Authorization', `Bearer ${auth.token}`] };
  if (auth.type === 'basic') {
    return { header: ['Authorization', `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`] };
  }
  return auth.paramName ? { query: [auth.paramName, auth.key] } : { header: [auth.headerName, auth.key] };
}

/** A 401 the borrowed-credential rule retries: its body is dropped, never read. */
function isUnauthorizedResponse(response: Response): boolean {
  if (response.status !== 401) return false;
  void response.body?.cancel().catch(() => {});
  return true;
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
    const borrowed = this.opts.borrowed ? await this.opts.borrowed() : undefined;
    let response: Response;
    let presented: BorrowedConnectorAuth | undefined;
    if (borrowed) {
      // [ADR-0015 D7] The connector instance's credential, by the one rule every
      // driver presents a borrowed credential through. A second 401 ends as its
      // 503, which the engine's floor answers ERR_DATASOURCE_UNAVAILABLE.
      response = await callWithBorrowedCredential(
        borrowed,
        (auth) => {
          presented = auth;
          return this.send(req, presentBorrowed(auth));
        },
        { isUnauthorized: isUnauthorizedResponse },
      );
    } else {
      response = await this.send(req, await this.authorization());
      if (response.status === 401 && this.opts.auth.scheme !== 'none') {
        // The credential may have been rotated in the secret store: resolve it once more.
        this.reset();
        response = await this.send(req, await this.authorization());
      }
    }
    const body = await readBody(response, req.text === true);
    if (response.ok || req.accept?.includes(response.status)) {
      return { status: response.status, headers: response.headers, body };
    }
    const refusal = this.opts.dialect.readError(body);
    // The upstream's own text can reach the caller (the floor answers a 400 /
    // 404 / 422 refusal with it), and a service that echoes the request URI
    // carries an API key presented as a query parameter: withheld first.
    const scrub = (text: string | undefined) => (text && presented ? withoutBorrowedCredential(text, presented) : text);
    const message = scrub(refusal.message);
    throw new ODataRequestError(
      `OData service refused ${req.method} on '${req.subject}' (HTTP ${response.status})`
        + (message ? `: ${message}` : ''),
      response.status,
      scrub(refusal.code),
    );
  }

  private async send(req: ODataRequest, credential: PresentedCredential | undefined): Promise<Response> {
    const headers: Record<string, string> = {
      ...this.opts.dialect.requestHeaders(),
      ...(req.text ? { Accept: 'application/xml' } : {}),
      ...(req.method === 'GET' && !req.text ? { Prefer: `odata.maxpagesize=${this.opts.pageSize}` } : {}),
      ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...req.headers,
    };
    if (credential?.header) headers[credential.header[0]] = credential.header[1];
    let url = req.url;
    if (credential?.query) {
      url = new URL(req.url);
      url.searchParams.set(credential.query[0], credential.query[1]);
    }
    try {
      return await this.fetchImpl(url.toString(), {
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

  private async authorization(): Promise<PresentedCredential | undefined> {
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
    return {
      header: ['Authorization', auth.scheme === 'bearer'
        ? `Bearer ${secret}`
        : `Basic ${Buffer.from(`${auth.username}:${secret}`, 'utf8').toString('base64')}`],
    };
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
