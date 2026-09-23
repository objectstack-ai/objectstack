// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Connector, RetryConfig } from '@objectstack/spec/integration';
import { connectorFetchOptions } from '@objectstack/spec/integration';
import { resilientFetch } from '@objectstack/spec/shared';

/**
 * OpenAPI connector generator — turns a declarative OpenAPI 3.x document into a
 * {@link Connector} definition + handler map (ADR-0023).
 *
 * Each OpenAPI operation maps to one connector action; a single generic handler
 * (closing over the operation's method + path template) drives one shared HTTP
 * request implementation. That transport mirrors `@objectstack/connector-rest`
 * (build URL from base+path+query, apply static auth, JSON-encode the body,
 * normalise the response to `{ status, ok, body }`) — kept inline so this package
 * stays self-contained, depending only on `@objectstack/core` + `@objectstack/spec`
 * like its sibling connectors. The output is an ordinary `type: 'api'` connector,
 * registered via `engine.registerConnector(def, handlers)` exactly like a
 * hand-written one — the registry, the `connector_action` node, the discovery
 * route, and the Studio palette never know it came from OpenAPI.
 *
 * Open-source scope: **static** auth only (`none` / `api-key` / `basic` /
 * `bearer`), with credentials supplied by the caller. Managed OAuth2, credential
 * vaulting, and per-tenant lifecycle are the enterprise tier (ADR-0015 / 0022).
 */

/** Static auth understood by the generated connector (the open-source subset). */
export type RestAuth = Extract<Connector['authentication'], { type: 'none' | 'api-key' | 'basic' | 'bearer' }>;

/** An action on a Connector definition (derived to avoid guessing export names). */
type ConnectorAction = NonNullable<Connector['actions']>[number];

/** Handler signature accepted by the connector registry (ADR-0018 §Addendum). */
type ConnectorHandler = (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>;

/** A connector definition paired with its action handlers, ready for registerConnector(). */
export interface OpenApiConnectorBundle {
    def: Connector;
    handlers: Record<string, ConnectorHandler>;
}

/** A free-form JSON Schema fragment (matches ConnectorAction input/outputSchema). */
export type JsonSchema = Record<string, unknown>;

/** Minimal subset of an OpenAPI 3.x document consumed by the generator.
 *  The caller is responsible for loading and de-referencing ($ref) the doc. */
export interface OpenApiDocument {
    openapi?: string;
    info?: { title?: string; description?: string; version?: string };
    servers?: { url: string }[];
    paths?: Record<string, OpenApiPathItem>;
    components?: { securitySchemes?: Record<string, OpenApiSecurityScheme> };
}

export interface OpenApiPathItem {
    [method: string]: OpenApiOperation | unknown;
}

export interface OpenApiOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: OpenApiParameter[];
    requestBody?: OpenApiRequestBody;
    responses?: Record<string, OpenApiResponse>;
}

export interface OpenApiParameter {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    description?: string;
    schema?: JsonSchema;
}

export interface OpenApiRequestBody {
    required?: boolean;
    description?: string;
    content?: Record<string, { schema?: JsonSchema }>;
}

export interface OpenApiResponse {
    description?: string;
    content?: Record<string, { schema?: JsonSchema }>;
}

export interface OpenApiSecurityScheme {
    type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
    name?: string;
    in?: 'header' | 'query' | 'cookie';
    scheme?: string;
}

/** Flattened view of a single operation, passed to the `include` predicate. */
export interface OperationInfo {
    operationId?: string;
    method: string;
    path: string;
    tags?: string[];
    summary?: string;
    description?: string;
}

/** Configuration for {@link createOpenApiConnector}. */
export interface OpenApiConnectorConfig {
    /** Connector machine name (snake_case). Defaults to a slug of info.title. */
    name?: string;
    /** Human-friendly label. Defaults to info.title (then name). */
    label?: string;
    /** Description. Defaults to info.description. */
    description?: string;
    /** Icon identifier for the Studio palette. Defaults to `globe`. */
    icon?: string;
    /** The parsed OpenAPI 3.x document (caller loads/derefs it). */
    document: OpenApiDocument;
    /** Override the base URL (else servers[0].url). */
    baseUrl?: string;
    /** Static auth with credentials. Defaults to `{ type: 'none' }`. */
    auth?: RestAuth;
    /** Headers merged into every request (request-level headers win). */
    defaultHeaders?: Record<string, string>;
    /** Only include operations for which this predicate returns true (allowlist). */
    include?: (op: OperationInfo) => boolean;
    /**
     * Retry policy for every generated action, executed by `resilientFetch`
     * (ADR-0049 · #18975). Omitted ⇒ the wrapper's own defaults.
     */
    retryConfig?: RetryConfig;
    /**
     * Declared connect deadline (ms). Carried onto the def so `GET /connectors`
     * reports what the author declared; ⚠️ not enforced — one `fetch` signal
     * cannot bound the connection phase alone (`connector-fetch-policy.ts`).
     */
    connectionTimeoutMs?: number;
    /** Per-request deadline (ms) — `resilientFetch`'s per-attempt timeout. */
    requestTimeoutMs?: number;
    /** Injected fetch implementation (defaults to global `fetch`). */
    fetchImpl?: typeof fetch;
}

/** OpenAPI HTTP method keys, in a deterministic order. */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'] as const;

/** Input passed to the shared request transport. */
interface RequestInput {
    method: string;
    path: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
}

/**
 * Build an OpenAPI connector definition and its handler map.
 *
 * @returns the `Connector` definition (`def`) and a `handlers` record keyed by
 * action key, suitable for `engine.registerConnector(def, handlers)`.
 */
export function createOpenApiConnector(config: OpenApiConnectorConfig): OpenApiConnectorBundle {
    const { document, include } = config;
    const auth: RestAuth = config.auth ?? { type: 'none' };
    // Through the shared wrapper, like the sibling connectors — a naked `fetch`
    // here was both unbounded (no timeout, no retry) and the one built-in HTTP
    // path an authored `retryConfig` could never reach. Resolved once per
    // connector; the policy is fixed for the bundle's lifetime.
    const fetchOptions = connectorFetchOptions(
        { retryConfig: config.retryConfig, requestTimeoutMs: config.requestTimeoutMs },
        { fetchImpl: config.fetchImpl },
    );
    const name = config.name ?? slug(document.info?.title ?? 'openapi_connector');
    const label = config.label ?? document.info?.title ?? titleize(name);
    const description = config.description ?? document.info?.description;
    const baseUrl = config.baseUrl ?? document.servers?.[0]?.url;
    if (!baseUrl) {
        throw new Error('createOpenApiConnector: no base URL — provide config.baseUrl or document.servers[0].url');
    }

    // One shared transport (mirrors connector-rest) reused by every action handler.
    async function request(input: RequestInput): Promise<Record<string, unknown>> {
        const method = input.method.toUpperCase();
        const headers: Record<string, string> = { ...config.defaultHeaders, ...input.headers };
        const query: Record<string, string> = { ...input.query };
        applyAuth(auth, headers, query);

        const url = buildUrl(baseUrl as string, input.path, query);
        const hasBody = input.body !== undefined && method !== 'GET' && method !== 'HEAD';
        if (hasBody && headers['Content-Type'] === undefined && headers['content-type'] === undefined) {
            headers['Content-Type'] = 'application/json';
        }

        const response = await resilientFetch(url, {
            method,
            headers,
            body: hasBody ? JSON.stringify(input.body) : undefined,
        }, fetchOptions);

        const contentType = response.headers.get('content-type') ?? '';
        const parsed = contentType.includes('application/json') ? await response.json() : await response.text();
        return { status: response.status, ok: response.ok, body: parsed };
    }

    const actions: ConnectorAction[] = [];
    const handlers: Record<string, ConnectorHandler> = {};
    const seenKeys = new Set<string>();

    for (const op of collectOperations(document)) {
        if (include && !include(toInfo(op))) continue;
        const key = uniqueKey(op.operationId ?? slug(`${op.method}_${op.path}`), seenKeys);

        actions.push({
            key,
            label: op.summary ?? titleize(key),
            description: op.description,
            inputSchema: buildInputSchema(op),
            outputSchema: buildOutputSchema(op),
        });

        handlers[key] = async (input: Record<string, unknown>) => {
            const req = input as { path?: unknown; query?: unknown; header?: unknown; body?: unknown };
            return request({
                method: op.method,
                path: interpolatePath(op.path, asRecord(req.path)),
                query: stringifyValues(asRecord(req.query)),
                headers: stringifyValues(asRecord(req.header)),
                body: req.body,
            });
        };
    }

    const def: Connector = {
        name,
        label,
        type: 'api',
        description,
        icon: config.icon ?? 'globe',
        authentication: auth,
        // Defaulted by ConnectorSchema; set explicitly so the literal satisfies
        // the (post-parse) Connector output type (mirrors connector-rest/mcp).
        status: 'active',
        enabled: true,
        connectionTimeoutMs: config.connectionTimeoutMs ?? 30000,
        requestTimeoutMs: config.requestTimeoutMs ?? 30000,
        ...(config.retryConfig === undefined ? {} : { retryConfig: config.retryConfig }),
        actions,
    };

    return { def, handlers };
}

interface Op extends OpenApiOperation {
    method: string;
    path: string;
}

/** Flatten paths × methods into a deterministic list of operations. */
function collectOperations(doc: OpenApiDocument): Op[] {
    const ops: Op[] = [];
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        for (const method of HTTP_METHODS) {
            const operation = record[method] as OpenApiOperation | undefined;
            if (!operation || typeof operation !== 'object') continue;
            ops.push({ ...operation, method, path });
        }
    }
    return ops;
}

function toInfo(op: Op): OperationInfo {
    return {
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        tags: op.tags,
        summary: op.summary,
        description: op.description,
    };
}

/**
 * Assemble the action inputSchema from an operation's parameters + requestBody.
 * Produces { type: 'object', properties: { path, query, header, body }, required }
 * where only non-empty sections are emitted.
 */
function buildInputSchema(op: OpenApiOperation): JsonSchema | undefined {
    const sections: Record<'path' | 'query' | 'header', { props: Record<string, JsonSchema>; required: string[] }> = {
        path: { props: {}, required: [] },
        query: { props: {}, required: [] },
        header: { props: {}, required: [] },
    };

    for (const p of op.parameters ?? []) {
        if (!p || typeof p !== 'object' || '$ref' in p) continue;
        if (p.in !== 'path' && p.in !== 'query' && p.in !== 'header') continue;
        const sec = sections[p.in];
        sec.props[p.name] = p.schema ?? (p.description ? { type: 'string', description: p.description } : { type: 'string' });
        if (p.required) sec.required.push(p.name);
    }

    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const where of ['path', 'query', 'header'] as const) {
        const sec = sections[where];
        if (Object.keys(sec.props).length === 0) continue;
        const schema: JsonSchema = { type: 'object', properties: sec.props };
        if (sec.required.length) schema.required = sec.required;
        properties[where] = schema;
        // Path params are always required when present; others only if any are.
        if (where === 'path' || sec.required.length) required.push(where);
    }

    const bodySchema = extractRequestBodySchema(op.requestBody);
    if (bodySchema) {
        properties.body = bodySchema;
        if (op.requestBody && !('$ref' in op.requestBody) && op.requestBody.required) required.push('body');
    }

    if (Object.keys(properties).length === 0) return undefined;
    const schema: JsonSchema = { type: 'object', properties };
    if (required.length) schema.required = required;
    return schema;
}

/** Pick the success response's JSON schema (200 → first 2xx → default). */
function buildOutputSchema(op: OpenApiOperation): JsonSchema | undefined {
    const responses = op.responses;
    if (!responses) return undefined;
    let code: string | undefined;
    if (responses['200']) code = '200';
    else code = Object.keys(responses).find((c) => /^2\d\d$/.test(c));
    if (!code && responses['default']) code = 'default';
    if (!code) return undefined;
    const resp = responses[code];
    if (!resp || typeof resp !== 'object' || '$ref' in resp) return undefined;
    return pickJsonSchema(resp.content);
}

/** Extract the requestBody JSON schema (prefers application/json). */
function extractRequestBodySchema(rb: OpenApiRequestBody | undefined): JsonSchema | undefined {
    if (!rb || typeof rb !== 'object' || '$ref' in rb) return undefined;
    return pickJsonSchema(rb.content);
}

/** Choose the application/json schema, falling back to the first content type. */
function pickJsonSchema(content: Record<string, { schema?: JsonSchema }> | undefined): JsonSchema | undefined {
    if (!content) return undefined;
    const chosen = content['application/json'] ?? Object.values(content)[0];
    return chosen?.schema;
}

/** Build the request URL from base + path + query, encoding query params. */
function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
    const base = baseUrl.replace(/\/+$/, '');
    const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '';
    const url = new URL(base + suffix);
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
}

/** Apply static auth to the outgoing headers / query (mirrors connector-rest). */
function applyAuth(auth: RestAuth, headers: Record<string, string>, query: Record<string, string>): void {
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

/** Interpolate {name} path templates with encoded values from the input. */
function interpolatePath(template: string, pathParams: Record<string, unknown>): string {
    return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
        const value = pathParams[key];
        return value === undefined || value === null ? `{${key}}` : encodeURIComponent(String(value));
    });
}

/** Coerce a record of mixed values into string values, dropping null/undefined. */
function stringifyValues(rec: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) {
        if (v === undefined || v === null) continue;
        out[k] = String(v);
    }
    return out;
}

/** Return v if it is a plain object, else an empty record. */
function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Ensure a deterministically unique action key within the connector. */
function uniqueKey(base: string, seen: Set<string>): string {
    let candidate = base;
    if (seen.has(candidate)) {
        let i = 2;
        while (seen.has(`${base}_${i}`)) i++;
        candidate = `${base}_${i}`;
    }
    seen.add(candidate);
    return candidate;
}

/** Slugify a string into a snake_case machine name (`/^[a-z_][a-z0-9_]*$/`). */
function slug(s: string): string {
    const out = s
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    if (!out) return 'connector';
    return /^[a-z_]/.test(out) ? out : `op_${out}`;
}

/** Title-case a snake_case key for a default label (`get_pets` → `Get Pets`). */
function titleize(name: string): string {
    return name
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}
