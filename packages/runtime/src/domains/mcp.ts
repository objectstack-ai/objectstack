// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/mcp` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-9).
 * The MCP transport (JSON-RPC over HTTP) + the public `/mcp/skill`
 * SKILL.md download. The bridge exposes business actions as MCP tools via
 * the action-execution subsystem (PR-8); OAuth resource-metadata and
 * Fetch-Request normalization ride along as family helpers.
 */

import { isMcpServerEnabled } from '@objectstack/types';
import { MCP_OAUTH_SCOPES, deriveAiFaceName } from '@objectstack/spec/ai';
import type { ErrorCode, MetadataProtocol } from '@objectstack/spec/api';
import type { ISecurityService } from '@objectstack/spec/contracts';
// [#32442] The ONE reading of `enable.aiReadable` (ruling A, #32865).
import { isAiReadExposed } from '@objectstack/spec/data';
import {
    BUILTIN_MEMBERSHIP_ROLES,
    MEMBERSHIP_REACH,
    mapMembershipRole,
    type BuiltinMembershipRole,
    type MembershipReachEntry,
} from '@objectstack/spec/identity';
import type { AIActionConfirmation, IExternalDatasourceService, ScreenSpec } from '@objectstack/spec/contracts';
import {
    FEDERATION_READ_CAPABILITY,
    FEDERATION_WRITE_CAPABILITY,
    federationCapabilityRefusal,
    metaRequestLocale,
    translateMetaList,
    type FederationCallKind,
    type MetaListTranslationSources,
} from '@objectstack/rest';
// [ADR-0131 D3 · D12 items 7–8 · D11] The walled refusal every door that writes
// the environment's metadata asks, read through this transport's one posture read.
import { walledCatalogWriteVerdict } from '@objectstack/metadata-core';
import { shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE, userTextLocalesOf } from '@objectstack/core';
import { readEffectiveTenancyPosture } from './activation-gate.js';
import { buildApiError } from '../error-envelope.js';
import * as actionExec from '../action-execution.js';
import { actionInvocationFailure, recordActionInvocation, withActionSurface } from '../action-invocation-audit.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import type { ActionDispatchAnswer, ActionResumeRequest, PlaceRequestInEnvironment } from '../action-dispatch.js';
import { readDispatchedBody } from '../deferred-request-body.js';
// [#34766] The open MCP draft door: its registry, behind `metadata:write` and the user's own `manage_metadata`.
import { resolveOpenAuthoringInjection } from './mcp-authoring.js';
// [#28715] The engine's own reading of "this field declares options" (its
// `label()` map is built from it), never a second spelling here.
import { declaresOptions } from '@objectstack/formula';
import { RUNTIME_OWNED_FIELD_TYPES, SEARCH_COMPANION_FIELD, isVirtualSearchField } from '@objectstack/spec/data';
// [#15705] The resume door's one refusal table, shared with
// `POST /automation/:name/runs/:runId/resume` so the two doors answer one
// engine result identically.
import { classifyResumeResult } from './automation.js';
// [ADR-0150 D3/D4, #31696] A flow action's `target` read from the action's own
// package; a run's flow read off the slot key it carries.
import { flowHolderForCaller, flowServiceForCaller, runFlowOf, runSlotPackage } from '../flow-slot-view.js';
import { automationAddressRegistryOf, bareNameRefusal } from './automation-address.js';
// [ADR-0106 D1/D5] The `/meta` door's object-schema masker and projection —
// imported, never restated, so `describe_object` and `list_objects` answer a
// caller the same field set the `/meta` object read answers that caller.
import { maskObjectSchema, resolveObjectMasker } from './meta.js';
// [ADR-0106 D1] The run doors' visibility question, asked where an action is listed or run.
import { actionRunFieldVisibilityRefusal, actionRunMasker, projectActionForCaller } from '../action-run-visibility.js';

/** Typed as the registered vocabulary, so a misspelling fails to compile. */
const FIELD_VISIBILITY_UNRESOLVED: ErrorCode = 'FIELD_VISIBILITY_UNRESOLVED';

/**
 * The code `run_action` answers when an organization endpoint refuses the
 * caller's membership role: the forward relays the endpoint's 403, served as
 * the standard code for that status (ADR-0112).
 */
const MEMBERSHIP_REACH_REFUSAL_CODE: ErrorCode = 'PERMISSION_DENIED';

/** An identity-route target on better-auth's organization plugin, captured relative to the auth base path. */
const ORGANIZATION_ENDPOINT_TARGET = /^\/api\/v1\/auth(\/organization\/[^?#]+)/;

/**
 * [ruling record 6812625052, letter E: list and mark, do not hide] Why
 * `run_action` would be refused for a listed `api` action whose target is an
 * organization endpoint the caller's membership role does not reach, or
 * `undefined` when it would not, or when this listing cannot tell.
 *
 * The reach is read from the action's declared `target` against the spec's
 * reach table ({@link MEMBERSHIP_REACH}, pinned equal to the vendor doors in
 * plugin-auth), never from a local list: the grades that reach the endpoint
 * are those of every row naming it (`/organization/update-member-role` is two
 * rows, so its reach is their union). A target no row names is no grade's to
 * judge (`/organization/create` is judged on the deployment's tenancy posture,
 * an SSO provider or OAuth application on record ownership), so it is never
 * marked.
 *
 * The caller's grades are its `positions` in the organization this listing
 * reads, by the names {@link mapMembershipRole} projects them to: the reading
 * the action's `requiresMembershipReach` sugar is lowered to. Only a principal
 * whose envelope carries its own positions is judged: the system context, a
 * delegated agent (its envelope carries the agent ceiling, not the delegating
 * person's grades) and an envelope with no `positions` are left unmarked.
 *
 * This is a mark and nothing else. The run doors do not read it: the endpoint
 * stays the authority, and a call naming another organization is judged there.
 */
function membershipReachRefusal(action: any, objectName: string | undefined, ec: any): { code: string; message: string } | undefined {
    if (action?.type !== 'api' || typeof action?.target !== 'string') return undefined;
    const endpoint = ORGANIZATION_ENDPOINT_TARGET.exec(action.target)?.[1]?.replace(/\/+$/, '');
    if (!endpoint) return undefined;
    const reaching = new Set<BuiltinMembershipRole>();
    for (const row of Object.values(MEMBERSHIP_REACH) as MembershipReachEntry[]) {
        if (row.endpoint === endpoint) for (const grade of row.grades) reaching.add(grade);
    }
    if (reaching.size === 0) return undefined;
    if (!ec || ec.isSystem === true || ec.onBehalfOf || !Array.isArray(ec.positions)) return undefined;
    const grades = BUILTIN_MEMBERSHIP_ROLES.filter((grade) => reaching.has(grade));
    if (grades.some((grade) => ec.positions.includes(mapMembershipRole(grade)))) return undefined;

    const names = grades.map((grade) => grade.replace(/_/g, ' '));
    const roles = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
    const on = objectName ? ` on '${objectName}'` : '';
    const where = ec.tenantId ? 'in this organization' : 'in any organization you belong to';
    return {
        code: MEMBERSHIP_REACH_REFUSAL_CODE,
        message:
            `Action '${String(action?.name ?? '')}'${on} needs an organization ${roles}: its endpoint ` +
            `(${endpoint}) refuses every other membership role, and your role ${where} is none of those. ` +
            `Ask a person who holds one of those roles to run it.`,
    };
}

/**
 * [ADR-0106 D6 tier 3] The refusal an MCP object-schema read answers when the
 * caller's field visibility could not be evaluated, or the projection would
 * leave the object with no field: the code, status and sentence the REST
 * `/meta` object read answers (`sendFieldVisibilityFault`), thrown so the tool
 * renders it as a coded tool error. Never the unmasked schema, never an
 * object with no fields.
 */
function fieldVisibilityRefusal(objectName: string): Error & { code: ErrorCode; status: number } {
    return Object.assign(
        new Error(`Field visibility for object '${objectName}' could not be evaluated; the object schema is not being served.`),
        { code: FIELD_VISIBILITY_UNRESOLVED, status: 503 },
    );
}

/**
 * The legacy branches matched `/mcp/skill` (exact or `?`-suffixed) BEFORE
 * the `/mcp` transport claimed everything else (exact, `/`, or `?` forms).
 * Entry order reproduces that precedence.
 *
 * [#16263] The two `?`-suffixed entries now say `match: 'prefix'` out loud —
 * they always rode the bare-`startsWith` default, which is `'segment'` now,
 * and a prefix ending in `'?'` has no `/` after it for a segment match to
 * find. Declaring it keeps both routes matching exactly what they always did.
 */
export function createMcpDomains(deps: DomainHandlerDeps): DomainRoute[] {
    return [
        { prefix: '/mcp/skill', match: 'segment', handler: (req, context) => handleMcpSkillRequest(deps, req.method, context) },
        { prefix: '/mcp/skill?', match: 'prefix', handler: (req, context) => handleMcpSkillRequest(deps, req.method, context) },
        { prefix: '/mcp', match: 'segment', handler: (req, context) => handleMcpRequest(deps, req.body, context) },
        { prefix: '/mcp?', match: 'prefix', handler: (req, context) => handleMcpRequest(deps, req.body, context) },
    ];
}

/**
 * Handle an MCP request over the Streamable HTTP transport (`/mcp`).
 *
 * Gating + auth (fail-closed), in this order:
 *  - **auth first**: requires a principal already resolved by
 *    `resolveExecutionContext` (the `sys_api_key` Bearer/header path, an
 *    OAuth access token or a session). Anonymous → 401, whatever the two
 *    checks below would answer: ADR-0138 D2 takes the anonymous decision as
 *    the domain's first statement ({@link refuseAnonymousMcpCaller}).
 *  - **default-on**: served unless `OS_MCP_SERVER_ENABLED=false` (single-env
 *    runtime; MCP is a core platform capability). Multi-tenant cloud
 *    overrides this gate per env. When opted out we return 404 so the
 *    surface isn't advertised.
 *  - **serveable**: 501 when no `mcp` service can take the request.
 *
 * Execution: the MCP runtime builds a stateless per-request server whose
 * object-CRUD tools run through {@link callData} bound to THIS request's
 * ExecutionContext — i.e. the exact permission + RLS path the REST API
 * uses. An external agent can never exceed the key's authority.
 */
export async function handleMcpRequest(deps: DomainHandlerDeps, body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    // [#24251] ADR-0138 D2: the anonymous decision is this domain's first
    // statement. The switch's 404 and the service's 501 below used to come
    // first, so an anonymous caller learned whether this deployment runs MCP
    // before it was refused.
    const ec = context.executionContext;
    if (!ec || (!ec.userId && !ec.isSystem)) {
        return { handled: true, response: await refuseAnonymousMcpCaller(deps, context) };
    }

    if (!isMcpServerEnabled()) {
        return { handled: true, response: deps.error('MCP server is not enabled', 404) };
    }
    const mcp: any = await deps.resolveService(context, 'mcp', context.environmentId);
    if (!mcp || typeof mcp.handleHttpRequest !== 'function') {
        return { handled: true, response: deps.error('MCP server is not available', 501) };
    }

    // [#24151] The body is read once the anonymous decision above has admitted
    // the caller, never ahead of it (`../deferred-request-body.ts`).
    body = readDispatchedBody(body);

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

    // [#30892] The file seam, resolved once per request so the bridge carries
    // `read_file` / `create_upload_link` exactly where the storage plugin's
    // caller-scoped verbs are served.
    const recordFiles = await resolveMcpRecordFileService(deps, context);
    // [ADR-0149 D2] The dataset seam, resolved on the same schedule: the bridge
    // carries `list_datasets` / `query_dataset` exactly where the analytics
    // service serves its dataset executor.
    const datasetTools = await resolveMcpDatasetToolsService(deps, context);
    const bridge = buildMcpBridge(deps, context, { recordFiles, datasetTools });
    // [#34766] The open draft door (design `docs/design/mcp-local-first-door.md`,
    // Design A): resolved per request, so the user's own `manage_metadata` is
    // read for every call. `undefined` for a grant without `metadata:write`
    // (an API key or a session carries none) and for an envelope with no user;
    // a user without the capability gets a registry that lists nothing.
    const authoring = await resolveOpenAuthoringInjection(deps, context, grantedScopes);
    let webRes: Response;
    try {
        webRes = await mcp.handleHttpRequest(webRequest, {
            bridge,
            parsedBody: body,
            // undefined = not scope-limited (API key / session); an array
            // narrows the registered tool families inside the MCP runtime.
            ...(grantedScopes ? { toolOptions: { grantedScopes } } : {}),
            ...(authoring ? { authoring } : {}),
            // [#31605] Who this request was admitted as: the resolved
            // ExecutionContext and the environment it was dispatched for. A
            // host-installed tool-call interceptor reads every call's
            // principal from these two and from nothing the request carries.
            caller: { executionContext: ec, environmentId: context.environmentId },
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
        return { handled: true, response: deps.error('MCP server is not enabled', 404) };
    }
    if (method !== 'GET') {
        // Hand-rolled rather than `deps.error(...)` only because it carries an
        // `Allow` header; the BODY still goes through the one builder (#3842),
        // so this branch cannot drift back to a numeric `code`. The code is
        // DERIVED (`METHOD_NOT_ALLOWED`), not spelled here. Every 405 this
        // dispatcher's domains answer (`actions.ts`, `ai.ts`, `keys.ts`,
        // `meta.ts`, this one) is built this way: an `Allow` header, and the
        // body through the one builder.
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

    // [#30892] The file pair is taught where the bridge would carry it.
    const recordFiles = await resolveMcpRecordFileService(deps, context);
    const fileTools = recordFiles !== undefined;
    // [#32686] …and the upload link for a record not yet created, where the
    // storage plugin serves it.
    const newRecordUploadLinks = typeof recordFiles?.createUploadLinkForNewRecordAs === 'function';
    // [ADR-0149 D2] …and the dataset pair, with the D3 selection rule.
    const datasetTools = (await resolveMcpDatasetToolsService(deps, context)) !== undefined;
    const markdown: string = mcp.renderSkill({ mcpUrl, fileTools, newRecordUploadLinks, datasetTools });
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
 * [#24251] The anonymous `401` of `/mcp` (ADR-0138 D2): the same status and
 * code whatever `OS_MCP_SERVER_ENABLED` or the `mcp` service says.
 *
 * Per the MCP authorization spec (RFC 9728 §5.1), a 401 from the protected
 * resource advertises where its metadata lives so an OAuth-capable client can
 * bootstrap discovery → DCR → PKCE. It is advertised only when both halves
 * hold, and API-key-only deployments get a plain 401:
 *
 *  - **the resource is served**: the switch is on and an `mcp` service can take
 *    the request. That is the predicate `handleMcpRequest` applies to an
 *    admitted caller (its 404 and 501) and `/discovery` applies to
 *    `routes.mcp`. Without it there is nothing behind the metadata to
 *    authorize. The auth service's answer alone does not settle it: with
 *    `OS_OIDC_PROVIDER_ENABLED=true` (or the `oidcProvider` config key)
 *    plugin-auth answers a metadata URL while the switch is off, and its
 *    `/.well-known/oauth-protected-resource` mount follows the switch, so
 *    that URL is not served.
 *  - **the OAuth track is live**: the auth service answers a metadata URL
 *    (AS on + TLS rule satisfied).
 *
 * The header tells an anonymous caller nothing the public `/discovery` route
 * and the metadata document itself do not already answer anonymously.
 */
async function refuseAnonymousMcpCaller(deps: DomainHandlerDeps, context: HttpProtocolContext) {
    const mcp: any = isMcpServerEnabled()
        ? await deps.resolveService(context, 'mcp', context.environmentId)
        : undefined;
    const served = !!mcp && typeof mcp.handleHttpRequest === 'function';
    const resourceMetadataUrl = served ? await getMcpResourceMetadataUrl(deps, context) : null;
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
    return response;
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
 * [commit e783e163d] The protocol layer's overlay-aware merged read, as this package can
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
// [#15238] Exported so the handle-typing pin beside this file can name it —
// the same reason `domains/packages.ts` exports `PackagesDomainProtocol`. Not a
// published-surface change: `packages/runtime`'s index does not re-export
// `domains/`.
export type McpMergedMetadataRead = Pick<MetadataProtocol, 'getMetaItems'>;

/**
 * [commit e783e163d] Read this environment's `skill` rows through the merged listing.
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
 * 1. **No merged read on this host** → the registry listing before commit e783e163d,
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
 * `organizationId` is deliberately NOT threaded: every metadata write lands
 * env-wide (ADR-0131 D6), and `getMetaItems` reads env-wide rows
 * unconditionally. Passing the active org would ask for a per-organization
 * overlay no metadata type has a write channel for.
 */
async function readMergedSkillRows(
    deps: DomainHandlerDeps,
    protocol: McpMergedMetadataRead | undefined | null,
    getMeta: () => Promise<any>,
): Promise<unknown[]> {
    const items = await actionExec.readMergedItems(protocol, 'skill');
    if (items === undefined) {
        const meta: any = await getMeta();
        return (await meta?.list?.('skill')) ?? [];
    }
    await warnIfSkillListIncomplete(deps, getMeta, items.length);
    return items;
}

/**
 * [ADR-0150 D2/D6] The manifest namespace of the package `packageId` names,
 * from the engine's registry (`getPackage`), or `undefined`: no package id, no
 * engine, or an id with no package record. A row's face is then its bare name.
 */
function packageNamespaceOf(engine: any, packageId: string | undefined): string | undefined {
    if (!packageId) return undefined;
    let pkg: any;
    try {
        pkg = engine?.registry?.getPackage?.(packageId);
    } catch {
        return undefined;
    }
    const namespace = pkg?.manifest?.namespace;
    return typeof namespace === 'string' && namespace !== '' ? namespace : undefined;
}


/**
 * [commit e783e163d] Report #6504's completeness verdict for the skill prompt surface.
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
 * [#32435] `describe_object`'s answer: what an agent needs to WRITE a record,
 * read off the object as THIS caller is served it — so a field, an option or a
 * rule the caller's view withholds (ADR-0106 D1: the served view drops a rule
 * that names a denied field anywhere, its message included) is not described.
 *
 * Per field: `required`, `readonly` and `system` (an auto-injected column such
 * as `created_at` is `readonly` and `system`; [#32530] `readonly` is also true
 * where a write never sets the value, {@link writeNeverSetsField}), the allowed
 * `options` as value + label for a field that declares them (a picklist-bound
 * field carries its list's resolved options on the served object,
 * `declaresOptions`), and the `defaultValue` an INSERT applies. Per active validation rule: its name, kind,
 * message, severity, the write events it runs on, and the fields it names —
 * ⛔ never its condition, pattern or transition table: the rule's message is
 * what a refused write answers with, and its expression is server policy.
 *
 * ⛔ Never the hidden search companion (`SEARCH_COMPANION_FIELD`), which the
 * registry serves beside the display field where pinyin search is on: no
 * caller may read, write or name it (a record never echoes it, a
 * `$searchFields` override naming it is refused, `validate_expression`
 * answers `unknown-field`), so the door that offers an agent a field to use
 * does not list it. The stdio twin skips it by the same constant.
 *
 * `declared` is the object `def` was projected from (the caller's mask
 * applied to it gives `def`): `readonly` is judged on it,
 * {@link writeNeverSetsField}. Nothing else is read from it.
 *
 * The twin is `describeServedObject` in `packages/mcp/src/mcp-server-runtime.ts`,
 * which the stdio bridge and the `objectstack://objects/{name}` resource serve
 * (this package does not depend on `@objectstack/mcp`): the transports answer
 * one shape, and the `describe_object` description (`mcp-http-tools.ts`)
 * states it.
 */
function describeServedObject(def: any, declared: any): Record<string, unknown> {
    return {
        name: def.name,
        label: def.label ?? def.name,
        // [#34721] The authored descriptions, off the same served object.
        ...authoredDescription(def),
        fields: Object.entries(def.fields ?? {}).filter(([k]) => k !== SEARCH_COMPANION_FIELD).map(([k, f]: [string, any]) => ({
            name: k,
            type: f?.type,
            label: f?.label ?? k,
            ...authoredDescription(f),
            required: f?.required ?? false,
            // [#32530] Judged on the DECLARED field, never the served one: the
            // caller's mask deletes a readable field's `expression` when it
            // names a field they cannot read, and the engine still computes the
            // field. Only the boolean is read there; the served definition,
            // without that expression, is what the answer is built from.
            readonly: writeNeverSetsField(declared?.fields?.[k]),
            system: f?.system === true,
            ...(declaresOptions(f) ? { options: describedOptions(f.options) } : {}),
            ...(f?.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
        })),
        validations: describedRules(def.validations),
        enableFeatures: def.enable ?? {},
    };
}

/**
 * [#34721] An object's or a field's `description` as `list_objects` and
 * `describe_object` serve it: `{ description }` when the definition, as the
 * caller is served it ({@link servedToCaller}), carries a non-blank string
 * there, and nothing otherwise, so an answer for a definition that authors
 * none keeps the shape it always had. The existing key only: the ADR-0106
 * projection removes an unreadable field whole, its description with it, and
 * keeps the prose of everything the caller may read, as the `/meta` object
 * door serves it.
 *
 * The twin is `authoredDescription` in `packages/mcp/src/mcp-server-runtime.ts`.
 */
function authoredDescription(def: any): { description?: string } {
    const text = def?.description;
    return typeof text === 'string' && text.trim() !== '' ? { description: text } : {};
}

/**
 * [#32530] `readonly` as {@link describeServedObject} serves it: a caller's
 * write can never set this field's value. True for the declared flag, and for
 * a value the engine owns whatever the payload says:
 *
 * - a runtime-owned type (`RUNTIME_OWNED_FIELD_TYPES`, today `autonumber`):
 *   the write path strips a caller's value even with no `readonly` flag, and a
 *   hand-authored literal carries none (the field builder injects it);
 * - a `formula`, virtual — computed on read, no column (`isVirtualSearchField`,
 *   the spec's one statement of that set): the write path strips it;
 * - a stored field declaring an `expression`: the engine computes it from the
 *   row the write stores, so a client-sent value never stands (the spec's
 *   `expression` contract).
 *
 * ⛔ Not the caller's field edit permission: a field the caller may read but
 * not edit is served the schema's answer, and the write naming it is refused
 * at the field-level write gate. The served object carries the read projection
 * only ({@link servedToCaller}), and the `describe_object` description says so.
 *
 * Asked of the DECLARED field ({@link describeServedObject}'s `declared`),
 * because the caller's mask deletes an `expression` that names a field the
 * caller cannot read, while the engine still computes the column from it.
 *
 * The twin is `writeNeverSetsField` in `packages/mcp/src/mcp-server-runtime.ts`,
 * which the stdio bridge and the `objectstack://objects/{name}` resource ask of
 * the declared field too: the stdio caller view hands the declaration it masked
 * beside the served object (`readObjectWithDeclaration`), so every transport
 * answers this verdict alike.
 */
function writeNeverSetsField(f: any): boolean {
    if (!f || typeof f !== 'object') return false;
    if (f.readonly === true) return true;
    if (typeof f.type === 'string' && RUNTIME_OWNED_FIELD_TYPES.has(f.type)) return true;
    if (isVirtualSearchField(f)) return true;
    // Truthy, the engine's own test for a stored expression it plans.
    return Boolean(f.expression);
}

/** A field's options as value + label: the stored value a write sends, and what a person reads. */
function describedOptions(options: unknown[]): Array<{ value: unknown; label: unknown }> {
    return options
        .filter((o): o is { value: unknown; label?: unknown } => !!o && typeof o === 'object' && 'value' in o)
        .map((o) => ({ value: o.value, label: o.label ?? o.value }));
}

/**
 * How deep a `conditional` rule's `then` / `otherwise` is described: the depth
 * the engine's own rule-message index walks (`MAX_VALIDATION_DEPTH`,
 * `@objectstack/objectql`'s `engine-validation-messages.ts`).
 */
const MAX_DESCRIBED_RULE_DEPTH = 10;

/** The object's ACTIVE validation rules, described without their expressions ({@link describeServedObject}). */
function describedRules(rules: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(rules)) return [];
    const out: Array<Record<string, unknown>> = [];
    for (const rule of rules) {
        const described = describedRule(rule, 0);
        if (described) out.push(described);
    }
    return out;
}

function describedRule(raw: unknown, depth: number): Record<string, unknown> | undefined {
    if (!raw || typeof raw !== 'object' || depth >= MAX_DESCRIBED_RULE_DEPTH) return undefined;
    const rule = raw as Record<string, unknown>;
    // An inactive rule never runs on a write, so it is not part of what a write needs.
    if (rule.active === false) return undefined;
    const fields: string[] = [];
    if (typeof rule.field === 'string') fields.push(rule.field);
    if (Array.isArray(rule.fields)) {
        for (const name of rule.fields) if (typeof name === 'string' && !fields.includes(name)) fields.push(name);
    }
    const described: Record<string, unknown> = {
        name: rule.name,
        type: rule.type,
        message: rule.message,
        // The spec's defaults (`ValidationRuleSchema`), stated so a reader need not know them.
        severity: rule.severity ?? 'error',
        events: Array.isArray(rule.events) ? rule.events : ['insert', 'update'],
        fields,
    };
    if (rule.type === 'conditional') {
        const then = describedRule(rule.then, depth + 1);
        const otherwise = describedRule(rule.otherwise, depth + 1);
        if (then) described.then = then;
        if (otherwise) described.otherwise = otherwise;
    }
    return described;
}

/**
 * [#34386] The per-request reads the action doors resolve declarations from:
 * the metadata service, the protocol layer's merged listing, and the objects
 * and standalone actions served from it. {@link buildMcpBridge} reads them for
 * its tools, and the host resume door ({@link resumeActionRunRequest}) for
 * `resume_run`'s gates, so the two cannot read different declarations.
 */
function actionDeclarationReads(deps: DomainHandlerDeps, context: HttpProtocolContext) {
    const envId = context.environmentId;
    const getMeta = () => deps.resolveService(context, 'metadata', envId);
    // The protocol layer's merged read, resolved per request on the SAME
    // per-environment seam `getMeta` uses — never captured once at boot,
    // which would serve one environment's rows to every other one.
    //
    // [#15238] Typed at the RESOLVE, not just at the callee's parameter.
    // `resolveService` answers `any` for `'protocol'` (the slot is deliberately
    // unmapped in `ServiceSlotContracts`), so naming {@link McpMergedMetadataRead}
    // here is what keeps any verb, spelt any way, from being reached through
    // this handle. ⛔ Still `| undefined` and still every member optional:
    // `actionExec.readMergedItems` keeps its own `typeof protocol.getMetaItems !==
    // 'function'` probe, because a host may occupy the slot with a partial
    // object.
    const getProtocol = async (): Promise<McpMergedMetadataRead | undefined> =>
        await deps.resolveService(context, 'protocol', envId);

    /**
     * [#25120] The objects `list_objects` and `describe_object` answer from:
     * the protocol's MERGED listing, the read `GET /api/v1/meta/object` serves
     * — never `IMetadataService.listObjects()` / `getObject()`.
     *
     * The metadata service holds a copy of an object only where something put
     * one there, and on a kernel with an `environmentId` nothing copies the
     * objects a package or a plugin contributes to the `SchemaRegistry` during
     * the boot (the full boot bridge is off on that shape). Those objects live
     * in the registry, which the merged read reads and the metadata service
     * does not. So this read served `list_objects` the environment-authored
     * objects alone, as a complete `totalCount`, and `describe_object` answered
     * "not found" for every package object, while REST listed them and the data
     * verbs served them. Measured on that shape: REST listed both of a
     * boot-registered package's objects, `list_objects` neither. The repair is
     * the consumer moving up to the read REST serves — the shape commit
     * e783e163d gave the skill read — ⛔ NOT a second copy of each package
     * object in the metadata service, which would be one more thing to keep in
     * sync.
     *
     * `undefined` = no merged read on this host (structural absence, see
     * `actionExec.readMergedItems`): `list_objects` and `describe_object` then read
     * the metadata service, exactly as before.
     */
    const readMergedObjects = async (): Promise<any[] | undefined> =>
        (await actionExec.readMergedItems(await getProtocol(), 'object')) as any[] | undefined;

    /**
     * [#25139] The object definitions `list_objects` lists: the merged listing,
     * or the metadata service's on a host with none. `list_actions`,
     * `run_action` and `resume_run` collect object-embedded actions from the
     * same read, so an action is listed and resolved on every object an agent
     * is listed, and on none the listing omits (a disabled package's).
     */
    const readServedObjects = async (): Promise<any[]> => {
        const merged = await readMergedObjects();
        if (merged !== undefined) return merged;
        const meta: any = await getMeta();
        return ((await meta?.listObjects?.()) ?? []) as any[];
    };

    /**
     * [#25297] The standalone `action` items `list_actions`, `run_action` and
     * `resume_run` collect beside the objects' embedded ones: the merged
     * listing, the read `GET /api/v1/meta/action` serves. The metadata
     * service's `loadMany('action')` holds the compiled artifact's actions
     * alone, so a package's object-less action and an environment-authored
     * one were never listed, and a disabled artifact package's still was.
     * `undefined` = no merged read on this host, and the collection reads the
     * metadata service, exactly as before.
     */
    const readServedActions = async (): Promise<any[] | undefined> =>
        (await actionExec.readMergedItems(await getProtocol(), 'action')) as any[] | undefined;
    return { getMeta, getProtocol, readMergedObjects, readServedObjects, readServedActions };
}

/**
 * Build a principal-bound {@link McpDataBridge}: every method runs AS the
 * request's ExecutionContext through {@link callData} (RLS/permissions) and
 * the per-env metadata reads (the protocol's merged listing, or the metadata
 * service on a host with none). Keeps the MCP tool layer free of any direct
 * engine access.
 *
 * Also carries the action seam (`listActions` / `runAction`) and the skill seam
 * (`listSkills`, #3905) the MCP runtime wires by capability.
 */
export function buildMcpBridge(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    seams: { recordFiles?: McpRecordFileService; datasetTools?: McpDatasetToolsService } = {},
): any {
    const ec = context.executionContext;
    const envId = context.environmentId;
    const driver = (context as any).dataDriver;
    // [#5155] Both the facilities AND the request are bound here, once, so the
    // bridge's tool surface below reads exactly as it did — while every call it
    // makes stays pinned to THIS request's kernel.
    const callData = actionExec.callData.bind(null, deps, context);
    const { getMeta, getProtocol, readMergedObjects, readServedObjects, readServedActions } = actionDeclarationReads(deps, context);

    /**
     * The one object `describe_object` describes and `validate_expression`
     * judges against: from the listing {@link readMergedObjects} reads, or the
     * metadata service's by-name read on a host with none.
     */
    /** {@link readMergedObjects}, read once per bridge for the `aiReadExposed` asks. */
    let mergedForAiRead: Promise<any[] | undefined> | undefined;

    const readServedObject = async (name: string): Promise<any> => {
        const merged = await readMergedObjects();
        return merged !== undefined
            ? merged.find((o: any) => o?.name === name)
            : await ((await getMeta()) as any)?.getObject?.(name);
    };

    // [ADR-0150 D6] The engine the skill read last resolved (`listSkills`).
    let skillEngine: any;

    /**
     * [ADR-0106 D1/D5] An object definition as THIS caller is served it: the
     * `/meta` object door's masker ({@link resolveObjectMasker}, this
     * request's execution context and security service, its D4 exemptions)
     * and its projection ({@link maskObjectSchema}), so a field the caller
     * cannot read does not exist in `describe_object` or `list_objects`
     * either. An unrestricted caller is handed the definition it was handed
     * before (the projection returns it by reference). A posture that cannot
     * be evaluated, or a projection that leaves no field, is refused with the
     * door's code ({@link fieldVisibilityRefusal}). [ruling record
     * 6787890900] An object the caller may not read is `undefined`: it does
     * not exist for them in `describe_object` or `list_objects`, exactly as a
     * name the listing omits. The masker is resolved once per bridge, i.e.
     * once per MCP request, and asked per object.
     *
     * Only the definitions these tools SERVE go through it. The reads that
     * judge a call (the action collection, the exposure gates) keep the
     * definition whole: they serve none of it.
     */
    let masker: ReturnType<typeof resolveObjectMasker> | undefined;
    const servedToCaller = async (def: any): Promise<any> => {
        const name = String(def?.name ?? '');
        const masked = await maskObjectSchema(await (masker ??= resolveObjectMasker(deps, context, 'object')), name, def);
        // [ruling record 6787890900] An object the caller may not read does not
        // exist for them: `undefined`, the answer for a name the listing omits.
        if (!masked.ok && masked.hidden) return undefined;
        if (!masked.ok) throw fieldVisibilityRefusal(name);
        return masked.document;
    };

    /** This request's masker ({@link resolveObjectMasker}), asked per object. */
    const callerMasker = async (name: string) => (await (masker ??= resolveObjectMasker(deps, context, 'object')))(name);

    /**
     * [ADR-0106 D1] The object one action is summarised against, as THIS
     * caller is served it — or `undefined` when the `/meta` object door's
     * projection withholds the action from this caller. The decision is
     * `projectMetaActionForCaller` (`@objectstack/rest`), the one the `/meta`
     * action list and item read ask, over the same masker: the action is
     * projected as its object's only `actions` entry, the position where that
     * projection drops an action reading a field the caller cannot read — a
     * param's `field` (one under `objectOverride` judged on the object it
     * names), or any other position of the action. An action with no object
     * definition (an object-less one) carries no field of its own object, and
     * each of its `objectOverride` params is judged on the object it names.
     * The object handed back is the projected one where it was projected, so it
     * carries no field the caller cannot read; a projection that cannot be
     * evaluated is refused with the door's code ({@link fieldVisibilityRefusal}).
     */
    const servedActionObject = async (
        action: any,
        objectName: string,
        obj: any,
        objects: ReadonlyMap<string, any>,
    ): Promise<{ obj: any } | undefined> => {
        // The object it is judged against is the run doors' own
        // (`projectActionForCaller`), so an action listed here is one
        // `run_action` runs for this caller, and one left out is one it answers
        // as an unknown name.
        const projected = await projectActionForCaller(callerMasker, {
            action, objectName, obj, readObject: (name) => objects.get(name),
        });
        if (projected.kind === 'fault') throw fieldVisibilityRefusal(projected.object);
        if (projected.kind === 'withhold') return undefined;
        return { obj: projected.object ?? obj };
    };

    /**
     * [#34872] Served objects in THIS caller's locale: the `/meta` object
     * door's translation (`translateMetaList`, the routine `GET /meta/object`
     * and the dataset tools below run) for this request's locale
     * ({@link metaTranslationSources}), ⛔ never a second translation routine.
     * Handed the objects AS THIS CALLER IS SERVED THEM ({@link servedToCaller}):
     * the translator rewrites the text of the fields it is given and adds
     * none, so a field the mask removed stays absent, its translated label and
     * description with it (ADR-0106 D3/D5). Computed per request (ADR-0156).
     * No locale, or a key the bundle does not carry, leaves the authored text;
     * names never change.
     */
    const inCallerLocale = async (served: readonly any[]): Promise<any[]> => {
        if (served.length === 0) return [...served];
        const translated = await translateMetaList(metaTranslationSources(deps, context, getProtocol), 'object', [...served]);
        return Array.isArray(translated) ? translated : [...served];
    };

    /** {@link readServedObject}, as this caller is served it ({@link servedToCaller}). */
    const readObjectForCaller = async (name: string): Promise<any> => {
        const def: any = await readServedObject(name);
        return def ? await servedToCaller(def) : def;
    };

    const listObjectSummaries = async (): Promise<any[]> => {
        const objs = await readServedObjects();
        const served: any[] = [];
        // [ADR-0106 D5(2)] Every listed object as this caller is served it,
        // so `fieldCount` counts the fields that exist for them. One object
        // that cannot be projected refuses the listing, as the `/meta`
        // object list does.
        for (const listed of objs) {
            const o = await servedToCaller(listed);
            // [ruling record 6787890900] An object the caller may not read is left out.
            if (o !== undefined) served.push(o);
        }
        const out: any[] = [];
        // [#34872] …in the caller's locale, the page translated in one call.
        for (const o of await inCallerLocale(served)) {
            out.push({
                name: o.name,
                label: o.label ?? o.name,
                // [#34721] …and its authored description, as the stdio twin serves it.
                ...authoredDescription(o),
                fieldCount: o.fields ? Object.keys(o.fields).length : undefined,
            });
        }
        return out;
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
        // [#25120] Answered from the listing `list_objects` serves
        // ({@link readMergedObjects}), so every object an agent is listed it
        // can describe, and a name the listing omits (a disabled package's
        // object among them) is "not found" here too.
        // [ADR-0106 D1/D5] …as this caller is served it ({@link readObjectForCaller}).
        /**
         * [#32442, ruling A] The read opt-in of a system object, judged by
         * `isAiReadExposed` over its WHOLE served definition (the read that
         * judges a call, not the masked one this caller is served): the
         * stored-metadata family is refused before the key is read, and only
         * `enable.aiReadable: true` opens. The read tools then read the object
         * through {@link callData} as the caller, under every gate they always
         * ran (permissions, RLS, the object's own read middleware, field
         * masking), so this admits the object and nothing else.
         */
        aiReadExposed: async (name: string): Promise<boolean> => {
            // `list_objects` asks once per listed `sys_*` object: one merged
            // read serves every ask this bridge (one request) makes.
            mergedForAiRead ??= readMergedObjects();
            const merged = await mergedForAiRead;
            const def = merged !== undefined
                ? merged.find((o: any) => o?.name === name)
                : await ((await getMeta()) as any)?.getObject?.(name);
            return isAiReadExposed(def);
        },
        describeObject: async (name: string) => {
            // {@link readObjectForCaller}'s two steps, kept apart so the
            // declaration it masks is in hand ([#32530] `readonly`).
            const declared: any = await readServedObject(name);
            const def: any = declared ? await servedToCaller(declared) : declared;
            if (!def) return null;
            // [#34872] …in the caller's locale. `declared` is read for the
            // `readonly` verdict alone, which no translation touches.
            const [localized] = await inCallerLocale([def]);
            // [#32435] …each field and rule carrying what a write needs.
            return describeServedObject(localized, declared);
        },
        // [#28715] The fields `validate_expression` judges a `label()` call
        // against, from the object `describeObject` reads: the served object,
        // where a picklist-bound field carries its list's resolved `options`,
        // so the served-form predicate is the one that matches.
        // [ADR-0106 D1] …the same caller's object, so no field it cannot read is named.
        optionFieldsOf: async (name: string): Promise<readonly string[] | null> => {
            const def: any = await readObjectForCaller(name);
            if (!def) return null;
            return Object.entries(def.fields ?? {})
                .filter(([, f]) => declaresOptions(f))
                .map(([k]) => k);
        },
        // [#32872] The object `describeObject` reads, whole: what
        // `validate_expression` hands the publish gate's own passes at a
        // validation rule or a formula field. Rendered to nobody; the tool
        // answers the gate's findings only.
        // [ADR-0106 D1] …the same caller's object, so no field it cannot read is judged.
        servedObjectDefinitionOf: async (name: string): Promise<Record<string, unknown> | null> => {
            const def: any = await readObjectForCaller(name);
            return def ?? null;
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
        /**
         * [ADR-0090 D10 — maintainer ruling 2026-09-08, #16549] The
         * delegated-read diagnostic, asked of THIS request's security service
         * about THIS request's principal.
         *
         * `query_records` renders it only where a narrowing was ESTABLISHED, so
         * every "cannot say" path answers `{ narrowed: false }` and the tool
         * renders exactly what it rendered before: no security service in this
         * deployment, a service predating the probe (feature-detected — the
         * availability rule `ISecurityService` states at the top of its own
         * file), or a throwing probe. ⛔ A diagnostic must never fail the read
         * it annotates.
         */
        diagnoseDelegation: async (object: string) => {
            try {
                // Typed against the published slot contract, never `any`
                // (#4251): `Partial<…>` is the availability rule the contract
                // itself states, and it is what makes the feature-detect below
                // a TYPE-CHECKED narrowing rather than a property probe on an
                // untyped value — the same shape `domains/automation.ts` uses.
                const security = await deps.resolveService(context, 'security', envId) as
                    Partial<ISecurityService> | undefined;
                if (typeof security?.describeDelegationNarrowing !== 'function') {
                    return { narrowed: false };
                }
                return await security.describeDelegationNarrowing(object, ec);
            } catch {
                return { narrowed: false };
            }
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
        // [#35138] The caller's locale ladder for a sentence the record tools
        // compose (`ifNotRecorded`): this request's, as the dataset tools'
        // `nextStep` reads it on this door (`userTextLocalesOf`).
        userTextLocales: async (): Promise<readonly string[]> => userTextLocalesOf(ec),

        // ── Skill metadata → MCP prompts (#3905) ──────────────────
        // ADR-0063 §2 names skills the only third-party extension primitive,
        // and the open distribution is MCP-only (BYO-AI): without this read the
        // type is authorable, lint-validated and consumed by nothing here. The
        // MCP runtime projects each skill's `instructions` onto the `prompts`
        // primitive. The tool-binding half binds nothing here, but it is read:
        // `registerSkillPrompts` offers a skill only when this request's
        // server lists every tool the skill binds.
        //
        // Resolved through THIS request's per-environment services — the same
        // seam `listObjects` / `describeObject` use — so a multi-tenant host
        // serves each environment its own skills. Metadata, not row data: no
        // ExecutionContext filtering, exactly like `describeObject` (the MCP
        // route itself is authenticated).
        //
        // [commit e783e163d] Through the protocol layer's MERGED listing — the second half
        // of #8328, whose own reproduction runs through THIS endpoint. See
        // {@link readMergedSkillRows}.
        listSkills: async () => {
            // [ADR-0150 D6] The engine whose registry places each row's package
            // ({@link packageNamespaceOf}), resolved beside the read it serves:
            // `@objectstack/mcp` asks `packageNamespace` only for rows this
            // call returned.
            skillEngine = await deps.getObjectQL(context, envId).catch(() => undefined);
            // Resolved per request through {@link getProtocol}, the typed
            // per-environment handle the object reads above use too.
            return await readMergedSkillRows(deps, await getProtocol(), getMeta);
        },
        // [ADR-0150 D6] A package-held skill's prompt name is `NS-NAME`.
        packageNamespace: (packageId: string) => packageNamespaceOf(skillEngine, packageId),

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
            // [#15705] The service instance, not just its presence: a
            // flow-typed action's input contract lives in the FLOW, and
            // `getFlow` is the declared door onto it (`IAutomationService`,
            // the same probe `dispatchFlowAction` uses before it dispatches).
            // Without it `list_actions` answered with no `params` for every
            // flow action while promising "its input parameters".
            const automation: any = await actionExec.resolveAutomationService(deps, context, envId);
            const hasAutomation = Boolean(automation);
            // [#21321] ONE source for advertising and running. `run_action`
            // dispatches a script action through the engine's handler registry
            // (`executeRegisteredAction`), so the listing asks that registry —
            // the same engine, the same key rotation — instead of trusting the
            // declaration's `target || body`. A declared action nothing bound
            // (measured: an `os package install`ed package) was listed here and
            // refused there with "No handler registered".
            const listingEngine: any = await deps.getObjectQL(context, envId).catch(() => undefined);
            const hasHandler = actionExec.registeredActionHandlerProbe(deps, listingEngine);
            const out: any[] = [];
            const servedObjects = await readServedObjects();
            // [ADR-0106 D1] The objects an action's `objectOverride` params
            // name, by name: judged and summarised on the object each names.
            const objectsByName = new Map<string, any>();
            for (const o of servedObjects) if (typeof o?.name === 'string') objectsByName.set(o.name, o);
            const declarations = await actionExec.collectActionDeclarations(
                deps, meta, servedObjects, await readServedActions(),
            );
            for (const { action, objectName, obj, packageId } of declarations) {
                if (!objectName) continue;
                // [#27681] Fail-closed on `sys_*` PER ACTION: the same predicate
                // `run_action` asks, so an agent that lists sees exactly the
                // system-object actions it may run (their author's `ai.exposed`).
                if (actionExec.systemObjectActionExposureError(deps, action, objectName)) continue;
                if (!actionExec.isHeadlessInvokableAction(deps, action, hasAutomation)) continue;
                // The script arm — every action `invokeBusinessAction` sends to
                // the handler registry, i.e. neither the declarative update, nor
                // a flow, nor a same-origin `api` action (its branch order, read
                // the same way; #27506 added the api forward). The other arms
                // have their own dispatchers and keep their own predicates.
                if (!actionExec.isDeclarativeUpdateAction(action) && action?.type !== 'flow' && action?.type !== 'api'
                    && !hasHandler(objectName, actionExec.resolveActionHandlerKeys(action))) continue;
                // [#2849 / ADR-0011] MCP is an AI surface: only actions the
                // author explicitly opted in via `ai.exposed` are listed.
                // Fail-closed — bodies run as trusted code (see
                // buildActionEngineFacade), so author opt-in is the boundary.
                if (actionExec.actionAiExposureError(deps, action)) continue;
                // Hide actions the caller is not permitted to run.
                if (actionExec.actionPermissionError(deps, action, ec)) continue;
                // Resolved per flow action, and only for one: a service that
                // omits the optional `getFlow` — or a flow the registry does
                // not hold — simply summarizes as before, since the fallback
                // is "no `params` key", exactly today's answer.
                // [ADR-0150 D3, #31696] Read from the action's own package, as
                // `run_action` runs it: on a flow name two namespaces hold, the
                // bare read refuses, while the action runs its package's own.
                let flow: any;
                if (action?.type === 'flow' && typeof action?.target === 'string' && typeof automation?.getFlow === 'function') {
                    try {
                        flow = await flowServiceForCaller(automation, listingEngine?.registry, action.target, packageId)
                            .getFlow(action.target);
                    } catch {
                        flow = undefined; // a registry that cannot answer, or a refused name, is not a listing failure
                    }
                }
                // [#28178] An api action whose target cannot read the caller's
                // credential (an OAuth-connected agent, an identity target for
                // an API key) is LISTED, marked with the refusal `run_action`
                // would answer — the same table, the same sentence — so an
                // agent can explain the gap instead of discovering it.
                // [#28943] …and one the target's per-object gate refuses for
                // that credential (a `sys_api_key` write under an API key),
                // marked with that gate's own code and sentence.
                // [ADR-0151 D3 rule 3] …and one declaring `ai.requiresConfirmation:
                // true` for an AI service account, which never confirms for
                // itself: `run_action` refuses it whatever the call sends, with
                // the gate's own code and sentence. That gate runs in the
                // admission sequence, ahead of the forward, so where both
                // apply it is the refusal the mark carries. Asked only for an
                // account: a person and a delegated agent confirm and run.
                const confirmation = actionExec.isAiServiceAccountCaller(ec)
                    ? actionExec.actionConfirmationRefusal(deps, action, undefined, objectName, ec)
                    : undefined;
                // [ruling record 6812625052, letter E] …and an organization
                // endpoint the caller's membership role does not reach: the
                // forward reaches it and it refuses 403. Asked last, because
                // `run_action` meets it last: after the admission sequence and
                // the forward's credential table. Listed, never hidden: the
                // run doors do not read the mark ({@link membershipReachRefusal}).
                const refusal = confirmation ?? actionExec.apiForwardCredentialRefusal(context, action)
                    ?? membershipReachRefusal(action, actionExec.isObjectLessActionKey(objectName) ? undefined : objectName, ec);
                // [ADR-0106 D1] Summarised against the object as this caller is
                // served it, and not listed where `/meta` withholds it.
                const served = await servedActionObject(action, objectName, obj, objectsByName);
                if (!served) continue;
                // [ADR-0150 D2/D5/D6] The holder's namespace — what `run_action`
                // takes as `namespace` to name this one action — and the action's
                // AI face, derived by spec's one derivation from its address.
                const namespace = packageNamespaceOf(listingEngine, packageId);
                const face = deriveAiFaceName({
                    name: action.name,
                    namespace,
                    objectName: actionExec.isObjectLessActionKey(objectName) ? undefined : objectName,
                });
                out.push({
                    ...actionExec.summarizeAction(
                        deps, action, served.obj, objectName, flow ?? undefined,
                        (name) => (name === objectName ? served.obj : objectsByName.get(name)),
                    ),
                    ...(namespace !== undefined ? { namespace } : {}),
                    face,
                    ...(refusal ? { unavailable: { code: refusal.code, reason: refusal.message } } : {}),
                });
            }
            return out;
        },
        // [#30771] Why the scoped `run_action` pre-screen (`@objectstack/mcp`)
        // finds a `sys_*` action missing from this caller's listing when the
        // reason is the caller's capability: an action its author exposed whose
        // declared gate refuses this caller answers the gate's own refusal, the
        // one `runAction` throws by name. Anything else (not declared there, not
        // exposed) answers `undefined`, so the tool keeps its system-object
        // sentence. Reads the declarations `listActions` reads, runs nothing.
        capabilityRefusal: async (name: string, objectName: string) => {
            const declarations = await actionExec.collectActionDeclarations(
                deps, await getMeta(), await readServedObjects(), await readServedActions(),
            );
            const found = declarations.find((d) => d.objectName === objectName && d.action?.name === name);
            if (!found) return undefined;
            // [ADR-0106 D1] An action this caller is not shown is answered as
            // a name nothing declares, as `run_action` answers it: never its
            // gate's refusal.
            const objects = new Map<string, any>();
            for (const o of await readServedObjects()) if (typeof o?.name === 'string') objects.set(o.name, o);
            const projected = await projectActionForCaller(actionRunMasker(deps, context), {
                action: found.action, objectName, obj: found.obj, readObject: (other) => objects.get(other),
            });
            if (projected.kind === 'fault') throw actionRunFieldVisibilityRefusal(projected.object);
            if (projected.kind === 'withhold') return undefined;
            if (actionExec.systemObjectActionExposureError(deps, found.action, objectName)) return undefined;
            if (actionExec.actionAiExposureError(deps, found.action)) return undefined;
            return actionExec.actionPermissionRefusal(deps, found.action, ec, objectName) ?? undefined;
        },
        // [#15942] `confirm` rides through UNTOUCHED. The bridge forwards the
        // whole request object, so widening the type here is the whole change:
        // the MCP door grew the member in the same change that enforces it, and
        // a bridge that quietly rebuilt `{ objectName, recordId, params }` was
        // the second of the two strip layers that made the member unreachable.
        // [#33690] The door no longer reads it: a declared-gated call is handed
        // to the person it runs as (`invokeBusinessAction`), whatever it carries.
        runAction: async (
            name: string,
            // [ADR-0150 D5] `namespace` rides through like `confirm`: the whole
            // request object is forwarded, never rebuilt without it.
            input: { objectName?: string; namespace?: string; recordId?: string; params?: Record<string, unknown> } & AIActionConfirmation,
            // [#33712] The door's channel to the person's client, set by the
            // tool only when the client can be elicited (`McpActionCallDoor`).
            door?: { elicitConfirmation?: actionExec.ActionConfirmationElicitor },
        ) => actionExec.invokeBusinessAction(deps, context, name, input ?? {}, {
            driver, envId, ec, getMeta, readObjects: readServedObjects, readActions: readServedActions, callData,
            ...(typeof door?.elicitConfirmation === 'function' ? { elicitConfirmation: door.elicitConfirmation } : {}),
        }),
        // [#15705] `resume_run`: continue the caller's own paused screen run.
        // Admitted by the same gates as `run_action`; see
        // {@link resumeActionRun}.
        resumeRun: async (
            runId: string,
            input: { values?: Record<string, unknown> } & AIActionConfirmation,
            door?: { elicitConfirmation?: actionExec.ActionConfirmationElicitor },
        ) => resumeActionRun(deps, context, runId, input ?? {}, {
            driver, envId, ec, getMeta, readObjects: readServedObjects, readActions: readServedActions, callData,
            ...(typeof door?.elicitConfirmation === 'function' ? { elicitConfirmation: door.elicitConfirmation } : {}),
        }),
        // ── Federation surface (McpFederationBridge, #27745) ───────
        // The `external-datasource` service Studio's datasource page reaches
        // through `…/external/tables` and `…/tables/:remote/import`, refused
        // on the same two capabilities those routes gate on.
        //
        // [#28938] Carried only for an envelope holding one of those two
        // capabilities. `wireBridgeTools` (`@objectstack/mcp`) registers the
        // pair only on a bridge carrying both members, so without them
        // `tools/list` omits the pair —
        // the shape `list_actions` already has, which hides an action its
        // caller may not run. The case that made this matter: the `/mcp` door
        // hands an OAuth agent the user's system capabilities only under
        // `actions:execute`, so a `metadata:write`-only grant holds none and
        // was listed two tools whose every call answered 403, for an
        // administrator too. Read off the SAME envelope the per-call gate
        // reads ({@link heldFederationCapabilities}), so listing and calling
        // cannot disagree; nothing a grant can do changes.
        //
        // [2026-11-03 ruling] "Some call of the pair can pass" is asked of the
        // family's one rule (`federationCapabilityRefusal`), not of "holds
        // either capability": both calls answer remote structure, so both
        // need the read capability, and an envelope holding only the write one
        // can pass neither — it is carried neither, as a `metadata:write`-only
        // grant is.
        //
        // [ADR-0131 D3 · D12 items 7–8 · D11] The import saves an `object` into
        // the environment's metadata catalog, so it names that type and
        // {@link federationService} asks the walled refusal for it, as the REST
        // route does. The listing stays a pure capability decision: the posture
        // read is per call, and the pair is listed where a call of it can pass.
        ...(federationPairCallable(ec)
            ? {
                listRemoteTables: async (datasource: string, opts: { schema?: string }) =>
                    (await federationService(deps, context, ec, 'read')).listRemoteTables(datasource, opts),
                importObject: async (datasource: string, remoteName: string, opts: { name?: string; writable?: boolean }) =>
                    (await federationService(deps, context, ec, 'write', { catalogWrite: 'object' })).importObject(datasource, remoteName, opts),
            }
            : {}),
        // [#30892] The file seam (`read_file` / `create_upload_link`), carried
        // only where the storage plugin serves its caller-scoped verbs.
        ...(seams.recordFiles ? recordFileMembers(seams.recordFiles, callData, driver, envId, ec, deps, context) : {}),
        // [ADR-0149 D2] The dataset seam (`list_datasets` / `query_dataset`),
        // carried only where the analytics service serves its executor.
        ...(seams.datasetTools ? datasetToolMembers(seams.datasetTools, getProtocol, ec, deps, context) : {}),
    };
}

/**
 * [ADR-0149 D2] The face of the `analytics` service the MCP dataset tools
 * call: `datasetTools(deps)` binds the service-analytics executor
 * (`createDatasetTools`) to the service itself. Named here structurally, as
 * {@link McpRecordFileService} is, so this package takes no dependency on the
 * analytics package (it loads opt-in). Every method refuses by throwing an
 * ADR-0112 coded error.
 */
export interface McpDatasetToolsService {
    datasetTools(deps: {
        loadDatasets: (context: unknown) => Promise<readonly unknown[]>;
        diagnoseDelegation?: (object: string, context: unknown) => Promise<{ narrowed: boolean; statement?: string } | undefined>;
        maxQueryLimit?: number;
    }): {
        readonly definitions: ReadonlyArray<{ name: string; description: string }>;
        listDatasets(input: unknown, context?: unknown): Promise<any>;
        queryDataset(input: unknown, context?: unknown): Promise<any>;
    };
}

/**
 * [ADR-0149 D2] The `analytics` service when it serves the dataset executor,
 * else `undefined` (no analytics service — it loads opt-in — or one without
 * `datasetTools`). A lookup that throws is "not served": the tools are then
 * not listed, as for {@link resolveMcpRecordFileService}.
 */
export async function resolveMcpDatasetToolsService(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<McpDatasetToolsService | undefined> {
    let service: Partial<McpDatasetToolsService> | undefined;
    try {
        service = (await deps.resolveService(context, 'analytics', context.environmentId)) as unknown as
            Partial<McpDatasetToolsService> | undefined;
    } catch {
        return undefined;
    }
    return service && typeof service.datasetTools === 'function' ? (service as McpDatasetToolsService) : undefined;
}

/**
 * [ADR-0149 D2 · #34872] What the `/meta` translation reads for THIS request:
 * the request's i18n service (a lookup that throws is none, and the text is
 * then served untranslated), its protocol (an object's packaged base and a
 * declared override's pair translations) and its locale — the
 * `Accept-Language` / `?locale=` reading every `/meta` answer takes
 * (`metaRequestLocale`), the i18n service's default last. One reading for the
 * dataset tools and the object tools, so the two answer one caller in one
 * locale.
 */
function metaTranslationSources(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    getProtocol: () => Promise<unknown>,
): MetaListTranslationSources {
    return {
        resolveI18nService: async () => {
            try {
                return await deps.resolveService(context, 'i18n', context.environmentId);
            } catch {
                return undefined;
            }
        },
        resolveProtocol: getProtocol,
        requestLocale: (i18n?: unknown) => metaRequestLocale({ headers: context.request?.headers }, i18n),
    };
}

/**
 * [ADR-0149 D2] The bridge's three dataset members over the analytics
 * service's executor, bound to THIS request's principal.
 *
 * - The saved datasets come from the read the REST door resolves
 *   `datasetName` from (the protocol's merged `getMetaItems({ type: 'dataset' })`),
 *   localized with the `/meta` list translation for this request's locale, as
 *   the REST door localizes a saved dataset. A throwing read is left to throw:
 *   the executor answers it as a degraded read (`partial` / 503), never as an
 *   empty catalogue.
 * - The narrowing probe is the bridge's own `diagnoseDelegation` read, asked
 *   of this request's security service, so `query_dataset` states a narrowing
 *   exactly where `query_records` does.
 * - `maxRows` is the tool layer's page cap; the executor holds
 *   `selection.limit` to it.
 */
function datasetToolMembers(
    service: McpDatasetToolsService,
    getProtocol: () => Promise<McpMergedMetadataRead | undefined>,
    ec: unknown,
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
) {
    const envId = context.environmentId;
    const loadDatasets = async (): Promise<readonly unknown[]> => {
        const protocol = await getProtocol();
        const items = (await actionExec.readMergedItems(protocol, 'dataset')) ?? [];
        const translated = await translateMetaList(
            metaTranslationSources(deps, context, async () => protocol),
            'dataset',
            items,
        );
        return Array.isArray(translated) ? translated : items;
    };
    const diagnoseDelegation = async (object: string) => {
        try {
            const security = await deps.resolveService(context, 'security', envId) as
                Partial<ISecurityService> | undefined;
            if (typeof security?.describeDelegationNarrowing !== 'function') return undefined;
            return await security.describeDelegationNarrowing(object, ec as any);
        } catch {
            return undefined;
        }
    };
    const executor = (maxQueryLimit?: number) =>
        service.datasetTools({ loadDatasets, diagnoseDelegation, ...(maxQueryLimit !== undefined ? { maxQueryLimit } : {}) });
    return {
        listDatasets: (input: unknown) => executor().listDatasets(input, ec),
        queryDataset: (input: unknown, opts: { maxRows: number }) => executor(opts.maxRows).queryDataset(input, ec),
        datasetToolDefinitions: () => executor().definitions,
    };
}

/**
 * [#30892] The caller-scoped face of the storage plugin's `file-attachments`
 * service the MCP file tools call (`ICallerRecordFileService`,
 * `@objectstack/service-storage`), named here structurally so this package
 * takes no dependency on the storage package. Every verb acts as the context's
 * user and throws ADR-0112 coded refusals.
 */
export interface McpRecordFileService {
    listRecordFilesAs(object: string, recordId: string, context: unknown): Promise<unknown[]>;
    readRecordFileAs(
        object: string,
        recordId: string,
        target: { field: string; fileId?: string } | { attachmentId: string },
        context: unknown,
        options: { maxBytes: number },
    ): Promise<{ download: { url: string; expiresAt: string } | null } & Record<string, unknown>>;
    createUploadLinkAs(
        object: string,
        recordId: string,
        target: { field: string } | { attachments: true },
        context: unknown,
    ): Promise<{ path: string; expiresAt: string }>;
    /**
     * [#32686] A link for a file field of a record not yet created, with the
     * file id(s) the upload is stored under. Optional: a storage plugin that
     * predates it serves links for existing records only.
     */
    createUploadLinkForNewRecordAs?(
        object: string,
        target: { field: string; count?: number },
        context: unknown,
    ): Promise<{ path: string; expiresAt: string; fileIds: string[] }>;
}

/**
 * [#30892] The `file-attachments` service when it serves the caller-scoped
 * record-file verbs, else `undefined` (no storage plugin, or one that predates
 * them). A lookup that throws is "not served": the tools are then not listed.
 */
async function resolveMcpRecordFileService(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<McpRecordFileService | undefined> {
    let service: Partial<McpRecordFileService> | undefined;
    try {
        service = (await deps.resolveService(context, 'file-attachments', context.environmentId)) as unknown as
            Partial<McpRecordFileService> | undefined;
    } catch {
        return undefined;
    }
    return service
        && typeof service.listRecordFilesAs === 'function'
        && typeof service.readRecordFileAs === 'function'
        && typeof service.createUploadLinkAs === 'function'
        ? (service as McpRecordFileService)
        : undefined;
}

/**
 * [#30892] The origin a link this server mints is opened at: the one the auth
 * service declares for the MCP endpoint (its configured base URL), else the
 * request's own host — the order the skill route resolves the MCP URL in.
 * `undefined` when neither is known, and a link stays the path it was minted as.
 */
async function publicOrigin(deps: DomainHandlerDeps, context: HttpProtocolContext): Promise<string | undefined> {
    try {
        const authService = await deps.resolveService(context, 'auth', context.environmentId);
        const url = authService?.getMcpResourceUrl?.();
        if (typeof url === 'string' && url) return new URL(url).origin;
    } catch { /* fall through to the request host */ }
    try {
        const webReq = toMcpWebRequest(deps, context.request, undefined);
        const host = webReq?.headers.get('host');
        if (host) {
            const proto = webReq?.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
            return `${proto}://${host}`;
        }
    } catch { /* no origin */ }
    return undefined;
}

/** `url` made absolute against `origin`; an absolute `url` (an S3 presigned link) stays as it is. */
function absoluteUrl(url: string, origin: string | undefined): string {
    if (!origin) return url;
    try {
        return new URL(url, origin).toString();
    } catch {
        return url;
    }
}

/**
 * [#30892] The bridge's file members. Each reads the record through the door
 * `get_record` reads it through first, so a record the caller cannot read is
 * refused with exactly `get_record`'s answer before the storage service is
 * asked anything; the service then reads it again as the caller and judges the
 * file by the download door's verdict, or the link by the attach rule.
 */
function recordFileMembers(
    service: McpRecordFileService,
    callData: (action: string, params: any, driver?: any, scopeId?: string, ec?: any) => Promise<any>,
    driver: unknown,
    envId: string | undefined,
    ec: unknown,
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
) {
    const readRecordFirst = async (object: string, recordId: string): Promise<void> => {
        const res: any = await callData('get', { object, id: recordId }, driver, envId, ec);
        if ((res?.record ?? res ?? null) == null) {
            throw Object.assign(new Error(`Record "${recordId}" not found in "${object}"`), {
                code: 'RECORD_NOT_FOUND',
                status: 404,
            });
        }
    };
    const newRecordLinkAs =
        typeof service.createUploadLinkForNewRecordAs === 'function' ? service.createUploadLinkForNewRecordAs.bind(service) : undefined;
    return {
        listRecordFiles: async (object: string, recordId: string) => {
            await readRecordFirst(object, recordId);
            return await service.listRecordFilesAs(object, recordId, ec);
        },
        readRecordFile: async (
            object: string,
            recordId: string,
            target: { field: string; fileId?: string } | { attachmentId: string },
            options: { maxBytes: number },
        ) => {
            await readRecordFirst(object, recordId);
            const read = await service.readRecordFileAs(object, recordId, target, ec, options);
            const origin = read.download ? await publicOrigin(deps, context) : undefined;
            return {
                ...read,
                download: read.download ? { ...read.download, url: absoluteUrl(read.download.url, origin) } : null,
            };
        },
        createUploadLink: async (object: string, recordId: string, target: { field: string } | { attachments: true }) => {
            await readRecordFirst(object, recordId);
            const grant = await service.createUploadLinkAs(object, recordId, target, ec);
            return { url: absoluteUrl(grant.path, await publicOrigin(deps, context)), expiresAt: grant.expiresAt };
        },
        // [#32686] No record to read first: the storage service asks the
        // object's create verdict and the field's writability for the caller.
        ...(newRecordLinkAs
            ? {
                // [#32747] `count`: how many files the user will upload, each id answered now.
                createUploadLinkForNewRecord: async (object: string, target: { field: string; count?: number }) => {
                    const grant = await newRecordLinkAs(object, target, ec);
                    return {
                        url: absoluteUrl(grant.path, await publicOrigin(deps, context)),
                        expiresAt: grant.expiresAt,
                        fileIds: [...grant.fileIds],
                    };
                },
            }
            : {}),
    };
}

/**
 * [#28938] The federation capabilities this request's envelope holds — the
 * one read both the bridge's listing decision and {@link federationService}'s
 * per-call gate make, so a tool is listed exactly where some call of the pair
 * can pass.
 */
function heldFederationCapabilities(ec: any): string[] {
    const held: unknown[] = Array.isArray(ec?.systemPermissions) ? ec.systemPermissions : [];
    return [FEDERATION_READ_CAPABILITY, FEDERATION_WRITE_CAPABILITY].filter((cap) => held.includes(cap));
}

/** The kinds of the pair's two calls: `list_remote_tables` reads, `import_object` writes. */
const FEDERATION_PAIR_KINDS: readonly FederationCallKind[] = ['read', 'write'];

/**
 * [#28938, 2026-11-03 ruling] Whether some call of the federation pair can
 * pass for this envelope — judged by the family's one rule
 * (`federationCapabilityRefusal`, `@objectstack/rest`) over the same held set
 * {@link federationService} judges each call by, so the pair is listed
 * exactly where one of its calls is admitted.
 */
function federationPairCallable(ec: any): boolean {
    const held = heldFederationCapabilities(ec);
    return FEDERATION_PAIR_KINDS.some((kind) => federationCapabilityRefusal(kind, held) === undefined);
}

/**
 * [#27745] The `external-datasource` service for one federation tool call, or
 * the refusal the REST twin answers: `403 PERMISSION_DENIED` without the
 * capabilities the call's kind needs (asked first, as the route asks it, so a
 * caller without them cannot learn which services the host wires), `503
 * SERVICE_UNAVAILABLE` on a host with no federation service.
 *
 * [2026-11-03 ruling] The capability decision is the REST family's own
 * `federationCapabilityRefusal`, not a copy of it: seeing a datasource's
 * remote structure needs the read capability on every route, writes included,
 * so `import_object` — which answers with the generated definition — needs
 * the read capability as well as the write one, and its refusal is the
 * route's sentence.
 *
 * [ADR-0131 D3 · D12 items 7–8 · D11] A call that saves an item into the
 * environment's metadata catalog names its type in `catalogWrite`, and is then
 * asked the walled refusal after the capability rule and before the service
 * lookup, as the REST import route asks it: `walledCatalogWriteVerdict`
 * (`@objectstack/metadata-core`), the verdict the metadata save door asks,
 * never restated. Under a walled tenancy posture only the platform operator
 * rung (or `isSystem`) is admitted, whatever the caller holds; inert under
 * `single` and with no `tenancy` service. The posture is this transport's one
 * read ({@link readEffectiveTenancyPosture}, which every walled door of the
 * dispatcher reads), so a `tenancy` service that cannot answer raises the
 * outage's `503`, never a permit. Refused `403 PERMISSION_DENIED` with the
 * verdict's sentence, the route's answer.
 */
async function federationService(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    ec: any,
    kind: FederationCallKind,
    catalog: { catalogWrite?: string } = {},
): Promise<IExternalDatasourceService> {
    const refusal = federationCapabilityRefusal(kind, heldFederationCapabilities(ec));
    if (refusal !== undefined) {
        throw Object.assign(new Error(refusal), { code: 'PERMISSION_DENIED', status: 403 });
    }
    if (catalog.catalogWrite !== undefined) {
        const walled = walledCatalogWriteVerdict({
            type: catalog.catalogWrite,
            tenancyPosture: await readEffectiveTenancyPosture(deps, context),
            isSystem: ec?.isSystem === true,
            callerPosture: ec?.posture,
        });
        if (!walled.allowed) {
            throw Object.assign(new Error(walled.message), { code: 'PERMISSION_DENIED', status: 403 });
        }
    }
    let service: IExternalDatasourceService | undefined;
    try {
        service = await deps.resolveService(context, 'external-datasource', context.environmentId);
    } catch {
        service = undefined;
    }
    if (!service) {
        throw Object.assign(new Error('The external-datasource service is not available.'), {
            code: 'SERVICE_UNAVAILABLE',
            status: 503,
        });
    }
    return service;
}

/**
 * [#15705] Build the error a resume refusal throws, through the SAME
 * `deps.error` builder the REST resume door answers with. So the code
 * (explicit, promoted from `details`, or derived from the status), the message
 * (with the 5xx leak guard) and the `details` are exactly what the REST door
 * would serve. The MCP tool layer turns `code` / `status` / `details` back into
 * the ADR-0112 envelope of its tool error.
 */
function resumeDoorError(
    deps: DomainHandlerDeps,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
    extra?: { userMessage?: string },
): Error {
    const response = deps.error(message, httpStatus, details, extra);
    const envelope = (response?.body as {
        error?: { code?: unknown; message?: unknown; details?: unknown; userMessage?: unknown };
    } | undefined)?.error;
    const thrown = Object.assign(new Error(typeof envelope?.message === 'string' ? envelope.message : message), {
        code: typeof envelope?.code === 'string' ? envelope.code : undefined,
        status: response?.status ?? httpStatus,
        ...(envelope?.details !== undefined ? { details: envelope.details } : {}),
        // [#24914, ruling B′] The producer-marked end-user text, carried onto
        // the thrown error as the `userMessage` field every boundary reads
        // through `declaredUserMessage` — exactly what the REST door put at the
        // envelope's top level, never folded into `message`.
        ...(typeof envelope?.userMessage === 'string' ? { userMessage: envelope.userMessage } : {}),
    });
    // [#34386] The host's resume door answers this refusal with the envelope
    // it was built from (`resumeDoorAnswerOf`), `details` included.
    resumeDoorEnvelopes.set(thrown, response);
    return thrown;
}

/**
 * [#34386] Each refusal {@link resumeDoorError} built, keyed to the envelope
 * `deps.error` built for it. The MCP door throws the refusal and its tool
 * reads `code`, `status` and `details` off it; the host's resume door answers
 * that same envelope. A generic thrown-value reader would keep the code and
 * the status but drop `details` (a confirmation refusal's `reason`, a shared
 * flow name's `candidates`), so the host door does not read it that way.
 */
const resumeDoorEnvelopes = new WeakMap<object, { status: number; body: any }>();

/** [#34386] The host resume door's answer to a throw: the door's own envelope, or the dispatcher's reader for anything else. */
function resumeDoorAnswerOf(deps: DomainHandlerDeps, err: unknown): ActionDispatchAnswer {
    const envelope = err !== null && typeof err === 'object' ? resumeDoorEnvelopes.get(err) : undefined;
    return (envelope ?? deps.errorFromThrown(err, 500)) as ActionDispatchAnswer;
}

/**
 * [#15705] The one answer for "this is not a paused run you can resume". It is
 * given when no run has the id, when the run is no longer paused, and when
 * someone else started it. The three read the same on purpose (the reason is
 * in {@link resumeActionRun}'s step 2).
 */
function notResumableRunMessage(runId: string): string {
    return (
        `Run '${runId}' is not a paused run you can resume: no run has this id, the run is no longer paused, `
        + 'or it was started by a different user. Only the user whose call started a run can resume it.'
    );
}

/**
 * [#15705] The MCP `resume_run` door. It continues a paused SCREEN run with
 * the screen's field values, so an agent that got `status: 'paused'` plus a
 * `screen` from `run_action` can finish the run.
 *
 * ## The ruling this implements
 *
 * Maintainer, on #15705: add the resume verb, and make it pass the SAME
 * authorization and caller-scope checks as `run_action`. The #16370 fix (a
 * record the caller cannot read is refused at the door) is named as the rule
 * resume must not get around. So a call is admitted only when `run_action`
 * would admit starting this same flow on this same record, for this caller,
 * now.
 *
 * ## Why the REST resume door alone is not enough
 *
 * `POST /automation/:name/runs/:runId/resume` checks two things: the caller is
 * not anonymous, and the node the run is parked on declares `resumeAuthority:
 * 'any'` (a `screen` does). It never asks who is resuming. That matters
 * because a resumed run continues under the identity stored in the run, not
 * the caller's. The run's data nodes run as the user who STARTED it. So
 * "any authenticated caller with the run id" would let one user continue
 * another user's run as that other user. The steps below close that for this
 * door. The REST door is not changed here.
 *
 * ## The steps, in order
 *
 *  1. The service must implement `resume`, `getRun` and `getSuspendedScreen`.
 *     Otherwise 501. Ownership cannot be checked without `getRun`, so this
 *     fails closed.
 *  2. **Whose run.** `getRun(runId).trigger.userId` must be the caller's
 *     `userId`, and the run must be `paused`. Otherwise the ONE not-found
 *     answer, 404. An unknown id, a finished run and another user's run all
 *     get the same code, status and message. This is the existence
 *     non-disclosure #16370 used for records: an agent learns nothing about a
 *     run id it did not start.
 *  3. **Which action admits it.** The run records its flow and its object, not
 *     the action that started it. So the candidates are the `type: 'flow'`
 *     actions whose `target` is the run's flow, on the run's object (the
 *     object-less key when the run carries no object, because
 *     `dispatchFlowAction` sets no `object` for one). Each candidate goes
 *     through `run_action`'s gates in `run_action`'s order, using the same
 *     helpers: system-object guard, `ai.exposed`, `requiredPermissions`, the
 *     ADR-0126 activation switch, and `ai.requiresConfirmation`. The first
 *     candidate that passes admits the call. If none passes, the first
 *     candidate's refusal is served. If there is no candidate at all, the run
 *     was not started by a flow action, and the call is refused 403.
 *     The confirmation step applies here too because the flow's writes happen
 *     after the screen, so on resume. [#33690] Under the amended contract the
 *     caller's `confirm` never counts: a resume of a gated action is handed to
 *     the person (after steps 4 and 5, below), carrying its run, and an AI
 *     service account is refused whatever it sends (ADR-0151 D3 rule 3).
 *  4. **The subject record, read again as the caller.** This is #16370's rule,
 *     with the same two shared functions: `loadActionSubjectRecord` and
 *     `refuseDeniedSubjectLoad`. A record the caller could read when the run
 *     started but cannot read now is refused `RECORD_NOT_FOUND` / 404, and
 *     the run is not resumed.
 *  5. **A screen pause only.** `getSuspendedScreen` must return a screen.
 *     The verb submits screen values. A run parked on any other node (a
 *     timer `wait`, for example) is refused 409 and left alone. [#34515] An
 *     approval is bound to the screen it was given on (an approved hand-off's
 *     `screenNodeId` at the host door, the screen an elicited person was
 *     asked about): a run now paused on another screen is refused 409
 *     `RESOURCE_CONFLICT` and left alone.
 *  6. **Resume.** The signal is built one field at a time and the input is
 *     never spread, as the REST door does (#3801). The engine's answer goes
 *     through {@link classifyResumeResult}, the table both doors share.
 *
 * Every refusal is thrown before `resume()` is called, so a refused call
 * consumes nothing and the run stays parked.
 *
 * The success value is `run_action`'s envelope: `{ ok, action, objectName,
 * recordId?, result }`. `result` is the engine's own answer, so a run that
 * pauses on its NEXT screen comes back as `status: 'paused'` with a `runId`
 * and a `screen`, and a multi-screen wizard is walked by calling this again.
 * [#33690] A resume of a gated action answers `ActionConfirmationPending`
 * instead (or the `no_confirmation_service` refusal): the run stays parked,
 * and approving the hand-off resumes THAT run with these values, as the
 * approver, who must be its owner. No invocation row is written for it.
 *
 * [#34386] The host's door to the same steps is {@link resumeActionRunRequest}
 * (published as `dispatchActionResume`): the approval leg of a handed-off
 * `resume_run`. It asks steps 1 to 6 again as the approving person, with
 * one difference at step 3: the confirmation gate reads the person's
 * confirmation the host carries (`wiring.hostDoor`), so the call is never
 * handed off or elicited again.
 */
export async function resumeActionRun(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    runId: string,
    input: { values?: Record<string, unknown> } & AIActionConfirmation,
    wiring: {
        driver: any;
        envId?: string;
        ec: any;
        getMeta: () => Promise<any>;
        /** [#25139] As `invokeBusinessAction`'s: the objects whose `actions[]` admit the run. */
        readObjects?: () => Promise<readonly any[]>;
        /** [#25297] As `invokeBusinessAction`'s: the standalone `action` items that admit the run. */
        readActions?: () => Promise<readonly any[] | undefined>;
        callData: (action: string, params: any, dataDriver?: any, scopeId?: string, ec?: any) => Promise<any>;
        /** [#33712] As `invokeBusinessAction`'s: the person asked in their client, in place of a hand-off. */
        elicitConfirmation?: actionExec.ActionConfirmationElicitor;
        /**
         * [#34386] Present exactly when the call comes through the host's
         * resume door ({@link resumeActionRunRequest}), never at the MCP
         * tool. The host has asked the person already (an approved
         * hand-off), so step 3's confirmation gate reads the person's
         * `confirmation` as a host action door reads it (the member gate,
         * `actionConfirmationRefusal`): nothing is handed off or elicited,
         * an AI service account is refused whatever it carries, and the
         * invocation row names no MCP surface.
         *
         * [#34515] `screenNodeId` is the screen the approved hand-off was given
         * on (`ActionConfirmationHandOff.run.screenNodeId`): step 5 refuses a
         * run no longer paused on it.
         */
        hostDoor?: { confirmation: AIActionConfirmation; screenNodeId?: string };
    },
): Promise<any> {
    const { driver, envId, ec, getMeta, readObjects, readActions, callData, hostDoor } = wiring;
    // [#34386] The host door asks no client: it carries the person's answer.
    const elicitConfirmation = hostDoor ? undefined : wiring.elicitConfirmation;
    if (typeof runId !== 'string' || runId === '') {
        throw resumeDoorError(deps, 'runId is required', 400);
    }
    const values = input?.values;
    if (values !== undefined && (values === null || typeof values !== 'object' || Array.isArray(values))) {
        throw resumeDoorError(deps, 'values must be an object that maps screen field names to values', 400);
    }

    // ── 1. the service, and the three members this door reads ────────────────
    const automation: any = await actionExec.resolveAutomationService(deps, context, envId);
    if (
        !automation
        || typeof automation.resume !== 'function'
        || typeof automation.getRun !== 'function'
        || typeof automation.getSuspendedScreen !== 'function'
    ) {
        throw resumeDoorError(
            deps,
            'Resuming a run is not supported here: the automation service must implement resume, getRun '
                + 'and getSuspendedScreen, and getRun is how this door checks who started the run.',
            501,
        );
    }

    // ── 2. whose run: the caller's own, and still paused ─────────────────────
    const callerId = typeof ec?.userId === 'string' && ec.userId !== '' ? ec.userId : undefined;
    const run: any = await automation.getRun(runId);
    const trigger = run?.trigger;
    if (!run || run.status !== 'paused' || !callerId || trigger?.userId !== callerId) {
        throw resumeDoorError(deps, notResumableRunMessage(runId), 404);
    }

    // ── 3. the flow action that admits it, through run_action's gates ────────
    // [ADR-0150 D4, #31696] A run of a flow name two packages hold carries its
    // slot key, `PACKAGE/NAME`: the run's flow is that NAME, of that package.
    // A candidate targets the name, and its target reaches the run's package
    // from the action's own (`run_action`'s resolution of it): the action that
    // could have started this run. A run whose key carries no package, of a
    // name two packages hold, is the one holder's whose slot is filed under
    // the key (`runSlotPackage`), else refused naming every holder.
    const runFlow = runFlowOf(run.flowName);
    const flowName: unknown = runFlow?.name ?? run.flowName;
    const runObject = typeof trigger?.object === 'string' && trigger.object !== '' ? trigger.object : undefined;
    const meta: any = await getMeta();
    const objectsListing = await readObjects?.();
    const declarations = await actionExec.collectActionDeclarations(deps, meta, objectsListing, await readActions?.());
    const activationEngine: any = await deps.getObjectQL(context, envId).catch(() => undefined);
    let runPackage = runFlow?.packageId;
    const runName = runPackage === undefined && typeof flowName === 'string' ? flowName.replace(/^\u0000/, '') : '';
    const shared = runName ? bareNameRefusal(automationAddressRegistryOf(activationEngine), 'flow', runName) : undefined;
    if (shared) {
        runPackage = runSlotPackage(automation, runName, run.flowName, shared.candidates.flatMap((c) => (c.kind === 'package' ? [c.packageId] : [])));
        if (runPackage === undefined) throw resumeDoorError(deps, shared.message, 409, { candidates: shared.candidates });
    }
    const candidates = declarations.filter(({ action, objectName, packageId }) =>
        action?.type === 'flow'
        && !actionExec.isDeclarativeUpdateAction(action)
        && typeof action?.target === 'string'
        && action.target === flowName
        && (runPackage === undefined
            || flowHolderForCaller(activationEngine?.registry, action.target, packageId) === runPackage)
        && (runObject === undefined ? actionExec.isObjectLessActionKey(objectName) : objectName === runObject));
    let admitted: { action: any; objectName: string } | undefined;
    let handOff = false;
    let firstRefusal: Error | undefined;
    // [ADR-0106 D1] A candidate this caller is not shown does not exist for
    // them, as `run_action` answers it: it admits nothing and is no refusal.
    const callerMasker = actionRunMasker(deps, context);
    const objectsByName = new Map<string, any>();
    for (const o of objectsListing ?? []) if (typeof o?.name === 'string') objectsByName.set(o.name, o);
    for (const candidate of candidates) {
        const projected = await projectActionForCaller(callerMasker, {
            action: candidate.action, objectName: candidate.objectName, obj: candidate.obj,
            readObject: async (other) => objectsByName.get(other)
                ?? (typeof meta?.getObject === 'function' ? await meta.getObject(other) : undefined),
        });
        if (projected.kind === 'fault') throw actionRunFieldVisibilityRefusal(projected.object);
        if (projected.kind === 'withhold') continue;
        const admission = resumeAdmissionRefusal(deps, candidate, ec, activationEngine, hostDoor?.confirmation);
        if (!(admission instanceof Error)) {
            admitted = candidate;
            handOff = admission.handOff;
            break;
        }
        firstRefusal ??= admission;
    }
    if (!admitted) {
        throw firstRefusal ?? resumeDoorError(
            deps,
            `Run '${runId}' is a run of flow '${String(flowName)}'${runObject ? ` on '${runObject}'` : ''}, `
                + 'and no flow action targets that flow there. resume_run only continues a run that an action '
                + 'exposed to AI could have started.',
            403,
        );
    }
    const { action, objectName } = admitted;
    const recordId = typeof trigger?.recordId === 'string' && trigger.recordId !== '' ? trigger.recordId : undefined;

    // [#33690] A gated action's resume is handed to the person, after steps 4
    // and 5 so nobody is asked to confirm a resume refused anyway: nothing
    // resumes, the run stays parked, and no invocation row is written.
    //
    // [#33712] Where the person's client can be elicited, they are asked there
    // instead, after the same steps: `accept` resumes the run below, as any
    // admitted resume; any other answer refuses the call and the run stays
    // parked. Nothing is handed off then.
    // [#34515] The screen an approval is bound to: the one the host passed
    // back for an approved hand-off, or the one an elicited person was asked
    // about (below). Step 5 refuses a run no longer paused on it.
    let boundScreenNodeId = hostDoor?.screenNodeId;
    if (handOff && elicitConfirmation) {
        const { subject, screen } = await refuseUnresumableAdmittedRun(deps, automation, runId, { objectName, recordId, driver, envId, ec, callData });
        const elicited = await actionExec.elicitActionConfirmation(
            elicitConfirmation,
            actionExec.actionConfirmationElicitSubject(
                action,
                typeof action?.name === 'string' && action.name ? action.name : String(flowName),
                objectName, recordId, objectsByName.get(objectName), subject.record,
            ),
        );
        if ('refused' in elicited) {
            throw resumeDoorError(deps, elicited.refused.message, elicited.refused.status, {
                code: elicited.refused.code,
                ...elicited.refused.details,
            });
        }
        // The person answered some time after the gates were read: ask the
        // admitting action's gates again before the resume below, which reads
        // the subject and the screen again itself (`continueAdmittedRun`).
        const regated = resumeAdmissionRefusal(deps, admitted, ec, activationEngine);
        if (regated instanceof Error) throw regated;
        // [#34515] The person answered for the screen the run was parked on
        // then: a run that moved on meanwhile is refused at step 5.
        boundScreenNodeId = screenNodeIdOf(screen);
    } else if (handOff) {
        // [#34515] The hand-off names the screen the values were given for,
        // so the host can bind its approval to it (`dispatchActionResume`).
        const { screen } = await refuseUnresumableAdmittedRun(deps, automation, runId, { objectName, recordId, driver, envId, ec, callData });
        const screenNodeId = screenNodeIdOf(screen);
        const answer = await actionExec.handOffActionConfirmation(deps, context, envId, {
            actionName: typeof action?.name === 'string' && action.name ? action.name : String(flowName),
            ...(actionExec.isObjectLessActionKey(objectName) ? {} : { objectName }),
            ...(recordId !== undefined ? { recordId } : {}),
            params: {},
            door: 'mcp',
            run: { runId, values: values ?? {}, ...(screenNodeId !== undefined ? { screenNodeId } : {}) },
        }, ec);
        if ('refused' in answer) {
            throw resumeDoorError(deps, answer.refused.message, answer.refused.status, {
                code: answer.refused.code,
                ...answer.refused.details,
            });
        }
        return answer.pending;
    }

    // [#27908 — ruling 6513869839 on #27681, parameter 3] THE INVOCATION ROW,
    // as `run_action` writes it: the call cleared steps 1–3, so from here on
    // one `action_invocation` row is written whether the resume answers or is
    // refused, naming this door (`surface: 'mcp'`, set from the door's
    // identity), the admitting flow action, and the run it continued. A
    // refusal in steps 1–3 resumed nothing and writes no row.
    // [#34386] At the host door the row names no surface, as the host action
    // door's row does (`dispatchActionRequest`): the call came through
    // neither REST nor MCP.
    const invocation = {
        context: hostDoor ? (ec && typeof ec === 'object' ? ec : ({} as any)) : withActionSurface(ec, 'mcp'),
        actionName: typeof action?.name === 'string' && action.name ? action.name : String(flowName),
        objectName: actionExec.isObjectLessActionKey(objectName) ? undefined : objectName,
        recordId,
        branch: 'flow' as const,
        runId,
    };
    let answer: any;
    try {
        answer = await continueAdmittedRun(deps, automation, runId, values, {
            action, objectName, recordId, driver, envId, ec, callData, boundScreenNodeId,
        });
    } catch (err) {
        await recordActionInvocation(deps, context, envId, {
            ...invocation, outcome: 'failed', ...actionInvocationFailure(err),
        });
        throw err;
    }
    await recordActionInvocation(deps, context, envId, { ...invocation, outcome: 'succeeded' });
    return answer;
}

/**
 * [#34386] The host's door to `resume_run`: the approval leg of a handed-off
 * `resume_run` (`ActionConfirmationHandOff.run`, `@objectstack/spec/contracts`),
 * published as `dispatchActionResume` (`../action-dispatch.ts`).
 *
 * The amended confirmation contract says that approving a handed-off
 * `resume_run` resumes THAT parked run, with the values the call carried, as
 * the approver, who must be the run's owner, every gate re-checked at that
 * moment. This door is that sequence: {@link resumeActionRun}'s steps 1 to 6,
 * asked again as `executionContext`, so a host keeps no second copy of them.
 *
 *  - Step 2 refuses a run that is no longer paused, and a run another person
 *    started, with the door's one not-found answer (`404`).
 *  - Step 3 asks every gate of the action that admits the run; its
 *    confirmation gate reads `confirm` as a host action door reads it
 *    (`dispatchAction`'s member gate): a declared-gated action resumes on the
 *    person's `confirm: true` and is refused `428 ACTION_CONFIRMATION_REQUIRED`
 *    without it. Nothing is handed off again, and an AI service account is
 *    refused whatever it carries (ADR-0151 D3 rule 3).
 *  - Steps 4 and 5 read the subject record again as the person and require
 *    the run to be paused on a screen; step 6 resumes it.
 *
 * Step 2 refuses only a run that is no longer paused: a wizard moved on to
 * its next screen is still paused under the same run id. [#34515] So the
 * host passes back the screen the hand-off was given on
 * (`ActionConfirmationHandOff.run.screenNodeId`, as `screenNodeId`), and
 * step 5 refuses a run no longer paused on it, `409 RESOURCE_CONFLICT`,
 * leaving it where it is: a second approval of the same hand-off, or one
 * that lands after the person advanced the wizard in the app, resumes
 * nothing. Without it, the run's current screen is resumed with the values
 * given. Deciding a pending item once is the host's.
 *
 * Placement is the host action door's ({@link PlaceRequestInEnvironment}).
 * What stays the host's before it calls, as for `dispatchAction`: resolving
 * the person's envelope against the placed kernel, the ADR-0069
 * authentication-policy gate, the environment-membership gate, and the
 * approve door's own rule that only a person's signed-in session decides.
 *
 * The answer is the REST envelope: `200` with `resume_run`'s success value
 * (`{ ok, action, objectName, recordId?, result }`) as `data`, or the
 * refusal's ADR-0112 envelope. One invocation row is written for a call that
 * cleared steps 1 to 3, as at the MCP door, with no surface.
 */
export async function resumeActionRunRequest(
    deps: DomainHandlerDeps,
    request: ActionResumeRequest,
    place: PlaceRequestInEnvironment,
): Promise<ActionDispatchAnswer> {
    const ec: any = request?.executionContext;
    // [#5519] ANONYMOUS BASELINE, first, as at the host action door.
    if (shouldDenyAnonymous({ userId: ec?.userId, isSystem: ec?.isSystem, method: 'POST' })) {
        return deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }) as ActionDispatchAnswer;
    }
    const runId = request?.runId;
    if (typeof runId !== 'string' || runId === '') {
        return deps.error('dispatchActionResume needs the paused run\'s id (`runId`)', 400) as ActionDispatchAnswer;
    }
    const namedEnvironment = typeof request.environmentId === 'string' && request.environmentId !== '' ? request.environmentId : undefined;
    const context: HttpProtocolContext = { request: { headers: {} }, executionContext: ec };
    // [ADR-0006 Phase 5] PLACEMENT, as at the host action door. The route
    // path is informational only: no environment hint is derived from it.
    try {
        await place(context, {
            routePath: `/mcp/resume_run/${encodeURIComponent(runId)}`,
            ...(namedEnvironment ? { environmentId: namedEnvironment } : {}),
        });
    } catch (err) {
        return deps.errorFromThrown(err, 500) as ActionDispatchAnswer;
    }
    if (namedEnvironment && !deps.isMultiTenantHost()) context.environmentId = namedEnvironment;
    if (!context.environmentId) {
        const def = deps.getDefaultEnvironmentId();
        if (def) context.environmentId = def;
    }
    const { getMeta, readServedObjects, readServedActions } = actionDeclarationReads(deps, context);
    const confirmation: AIActionConfirmation = request.confirm !== undefined ? { confirm: request.confirm } : {};
    // [#34515] The screen the approved hand-off was given on, when the host passes it back.
    const screenNodeId = request.screenNodeId;
    if (screenNodeId !== undefined && (typeof screenNodeId !== 'string' || screenNodeId === '')) {
        return deps.error('dispatchActionResume\'s `screenNodeId` names the screen the hand-off was given on: a non-empty string', 400) as ActionDispatchAnswer;
    }
    try {
        const answer = await resumeActionRun(deps, context, runId, request.values !== undefined ? { values: request.values } : {}, {
            driver: (context as any).dataDriver,
            envId: context.environmentId,
            ec,
            getMeta,
            readObjects: readServedObjects,
            readActions: readServedActions,
            callData: actionExec.callData.bind(null, deps, context),
            hostDoor: { confirmation, ...(screenNodeId !== undefined ? { screenNodeId } : {}) },
        });
        return deps.success(answer) as ActionDispatchAnswer;
    } catch (err) {
        return resumeDoorAnswerOf(deps, err);
    }
}

/**
 * `resume_run` steps 4–6 for the run {@link resumeActionRun} admitted: the
 * subject record read again as the caller, the screen-pause check, and the
 * resume itself. Split out so the door can write the invocation row for
 * whatever this answers or throws (#27908); the code is unchanged.
 */
async function continueAdmittedRun(
    deps: DomainHandlerDeps,
    automation: any,
    runId: string,
    values: Record<string, unknown> | undefined,
    admitted: {
        action: any;
        objectName: string;
        recordId: string | undefined;
        driver: any;
        envId?: string;
        ec: any;
        callData: (action: string, params: any, dataDriver?: any, scopeId?: string, ec?: any) => Promise<any>;
        /** [#34515] The screen the approval was given on, when it is bound to one. */
        boundScreenNodeId?: string;
    },
): Promise<any> {
    const { action, objectName, recordId } = admitted;
    await refuseUnresumableAdmittedRun(deps, automation, runId, admitted);

    // ── 6. resume, answered through the table the REST door uses ─────────────
    const signal: { variables?: Record<string, unknown> } = {};
    if (values !== undefined) signal.variables = values;
    const result = await automation.resume(runId, signal);
    const refusal = await classifyResumeResult(deps, automation, runId, result);
    if (refusal) throw resumeDoorError(deps, refusal.message, refusal.status, refusal.details, refusal.extra);
    return { ok: true, action: action.name, objectName, ...(recordId ? { recordId } : {}), result: result ?? null };
}

/**
 * `resume_run` steps 4–5 for an admitted run: the subject record read again
 * as the caller, and the screen-pause check. Throws the refusal; reads
 * nothing else. Asked before a resume and before a hand-off (#33690) alike.
 *
 * [#34515] Step 5 also binds an approval to its screen: given
 * `boundScreenNodeId`, a run paused on another screen is refused 409 and left
 * where it is. A multi-screen wizard stays `paused` under the same run id as
 * it moves from screen to screen, so step 2 alone would let an approval given
 * for one screen (a second approval of the same hand-off, or one that lands
 * after the person advanced the wizard in the app) submit its values to the
 * next screen, as the approver.
 */
async function refuseUnresumableAdmittedRun(
    deps: DomainHandlerDeps,
    automation: any,
    runId: string,
    admitted: {
        objectName: string;
        recordId: string | undefined;
        driver: any;
        envId?: string;
        ec: any;
        callData: (action: string, params: any, dataDriver?: any, scopeId?: string, ec?: any) => Promise<any>;
        boundScreenNodeId?: string;
    },
): Promise<{ subject: actionExec.ActionSubjectRecordLoad; screen: ScreenSpec }> {
    const { objectName, recordId, driver, envId, ec, callData, boundScreenNodeId } = admitted;

    // ── 4. the subject record, read again in the caller's own scope ──────────
    const subject = await actionExec.loadActionSubjectRecord(objectName, recordId, () =>
        callData('get', { object: objectName, id: recordId }, driver, envId, ec));
    actionExec.refuseDeniedSubjectLoad(objectName, recordId, subject);

    // ── 5. a screen pause, and nothing else ──────────────────────────────────
    const screen = await automation.getSuspendedScreen(runId);
    if (!screen) {
        throw resumeDoorError(
            deps,
            `Run '${runId}' is paused, but not on a screen. resume_run submits the values of a screen; it does `
                + 'not continue a run that is waiting on anything else.',
            409,
        );
    }
    // [#34515] An approval bound to a screen resumes that screen and no other.
    if (boundScreenNodeId !== undefined && screenNodeIdOf(screen) !== boundScreenNodeId) {
        throw resumeDoorError(
            deps,
            `Run '${runId}' has moved on: this approval was given for screen '${boundScreenNodeId}', and the run is `
                + `now paused on ${screenNodeIdOf(screen) !== undefined ? `screen '${screenNodeIdOf(screen)}'` : 'another screen'}. `
                + 'Nothing was resumed and the run stays where it is; ask again on the screen it is on now.',
            409,
        );
    }
    // [#33712] The subject as read, so an elicitation can name the record by its title.
    return { subject, screen };
}

/** [#34515] A screen's node id (`ScreenSpec.nodeId`), when the engine named one. */
function screenNodeIdOf(screen: ScreenSpec | null | undefined): string | undefined {
    const nodeId = (screen as { nodeId?: unknown } | null | undefined)?.nodeId;
    return typeof nodeId === 'string' && nodeId !== '' ? nodeId : undefined;
}

/**
 * [#15705] `run_action`'s admission gates, in `run_action`'s order, for ONE
 * candidate action. Answers the refusal, or the admission (whether the call
 * is handed to the person, #33690) when the candidate admits the call. Each
 * gate uses the shared helper `invokeBusinessAction` uses, so the reasons
 * cannot drift apart. The system-object, exposure and permission refusals are thrown as plain errors there. Here they carry
 * `PERMISSION_DENIED` / 403 (the code and status REST `/actions` answers for
 * the permission gate), because a refusal on a new door should be
 * machine-readable.
 */
function resumeAdmissionRefusal(
    deps: DomainHandlerDeps,
    candidate: { action: any; objectName: string },
    ec: any,
    activationEngine: any,
    hostConfirmation?: AIActionConfirmation,
): Error | { handOff: boolean } {
    const { action, objectName } = candidate;
    const systemObject = actionExec.systemObjectActionExposureError(deps, action, objectName);
    if (systemObject) return resumeDoorError(deps, systemObject, 403);
    const exposure = actionExec.actionAiExposureError(deps, action, objectName);
    if (exposure) return resumeDoorError(deps, exposure, 403);
    const permission = actionExec.actionPermissionError(deps, action, ec, objectName);
    if (permission) return resumeDoorError(deps, permission, 403);
    const disabled = actionExec.disabledActionRefusal(deps, activationEngine, action);
    if (disabled) return resumeDoorError(deps, disabled.message, disabled.status, { code: disabled.code });
    // [ADR-0151 D3 rule 3] The caller's envelope rides along: an AI service
    // account never confirms for itself, so it is refused whatever it sends.
    // [#34386] The host's resume door carries the person's confirmation (an
    // approved hand-off): the member gate a host action door asks reads it.
    // An AI service account is refused there whatever it carries; nothing is
    // handed off again.
    if (hostConfirmation !== undefined) {
        const refused = actionExec.actionConfirmationRefusal(deps, action, hostConfirmation, objectName, ec);
        if (refused) {
            return resumeDoorError(deps, refused.message, refused.status, { code: refused.code, ...refused.details });
        }
        return { handOff: false };
    }
    // [#33690] The request is not read: a gated resume by anyone else is
    // handed to the person, never admitted on the caller's `confirm`.
    const confirmation = actionExec.aiDoorConfirmation(deps, action, objectName, ec);
    if (confirmation.kind === 'refuse') {
        return resumeDoorError(deps, confirmation.refusal.message, confirmation.refusal.status, {
            code: confirmation.refusal.code,
            ...confirmation.refusal.details,
        });
    }
    return { handOff: confirmation.kind === 'hand-off' };
}
