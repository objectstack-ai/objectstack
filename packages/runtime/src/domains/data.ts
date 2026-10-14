// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/data` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-10,
 * the terminal cut). CRUD + query over `callData` (protocol-first with
 * ObjectQL fallback, ADR-0049 exposure gate inside). On a multi-tenant
 * host (a KernelResolver is registered) an unresolved environment answers
 * 428 instead of silently serving the control plane.
 *
 * D11 invariant: the body stays HERE. `HttpDispatcher.handleData` is a thin
 * back-compat delegate, so folding this module back into it — the tempting
 * "the indirection buys nothing" cleanup — re-couples the data plane to
 * dispatcher state and restarts the accretion D11 decomposed. Dispatcher
 * facilities are reachable only through `DomainHandlerDeps`. Anchored in
 * scripts/adr-anchors/.
 *
 * ADR-0138 D2: the anonymous decision is this domain's FIRST statement
 * (`shouldDenyAnonymous`), taken once for every face — ahead of the path
 * parse, the environment check and every CRUD face, so a face added here
 * later is behind it from the day it lands, and an unauthenticated caller is
 * answered 401 whichever face it names. No D2 door class runs through this
 * domain: a declared `object_operation` endpoint (class 4) reaches `callData`
 * from the transport's fallback seam, never through this handler.
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import * as actionExec from '../action-execution.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
// [#23214] The `/data` list's filter-slot arity rule (#7390), the one
// `RestServer`'s list asks, imported rather than restated.
// [#23265] …and the repo's one sentence for a repeated single-valued
// parameter, which the delete's `?expectedVersion` answers.
import { assertFilterParamSuppliedOnce, repeatedQueryParamMessage } from '@objectstack/rest';

/**
 * [#23265] The request's `If-Match`, from either header shape a host hands
 * `dispatch()`: the raw Fetch `Request`'s `Headers` (the `@objectstack/hono`
 * catch-all) or a plain header record (a Node host). `Headers.get` answers
 * `null` for an absent header; that is folded to `undefined`, the record's
 * absence, so the two shapes answer one question. The `/meta` save reads its
 * precondition headers off the same two shapes (`metaSaveRequestOptions`).
 */
function requestIfMatch(headers: unknown): unknown {
    if (!headers || typeof headers !== 'object') return undefined;
    const h = headers as { get?: unknown } & Record<string, unknown>;
    if (typeof h.get === 'function') return (h.get as (name: string) => unknown).call(headers, 'if-match') ?? undefined;
    return h['if-match'] ?? h['If-Match'];
}

export function createDataDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/data',
        handler: (req, context) =>
            handleDataRequest(deps, req.path.substring(5), req.method, req.body, req.query, context),
    };
}

/**
 * Handles Data requests
 * path: sub-path after /data/ (e.g. "contacts", "contacts/123", "contacts/query")
 */
export async function handleDataRequest(deps: DomainHandlerDeps, path: string, method: string, body: any, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    // ANONYMOUS BASELINE — the domain's FIRST statement (ADR-0138 D2: the
    // decision is taken once per domain, never face by face). This domain made
    // no anonymous decision of its own: an unauthenticated caller reached the
    // face it named and was answered by that face — the CRUD gate's refusal of
    // the guest envelope, a validation answer, the environment check — instead
    // of the 401 every domain off the closed list of doors answers. Decided
    // here, before the path is even parsed, the caller learns nothing about the
    // object it named, and a face added below inherits the refusal.
    //
    // Asked about the user id alone, as the `/notifications` and `/keys` floors
    // are: this is a transport for a caller on the wire, and `dispatch()`
    // re-resolves identity for every request, so a caller arrives here as a
    // user or as the guest — the system context is never an inbound principal.
    // `method` rides along so a CORS preflight keeps the pass every other floor
    // gives it.
    if (shouldDenyAnonymous({ userId: _context.executionContext?.userId, method })) {
        return {
            handled: true,
            response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
        };
    }

    const parts = path.replace(/^\/+/, '').split('/');
    const objectName = parts[0];

    if (!objectName) {
        return { handled: true, response: deps.error('Object name required', 400) };
    }

    // Check if environment is resolved for data-plane requests. A
    // registered KernelResolver marks this host as multi-tenant (ADR-0006
    // Phase 5 — previously signalled by the env-registry service): a
    // data-plane request that the resolver did not attach to an
    // environment must not silently fall through to the host kernel.
    if (!_context.dataDriver && deps.isMultiTenantHost()) {
        return {
            handled: true,
            response: deps.error('Project not resolved. Please specify X-Environment-Id header or ensure hostname maps to a project.', 428)
        };
    }

    const m = method.toUpperCase();

    // 1. Custom Actions (query)
    //
    // [#5856] `batch` was listed here too, and was the last trace of a wiring
    // that never happened: no branch below routes it, and `callData`'s
    // `action === 'batch'` arm (which answered a silent `{ results: [] }`) has
    // been removed with it. Batching has ONE owner and it is not this domain
    // (route-ownership rule 1): `@objectstack/rest`'s `registerBatchEndpoints`
    // mounts both `POST /batch` (atomic, cross-object) and `POST
    // /data/:object/batch` (per-object) — which is exactly why a host serving
    // only this dispatcher reports `capabilities.transactionalBatch: false`
    // (#5672). Re-adding `batch` HERE would be a second implementation of a
    // path REST already serves, not the missing half of one.
    if (parts.length > 1) {
        const action = parts[1];

        // POST /data/:object/query
        if (action === 'query' && m === 'POST') {
            // [#3946] The PATH object is written LAST. The body used to be
            // spread OVER `object: objectName`, so `{"object":"other", …}`
            // moved the read to a different object than the URL named — the
            // same shape #3933 fixed on the REST bulk routes, found by the
            // follow-up sweep.
            //
            // Not an authorization bypass here: `callData` gates exposure on
            // `params.object` (action-execution.ts), so the gate followed the
            // body and agreed with the read. What broke is that the URL stopped
            // describing the operation — audit trails, logs and anything keyed
            // on the request path saw object A while object B was read — and
            // that one endpoint spoke a second dialect of a contract the REST
            // side had just standardised (path wins).
            //
            // The sibling handlers below never had this: they nest the caller's
            // data (`data: body`, `query: normalized`) instead of splatting it,
            // and the GET-by-id branch even allowlists its query params against
            // exactly this kind of parameter pollution.
            const result = await actionExec.callData(deps, _context, 'query', { ...body, object: objectName }, _context.dataDriver, _context.environmentId, _context.executionContext);
            return { handled: true, response: deps.success(result) };
        }

        // GET /data/:object/:id
        if (parts.length === 2 && m === 'GET') {
            const id = parts[1];
            // Spec: Only select/expand are allowlisted query params for GET by ID.
            // All other query parameters are discarded to prevent parameter pollution.
            const { select, expand } = query || {};
            const allowedParams: Record<string, unknown> = {};
            if (select != null) allowedParams.select = select;
            if (expand != null) allowedParams.expand = expand;
            // Spec: returns GetDataResponse = { object, id, record }
            const result = await actionExec.callData(deps, _context, 'get', { object: objectName, id, ...allowedParams }, _context.dataDriver, _context.environmentId, _context.executionContext);
            return { handled: true, response: deps.success(result) };
        }

        // PATCH /data/:object/:id
        if (parts.length === 2 && m === 'PATCH') {
            const id = parts[1];
            // [#23462] The optimistic-concurrency token, read the way
            // `RestServer`'s twin of this route reads it: the body's
            // `expectedVersion`, else `If-Match`, and forwarded to `updateData`,
            // which refuses an update whose version moved (`409
            // CONCURRENT_UPDATE`). This branch read neither and handed the
            // whole body over as the patch, so through the `@objectstack/hono`
            // catch-all a stale `If-Match` update was APPLIED, and a body
            // `expectedVersion` reached the engine as a field it refused as
            // unknown. The key is stripped from the patch whatever its value,
            // and a token is forwarded only when truthy: the twin's own
            // statements, so both doors send `updateData` the same thing.
            const bodyVersion = (body && typeof body === 'object') ? body.expectedVersion : undefined;
            const expectedVersion = bodyVersion ?? requestIfMatch(_context.request?.headers);
            let data = body;
            if (body && typeof body === 'object' && 'expectedVersion' in body) {
                const { expectedVersion: _token, ...patch } = body;
                data = patch;
            }
            // Spec: returns UpdateDataResponse = { object, id, record }
            const result = await actionExec.callData(deps, _context, 'update', {
                object: objectName,
                id,
                data,
                ...(expectedVersion ? { expectedVersion: String(expectedVersion) } : {}),
            }, _context.dataDriver, _context.environmentId, _context.executionContext);
            return { handled: true, response: deps.success(result) };
        }

        // DELETE /data/:object/:id
        if (parts.length === 2 && m === 'DELETE') {
            const id = parts[1];
            // Spec: returns DeleteDataResponse = { object, id, success }
            // [#5581] Said `deleted` until this fix — the one comment in this
            // trio that did NOT match its schema (`DeleteDataResponseSchema`
            // declares `success`; the 87/94 get/update comments above were
            // already right). It described the ObjectQL fallback's off-spec
            // body as if it were the spec, so the next reader of this line
            // would have written a consumer against `deleted`.
            //
            // [#23265] The optimistic-concurrency token, read the way
            // `RestServer`'s twin of this route reads it: `?expectedVersion`,
            // else `If-Match`, and forwarded to `deleteData`, which refuses a
            // delete whose version moved (`409 CONCURRENT_UPDATE`). This
            // branch read neither, so through the `@objectstack/hono`
            // catch-all a stale delete was APPLIED, answered `200` like a
            // request that sent no token. A repeated `?expectedVersion` is
            // refused first, as the twin's arity gate refuses it, before the
            // service is asked; a one-element array is one occurrence and an
            // empty one is none. A token is forwarded only when non-empty, the
            // twin's own test, so both doors send `deleteData` the same thing.
            const rawVersion = query?.expectedVersion;
            if (Array.isArray(rawVersion) && rawVersion.length > 1) {
                return {
                    handled: true,
                    response: deps.error(repeatedQueryParamMessage('expectedVersion', rawVersion.length), 400, { code: 'VALIDATION_ERROR' }),
                };
            }
            const queryVersion = Array.isArray(rawVersion) ? rawVersion[0] : rawVersion;
            const expectedVersion = queryVersion ?? requestIfMatch(_context.request?.headers);
            const result = await actionExec.callData(deps, _context, 'delete', {
                object: objectName,
                id,
                ...(expectedVersion ? { expectedVersion: String(expectedVersion) } : {}),
            }, _context.dataDriver, _context.environmentId, _context.executionContext);
            return { handled: true, response: deps.success(result) };
        }
    } else {
        // GET /data/:object (List)
        if (m === 'GET') {
            // HTTP transport params (filter/select/sort/top/skip, see
            // HttpFindQueryParamsSchema) ride through VERBATIM. Folding them
            // into QueryAST names is owned by the protocol's `findData`
            // normalizer alone (#3795): this route used to carry its own copy
            // of that fold, with the OPPOSITE precedence on three of the five
            // alias pairs — two readers of one prose contract, the exact
            // condition #3713 described. One fold, one answer; a second copy
            // here could only agree by inspection.
            //
            // [#23214] …with ONE exception, which is not a fold: the FILTER
            // slot's arity. A filter AST is an array too, so the normalizer
            // cannot tell a repeated `?filter=` from one AST; only the
            // querystring layer can, and `RestServer`'s list asks
            // `assertFilterParamSuppliedOnce` for exactly that reason. It is
            // asked here on the copy `findData` receives (it unwraps a
            // one-element array in place), and its throw is answered in this
            // transport's envelope with the code and sentence it carries.
            const listQuery = { ...query };
            try {
                assertFilterParamSuppliedOnce(listQuery);
            } catch (e: any) {
                return { handled: true, response: deps.error(e.message, 400, { code: e.code }) };
            }
            // Spec: returns FindDataResponse = { object, records, total?, hasMore? }
            const result = await actionExec.callData(deps, _context, 'query', { object: objectName, query: listQuery }, _context.dataDriver, _context.environmentId, _context.executionContext);
            return { handled: true, response: deps.success(result) };
        }

        // POST /data/:object (Create)
        if (m === 'POST') {
            // Spec: returns CreateDataResponse = { object, id, record }
            const result = await actionExec.callData(deps, _context, 'create', { object: objectName, data: body }, _context.dataDriver, _context.environmentId, _context.executionContext);
            const res = deps.success(result);
            res.status = 201;
            return { handled: true, response: res };
        }
    }

    return { handled: false };
}
