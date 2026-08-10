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
 */

import * as actionExec from '../action-execution.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

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
            // Spec: returns UpdateDataResponse = { object, id, record }
            const result = await actionExec.callData(deps, _context, 'update', { object: objectName, id, data: body }, _context.dataDriver, _context.environmentId, _context.executionContext);
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
            const result = await actionExec.callData(deps, _context, 'delete', { object: objectName, id }, _context.dataDriver, _context.environmentId, _context.executionContext);
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
            // Spec: returns FindDataResponse = { object, records, total?, hasMore? }
            const result = await actionExec.callData(deps, _context, 'query', { object: objectName, query: { ...query } }, _context.dataDriver, _context.environmentId, _context.executionContext);
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
