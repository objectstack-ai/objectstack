// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Connector, RetryConfig } from '@objectstack/spec/integration';
import { connectorFetchOptions } from '@objectstack/spec/integration';
import { resilientFetch } from '@objectstack/spec/shared';

/**
 * Generic REST connector — the reference *concrete* connector (ADR-0018
 * §Addendum). It produces a {@link Connector} definition plus the handler for
 * its one action, `request`, which the baseline `connector_action` node
 * dispatches to.
 *
 * Open-source scope: **static** auth only (`none` / `api-key` / `basic` /
 * `bearer`), with credentials supplied by the caller. OAuth2 token acquisition
 * and refresh, credential vaulting, and multi-tenant connection lifecycle are
 * the enterprise tier (see `../cloud/docs/design/connector-tiering.md`) and are
 * deliberately out of scope here.
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

/** Build the request URL from base + path + query, encoding query params. */
function buildUrl(baseUrl: string, path: string, query?: RestRequestInput['query']): string {
    const base = baseUrl.replace(/\/+$/, '');
    const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '';
    const url = new URL(base + suffix);
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
    auth: RestAuth,
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

export function createRestConnector(opts: RestConnectorOptions): RestConnectorBundle {
    const name = opts.name ?? 'rest';
    const auth: RestAuth = opts.auth ?? { type: 'none' };
    // Resolved once per connector, not per request: the policy is fixed for the
    // bundle's lifetime, and a declarative instance re-materializes (with a new
    // bundle) whenever the author edits it.
    const fetchOptions = connectorFetchOptions(
        { retryConfig: opts.retryConfig, requestTimeoutMs: opts.requestTimeoutMs },
        { fetchImpl: opts.fetchImpl },
    );

    const def: Connector = {
        name,
        label: opts.label ?? 'REST Connector',
        type: 'api',
        description: 'Generic REST/HTTP connector with static authentication.',
        icon: 'globe',
        authentication: auth,
        // Defaulted by ConnectorSchema; set explicitly so the literal satisfies
        // the (post-parse) Connector output type.
        status: 'active',
        enabled: true,
        requestTimeoutMs: opts.requestTimeoutMs ?? 30000,
        ...(opts.retryConfig === undefined ? {} : { retryConfig: opts.retryConfig }),
        actions: [
            {
                key: 'request',
                label: 'HTTP Request',
                description: 'Send an HTTP request to the connector\'s base URL with static auth applied.',
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

    async function request(input: Record<string, unknown>): Promise<Record<string, unknown>> {
        const req = input as RestRequestInput;
        const method = (req.method ?? 'GET').toUpperCase();
        const headers: Record<string, string> = { ...opts.defaultHeaders, ...req.headers };
        const query: Record<string, string | number | boolean | null | undefined> = { ...req.query };

        applyAuth(auth, headers, query);

        const url = buildUrl(opts.baseUrl, req.path ?? '', query);

        const hasBody = req.body !== undefined && method !== 'GET' && method !== 'HEAD';
        if (hasBody && headers['Content-Type'] === undefined && headers['content-type'] === undefined) {
            headers['Content-Type'] = 'application/json';
        }

        const response = await resilientFetch(url, {
            method,
            headers,
            body: hasBody ? JSON.stringify(req.body) : undefined,
        }, fetchOptions);

        // Parse JSON when advertised; fall back to text so non-JSON endpoints
        // don't throw.
        const contentType = response.headers.get('content-type') ?? '';
        const parsed = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

        return { status: response.status, ok: response.ok, body: parsed };
    }

    return { def, handlers: { request } };
}
