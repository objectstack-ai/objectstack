// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 12] The CRUD routes of `RestServer` — the six record doors
 * under `{basePath}{crud.dataPrefix}`: `GET /:object` (list), `GET
 * /:object/:id` (read), `POST /:object` (create), `POST /:object/query` (the
 * QueryAST query), `PATCH /:object/:id` (update) and `DELETE /:object/:id`
 * (delete) — moved out of `rest-server.ts` whole. `registerRoutes` calls the
 * registrar once for each base it mounts while `api.enableCrud` is on, AFTER
 * the data-action routes, whose literal action segments the greedy
 * `/:object/:id` matchers here would otherwise capture.
 *
 * A MOVE, not a redesign. The function below is the body of
 * `RestServer#registerCrudEndpoints` as it stood, re-indented one level and
 * otherwise unedited: the same six routes, registered in the same order under
 * the same five `crud.operations` switches (`list` gates two of them), by the
 * same handlers, answering the same bodies.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps the private method —
 * the published `dist/*.d.ts` lists its name, docblock and position — and the
 * body is one host literal ({@link CrudRouteHost}) plus `.call(host, basePath)`.
 * A method is handed over as a closure that calls it on the server at call
 * time, so a test double or spy set on the server is still the one the body
 * reaches.
 *
 * Each member was checked on its own, not inherited from an earlier slice:
 *
 * - `config` goes BY VALUE. The body reads it once, in its first statement,
 *   while registration runs: `crud`, its `operations` and its `dataPrefix` are
 *   taken from it then, and the handlers close over those. The class assigns
 *   the field only in its constructor.
 * - `routeManager` goes BY VALUE. The body reads it only for its six
 *   `register` calls, which run while registration runs, and the class's one
 *   `routeManager` reassignment wraps `registerMetadataEndpointsInner`, never
 *   this registrar.
 * - No member goes as a getter, because the body reads no FIELD at request
 *   time. The protocol, the caller's execution context, the anonymous-deny
 *   gate and the per-object API exposure gate are each resolved per request by
 *   a METHOD of the class, and every method goes as a closure. No provider
 *   field is read either.
 *
 * Module-level names stay where they are declared. Two of them are declared in
 * `rest-server.ts` itself and are imported from it: `DATA_RECORD_READ_PARAMS`,
 * the read door's closed query-parameter set, which was already exported and
 * which its pin test imports from there; and `versionTokenRefusal`, the OCC
 * token rule, exported there for this module only (as slices 1 and 2 exported
 * theirs) because the runtime dispatcher's `/data` twin names that file as the
 * home of its full argument. The package entry re-exports neither, so the
 * published surface does not move, and both are read only at request time, so
 * the two modules importing each other cannot see them uninitialised. The data
 * doors' `ServerScopedDataRequest` comes from `data-action-routes.ts`, where
 * slice 1 moved it. The five data request types,
 * `assertFilterParamSuppliedOnce`, `logUnexpectedRouteError` and
 * `applyDroppedFieldsHeader`, which only this body read, are imported here
 * instead of there; every other name is imported from the module
 * `rest-server.ts` imports it from.
 */

// [#15866] The DATA doors' declared request types. Every literal these routes
// assemble is compiled against its declared request type through
// `ServerScopedDataRequest`, so a member the contract does not declare is a
// compile error at the call site instead of a payload no schema has seen.
import type {
    FindDataRequest,
    GetDataRequest,
    CreateDataRequest,
    UpdateDataRequest,
    DeleteDataRequest,
} from '@objectstack/spec/api';
import { zodIssuesToFields } from '@objectstack/spec/api';
import { validationFailure } from '@objectstack/types';
import type { ServerScopedDataRequest } from './data-action-routes.js';
import { applyDroppedFieldsHeader, logUnexpectedRouteError, mapDataError } from './error-response.js';
// [#7390] The filter slot is the one arity judgement the shared normalizer
// structurally cannot make (a filter AST IS an array), so the querystring
// ingress — the only layer that knows it is one — makes it instead.
import { assertFilterParamSuppliedOnce, refuseRepeatedQueryParams } from './query-multiplicity.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { DATA_RECORD_READ_PARAMS, versionTokenRefusal, type RestServer } from './rest-server.js';

/**
 * The `RestServer` members {@link registerCrudEndpoints} reads — every one of
 * them, and no other, in the order the body first reads them. Each is typed AS
 * the class member (an indexed access on the class), so a change to a member's
 * signature on the class is a change here too, and naming a member the class
 * does not have is a compile error. The module header says why none of them is
 * a getter.
 */
export interface CrudRouteHost {
    readonly config: RestServer['config'];
    readonly routeManager: RestServer['routeManager'];
    resolveProtocol: RestServer['resolveProtocol'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
    enforceApiAccess: RestServer['enforceApiAccess'];
}

/**
 * Register the CRUD endpoints for data operations —
 * `RestServer#registerCrudEndpoints`' body, called by that method with the
 * server as `this`.
 */
export function registerCrudEndpoints(this: CrudRouteHost, basePath: string): void {
    const { crud } = this.config;
    const dataPath = `${basePath}${crud.dataPrefix}`;
    const isScoped = basePath.includes('/environments/:environmentId');

    const operations = crud.operations;

    // GET /data/:object - List/query records
    if (operations.list) {
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/:object`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'list')) return;
                    // [#6877] Still NOT arity-gated as a whole, for the
                    // reason it never was: this route hands the WHOLE query
                    // record to `findData`, whose normalizer
                    // (`metadata-protocol`) owns every parameter's arity — the
                    // `$`-alias table, the implicit field-equality bucket, and
                    // the `$select`/`$expand`/`$searchFields` params that are
                    // legitimately multi-valued. Declaring an arity list here
                    // would be this file guessing at another package's
                    // contract.
                    //
                    // [#7390] ONE slot is the exception, and structurally so
                    // rather than by taste. A filter AST *is* an array
                    // (`['status','=','open']`), so #7386's arity gate cannot
                    // read `Array.isArray` as evidence of repetition on the
                    // filter slot: the normalizer serves this querystring and
                    // `POST /data/:object/query`'s arbitrary-JSON body through
                    // one door and cannot tell them apart. THIS layer can — on
                    // a querystring an array is a repeated parameter and can be
                    // nothing else — so the filter slot's arity is judged here,
                    // and only here, leaving the normalizer free of a heuristic.
                    //
                    // Refused, never resolved (maintainer ruling 2026-08-11 on
                    // #7390): last-wins and AND-merge are each a silent choice
                    // between two intents a caller actually expressed. Before
                    // this line the common shape was answered with the WRONG
                    // diagnosis — `malformedFilterArrayError`, telling a caller
                    // whose filters were both well-formed to check their AST
                    // syntax — and the rarer `?filter=status&filter=%3D&filter=open`
                    // spelled a valid AST and returned 200 with a filter nobody
                    // expressed. It throws rather than responding so both keep
                    // the envelope this route's other filter refusals already
                    // use; see the helper for why.
                    assertFilterParamSuppliedOnce(req.query);
                    const listRequest: ServerScopedDataRequest<FindDataRequest> = {
                        object: req.params.object,
                        query: req.query,
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.findData(listRequest);
                    res.json(result);
                } catch (error: any) {
                    const mapped = mapDataError(error, req.params?.object);
                    logUnexpectedRouteError(error, mapped);
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Query records',
                tags: ['data', 'crud'],
            },
        });
    }

    // GET /data/:object/:id - Get single record
    if (operations.read) {
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/:object/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    // [#6877] NOT gated, and this is a measured verdict
                    // rather than a name-based one: `GetDataRequest.select` /
                    // `.expand` are declared `z.array(z.string())`, and the
                    // consumer signature is
                    // `getData({ …, expand?: string | string[], select?: string | string[] })`
                    // — it splits the comma form itself and passes an array
                    // straight through. `?select=a&select=b` is therefore
                    // ALREADY correct end to end, and refusing it (or
                    // flattening it) would be the regression. The card listed
                    // this line under "array flows downstream"; measurement
                    // says the downstream was built for it.
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'get')) return;
                    // [#7606] Closed parameter set, AFTER the capability
                    // gates for the same reason #7527 put it there: which
                    // parameters a route understands is information, and a
                    // caller who may not read this object should not learn
                    // the shape of its ingress before being refused.
                    //
                    // This gate RESPONDS rather than throwing, as every
                    // `refuseUnknownQueryParams` door does. That was
                    // load-bearing here while the catch below rewrote every
                    // 400 into a 404; since #26816 it answers the mapped
                    // status, so the catch no longer turns a refusal into
                    // "no such record" either way.
                    if (refuseUnknownQueryParams(req, res, DATA_RECORD_READ_PARAMS)) return;
                    const { select, expand } = req.query || {};
                    const getRequest: ServerScopedDataRequest<GetDataRequest> = {
                        object: req.params.object,
                        id: req.params.id,
                        ...(select != null ? { select } : {}),
                        ...(expand != null ? { expand } : {}),
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.getData(getRequest);
                    res.json(result);
                } catch (error: any) {
                    // [#26816] The mapped status, as on every other data route
                    // and on the dispatcher's twin. This catch used to answer
                    // every mapped 400 as 404 — a rewrite kept from the days
                    // it answered EVERY error 404 (867ad87e5e), not an
                    // existence guard — so a malformed query on a real record
                    // (`?select=nope`, a blank `?select=`) read as "no such
                    // record". The 404s need no rewrite: a missing id and a
                    // row the caller may not read are the same no-row read,
                    // which `getData` answers `RECORD_NOT_FOUND`, declared
                    // 404. And a 400 says nothing about existence: each one
                    // `getData` raises comes before the read, byte-identical
                    // for any id (`data-record-read-malformed-query-door.test.ts`).
                    const mapped = mapDataError(error, req.params?.object);
                    logUnexpectedRouteError(error, mapped);
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Get record by ID',
                tags: ['data', 'crud'],
            },
        });
    }

    // POST /data/:object - Create record
    if (operations.create) {
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'create')) return;
                    // [#3899] The wire body IS the record. Validate the
                    // assembled protocol request (`CreateDataRequestSchema`,
                    // catalog `requestSchema`) so a non-record body — an
                    // array, a string, a number — answers 400 instead of
                    // reaching the engine as `data`. Per-field checks stay
                    // downstream (object metadata / validation rules); this
                    // gate is about the SHAPE the contract declares.
                    //
                    // [#23574] …the body AS THE CALLER SENT IT. It was
                    // `req.body ?? {}`, so a JSON `null` body parsed as an
                    // empty record and created an empty row (`201`). `null`
                    // is not the record `data` declares, so it is refused
                    // like an array, a string or a number, and the runtime
                    // dispatcher's twin (`domains/data.ts`) asks this gate
                    // over the same assembled request. An empty request
                    // body is not `null`: the HTTP adapter hands it over
                    // as `{}`, a record.
                    const { CreateDataRequestSchema } = await import('@objectstack/spec/api');
                    const createInput = { object: req.params.object, data: req.body };
                    const parsedCreate = (CreateDataRequestSchema as any).safeParse(createInput);
                    if (!parsedCreate.success) {
                        res.status(400).json({
                            error: 'Invalid create request',
                            code: 'VALIDATION_FAILED',
                            fields: zodIssuesToFields(parsedCreate.error?.issues, createInput),
                            object: req.params?.object,
                        });
                        return;
                    }
                    const createRequest: ServerScopedDataRequest<CreateDataRequest> = {
                        object: req.params.object,
                        data: req.body,
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.createData(createRequest);
                    // [#3431] Advertise fields the engine's create-side static-
                    // `readonly` strip dropped (`engine.insert`, relayed by
                    // `createData` as `droppedFields`) via the response header
                    // (body also carries `droppedFields`). Status stays 201.
                    applyDroppedFieldsHeader(res, result);
                    res.status(201).json(result);
                } catch (error: any) {
                    // [#24768] A NOT NULL refusal on a declared field arrives as
                    // the engine's `ValidationError`, already named by its label
                    // in the caller's locale; this door relabels nothing.
                    const mapped = mapDataError(error, req.params?.object);
                    logUnexpectedRouteError(error, mapped);
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Create record',
                tags: ['data', 'crud'],
            },
        });
    }

    // POST /data/:object/query — Spec-shape advanced query (QueryAST in body).
    // Supports server-side aggregation via { groupBy, aggregations, where, ... }
    // per spec/data/query.zod.ts. Mirrors what `client.data.query()` posts.
    // Returns FindDataResponse = { object, records, total? }.
    if (operations.list) {
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/query`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'list')) return;
                    // [#3899] Validate the QueryAST body against the declared
                    // contract (`FindDataRequestSchema`, catalog `requestSchema`).
                    // A malformed body used to be forwarded as-is — and since a
                    // dropped/mistyped clause does not narrow a query, it WIDENS
                    // it, `{"filter": …}` degraded into an unfiltered full read
                    // with a 200. The PATH object is written last (#3946) so a
                    // body `object` can neither dodge the `enforceApiAccess`
                    // gate above nor move the read. Validation only: the merged
                    // ORIGINAL body is forwarded, not the parse output, so the
                    // schema cannot inject defaults the engine did not receive
                    // before (the analytics-entry precedent, #3878).
                    //
                    // [#23574] …the body AS THE CALLER SENT IT. It was
                    // `req.body ?? {}`, so a JSON `null` body read as no
                    // query and answered the full record set (`200`).
                    // `query` declares a QueryAST or nothing, never `null`,
                    // so `null` is refused like a string or a number, and
                    // the runtime dispatcher's twin (`domains/data.ts`) now
                    // asks this gate over the same assembled request. An
                    // empty request body is not `null`: the HTTP adapter
                    // hands it over as `{}`, an empty query.
                    const { FindDataRequestSchema } = await import('@objectstack/spec/api');
                    const rawQuery = req.body;
                    const query = (rawQuery && typeof rawQuery === 'object' && !Array.isArray(rawQuery))
                        ? { ...rawQuery, object: req.params.object }
                        : rawQuery; // non-object bodies (`null` included) go to the schema as-is and fail with `query: invalid_type`
                    const findInput = { object: req.params.object, query };
                    const parsedFind = (FindDataRequestSchema as any).safeParse(findInput);
                    if (!parsedFind.success) {
                        res.status(400).json({
                            error: 'Invalid query request',
                            code: 'VALIDATION_FAILED',
                            fields: zodIssuesToFields(parsedFind.error?.issues, findInput),
                            object: req.params?.object,
                        });
                        return;
                    }
                    const queryRequest: ServerScopedDataRequest<FindDataRequest> = {
                        object: req.params.object,
                        query,
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.findData(queryRequest);
                    res.json(result);
                } catch (error: any) {
                    const mapped = mapDataError(error, req.params?.object);
                    logUnexpectedRouteError(error, mapped);
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Advanced query (QueryAST in body)',
                tags: ['data', 'crud'],
            },
        });
    }

    // PATCH /data/:object/:id - Update record
    if (operations.update) {
        this.routeManager.register({
            method: 'PATCH',
            path: `${dataPath}/:object/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    // OCC: clients opt in by sending either the standard
                    // `If-Match` header or an `expectedVersion` field in
                    // the JSON body. Body wins when both are present
                    // (lets callers override per-request without
                    // touching headers). See ConcurrentUpdateError in
                    // packages/objectql/src/protocol.ts.
                    const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                    const bodyVersion = (req.body && typeof req.body === 'object')
                        ? (req.body as any).expectedVersion
                        : undefined;
                    const expectedVersion = bodyVersion ?? ifMatchHeader;
                    // Strip the meta field out of the data payload so it
                    // doesn't get written as a column.
                    let data = req.body;
                    if (data && typeof data === 'object' && 'expectedVersion' in (data as any)) {
                        const { expectedVersion: _drop, ...rest } = data as any;
                        data = rest;
                    }
                    // [#23492] A token that can never carry a version is
                    // refused here, before anything is asked, and every
                    // other present token is forwarded below: no token the
                    // caller sent is read as "no token". THROWN as
                    // `validationFailure`, so this route's catch answers it
                    // through `mapDataError`, in the envelope it already
                    // gives the protocol's own refusal of `""`.
                    const versionRefusal = versionTokenRefusal(
                        expectedVersion,
                        bodyVersion != null ? 'The body\'s `expectedVersion`' : 'The `If-Match` header',
                    );
                    if (versionRefusal) throw validationFailure(versionRefusal, []);
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'update')) return;
                    // [#3899] Same gate as create: the wire body is the bare
                    // field patch (`expectedVersion` already stripped above),
                    // validated as the assembled `UpdateDataRequestSchema`
                    // request so a non-record body 400s instead of reaching
                    // the engine.
                    //
                    // [#23491] …the patch AS THE CALLER SENT IT. It was
                    // `data ?? {}`, so a JSON `null` body parsed as an empty
                    // patch and answered `200`: an update that changed no
                    // field and still moved the record's version. `null` is
                    // not the record the contract declares, so it is refused
                    // like an array, a string or a number, and the runtime
                    // dispatcher's twin (`domains/data.ts`) asks this gate
                    // over the same assembled request.
                    //
                    // [#23517] …and the token as the caller sent it, never
                    // its `String()`: this gate parsed `String(5)`, so a
                    // number `expectedVersion: z.string()` declares no room
                    // for was forwarded and judged `409`.
                    // `versionTokenRefusal` above already refuses it, so what
                    // reaches this gate and the forward below is a non-blank
                    // string.
                    const { UpdateDataRequestSchema } = await import('@objectstack/spec/api');
                    const updateInput = {
                        object: req.params.object,
                        id: req.params.id,
                        data,
                        ...(expectedVersion != null ? { expectedVersion } : {}),
                    };
                    const parsedUpdateOne = (UpdateDataRequestSchema as any).safeParse(updateInput);
                    if (!parsedUpdateOne.success) {
                        res.status(400).json({
                            error: 'Invalid update request',
                            code: 'VALIDATION_FAILED',
                            fields: zodIssuesToFields(parsedUpdateOne.error?.issues, updateInput),
                            object: req.params?.object,
                        });
                        return;
                    }
                    const updateRequest: ServerScopedDataRequest<UpdateDataRequest> = {
                        object: req.params.object,
                        id: req.params.id,
                        data,
                        ...(expectedVersion != null ? { expectedVersion } : {}),
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.updateData(updateRequest);
                    // [#3431] Advertise any LEGALLY-stripped write fields via
                    // the response header before serialising (the body also
                    // carries `droppedFields`). Status stays 200.
                    applyDroppedFieldsHeader(res, result);
                    res.json(result);
                } catch (error: any) {
                    // [#24768] As on the create: the engine named the field.
                    const mapped = mapDataError(error, req.params?.object);
                    logUnexpectedRouteError(error, mapped);
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Update record',
                tags: ['data', 'crud'],
            },
        });
    }

    // DELETE /data/:object/:id - Delete record
    if (operations.delete) {
        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/:object/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    // OCC: same opt-in protocol as PATCH (`If-Match`
                    // header or `expectedVersion` query string). DELETE
                    // has no JSON body, so we only accept the header
                    // and a query parameter.
                    // [#6877] `String(['1','2'])` is `'1,2'` — an OCC token
                    // no row carries, so a repeated `?expectedVersion=` turned
                    // an optimistic-concurrency check into a guaranteed
                    // conflict on a DESTRUCTIVE verb.
                    if (refuseRepeatedQueryParams(req, res, ['expectedVersion'])) return;
                    const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                    const queryVersion = (req.query && typeof req.query === 'object')
                        ? (req.query as any).expectedVersion
                        : undefined;
                    const expectedVersion = queryVersion ?? ifMatchHeader;
                    // [#23492] The `PATCH` above's rule, thrown the same
                    // way: a token that can never carry a version is
                    // refused, every other present token is forwarded.
                    const versionRefusal = versionTokenRefusal(
                        expectedVersion,
                        queryVersion != null ? 'The `expectedVersion` query parameter' : 'The `If-Match` header',
                    );
                    if (versionRefusal) throw validationFailure(versionRefusal, []);
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'delete')) return;
                    const deleteRequest: ServerScopedDataRequest<DeleteDataRequest> = {
                        object: req.params.object,
                        id: req.params.id,
                        ...(expectedVersion != null ? { expectedVersion: String(expectedVersion) } : {}),
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.deleteData(deleteRequest);
                    res.json(result);
                } catch (error: any) {
                    const mapped = mapDataError(error, req.params?.object);
                    logUnexpectedRouteError(error, mapped);
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Delete record',
                tags: ['data', 'crud'],
            },
        });
    }
}
