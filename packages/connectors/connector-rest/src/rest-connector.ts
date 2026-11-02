// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
    BorrowedConnectorAuth,
    Connector,
    ConnectorCredentialHandle,
    ConnectorRequestSigner,
    RetryConfig,
} from '@objectstack/spec/integration';
import { connectorFetchOptions, readConnectorResponse } from '@objectstack/spec/integration';
import { resilientFetch } from '@objectstack/spec/shared';
import { callWithBorrowedCredential, withoutBorrowedCredential } from '@objectstack/types';

/**
 * Generic REST connector — the reference *concrete* connector (ADR-0018
 * §Addendum). It produces a {@link Connector} definition plus the handler for
 * its one action, `request`, which the baseline `connector_action` node
 * dispatches to.
 *
 * Three ways to authenticate, one per request:
 *
 *   - **static** auth (`none` / `api-key` / `basic` / `bearer`), the credential
 *     supplied by the caller;
 *   - a **credential handle** (ADR-0143 D4) for a grant-bearing instance —
 *     `oauth2` or `app-credential`, open tier since ADR-0143 D1: the handle is
 *     asked on every request through `callWithBorrowedCredential`
 *     (`@objectstack/types`, the one copy of the call rule), so an expired
 *     token is refreshed before it is sent and an upstream `401` refreshes it
 *     once and retries once. The token itself is never held here;
 *
 *   - a **request signer** (ADR-0143 D2.3) instead of a credential: every
 *     attempt is signed by it — retries included — and its response
 *     verification, when the scheme has one, runs before a body is returned
 *     (`connectorFetchOptions` / `readConnectorResponse`, the one site for
 *     both built-in HTTP connectors).
 */

/** Auth config understood by the REST connector (the static subset). */
export type RestAuth = Extract<
    Connector['authentication'],
    { type: 'none' | 'api-key' | 'basic' | 'bearer' }
>;

export interface RestConnectorOptions {
    /** Connector machine name (snake_case). Defaults to `rest`. */
    name?: string;
    /** Human-readable label. Defaults to a title derived from `name`. */
    label?: string;
    /** Base URL prepended to each request's `path` (e.g. `https://api.example.com`). */
    baseUrl: string;
    /** Static authentication. Defaults to `{ type: 'none' }`. */
    auth?: RestAuth;
    /**
     * Per-request signer of a `signed` instance (ADR-0143 D2.3): signs every
     * attempt and verifies every response its scheme signs. Exclusive with a
     * static `auth` other than `none` — a request is authenticated one way.
     */
    requestSigner?: ConnectorRequestSigner;
    /**
     * Per-dispatch credential of a grant-bearing instance (ADR-0143 D4): asked
     * on every request, refreshed before an expired credential is sent and once
     * on an upstream `401`. Exclusive with a static `auth` other than `none`
     * and with `requestSigner` — a request is authenticated one way.
     */
    credentialHandle?: ConnectorCredentialHandle;
    /** Headers merged into every request (request-level headers win). */
    defaultHeaders?: Record<string, string>;
    /**
     * Retry policy for the `request` action, executed by `resilientFetch`
     * (ADR-0049 · #18975). Omitted ⇒ the wrapper's own defaults.
     */
    retryConfig?: RetryConfig;
    // `connectionTimeoutMs` — REMOVED with the spec key (ADR-0049). It was
    // accepted here only to be carried onto the def `GET /connectors` echoes:
    // one `fetch` signal cannot bound the connection phase alone, so it never
    // reached `connectorFetchOptions` and never bounded a call. Echoing a
    // deadline nobody keeps is what the retirement withdraws. A connect-only
    // bound belongs to a transport that can observe the connect phase.
    /** Per-request deadline (ms) — `resilientFetch`'s per-attempt timeout. */
    requestTimeoutMs?: number;
    /** Injected for tests; defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
}

/** Input accepted by the `request` action. */
export interface RestRequestInput {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    query?: Record<string, string | number | boolean | null | undefined>;
    body?: unknown;
}

/** A connector definition paired with its action handlers, ready for registerConnector(). */
export interface RestConnectorBundle {
    def: Connector;
    handlers: Record<
        string,
        (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>
    >;
}

/**
 * Build the request URL from base + path + query, encoding query params.
 *
 * The base is parsed first and its own query is lifted off before the path is
 * joined: a text join of `https://api.example.com/v1?region=eu` and `/items`
 * reads `…/v1?region=eu/items`, which sends every path-bearing action to `/v1`
 * with the path inside the `region` value. The path is then joined onto the
 * base's path with one slash between, exactly as before, so a base without a
 * query yields the same URL byte for byte, and a path can only ever land under
 * the base's origin: it is appended after the base's path, never resolved
 * against it, so `//other.example` or an absolute URL stays a path segment.
 *
 * The base's query parameters come back first, then the action's own: those
 * written inline in `path`, then `query` (auth's query parameter included).
 * **On a clash the action's value wins** — it is the more specific intent, and
 * refusing would break a working action the day its base gains the parameter.
 * A base fragment is left where the text join put it, as before.
 */
function buildUrl(baseUrl: string, path: string, query?: RestRequestInput['query']): string {
    const base = new URL(baseUrl);
    const baseParams = [...base.searchParams];
    base.search = '';
    const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '';
    const url = new URL(base.toString().replace(/\/+$/, '') + suffix);
    if (baseParams.length > 0) {
        const own = [...url.searchParams];
        const ownKeys = new Set(own.map(([key]) => key));
        const merged = new URLSearchParams(baseParams.filter(([key]) => !ownKeys.has(key)));
        for (const [key, value] of own) merged.append(key, value);
        url.search = merged.toString();
    }
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}

/**
 * Apply static auth to the outgoing headers / query. Returns possibly-extended
 * query so an `api-key` configured with `paramName` can ride the query string.
 */
function applyAuth(
    auth: RestAuth | BorrowedConnectorAuth,
    headers: Record<string, string>,
    query: Record<string, string | number | boolean | null | undefined>,
): void {
    switch (auth.type) {
        case 'none':
            return;
        case 'bearer':
            headers['Authorization'] = `Bearer ${auth.token}`;
            return;
        case 'basic': {
            const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
            headers['Authorization'] = `Basic ${encoded}`;
            return;
        }
        case 'api-key':
            if (auth.paramName) query[auth.paramName] = auth.key;
            else headers[auth.headerName ?? 'X-API-Key'] = auth.key;
            return;
    }
}

/**
 * The organization a dispatch runs in, read from the host's handler context
 * (`ConnectorActionContext.automation.tenantId` in
 * `@objectstack/service-automation`). A credential handle selects the
 * organization's connection by it (ADR-0143 Q1 = A); absent — a schedule, a
 * caller with no context — the handle answers as D4 rules for a run with none.
 */
function organizationOfDispatch(ctx: unknown): string | undefined {
    const tenantId = (ctx as { automation?: { tenantId?: unknown } } | null | undefined)?.automation?.tenantId;
    return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined;
}

export function createRestConnector(opts: RestConnectorOptions): RestConnectorBundle {
    const name = opts.name ?? 'rest';
    const auth: RestAuth = opts.auth ?? { type: 'none' };
    const ways = [
        auth.type !== 'none' ? `a static '${auth.type}' credential` : undefined,
        opts.requestSigner ? 'a request signer' : undefined,
        opts.credentialHandle ? 'a credential handle' : undefined,
    ].filter((w): w is string => w !== undefined);
    if (ways.length > 1) {
        throw new Error(
            `createRestConnector: connector '${name}' is given ${ways.join(' and ')}; ` +
                'a request is authenticated one way — pass one of them.',
        );
    }
    const handle = opts.credentialHandle;
    // Resolved once per connector, not per request: the policy is fixed for the
    // bundle's lifetime, and a declarative instance re-materializes (with a new
    // bundle) whenever the author edits it.
    const fetchOptions = connectorFetchOptions(
        { retryConfig: opts.retryConfig, requestTimeoutMs: opts.requestTimeoutMs },
        { fetchImpl: opts.fetchImpl },
        opts.requestSigner,
    );

    const def: Connector = {
        name,
        label: opts.label ?? 'REST Connector',
        type: 'api',
        description: 'Generic REST/HTTP connector.',
        icon: 'globe',
        authentication: auth,
        // Defaulted by ConnectorSchema; set explicitly so the literal satisfies
        // the (post-parse) Connector output type.
        // (`status: 'active'` stood here until the spec key was retired —
        // ADR-0049: nothing ever read it.)
        enabled: true,
        requestTimeoutMs: opts.requestTimeoutMs ?? 30000,
        ...(opts.retryConfig === undefined ? {} : { retryConfig: opts.retryConfig }),
        actions: [
            {
                key: 'request',
                label: 'HTTP Request',
                description: 'Send an HTTP request to the connector\'s base URL with the connector\'s authentication applied.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        method: { type: 'string', description: 'HTTP method (default GET)' },
                        path: { type: 'string', description: 'Path appended to the base URL' },
                        headers: { type: 'object', description: 'Per-request headers' },
                        query: { type: 'object', description: 'Query parameters' },
                        body: { description: 'Request body (JSON-encoded for non-GET)' },
                    },
                },
                outputSchema: {
                    type: 'object',
                    properties: {
                        status: { type: 'number' },
                        ok: { type: 'boolean' },
                        body: {},
                    },
                },
            },
        ],
    };

    async function request(input: Record<string, unknown>, ctx: unknown): Promise<Record<string, unknown>> {
        const req = input as RestRequestInput;
        const method = (req.method ?? 'GET').toUpperCase();

        /** One attempt, with the static auth or the credential the handle answered. */
        const send = (credential?: BorrowedConnectorAuth): Promise<Response> => {
            const headers: Record<string, string> = { ...opts.defaultHeaders, ...req.headers };
            const query: Record<string, string | number | boolean | null | undefined> = { ...req.query };
            applyAuth(credential ?? auth, headers, query);

            const url = buildUrl(opts.baseUrl, req.path ?? '', query);

            const hasBody = req.body !== undefined && method !== 'GET' && method !== 'HEAD';
            if (hasBody && headers['Content-Type'] === undefined && headers['content-type'] === undefined) {
                headers['Content-Type'] = 'application/json';
            }

            return resilientFetch(url, {
                method,
                headers,
                body: hasBody ? JSON.stringify(req.body) : undefined,
            }, fetchOptions);
        };

        // ADR-0143 D4 — ask the handle on every request; a `401` refreshes
        // once and retries once, a second `401` ends in the seam's `503`
        // refusal naming the instance. A thrown transport error is scrubbed
        // of the credential first: a query-parameter token rides the URL.
        const response = handle
            ? await callWithBorrowedCredential(handle, async (credential) => {
                try {
                    return await send(credential);
                } catch (err) {
                    if (err instanceof Error) err.message = withoutBorrowedCredential(err.message, credential);
                    throw err;
                }
            }, { organizationId: organizationOfDispatch(ctx) })
            : await send();

        // Parse JSON when advertised; fall back to text so non-JSON endpoints
        // don't throw. A signed instance's response is verified first, when
        // its scheme signs responses.
        return readConnectorResponse(response, opts.requestSigner);
    }

    return { def, handlers: { request } };
}
