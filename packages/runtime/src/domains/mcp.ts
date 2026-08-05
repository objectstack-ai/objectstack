// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/mcp` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-9).
 * The MCP transport (JSON-RPC over HTTP) + the public `/mcp/skill`
 * SKILL.md download. The bridge exposes business actions as MCP tools via
 * the action-execution subsystem (PR-8); OAuth resource-metadata and
 * Fetch-Request normalization ride along as family helpers.
 */

import { isMcpServerEnabled } from '@objectstack/types';
import { MCP_OAUTH_SCOPES } from '@objectstack/spec/ai';
import { buildApiError } from '../error-envelope.js';
import * as actionExec from '../action-execution.js';
import { isSystemObjectName } from '../action-execution.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * The legacy branches matched `/mcp/skill` (exact or `?`-suffixed) BEFORE
 * the `/mcp` transport claimed everything else (exact, `/`, or `?` forms).
 * Entry order reproduces that precedence.
 */
export function createMcpDomains(deps: DomainHandlerDeps): DomainRoute[] {
    return [
        { prefix: '/mcp/skill', match: 'segment', handler: (req, context) => handleMcpSkillRequest(deps, req.method, context) },
        { prefix: '/mcp/skill?', handler: (req, context) => handleMcpSkillRequest(deps, req.method, context) },
        { prefix: '/mcp', match: 'segment', handler: (req, context) => handleMcpRequest(deps, req.body, context) },
        { prefix: '/mcp?', handler: (req, context) => handleMcpRequest(deps, req.body, context) },
    ];
}

/**
 * Handle an MCP request over the Streamable HTTP transport (`/mcp`).
 *
 * Gating + auth (fail-closed):
 *  - **default-on**: served unless `OS_MCP_SERVER_ENABLED=false` (single-env
 *    runtime; MCP is a core platform capability). Multi-tenant cloud
 *    overrides this gate per env. When opted out we return 404 so the
 *    surface isn't advertised.
 *  - **auth**: requires a principal already resolved by
 *    `resolveExecutionContext` (the `sys_api_key` Bearer/header path or a
 *    session). Anonymous → 401.
 *
 * Execution: the MCP runtime builds a stateless per-request server whose
 * object-CRUD tools run through {@link callData} bound to THIS request's
 * ExecutionContext — i.e. the exact permission + RLS path the REST API
 * uses. An external agent can never exceed the key's authority.
 */
export async function handleMcpRequest(deps: DomainHandlerDeps, body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    if (!isMcpServerEnabled()) {
        return { handled: true, response: deps.error('MCP server is not enabled for this environment', 404) };
    }
    const mcp: any = await deps.resolveService(context, 'mcp', context.environmentId);
    if (!mcp || typeof mcp.handleHttpRequest !== 'function') {
        return { handled: true, response: deps.error('MCP server is not available', 501) };
    }

    const ec = context.executionContext;
    if (!ec || (!ec.userId && !ec.isSystem)) {
        // Per the MCP authorization spec (RFC 9728 §5.1), a 401 from the
        // protected resource advertises where its metadata lives so an
        // OAuth-capable client can bootstrap discovery → DCR → PKCE.
        // Only advertised when the OAuth track is actually live (AS on +
        // TLS rule satisfied); API-key-only deployments return a plain 401.
        const resourceMetadataUrl = await getMcpResourceMetadataUrl(deps, context);
        const response = deps.error(
            resourceMetadataUrl
                ? 'Unauthorized: a valid OAuth access token or API key is required'
                : 'Unauthorized: a valid API key is required',
            401,
        ) as { status: number; body: any; headers?: Record<string, string> };
        if (resourceMetadataUrl) {
            response.headers = {
                'WWW-Authenticate':
                    `Bearer realm="ObjectStack MCP", resource_metadata="${resourceMetadataUrl}"`,
            };
        }
        return { handled: true, response };
    }

    // ── OAuth scope → tool-family enforcement (fail-closed, #2698) ──
    // `oauthScopes` is set ONLY for OAuth-token provenance. A token that
    // grants none of the MCP tool families gets 403 insufficient_scope
    // up front; a partial grant narrows the tool set at registration
    // time inside the MCP runtime. API-key / session principals
    // (`oauthScopes` undefined) keep the full principal-bound surface.
    const grantedScopes = Array.isArray((ec as any).oauthScopes)
        ? ((ec as any).oauthScopes as string[])
        : undefined;
    if (grantedScopes && !grantedScopes.some((s) => (MCP_OAUTH_SCOPES as readonly string[]).includes(s))) {
        const resourceMetadataUrl = await getMcpResourceMetadataUrl(deps, context);
        const response = deps.error(
            `Forbidden: the access token grants none of the MCP scopes (${MCP_OAUTH_SCOPES.join(', ')})`,
            403,
        ) as { status: number; body: any; headers?: Record<string, string> };
        response.headers = {
            'WWW-Authenticate':
                'Bearer error="insufficient_scope"' +
                `, scope="${MCP_OAUTH_SCOPES.join(' ')}"` +
                (resourceMetadataUrl ? `, resource_metadata="${resourceMetadataUrl}"` : ''),
        };
        return { handled: true, response };
    }

    // The MCP transport needs a Web-standard Request. The runtime HTTP
    // adapter may hand us a node/Hono-style req (plain `headers` object,
    // path-only `url`), so normalise it.
    const webRequest = toMcpWebRequest(deps, context.request, body);
    if (!webRequest) {
        return { handled: true, response: deps.error('MCP transport requires a standard HTTP request', 400) };
    }

    const bridge = buildMcpBridge(deps, context);
    let webRes: Response;
    try {
        webRes = await mcp.handleHttpRequest(webRequest, {
            bridge,
            parsedBody: body,
            // undefined = not scope-limited (API key / session); an array
            // narrows the registered tool families inside the MCP runtime.
            ...(grantedScopes ? { toolOptions: { grantedScopes } } : {}),
        });
    } catch (err: any) {
        return { handled: true, response: deps.errorFromThrown(err, 500) };
    }

    // Convert the transport's buffered Web Response into the dispatcher's
    // `{ status, headers, body }` shape (JSON-response mode → fully buffered).
    const headers: Record<string, string> = {};
    try { webRes.headers.forEach((v, k) => { headers[k] = v; }); } catch { /* no headers */ }
    const text = await webRes.text().catch(() => '');
    let responseBody: any = null;
    if (text) {
        const ct = headers['content-type'] ?? '';
        if (ct.includes('application/json')) {
            try { responseBody = JSON.parse(text); } catch { responseBody = text; }
        } else {
            responseBody = text;
        }
    }
    return { handled: true, response: { status: webRes.status, headers, body: responseBody } };
}

/**
 * `GET /mcp/skill` — the environment-customized portable Agent Skill
 * (`SKILL.md`), rendered by the MCP service (ADR-0036 Amendment C: ONE
 * generic skill; only the connection URL is environment-specific).
 *
 * Served PUBLIC like `/discovery`: the content is generic agent
 * instructions plus a URL the caller already knows — no schema, no
 * tenant data. Gated on the same default-on switch as the `/mcp` route
 * (404 when opted out, so the surface isn't advertised) and 501 when the
 * MCP plugin isn't loaded, mirroring `handleMcp`.
 */
export async function handleMcpSkillRequest(deps: DomainHandlerDeps, method: string, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    if (!isMcpServerEnabled()) {
        return { handled: true, response: deps.error('MCP server is not enabled for this environment', 404) };
    }
    if (method !== 'GET') {
        // Hand-rolled rather than `deps.error(...)` only because it carries an
        // `Allow` header; the BODY still goes through the one builder (#3842),
        // so this branch cannot drift back to a numeric `code`. The code is
        // DERIVED (`method_not_allowed`), not spelled here — the other two 405
        // sites (`domains/actions.ts`, `domains/keys.ts`) go through
        // `deps.error` and derive theirs, and one dispatcher answering the same
        // status two ways is the drift this issue is closing.
        return {
            handled: true,
            response: {
                status: 405,
                headers: { Allow: 'GET' },
                body: {
                    success: false,
                    error: buildApiError({
                        message: 'Method not allowed — use GET',
                        httpStatus: 405,
                    }),
                },
            },
        };
    }
    const mcp: any = await deps.resolveService(context, 'mcp', context.environmentId);
    if (!mcp || typeof mcp.renderSkill !== 'function') {
        return { handled: true, response: deps.error('MCP server is not available', 501) };
    }

    // Resolve this environment's MCP URL for the skill's Connect section:
    // the auth service owns the canonical value (base URL config); fall
    // back to deriving from the request host so the endpoint still works
    // when the auth plugin isn't loaded.
    let mcpUrl: string | undefined;
    try {
        // [#4127] Was `const authService: any`, which erased the slot's type
        // even after `resolveService` started returning it — the escape hatch
        // this batch closes. `getMcpResourceUrl` is declared on `IAuthService`
        // now, so `?.()` reads a declared optional capability (an auth provider
        // without MCP/OAuth support fills this slot legitimately) instead of
        // guessing at a method the contract never mentioned.
        const authService = await deps.resolveService(context, 'auth', context.environmentId);
        const url = authService?.getMcpResourceUrl?.();
        if (typeof url === 'string' && url) mcpUrl = url;
    } catch { /* fall through to host derivation */ }
    if (!mcpUrl) {
        try {
            const webReq = toMcpWebRequest(deps, context.request, undefined);
            const host = webReq?.headers.get('host');
            if (host) {
                const proto = webReq?.headers.get('x-forwarded-proto') || 'http';
                mcpUrl = `${proto}://${host}/api/v1/mcp`;
            }
        } catch { /* leave the documented placeholder in place */ }
    }

    const markdown: string = mcp.renderSkill({ mcpUrl });
    // Raw text must NOT ride the `response` channel — `sendResult` JSON-
    // encodes those bodies unconditionally. The `result` stream channel is
    // the one raw pipe through every adapter (string events are written
    // verbatim, custom headers honored), so serve the markdown as a
    // single-chunk "stream".
    return {
        handled: true,
        result: {
            type: 'stream',
            status: 200,
            contentType: 'text/markdown; charset=utf-8',
            headers: {
                'content-type': 'text/markdown; charset=utf-8',
                'content-disposition': 'inline; filename="SKILL.md"',
                // Same reasoning as /discovery (cloud#152): reflects mutable
                // runtime config (base URL), must never be edge-cached stale.
                'cache-control': 'no-store',
            },
            events: (async function* () {
                yield markdown;
            })(),
        },
    } as any;
}

/**
 * Absolute URL of the RFC 9728 protected-resource metadata for the MCP
 * endpoint, advertised via `WWW-Authenticate` (#2698). `null` when the
 * OAuth track is off — the auth service owns the decision (AS enabled +
 * OAuth 2.1 TLS rule), the dispatcher only relays it. Never throws.
 */
async function getMcpResourceMetadataUrl(deps: DomainHandlerDeps, context: HttpProtocolContext): Promise<string | null> {
    try {
        // [#4127] Same `: any` erasure as the skill route above; same fix.
        const authService = await deps.resolveService(context, 'auth', context.environmentId);
        const url = authService?.getMcpResourceMetadataUrl?.();
        return typeof url === 'string' && url ? url : null;
    } catch {
        return null;
    }
}

/**
 * Normalise the inbound request into a Web-standard `Request` for the MCP
 * transport. Accepts an already-Web `Request`, or a node/Hono-style req
 * (plain `headers` object, path-only `url`). Returns undefined only if the
 * shape is unusable. The body is carried separately via `parsedBody`, so a
 * GET/DELETE (no body) and a POST (JSON-RPC) both normalise cleanly.
 */
function toMcpWebRequest(_deps: DomainHandlerDeps, raw: any, parsedBody: any): Request | undefined {
    if (!raw) return undefined;
    // Already a Web Request.
    if (typeof raw.headers?.get === 'function' && typeof raw.url === 'string' && typeof raw.method === 'string') {
        return raw as Request;
    }
    try {
        const method = String(raw.method ?? 'POST').toUpperCase();

        // Normalise headers (plain object or Headers-like).
        const headers = new Headers();
        const h = raw.headers;
        if (h) {
            if (typeof h.forEach === 'function') {
                h.forEach((v: any, k: any) => { if (v != null) headers.set(String(k), String(v)); });
            } else {
                for (const k of Object.keys(h)) {
                    const v = (h as any)[k];
                    if (v != null) headers.set(k, Array.isArray(v) ? v.join(',') : String(v));
                }
            }
        }

        // Build an absolute URL (node req.url is path-only).
        let url: string;
        try {
            url = new URL(String(raw.url)).toString();
        } catch {
            const host = headers.get('host') || 'mcp.local';
            const path = typeof raw.url === 'string' && raw.url ? raw.url : '/api/v1/mcp';
            url = `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
        }

        const init: { method: string; headers: Headers; body?: string } = { method, headers };
        if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
            init.body = typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody ?? {});
        }
        return new Request(url, init);
    } catch {
        return undefined;
    }
}

/**
 * Build a principal-bound {@link McpDataBridge}: every method runs AS the
 * request's ExecutionContext through {@link callData} (RLS/permissions) and
 * the per-env metadata service. Keeps the MCP tool layer free of any direct
 * engine access.
 */
export function buildMcpBridge(deps: DomainHandlerDeps, context: HttpProtocolContext): any {
    const ec = context.executionContext;
    const envId = context.environmentId;
    const driver = (context as any).dataDriver;
    // [#5155] Both the facilities AND the request are bound here, once, so the
    // bridge's tool surface below reads exactly as it did — while every call it
    // makes stays pinned to THIS request's kernel.
    const callData = actionExec.callData.bind(null, deps, context);
    const getMeta = () => deps.resolveService(context, 'metadata', envId);

    return {
        listObjects: async () => {
            const meta: any = await getMeta();
            const objs: any[] = (await meta?.listObjects?.()) ?? [];
            return objs.map((o) => ({
                name: o.name,
                label: o.label ?? o.name,
                fieldCount: o.fields ? Object.keys(o.fields).length : undefined,
            }));
        },
        describeObject: async (name: string) => {
            const meta: any = await getMeta();
            const def: any = await meta?.getObject?.(name);
            if (!def) return null;
            const fields = def.fields ?? {};
            return {
                name: def.name,
                label: def.label ?? def.name,
                fields: Object.entries(fields).map(([k, f]: [string, any]) => ({
                    name: k,
                    type: f?.type,
                    label: f?.label ?? k,
                    required: f?.required ?? false,
                })),
                enableFeatures: def.enable ?? {},
            };
        },
        query: async (object: string, o: any) => {
            const query: any = {};
            if (o?.where) query.where = o.where;
            if (o?.fields) query.fields = o.fields;
            if (typeof o?.limit === 'number') query.limit = o.limit;
            if (typeof o?.offset === 'number') query.offset = o.offset;
            if (o?.orderBy) query.orderBy = o.orderBy;
            return await callData('query', { object, query }, driver, envId, ec);
        },
        get: async (object: string, id: string) => {
            const res: any = await callData('get', { object, id }, driver, envId, ec);
            return res?.record ?? res ?? null;
        },
        aggregate: async (object: string, o: any) => {
            // NOTE: `driver` (the raw per-env db driver) is deliberately NOT
            // passed — callData's aggregate branch resolves the ObjectQL
            // engine itself so the security middleware (RLS + FLS aggregate
            // gate) always runs. See the branch comment in callData.
            const res: any = await callData(
                'aggregate',
                {
                    object,
                    where: o?.where,
                    groupBy: o?.groupBy,
                    aggregations: o?.aggregations,
                    timezone: o?.timezone,
                },
                undefined,
                envId,
                ec,
            );
            return res?.rows ?? [];
        },
        create: async (object: string, data: any) =>
            await callData('create', { object, data }, driver, envId, ec),
        update: async (object: string, id: string, data: any) =>
            await callData('update', { object, id, data }, driver, envId, ec),
        remove: async (object: string, id: string) =>
            await callData('delete', { object, id }, driver, envId, ec),

        // ── Business-action surface (McpActionBridge) ──────────────
        // Resolution + dispatch flow through the framework's own action
        // mechanism (engine.executeAction / automation flow runner). All
        // gating is at INVOKE time — `ai.exposed` (author opt-in, #2849) +
        // the ADR-0066 D4 capability gate + record load under the caller's
        // RLS. Script/body handlers then run TRUSTED (see
        // buildActionEngineFacade); flows honour `runAs` with the caller's
        // identity forwarded. No `@objectstack/service-ai`.
        listActions: async () => {
            const meta: any = await getMeta();
            const hasAutomation = Boolean(await actionExec.resolveAutomationService(deps, context, envId));
            const out: any[] = [];
            for (const { action, objectName, obj } of await actionExec.collectActionDeclarations(deps, meta)) {
                if (!objectName || isSystemObjectName(objectName)) continue; // fail-closed on sys_*
                if (!actionExec.isHeadlessInvokableAction(deps, action, hasAutomation)) continue;
                // [#2849 / ADR-0011] MCP is an AI surface: only actions the
                // author explicitly opted in via `ai.exposed` are listed.
                // Fail-closed — bodies run as trusted code (see
                // buildActionEngineFacade), so author opt-in is the boundary.
                if (actionExec.actionAiExposureError(deps, action)) continue;
                // Hide actions the caller is not permitted to run.
                if (actionExec.actionPermissionError(deps, action, ec)) continue;
                out.push(actionExec.summarizeAction(deps, action, obj, objectName));
            }
            return out;
        },
        runAction: async (
            name: string,
            input: { objectName?: string; recordId?: string; params?: Record<string, unknown> },
        ) => actionExec.invokeBusinessAction(deps, context, name, input ?? {}, { driver, envId, ec, getMeta, callData }),
    };
}
