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
import type { MetadataProtocol } from '@objectstack/spec/api';
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
 * [#8726] The protocol layer's overlay-aware merged read, as this package can
 * name it.
 *
 * ⚠️ **Deliberately `Pick`ed from the DECLARED contract rather than restated.**
 * `packages/mcp` declares its own `McpMergedMetadataRead` for the stdio half of
 * #8328, and the obvious move here was to import that. It is not reachable:
 * `@objectstack/mcp` re-exports only `MCPServerRuntime` + its config type from
 * its package index, and `@objectstack/runtime` deliberately carries **no**
 * `@objectstack/mcp` dependency at all — the MCP service is resolved by name
 * and the bridge is duck-typed precisely so any host can mount the dispatcher
 * without that package (the same property `@objectstack/rest` relies on).
 *
 * So this points at what `McpMergedMetadataRead` itself duck-types: the
 * `MetadataProtocol` contract in `@objectstack/spec`, which
 * `ObjectStackProtocolImplementation` declares `implements`. That is the
 * "one rule, one place" the divergence rule is protecting — a `Pick` from the
 * contract cannot drift from it, where a second hand-written `getMetaItems(…)`
 * signature silently could.
 */
type McpMergedMetadataRead = Pick<MetadataProtocol, 'getMetaItems'>;

/**
 * [#8726] Read this environment's `skill` rows through the merged listing.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * This read was `metadataService.list('skill')` — the registry/loader listing,
 * one layer BELOW where any `sys_metadata` overlay merging happens. So
 * `PUT /api/v1/meta/skill/<name>` with `{active:true}` returned 200, `GET
 * /api/v1/meta/skill` served the flip from the merged read, and MCP prompts on
 * this endpoint never saw it. Two surfaces, one skill name, two answers.
 *
 * The maintainer's ruling on #8328 (2026-08-13, option 3) is that the consumer
 * moves up to the protocol's merged read — ⛔ NOT that the overlay merge is
 * pushed down into `MetadataService.list()` for every consumer, which is a
 * wider contract change archived unscheduled as #8722.
 *
 * ── Absent vs. degraded vs. failed — three outcomes, deliberately ─────────
 *
 * 1. **No merged read on this host** → the pre-#8726 registry listing,
 *    unchanged, including its `?? []` for a host with no metadata service at
 *    all. Structural absence is not degradation: a host that assembles this
 *    runtime without the metadata protocol has no merged read to offer, so
 *    there is nothing to have skipped. This is the same branch
 *    `packages/mcp`'s `mergedDiagnosedList` takes for the stdio half.
 * 2. **Merged read answers, metadata service known-partial** → the items are
 *    served with #6504's verdict reported to the operator. See
 *    {@link warnIfSkillListIncomplete}.
 * 3. **Merged read THROWS** → ⛔ NO fallback to the un-merged listing. The
 *    throw travels to the MCP client as a JSON-RPC error. Falling back would
 *    answer registry rows in the shape of merged ones — this exact defect,
 *    restored silently at the moment the overlay store is unreadable, which is
 *    precisely when an overlay is most likely to be the thing being missed.
 *    `getMetaItems` already answers registry-only for the one benign case (a
 *    `sys_metadata` table not provisioned yet); anything it raises past that
 *    means overlay rows may exist and were not seen. Per AGENTS.md
 *    "Degradation log levels", a failure handed to the CALLER is not a
 *    degradation at all — the requester was told — so this branch logs nothing.
 *
 * `organizationId` is deliberately NOT threaded: `skill` is declared
 * `allowOrgOverride: false`, so the runtime write path lands its rows env-wide
 * and `getMetaItems` reads env-wide rows unconditionally. Passing the active
 * org would ask for a per-org overlay this type has no write channel for.
 */
async function readMergedSkillRows(
    deps: DomainHandlerDeps,
    protocol: McpMergedMetadataRead | undefined | null,
    getMeta: () => Promise<any>,
): Promise<unknown[]> {
    if (!protocol || typeof protocol.getMetaItems !== 'function') {
        const meta: any = await getMeta();
        return (await meta?.list?.('skill')) ?? [];
    }
    const answer = await protocol.getMetaItems({ type: 'skill' });
    // The declared `GetMetaItemsResponse` is `{ type, items }`, and the two
    // other `getMetaItems` consumers in this package read `res.items` the same
    // way. The bare-array arm matches what `packages/mcp` accepts for the stdio
    // half of this same read: the slot is filled by name from a host-owned
    // registry, and the two surfaces answering one question must not disagree
    // about the shape they accept.
    const items = Array.isArray(answer)
        ? (answer as unknown[])
        : Array.isArray(answer?.items)
            ? answer.items
            : [];
    await warnIfSkillListIncomplete(deps, getMeta, items.length);
    return items;
}

/**
 * [#8726] Report #6504's completeness verdict for the skill prompt surface.
 *
 * This read never had a diagnosed wrapper at all — unlike the stdio bridge,
 * where #6504 had already landed one — so a known-partial skill surface
 * presented as a complete one. Closing that is a gap closed, not a contract
 * preserved.
 *
 * The verdict has to be asked of the metadata service DIRECTLY rather than
 * taken from the merged read: `getMetaItems` swallows a MetadataService read
 * failure into its own `catch` and returns a merged list either way, so
 * sourcing completeness from it would spend the contract while looking clean.
 * The question stays addressed to the same set the items came from — the merged
 * list is the overlay layer ON TOP of exactly this listing.
 *
 * `warn`, not `error`, per AGENTS.md "Degradation log levels": the prompt
 * surface is *visibly* smaller than the environment declares and the next
 * client to look finds out. Nothing claims to have persisted and did not.
 *
 * ⚠️ Unlike the stdio half's boot-time snapshot this runs **per request**, so a
 * loader outage prints per MCP call rather than once. That is the honest rate:
 * each of those requests really did serve a short prompt list to a client that
 * was told nothing. It also means the surface self-heals the moment the loader
 * does — which is why the line says the outage is current rather than pinned at
 * boot, the one thing the stdio wording could not say.
 *
 * A verdict probe that THROWS must not fail a read whose items already
 * succeeded — that would be a new failure mode bought with pure observability.
 * It is reported as "could not be determined", never flattened into a
 * completeness claim this code did not earn.
 */
async function warnIfSkillListIncomplete(
    deps: DomainHandlerDeps,
    getMeta: () => Promise<any>,
    readable: number,
): Promise<void> {
    const logger = deps.logger ?? console;
    let degraded = false;
    let errors: string[] = [];
    try {
        const meta: any = await getMeta();
        if (!meta || typeof meta.listDiagnosed !== 'function') return;
        const diagnosed: any = await meta.listDiagnosed('skill');
        degraded = diagnosed?.degraded === true;
        errors = Array.isArray(diagnosed?.errors) ? diagnosed.errors : [];
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
            '[MCP] skill prompt list completeness could not be determined — the metadata service\'s '
                + 'diagnosed read failed, so this surface may be short without saying so. The skills it DID '
                + 'read are served normally. Fix: check the loaders behind the metadata service '
                + `(datasource connection, credentials, table). Cause: ${message}`,
            { readable },
        );
        return;
    }
    if (!degraded) return;
    logger.warn(
        '[MCP] skill prompt list is INCOMPLETE — the metadata service could not be fully read, so skills '
            + 'held by the unreadable loader(s) are missing from this surface. They are missing, NOT '
            + 'undeclared: an MCP client listing prompts on this request sees fewer than this environment '
            + 'declares. The HTTP transport rebuilds per request, so this surface recovers on the first '
            + 'request after the loader does — an outage reported here is current, not pinned at boot. '
            + 'Fix: check the loaders behind the metadata service (datasource connection, credentials, table).',
        { readable, errors },
    );
}

/**
 * Build a principal-bound {@link McpDataBridge}: every method runs AS the
 * request's ExecutionContext through {@link callData} (RLS/permissions) and
 * the per-env metadata service. Keeps the MCP tool layer free of any direct
 * engine access.
 *
 * Also carries the action seam (`listActions` / `runAction`) and the skill seam
 * (`listSkills`, #3905) the MCP runtime wires by capability.
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

    const listObjectSummaries = async (): Promise<any[]> => {
        const meta: any = await getMeta();
        const objs: any[] = (await meta?.listObjects?.()) ?? [];
        return objs.map((o) => ({
            name: o.name,
            label: o.label ?? o.name,
            fieldCount: o.fields ? Object.keys(o.fields).length : undefined,
        }));
    };

    return {
        listObjects: listObjectSummaries,
        /**
         * [#6504] The HTTP transport's half of the `list_objects` completeness
         * fix — the stdio bridge (`packages/mcp/src/stdio-data-bridge.ts`)
         * carries the identical member, because the tool that renders
         * `totalCount` is shared and a claim must not depend on which transport
         * the client happened to connect over.
         *
         * `McpDataBridge` declares this member OPTIONAL, so implementing it here
         * is what makes the tool's degraded branch reachable on this transport.
         * The items come from the resolver directly above; only the verdict is
         * asked of `listDiagnosed('object')`, the member declared to answer it
         * — `listObjects` claims no equivalence to `list('object')`, and
         * presuming one at a consumer is the private dialect Prime Directive #12
         * forbids. A metadata service predating `listDiagnosed` reports nothing
         * degraded, which is exactly what it could express, and the tool then
         * renders precisely what it rendered before.
         *
         * ⚠️ The verdict probe must not fail a read whose items already
         * succeeded: a throw here would trade a working `list_objects` for
         * observability. It is swallowed into "not degraded" — the same
         * direction `warnIfSkillListIncomplete` takes above, and the only one
         * that cannot manufacture a claim.
         */
        listObjectsDiagnosed: async () => {
            const objects = await listObjectSummaries();
            const meta: any = await getMeta();
            if (!meta || typeof meta.listDiagnosed !== 'function') {
                return { objects, degraded: false, errors: [] };
            }
            try {
                const diagnosed: any = await meta.listDiagnosed('object');
                return {
                    objects,
                    degraded: diagnosed?.degraded === true,
                    errors: Array.isArray(diagnosed?.errors) ? diagnosed.errors : [],
                };
            } catch {
                return { objects, degraded: false, errors: [] };
            }
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

        // ── Skill metadata → MCP prompts (#3905) ──────────────────
        // ADR-0063 §2 names skills the only third-party extension primitive,
        // and the open distribution is MCP-only (BYO-AI): without this read the
        // type is authorable, lint-validated and consumed by nothing here. The
        // MCP runtime projects each skill's `instructions` onto the `prompts`
        // primitive; the tool-binding half stays cloud-runtime-only.
        //
        // Resolved through THIS request's per-environment services — the same
        // seam `listObjects` / `describeObject` use — so a multi-tenant host
        // serves each environment its own skills. Metadata, not row data: no
        // ExecutionContext filtering, exactly like `describeObject` (the MCP
        // route itself is authenticated).
        //
        // [#8726] Through the protocol layer's MERGED listing — the second half
        // of #8328, whose own reproduction runs through THIS endpoint. See
        // {@link readMergedSkillRows}.
        listSkills: async () => {
            // Resolved per request on the SAME per-environment seam `getMeta`
            // uses — never captured once at boot, which would serve one
            // environment's overlay rows to every other one.
            const protocol: any = await deps.resolveService(context, 'protocol', envId);
            return await readMergedSkillRows(deps, protocol, getMeta);
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
