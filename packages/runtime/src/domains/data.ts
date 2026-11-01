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
// [#26898] …and the by-id read's closed parameter set (#7606), with the one
// sentence that refuses a name outside it.
import {
    assertFilterParamSuppliedOnce, repeatedQueryParamMessage,
    DATA_RECORD_READ_PARAMS, unknownQueryParamRefusalMessage,
} from '@objectstack/rest';
// [#23492] The dispatcher's one constructor for a `400 VALIDATION_FAILED`
// answer, which a refused version token returns in this transport's envelope.
// [#23491] …and the one Zod-issue → `fields[]` mapping, which a write whose
// assembled protocol request does not parse returns the same way.
import { validationFailure, fieldsFromZodIssues, VALIDATION_FAILED_STATUS } from '../validation-failure.js';
// [#23491] The request contracts `RestServer`'s twin routes validate (#3899).
// [#23574] …the query's too.
import { CreateDataRequestSchema, FindDataRequestSchema, UpdateDataRequestSchema } from '@objectstack/spec/api';
// [#28661] A write that landed answers its success even when a parent's
// roll-up could not be recomputed after it — the answer the protocol attached
// to the engine's refusal, the body `RestServer`'s twin routes answer too.
import { earnedAnswerOf, staleSummaryAnswerLines } from '@objectstack/metadata-protocol';

/**
 * [#28661] Run one `/data` write through `callData`, answering the body the
 * write EARNED when it landed but a parent's roll-up summary could not be
 * recomputed after it (objectql's `ERR_SUMMARY_RECOMPUTE`, carrying the answer
 * `ObjectStackProtocolImplementation` built). That refusal answered `500`, so
 * a client was told a landed write failed and a retried create duplicated
 * it. The stale column is logged at `error`, once per field
 * (`staleSummaryAnswerLines`). Every other error, and the refusal when no
 * answer rides on it (the ObjectQL fallback, which builds none), propagates
 * unchanged. `RestServer`'s twin is `answerEarnedWriteDespiteStaleSummary`.
 */
async function callDataWrite(
    deps: DomainHandlerDeps,
    objectName: string,
    call: () => Promise<unknown>,
): Promise<unknown> {
    try {
        return await call();
    } catch (e) {
        const earned = earnedAnswerOf(e);
        if (!earned) throw e;
        const log = deps.logger && typeof deps.logger.error === 'function'
            ? (line: string) => deps.logger.error(`[HttpDispatcher] ${line}`)
            : (line: string) => console.error(`[HttpDispatcher] ${line}`);
        for (const line of staleSummaryAnswerLines(e as Parameters<typeof staleSummaryAnswerLines>[0], objectName)) log(line);
        return earned;
    }
}

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

/**
 * [#23492] What this domain's `PATCH` and `DELETE` do with the
 * optimistic-concurrency token they read, before `callData` is asked: absent
 * (`undefined` or `null`, which falls through to `If-Match`), judged (a string
 * with something in it, forwarded as it is), or refused `400
 * VALIDATION_FAILED` (an empty or blank string, a number, a boolean, an array,
 * an object: a token shape that can never carry a version, maintainer decision
 * #20 ①). It replaces a truthiness test that let `expectedVersion: ''` or
 * `false`, and `?expectedVersion=`, hide a stale `If-Match` and run the write
 * unguarded.
 *
 * [#23517] A number is refused, no longer judged as its string:
 * `UpdateDataRequestSchema.expectedVersion` declares a string, and forwarding
 * `String(5)` answered `409` for a token the contract never admits. Only a
 * body token can be a number; `If-Match` and `?expectedVersion` are strings by
 * transport.
 *
 * `RestServer`'s twin routes ask the same function, statement for statement
 * (`versionTokenRefusal` in `packages/rest/src/rest-server.ts`, whose docblock
 * carries the full argument), so the two doors answer every token alike;
 * `data-update-expected-version.test.ts` and
 * `data-delete-expected-version.test.ts` hold them to it. Returns the refusal's
 * sentence, or `undefined` when the token is absent or judged.
 */
function versionTokenRefusal(token: unknown, spelling: string): string | undefined {
    if (token === undefined || token === null) return undefined;
    if (typeof token === 'string' && token.trim() !== '') return undefined;
    const shape = typeof token === 'string' ? 'empty'
        : Array.isArray(token) ? 'an array'
        : typeof token === 'object' ? 'an object'
        : `the ${typeof token} \`${String(token)}\``;
    return `${spelling} is ${shape}, which can never carry a version, so it is refused rather than read as `
        + 'no token. Send the version you read as a string (the record\'s `updated_at`), or omit both '
        + 'expectedVersion and If-Match to perform an unguarded write.';
}

/**
 * [#23491] This domain's answer to a `PATCH` or `POST` create whose assembled
 * protocol request (`UpdateDataRequestSchema` / `CreateDataRequestSchema`)
 * does not parse: `400 VALIDATION_FAILED`, `details.fields[]` naming each
 * failing member, before `callData` is asked. `RestServer`'s twin routes gate
 * the same assembled request (#3899); this domain had no gate, so a body that
 * is not a record (an array, a string, a number, `null`) reached the engine
 * as the patch or the row, and answered `500` with the engine's own error, or
 * created rows. RETURNED, not thrown, for the reason `versionTokenRefusal`'s
 * refusal is: a throw out of `dispatch()` reaches a `createHonoApp` host's
 * catch-all, which renders only some declared statuses.
 *
 * [#23574] …and the `POST /data/:object/query` read's
 * (`FindDataRequestSchema`), which had no gate either. Every caller asks the
 * object's API exposure first ({@link actionExec.refuseUnexposedDataAction}),
 * so this refusal never answers for an object the caller may not address.
 */
function requestSchemaRefusal(
    deps: DomainHandlerDeps,
    request: 'update' | 'create' | 'query',
    issues: Array<{ path: Array<string | number | symbol>; code: string; message: string }>,
    input: unknown,
): HttpDispatcherResult {
    const fields = fieldsFromZodIssues(issues, input);
    const message = `Invalid ${request} request: ${fields.map((f) => `${f.field}: ${f.message}`).join('; ')}`;
    return {
        handled: true,
        response: deps.errorFromThrown(validationFailure(message, fields), VALIDATION_FAILED_STATUS),
    };
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
            //
            // [#23574] The assembled request is validated as
            // `FindDataRequestSchema`, the gate `RestServer`'s twin has asked
            // since #3899, over the request that twin assembles, statement for
            // statement: a record body is the query, the path object written
            // into it last; any other body is the query as sent. This branch
            // had no gate, so a mistyped clause (`limit: "ten"`) or the retired
            // `joins` reached the engine, which dropped it and answered `200`
            // with the full record set; a number or a JSON `null` spread to no
            // query at all, another full read; and a string or an array was
            // spread into numbered keys the engine refused as unknown fields.
            // `RestServer` refused all of these `400 VALIDATION_FAILED`, and
            // both doors now do; `null` is refused like the rest, on both
            // (`query` declares a QueryAST or nothing, never `null`).
            //
            // The object's API exposure is asked first, as the twin's
            // `enforceApiAccess` is: a caller the object refuses is answered
            // that refusal, never a verdict on the shape of its body.
            await actionExec.refuseUnexposedDataAction(deps, _context, 'query', objectName, _context.environmentId, _context.executionContext);
            const query = (body && typeof body === 'object' && !Array.isArray(body))
                ? { ...body, object: objectName }
                : body;
            const findInput = { object: objectName, ...(query !== undefined ? { query } : {}) };
            const parsedFind = FindDataRequestSchema.safeParse(findInput);
            if (!parsedFind.success) return requestSchemaRefusal(deps, 'query', parsedFind.error.issues, findInput);
            // What is forwarded is the query the gate parsed (never the parse
            // output, as on the twin), handed to `callData` as `query`, the
            // path object riding as the request's `object` and not inside it:
            // the engine fallback (no protocol registered) serves a query's
            // clauses only. A body that passes the gate is a record (or
            // absent), and its clauses reach the engine exactly as they did
            // before. One body does not: a `query` key used to be unwrapped
            // here as the query itself (`callData` reads `params.query`
            // first), a second spelling the gate above never sees, so
            // `{ query: { limit: "ten" } }` would pass it and be read as the
            // full set. The catalog declares the body to be the QueryAST, so
            // a `query` key is the field it names, refused by the engine as
            // it is through `RestServer`.
            const { object: _pathObject, ...clauses } = (query ?? {}) as Record<string, unknown>;
            const result = await actionExec.callData(deps, _context, 'query', { object: objectName, query: clauses },
                _context.dataDriver, _context.environmentId, _context.executionContext);
            return { handled: true, response: deps.success(result) };
        }

        // GET /data/:object/:id
        if (parts.length === 2 && m === 'GET') {
            const id = parts[1];
            // [#26898] The route's closed parameter set (#7606), the one
            // `RestServer`'s twin asks, and at the same place in the gate
            // order: after the object's API exposure (the twin's
            // `enforceApiAccess`), since which parameters a route understands
            // is information a caller the object refuses should not learn.
            // Every name outside `select` / `expand` used to be dropped here,
            // so `?selct=name` answered `200` with every column where the twin
            // answered `400`; both now refuse it, before the read, whatever id
            // the path names.
            await actionExec.refuseUnexposedDataAction(deps, _context, 'get', objectName, _context.environmentId, _context.executionContext);
            const unknownParams = unknownQueryParamRefusalMessage(query, DATA_RECORD_READ_PARAMS);
            if (unknownParams !== undefined) {
                return { handled: true, response: deps.error(unknownParams, 400, { code: 'VALIDATION_ERROR' }) };
            }
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
            // unknown. The key is stripped from the patch whatever its value:
            // the twin's own statements, so both doors send `updateData` the
            // same thing.
            //
            // [#23492] …and every token the caller sent is judged or refused:
            // one that can never carry a version is refused `400` before
            // `callData` is asked (`versionTokenRefusal`), and every other
            // present token is forwarded. A truthiness test used to decide
            // the forward, so `expectedVersion: ''` or `false` hid a stale
            // `If-Match` and the update ran unguarded, on both doors.
            const bodyVersion = (body && typeof body === 'object') ? body.expectedVersion : undefined;
            const expectedVersion = bodyVersion ?? requestIfMatch(_context.request?.headers);
            let data = body;
            if (body && typeof body === 'object' && 'expectedVersion' in body) {
                const { expectedVersion: _token, ...patch } = body;
                data = patch;
            }
            const versionRefusal = versionTokenRefusal(
                expectedVersion,
                bodyVersion != null ? 'The body\'s `expectedVersion`' : 'The `If-Match` header',
            );
            if (versionRefusal) {
                return {
                    handled: true,
                    response: deps.errorFromThrown(validationFailure(versionRefusal, []), VALIDATION_FAILED_STATUS),
                };
            }
            // [#23491] The assembled request is validated as
            // `UpdateDataRequestSchema`, the gate `RestServer`'s twin has
            // asked since #3899, over the patch AS THE CALLER SENT IT (the
            // token stripped, nothing defaulted): a body that is not a record
            // is refused `400` here, before the engine is asked. It used to
            // reach `updateData` as the patch and answer `500` with the
            // engine's own error. A JSON `null` is refused like the rest: the
            // twin used to read it as `{}` and answer `200`, an update that
            // changed no field and still moved the record's version; both
            // doors now refuse it.
            //
            // [#23517] …and the token as the caller sent it too, never its
            // `String()`: the gate parsed `String(5)`, so a number the schema
            // declares no room for was forwarded and judged `409`.
            // `versionTokenRefusal` above already refuses it, so what reaches
            // this gate and the forward below is a non-blank string.
            //
            // [#23574] The object's API exposure is asked before this gate,
            // where the twin asks `enforceApiAccess`: between its token
            // refusal and its request gate. This gate used to run first, so
            // on an object whose exposure denies the update a body that is not
            // a record answered `400` here and `404` / `405` there, telling a
            // caller the object refuses how its ingress reads a body.
            await actionExec.refuseUnexposedDataAction(deps, _context, 'update', objectName, _context.environmentId, _context.executionContext);
            const updateInput = {
                object: objectName,
                id,
                data,
                ...(expectedVersion != null ? { expectedVersion } : {}),
            };
            const parsedUpdate = UpdateDataRequestSchema.safeParse(updateInput);
            if (!parsedUpdate.success) return requestSchemaRefusal(deps, 'update', parsedUpdate.error.issues, updateInput);
            // Spec: returns UpdateDataResponse = { object, id, record }
            const result = await callDataWrite(deps, objectName, () => actionExec.callData(deps, _context, 'update', updateInput,
                _context.dataDriver, _context.environmentId, _context.executionContext));
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
            // empty one is none.
            //
            // [#23492] The `PATCH` above's rule, the twin's own: a token that
            // can never carry a version is refused `400` before `callData` is
            // asked, and every other present token is forwarded. A truthiness
            // test used to decide the forward, so `?expectedVersion=` hid a
            // stale `If-Match` and the delete ran unguarded, on both doors.
            const rawVersion = query?.expectedVersion;
            if (Array.isArray(rawVersion) && rawVersion.length > 1) {
                return {
                    handled: true,
                    response: deps.error(repeatedQueryParamMessage('expectedVersion', rawVersion.length), 400, { code: 'VALIDATION_ERROR' }),
                };
            }
            const queryVersion = Array.isArray(rawVersion) ? rawVersion[0] : rawVersion;
            const expectedVersion = queryVersion ?? requestIfMatch(_context.request?.headers);
            const versionRefusal = versionTokenRefusal(
                expectedVersion,
                queryVersion != null ? 'The `expectedVersion` query parameter' : 'The `If-Match` header',
            );
            if (versionRefusal) {
                return {
                    handled: true,
                    response: deps.errorFromThrown(validationFailure(versionRefusal, []), VALIDATION_FAILED_STATUS),
                };
            }
            const result = await callDataWrite(deps, objectName, () => actionExec.callData(deps, _context, 'delete', {
                object: objectName,
                id,
                ...(expectedVersion != null ? { expectedVersion: String(expectedVersion) } : {}),
            }, _context.dataDriver, _context.environmentId, _context.executionContext));
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
            // [#23491] The `PATCH` above's gate, on the create: the assembled
            // request is validated as `CreateDataRequestSchema` before the
            // engine is asked. This branch had no gate, so an array body
            // created one row per element (`201`), a number created an empty
            // row (`201`), and a string answered the engine's own unknown-field
            // `400`; `RestServer`'s twin refused all three `400
            // VALIDATION_FAILED` (#3899). The assembled request is the twin's,
            // statement for statement.
            //
            // [#23574] …the body AS THE CALLER SENT IT. Both doors read a JSON
            // `null` as `{}` (`body ?? {}`) and created an empty row (`201`);
            // `data` declares a record, so `null` is refused like an array, a
            // string or a number, on both doors at once. An empty request body
            // is not `null`: every host hands it over as `{}`, a record. And
            // the object's API exposure is asked before this gate, as the
            // twin's `enforceApiAccess` is (see the `PATCH` above).
            await actionExec.refuseUnexposedDataAction(deps, _context, 'create', objectName, _context.environmentId, _context.executionContext);
            const createInput = { object: objectName, data: body };
            const parsedCreate = CreateDataRequestSchema.safeParse(createInput);
            if (!parsedCreate.success) return requestSchemaRefusal(deps, 'create', parsedCreate.error.issues, createInput);
            // Spec: returns CreateDataResponse = { object, id, record }
            const result = await callDataWrite(deps, objectName, () => actionExec.callData(deps, _context, 'create', createInput, _context.dataDriver, _context.environmentId, _context.executionContext));
            const res = deps.success(result);
            res.status = 201;
            return { handled: true, response: res };
        }
    }

    return { handled: false };
}
