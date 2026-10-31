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
 * Three ways to authenticate, one per connector (mirrors connector-rest):
 *
 *   - **static** auth (`none` / `api-key` / `basic` / `bearer`), the credential
 *     supplied by the caller;
 *   - a **credential handle** (ADR-0143 D4) for a grant-bearing instance —
 *     `oauth2` or `app-credential`, open tier since ADR-0143 D1 — asked on
 *     every request through `callWithBorrowedCredential` (`@objectstack/types`):
 *     an expired token is refreshed before it is sent, and an upstream `401`
 *     refreshes it once and retries once;
 *   - a **request signer** (ADR-0143 D2.3) instead of a credential: every
 *     attempt is signed by it — retries included — and its response
 *     verification, when the scheme has one, runs before a body is returned
 *     (`connectorFetchOptions` / `readConnectorResponse`, shared with
 *     `@objectstack/connector-rest`).
 *
 * **What the document's security says** (OpenAPI 3.x §4.8.27, §4.8.30), read
 * for a connector with a credential handle — the token comes from the
 * platform, so the document decides only where it is NOT sent and which
 * inputs it fills:
 *
 *   - an operation whose effective `security` is the empty list (`security:
 *     []` on the operation, or on the document with no operation override) is
 *     anonymous: its request carries no credential and never asks the handle,
 *     so a grant's token is not handed to an endpoint that never asked for one;
 *   - a header or query parameter an `apiKey` security scheme the operation
 *     requires names (`in` + `name` — a vendor token that rides a query
 *     parameter, WeCom's `access_token`) is the platform's to fill, so it is
 *     left out of the action's input schema, as `Authorization` is for an
 *     `oauth2`, `openIdConnect` or `http` scheme.
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
    /** The document-wide security requirement (§4.8.1); an operation's own `security` replaces it. */
    security?: OpenApiSecurityRequirement[];
}

/**
 * One Security Requirement Object (§4.8.30): scheme name → required scopes.
 * The operation's list is alternatives; `{}` in it makes the security optional.
 */
export type OpenApiSecurityRequirement = Record<string, string[]>;

export interface OpenApiPathItem {
    /** Parameters shared by every operation under this path (OpenAPI 3.x Path Item Object). */
    parameters?: OpenApiParameter[];
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
    /** This operation's security requirement, replacing the document's; `[]` = anonymous. */
    security?: OpenApiSecurityRequirement[];
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
    type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS';
    name?: string;
    in?: 'header' | 'query' | 'cookie';
    scheme?: string;
    bearerFormat?: string;
    /** `oauth2` only (§4.8.28): the flows the scheme supports. */
    flows?: Record<string, OpenApiOAuthFlow | undefined>;
    openIdConnectUrl?: string;
}

/** One OAuth Flow Object (§4.8.29). */
export interface OpenApiOAuthFlow {
    authorizationUrl?: string;
    tokenUrl?: string;
    refreshUrl?: string;
    scopes?: Record<string, string>;
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
    /**
     * Per-request signer of a `signed` instance (ADR-0143 D2.3): signs every
     * attempt and verifies every response its scheme signs. Exclusive with a
     * static `auth` other than `none` — a request is authenticated one way.
     */
    requestSigner?: ConnectorRequestSigner;
    /**
     * Per-dispatch credential of a grant-bearing instance (ADR-0143 D4): asked
     * on every request an operation that is not anonymous sends. Exclusive with
     * a static `auth` other than `none` and with `requestSigner`.
     */
    credentialHandle?: ConnectorCredentialHandle;
    /** Headers merged into every request (request-level headers win). */
    defaultHeaders?: Record<string, string>;
    /** Only include operations for which this predicate returns true (allowlist). */
    include?: (op: OperationInfo) => boolean;
    /**
     * Retry policy for every generated action, executed by `resilientFetch`
     * (ADR-0049 · #18975). Omitted ⇒ the wrapper's own defaults.
     */
    retryConfig?: RetryConfig;
    // `connectionTimeoutMs` — REMOVED with the spec key (ADR-0049). It was
    // accepted here only to be carried onto the def `GET /connectors` echoes:
    // one `fetch` signal cannot bound the connection phase alone, so it never
    // reached `connectorFetchOptions` and never bounded a call. Echoing a
    // deadline nobody keeps is what the retirement withdraws (mirrors
    // connector-rest).
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
        config.requestSigner,
    );
    const name = config.name ?? slug(document.info?.title ?? 'openapi_connector');
    const label = config.label ?? document.info?.title ?? titleize(name);
    const description = config.description ?? document.info?.description;
    const baseUrl = config.baseUrl ?? document.servers?.[0]?.url;
    if (!baseUrl) {
        throw new Error('createOpenApiConnector: no base URL — provide config.baseUrl or document.servers[0].url');
    }
    const ways = [
        auth.type !== 'none' ? `a static '${auth.type}' credential` : undefined,
        config.requestSigner ? 'a request signer' : undefined,
        config.credentialHandle ? 'a credential handle' : undefined,
    ].filter((w): w is string => w !== undefined);
    if (ways.length > 1) {
        throw new Error(
            `createOpenApiConnector: connector '${name}' is given ${ways.join(' and ')}; ` +
                'a request is authenticated one way — pass one of them.',
        );
    }
    const handle = config.credentialHandle;

    // One shared transport (mirrors connector-rest) reused by every action handler.
    async function request(input: RequestInput, ctx: unknown, anonymous: boolean): Promise<Record<string, unknown>> {
        const method = input.method.toUpperCase();

        /** One attempt, with the static auth or the credential the handle answered. */
        const send = (credential?: BorrowedConnectorAuth): Promise<Response> => {
            const headers: Record<string, string> = { ...config.defaultHeaders, ...input.headers };
            const query: Record<string, string> = { ...input.query };
            applyAuth(credential ?? auth, headers, query);

            const url = buildUrl(baseUrl as string, input.path, query);
            const hasBody = input.body !== undefined && method !== 'GET' && method !== 'HEAD';
            if (hasBody && headers['Content-Type'] === undefined && headers['content-type'] === undefined) {
                headers['Content-Type'] = 'application/json';
            }

            return resilientFetch(url, {
                method,
                headers,
                body: hasBody ? JSON.stringify(input.body) : undefined,
            }, fetchOptions);
        };

        // ADR-0143 D4 — ask the handle on every request an operation that
        // requires security sends; a `401` refreshes once and retries once. A
        // thrown transport error is scrubbed of the credential first.
        const response = handle && !anonymous
            ? await callWithBorrowedCredential(handle, async (credential) => {
                try {
                    return await send(credential);
                } catch (err) {
                    if (err instanceof Error) err.message = withoutBorrowedCredential(err.message, credential);
                    throw err;
                }
            }, { organizationId: organizationOfDispatch(ctx) })
            : await send();

        // A signed instance's response is verified first, when its scheme
        // signs responses.
        return readConnectorResponse(response, config.requestSigner);
    }

    const actions: ConnectorAction[] = [];
    const handlers: Record<string, ConnectorHandler> = {};
    const seenKeys = new Set<string>();

    for (const op of collectOperations(document)) {
        if (include && !include(toInfo(op))) continue;
        const key = uniqueKey(operationActionKey(op), seenKeys);
        const security = effectiveSecurity(op, document);
        const anonymous = security !== undefined && security.length === 0;

        actions.push({
            key,
            label: op.summary ?? titleize(key),
            description: op.description,
            inputSchema: buildInputSchema(op, auth, handle && !anonymous ? schemeFilledParameters(security, document) : new Set()),
            outputSchema: buildOutputSchema(op),
        });

        handlers[key] = async (input: Record<string, unknown>, ctx: unknown) => {
            const req = input as { path?: unknown; query?: unknown; header?: unknown; body?: unknown };
            return request({
                method: op.method,
                path: interpolatePath(op.path, asRecord(req.path)),
                query: stringifyValues(asRecord(req.query)),
                headers: stringifyValues(asRecord(req.header)),
                body: req.body,
            }, ctx, anonymous);
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
        // (`status: 'active'` stood here until the spec key was retired —
        // ADR-0049: nothing ever read it.)
        enabled: true,
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

/**
 * The organization a dispatch runs in, read from the host's handler context
 * (`ConnectorActionContext.automation.tenantId` in
 * `@objectstack/service-automation`). A credential handle selects the
 * organization's connection by it (ADR-0143 Q1 = A); absent, the handle
 * answers as D4 rules for a run with none.
 */
function organizationOfDispatch(ctx: unknown): string | undefined {
    const tenantId = (ctx as { automation?: { tenantId?: unknown } } | null | undefined)?.automation?.tenantId;
    return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined;
}

/**
 * The operation's effective security requirement (§4.8.10 `security`): its
 * own list, else the document's, else `undefined` — the document says nothing.
 * A list that is not an array reads as saying nothing, never as anonymous.
 */
function effectiveSecurity(op: OpenApiOperation, doc: OpenApiDocument): OpenApiSecurityRequirement[] | undefined {
    const own = (op as { security?: unknown }).security;
    if (Array.isArray(own)) return own as OpenApiSecurityRequirement[];
    const shared = (doc as { security?: unknown }).security;
    return Array.isArray(shared) ? (shared as OpenApiSecurityRequirement[]) : undefined;
}

/**
 * The parameters (`header:<name lower-cased>` / `query:<name>`) that the
 * `apiKey` schemes `security` names place the credential in — filled by the
 * platform, never by the flow's input. A scheme the document does not declare
 * fills nothing.
 */
function schemeFilledParameters(security: OpenApiSecurityRequirement[] | undefined, doc: OpenApiDocument): Set<string> {
    const filled = new Set<string>();
    const schemes = doc.components?.securitySchemes ?? {};
    for (const requirement of security ?? []) {
        if (!requirement || typeof requirement !== 'object') continue;
        for (const schemeName of Object.keys(requirement)) {
            const scheme = Object.prototype.hasOwnProperty.call(schemes, schemeName) ? schemes[schemeName] : undefined;
            if (!scheme || scheme.type !== 'apiKey' || typeof scheme.name !== 'string') continue;
            if (scheme.in === 'header') filled.add(`header:${scheme.name.toLowerCase()}`);
            else if (scheme.in === 'query') filled.add(`query:${scheme.name}`);
        }
    }
    return filled;
}

/**
 * Flatten paths × methods into a deterministic list of operations, each
 * carrying its path item's shared `parameters` (see {@link mergeParameters}).
 */
function collectOperations(doc: OpenApiDocument): Op[] {
    const ops: Op[] = [];
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const shared = Array.isArray(record.parameters) ? (record.parameters as OpenApiParameter[]) : [];
        for (const method of HTTP_METHODS) {
            const operation = record[method] as OpenApiOperation | undefined;
            if (!operation || typeof operation !== 'object') continue;
            ops.push({ ...operation, parameters: mergeParameters(shared, operation.parameters), method, path });
        }
    }
    return ops;
}

/**
 * The OpenAPI 3.x rule for a Path Item's `parameters`: they apply to every
 * operation under the path, and an operation entry with the same `name` + `in`
 * overrides the path-level one whole. A `$ref` entry has no `name` / `in` to
 * match on, so it is kept as is — the caller de-references the document, and
 * {@link buildInputSchema} skips an unresolved one exactly as it does an
 * operation-level `$ref`.
 */
function mergeParameters(
    shared: readonly OpenApiParameter[],
    own: OpenApiParameter[] | undefined,
): OpenApiParameter[] | undefined {
    if (shared.length === 0) return own;
    const ownList = Array.isArray(own) ? own : [];
    // `in` is a closed vocabulary with no ':' in it, so `in:name` is unambiguous.
    const key = (p: OpenApiParameter): string | undefined =>
        p && typeof p === 'object' && !('$ref' in p) ? `${p.in}:${p.name}` : undefined;
    const overridden = new Set(ownList.map(key));
    return [...shared.filter((p) => key(p) === undefined || !overridden.has(key(p))), ...ownList];
}

/**
 * The action key an operation generates: its `operationId`, else the
 * `method_path` slug (`get /pets/{id}` → `get_pets_id`). The one derivation of
 * that key — the generator keys its actions with it (before the collision
 * suffix {@link uniqueKey} adds), and the declarative `openapi` provider's
 * `providerConfig.include` matches its entries against it, so an allowlist
 * entry and the action it admits can never be spelled two ways.
 */
export function operationActionKey(op: Pick<OperationInfo, 'operationId' | 'method' | 'path'>): string {
    return op.operationId ?? slug(`${op.method}_${op.path}`);
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
 * Header parameters OAS 3.0.3 §4.7.12.1 says SHALL be ignored, compared
 * lower-cased: the transport sets `Content-Type`, and `applyAuth` sets
 * `Authorization`, so a value the input supplied could never take effect.
 */
const IGNORED_HEADER_PARAMETERS = new Set(['accept', 'content-type', 'authorization']);

/**
 * Assemble the action inputSchema from an operation's parameters + requestBody.
 * Produces { type: 'object', properties: { path, query, header, body }, required }
 * where only non-empty sections are emitted.
 *
 * #27995 — the `connector_action` executor now refuses a call whose input
 * breaks this schema, so it must not demand what the caller cannot supply:
 * the ignored header parameters above, and the header or query parameter
 * the connector's own `auth` fills (the credential never belongs in a
 * flow's `connectorConfig.input`), are left out of it — and so, for a
 * connector with a credential handle, is every parameter an `apiKey` security
 * scheme the operation requires places the token in (`schemeFilled`).
 */
function buildInputSchema(op: OpenApiOperation, auth: RestAuth, schemeFilled: ReadonlySet<string>): JsonSchema | undefined {
    const sections: Record<'path' | 'query' | 'header', { props: Record<string, JsonSchema>; required: string[] }> = {
        path: { props: {}, required: [] },
        query: { props: {}, required: [] },
        header: { props: {}, required: [] },
    };
    const authHeader = auth.type === 'api-key' && !auth.paramName ? (auth.headerName ?? 'X-API-Key').toLowerCase() : undefined;
    const authQuery = auth.type === 'api-key' ? auth.paramName : undefined;

    for (const p of op.parameters ?? []) {
        if (!p || typeof p !== 'object' || '$ref' in p) continue;
        if (p.in !== 'path' && p.in !== 'query' && p.in !== 'header') continue;
        if (p.in === 'header' && (IGNORED_HEADER_PARAMETERS.has(p.name.toLowerCase()) || p.name.toLowerCase() === authHeader)) continue;
        if (p.in === 'query' && authQuery !== undefined && p.name === authQuery) continue;
        if (schemeFilled.has(p.in === 'header' ? `header:${p.name.toLowerCase()}` : `${p.in}:${p.name}`)) continue;
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
function applyAuth(auth: RestAuth | BorrowedConnectorAuth, headers: Record<string, string>, query: Record<string, string>): void {
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
