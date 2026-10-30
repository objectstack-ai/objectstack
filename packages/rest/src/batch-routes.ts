// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 2] The batch routes of `RestServer` — the cross-object
 * transactional `POST {basePath}/batch`, and the per-object
 * `POST /data/:object/batch`, `createMany`, `updateMany` and `deleteMany` —
 * moved out of `rest-server.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of
 * `RestServer#registerBatchEndpoints` as it stood, re-indented one level and
 * otherwise unedited: the same routes, registered in the same order, behind
 * the same mount conditions, by the same handlers, answering the same bodies.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 1 set, repeated (`data-action-routes.ts`' header carries the
 * full reasoning). The class keeps its private `registerBatchEndpoints` — the
 * published `dist/*.d.ts` lists its name, docblock and position — and its body
 * is one {@link BatchRouteHost} literal plus `registerBatchEndpoints.call(host,
 * basePath)`. A method is handed over as a closure that calls it on the server
 * at call time, so a test double or spy set on the server is still the one the
 * body reaches.
 *
 * Each field was checked on its own, not inherited from slice 1's sentence:
 *
 * - `config`, `routeManager` and `protocol` go BY VALUE. The body reads each
 *   one only while registration runs (`crud` / `batch` off the config, the four
 *   mount conditions off the protocol, every `register` call), and the class
 *   assigns `config` and `protocol` only in its constructor. Its one
 *   `routeManager` reassignment wraps `registerMetadataEndpointsInner`, never
 *   this registrar.
 * - `objectQLProvider` goes as a GETTER. The cross-object door reads it at
 *   REQUEST time (`wiredEngineOrLoud(Boolean(this.objectQLProvider), …)`), and
 *   the field is not `readonly`, so a value copied at registration could part
 *   from it. The getter reads the field the handler read, when it read it.
 *
 * Module-level helpers stay in `rest-server.ts` and are imported from it;
 * `wiredEngineOrLoud` is exported there for this module, and the package entry
 * re-exports neither it nor `apiAccessDenialFromEnable`, so the published
 * surface does not move. `ServerScopedDataRequest` comes from
 * `data-action-routes.ts`, where slice 1 moved it.
 */

import type {
    CreateDataRequest,
    BatchDataRequest,
    CreateManyDataRequest,
    UpdateManyDataRequest,
    DeleteManyDataRequest,
} from '@objectstack/spec/api';
import { zodIssuesToFields } from '@objectstack/spec/api';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
// The write-response rules (credential-class mask, `internal` omit) for
// the cross-object batch's direct-engine update arm.
import { omitInternalFieldsFromWriteResponse } from '@objectstack/core';
// Managing API keys is a signed-in-session act: the rule every other data
// route of this server asks at `enforceApiAccess`, asked per op here because
// this route judges each op's object itself.
import { apiKeyManagementCredentialRefusal } from '@objectstack/core';
// The engine's own by-id predicates, which `ObjectQL.update` / `.delete`
// dispatch on — the cross-object batch's up-front id check asks them.
import { resolveEngineDeleteDispatch, resolveEngineUpdateDispatch } from '@objectstack/metadata-core';
import { handleRouteError } from './error-response.js';
import type { ServerScopedDataRequest } from './data-action-routes.js';
import {
    apiAccessDenialFromEnable,
    wiredEngineOrLoud,
    type RestServer,
} from './rest-server.js';

/**
 * The `RestServer` members {@link registerBatchEndpoints} reads — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which field is a getter and why.
 */
export interface BatchRouteHost {
    readonly config: RestServer['config'];
    readonly routeManager: RestServer['routeManager'];
    readonly protocol: RestServer['protocol'];
    readonly objectQLProvider: RestServer['objectQLProvider'];
    resolveProtocol: RestServer['resolveProtocol'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
    enforceApiAccess: RestServer['enforceApiAccess'];
    enforceBatchSize: RestServer['enforceBatchSize'];
    loadObjectItem: RestServer['loadObjectItem'];
}

/** One operation of the cross-object batch, as the spec contract parses it. */
type CrossObjectBatchOp = {
    object: string;
    action: 'create' | 'update' | 'delete';
    id?: string;
    data?: Record<string, any>;
};

/**
 * A field value of the form `{ $ref: <earlier op index> }`: an intra-batch
 * reference the cross-object batch resolves, inside the transaction, to that
 * op's created id. One spelling for the resolver and for the up-front id check,
 * so the check never judges a value the resolver would have replaced.
 */
function isBatchRef(value: unknown): value is { $ref: unknown } {
    return Boolean(value) && typeof value === 'object' && '$ref' in (value as object);
}

/**
 * The row an `update` / `delete` op of the cross-object batch addresses. The
 * up-front refusal and both write arms read it HERE, so the refusal cannot pass
 * an op that its arm then hands to the engine without an id.
 *
 * - `update`: `id`, else the payload's `data.id`. An `id` key that is present
 *   wins even when it names no row: it is refused, and the payload's id does
 *   not silently replace it.
 * - `delete`: `id` alone. The delete arm addresses `where: { id }` and never
 *   read `data.id`, which the spec declares as the create/update payload. The
 *   up-front check used to accept `data.id` for a delete anyway, and the op
 *   then reached the engine with no address at all.
 */
function batchOpRowAddress(op: CrossObjectBatchOp, data: Record<string, any> | undefined): unknown {
    return op.action === 'delete' ? op.id : (op.id ?? data?.id);
}

/**
 * Does this address name no row the engine could write? Such an op is refused
 * up front with the answer a missing id gets. Before, it reached `ql.update` /
 * `ql.delete`, whose `… requires an ID or options.multi=true` throw answered as
 * a 500.
 *
 * Judged by the engine's OWN by-id predicates (`resolveEngineUpdateDispatch` /
 * `resolveEngineDeleteDispatch`, the functions `ObjectQL.update` and
 * `ObjectQL.delete` dispatch on), never by a mirrored `if`. A by-id address is
 * a TRUTHY scalar. So `undefined`, `null`, `''`, `0`, a boolean, an object and
 * an array name no row. A whitespace string does name one: the engine looks it
 * up and answers 404 when no row has it. ⛔ This is not an id FORMAT check.
 *
 * A `{ $ref }` is not judged here. It is resolved inside the transaction, and
 * a reference to no earlier create is refused there (`BATCH_UNRESOLVED_REF`).
 */
function namesNoRow(action: 'update' | 'delete', address: unknown): boolean {
    if (isBatchRef(address)) return false;
    return action === 'delete'
        ? resolveEngineDeleteDispatch({ where: { id: address } }).kind !== 'by-id'
        : resolveEngineUpdateDispatch({ id: address }, undefined).kind !== 'by-id';
}

/**
 * Register batch operation endpoints — `RestServer#registerBatchEndpoints`'
 * body, called by that method with the server as `this`. The method's own
 * docblock, which the published declaration carries, names it.
 */
export function registerBatchEndpoints(this: BatchRouteHost, basePath: string): void {
    const { crud, batch } = this.config;
    const dataPath = `${basePath}${crud.dataPrefix}`;
    const isScoped = basePath.includes('/environments/:environmentId');

    const operations = batch.operations;
    // [#3939] One cap, read once, applied by every bulk route below via
    // {@link enforceBatchSize} — see that method for why it lives here and
    // not in the Zod schemas.
    const maxBatch = batch.maxBatchSize ?? 200;

    // POST /batch — cross-object transactional batch (issue #1604 / ADR-0034).
    // Runs heterogeneous create/update/delete across objects in ONE engine
    // transaction (commit all or roll back all). Intra-batch references: a
    // field value of `{ $ref: <earlier op index> }` resolves to that op's
    // created id, so a child can reference its parent (master-detail). The
    // request is validated against the spec contract, and each op is gated by
    // the SAME per-object API-exposure rules (enable.apiEnabled / apiMethods)
    // as the single-record routes before any transaction is opened.
    this.routeManager.register({
        method: 'POST',
        path: `${basePath}/batch`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                // [#18559] The engine seam, reached the way its two SIBLING
                // consumers of this same slot already reach it —
                // `wiredEngineOrLoud` — so "no engine is wired" and "the
                // engine WAS wired and could not be resolved" stay two facts
                // instead of being told apart only by accident. The retired
                // spelling this replaces was a plain read:
                //
                //     this.objectQLProvider ? await this.objectQLProvider(environmentId) : undefined
                //
                // ⚠️ It did NOT re-collapse them — that is why this is not a
                // regression and was not a blocker for #14251's decidable
                // test. A rejection escaped the plain read, missed the 501
                // arm below (which tests `!ql || typeof ql.transaction !==
                // 'function'`, and a rejection never reaches it), and was
                // caught by this handler's GENERIC outer catch
                // (`handleRouteError`). So the two facts did differ on the
                // wire — 500 INTERNAL_ERROR against 501 NOT_IMPLEMENTED —
                // but through a catch-all that knows nothing about this
                // seam, at a status this slot's other two consumers do not
                // use for the same fact.
                //
                // ⭐ What decided it, measured on a real `RestServer` over a
                // real `ObjectKernel` rather than argued: THIS DOOR ALREADY
                // ANSWERS 503 on the single-kernel wiring. There
                // `computeExecCtx` takes its PROVIDER branch, which is
                // `wiredEngineOrLoud`, and raises before this line runs. The
                // 500 was reachable only on the MULTI-KERNEL wiring, where
                // the gate's kernel branch absorbs by design (see
                // `wiredEngineOrLoud`'s RESIDUE note) and hands the engine
                // question down to this line:
                //
                // | wiring, engine wired and FAILING | before | after |
                // |:--|:--|:--|
                // | single-kernel (gate raises first)| 503    | 503 — unchanged |
                // | multi-kernel (gate absorbs)      | **500**| **503** |
                //
                // ⇒ the repair does not choose a new wire answer for this
                // door; it removes a WIRING-DEPENDENT divergence, leaving
                // the answer this door already gave on the composition the
                // open core boots.
                //
                // ⛔ NOT `seamOrUndefined`. That helper SWALLOWS, and its own
                // docblock forbids routing the data-engine seam back through
                // it "to make the seams uniform".
                //
                // The wiring fact is the provider's PRESENCE, asked once and
                // never inferred from what it returned, so both ABSENCE
                // shapes reach the 501 below byte-for-byte as before: no
                // provider wired at all, and a provider that RESOLVES
                // `undefined`, which is the seam contract declaring absence
                // rather than failing. `wiredEngineOrLoud` also invokes the
                // provider SYNCHRONOUSLY, so a host wiring a non-`async`
                // provider — which the seam's declared type cannot prevent —
                // reaches the same answer as one that rejects (commit add6a1b1c).
                const ql = await wiredEngineOrLoud(
                    Boolean(this.objectQLProvider),
                    () => this.objectQLProvider!(environmentId),
                );
                if (!ql || typeof ql.transaction !== 'function') {
                    // Typed like every other 501 on this server (clone/search,
                    // #4067) so a client can key on the code, not the prose.
                    res.status(501).json({ error: 'Transactional batch not supported by this runtime', code: 'NOT_IMPLEMENTED' });
                    return;
                }

                // Validate the request against the spec contract (Zod-First).
                const { CrossObjectBatchRequestSchema } = await import('@objectstack/spec/api');
                const parsed = (CrossObjectBatchRequestSchema as any).safeParse(req.body ?? {});
                if (!parsed.success) {
                    res.status(400).json({ error: 'Invalid batch request', code: 'VALIDATION_FAILED', issues: parsed.error?.issues });
                    return;
                }
                const ops: CrossObjectBatchOp[] = parsed.data.operations;
                // All-or-nothing by construction: refuse a request that asks for
                // non-atomic semantics rather than silently applying atomically
                // (honest contract). Per-object partial batches use the
                // POST /data/:object/batch route instead.
                if (parsed.data.atomic === false) {
                    res.status(400).json({ error: 'Cross-object batch is always atomic; use POST /data/:object/batch for non-atomic per-object batches', code: 'BATCH_NOT_ATOMIC' });
                    return;
                }
                if (ops.length === 0) { res.json({ results: [] }); return; }
                // [#3939] Same check, same envelope as every other bulk route
                // now — this one used to be the only one that capped at all,
                // and it answered without a `code` for clients to key on.
                if (this.enforceBatchSize(res, ops.length, maxBatch)) return;

                // update/delete need a target id — the schema can't express this
                // conditionally, so surface it as a 400 up front. "Missing" is
                // the address the op's arm would hand the engine naming no row
                // (`namesNoRow`): a blank id gets the answer an absent one does.
                for (const op of ops) {
                    if ((op.action === 'update' || op.action === 'delete') && namesNoRow(op.action, batchOpRowAddress(op, op.data))) {
                        res.status(400).json({ error: `Operation '${op.action}' on '${op.object}' requires an id`, code: 'VALIDATION_FAILED' });
                        return;
                    }
                }

                // Enforce object-level API exposure (enable.apiEnabled /
                // apiMethods) for EVERY op BEFORE opening the transaction — the
                // batch write surface must honour the same per-object gate as the
                // single-record routes (ADR-0049 / #1889). Each distinct object
                // is read once; each distinct (object, action) is checked once.
                //
                // [#27899] Read through the single-record routes' own read
                // (`loadObjectItem`), so an op is judged on the object the data
                // door serves for its name: a legacy `ns__short` object named by
                // its short name is that object, as `registry.getObject`
                // resolves it. The object LIST keyed by declared name found
                // nothing under the short name, and the op passed on as unknown
                // to an engine that does resolve it.
                const p = await this.resolveProtocol(environmentId, req);
                const objects = new Map<string, any>();
                const checked = new Set<string>();
                for (const op of ops) {
                    const key = `${op.object}\u0000${op.action}`;
                    if (checked.has(key)) continue;
                    checked.add(key);
                    if (!objects.has(op.object)) objects.set(op.object, await this.loadObjectItem(p, environmentId, op.object));
                    const obj = objects.get(op.object);
                    if (!obj) continue; // unknown object → surfaced by the op inside the tx
                    // [#3391] Cross-object batch is a bulk surface: gate each op
                    // as `bulk ∧ child(op.action)` — the object must grant the
                    // `bulk` primitive AND the specific write it performs.
                    const denial = apiAccessDenialFromEnable(obj.enable, op.object, 'bulk', { bulkChild: op.action });
                    if (denial) { res.status(denial.status).json(denial.body); return; }
                }

                // A write to `sys_api_key` from a request an API key
                // authenticated is refused `403 PERMISSION_DENIED`, as on every
                // single-object route (`enforceApiAccess`): after the exposure
                // verdict above, so an op the object does not expose keeps its
                // `405`, and before the transaction opens.
                for (const op of ops) {
                    const credentialRefusal = apiKeyManagementCredentialRefusal({
                        object: op.object,
                        operation: 'bulk',
                        credential: (context as { __admittedBy?: 'api_key' | 'session' } | undefined)?.__admittedBy,
                    });
                    if (credentialRefusal) { handleRouteError(res, credentialRefusal, op.object); return; }
                }

                // Resolve `{ $ref: <opIndex> }` values against results collected
                // so far. A ref MUST point at an earlier create whose id is known;
                // anything else is a 400 (never a silent null FK).
                const resolveRefs = (data: any, out: any[]): any => {
                    if (!data || typeof data !== 'object') return data;
                    const result: any = Array.isArray(data) ? [] : {};
                    for (const [k, v] of Object.entries(data)) {
                        if (isBatchRef(v)) {
                            const idx = v.$ref;
                            const ref = typeof idx === 'number' ? out[idx] : undefined;
                            const refId = ref && (ref.id ?? ref._id);
                            if (refId == null) {
                                const err: any = new Error(`Unresolved $ref ${JSON.stringify(idx)} on field '${k}' — must reference an earlier create in the same batch`);
                                err.status = 400;
                                err.code = 'BATCH_UNRESOLVED_REF';
                                throw err;
                            }
                            result[k] = refId;
                        } else {
                            result[k] = v;
                        }
                    }
                    return result;
                };

                // [#3794] Write-observability on THIS surface too. The engine
                // strips `readonly` / `readonlyWhen` writes silently, and every
                // other write path already reports what it dropped (#3431/#3455)
                // — but this one did not, and it is precisely the path the
                // console's record form takes for a master-detail save. Result:
                // a user edited a `readonlyWhen`-locked field, got "updated
                // successfully", and the value never changed with nothing said
                // (#3794 problem 2). Each event is tagged with its operation
                // index, since `results` entries are bare record echoes with no
                // envelope to hang a per-row list on.
                const dropped: Array<DroppedFieldsEvent & { index: number }> = [];
                const results = await ql.transaction(async (trxCtx: any) => {
                    const out: any[] = [];
                    for (const [index, op] of ops.entries()) {
                        const data = resolveRefs(op.data, out);
                        if (op.action === 'create') {
                            // [#3835] Go through the protocol's create ingress —
                            // the SAME one `POST /data/:object` uses — rather than
                            // calling `ql.insert` directly. When this was written the
                            // #3043 static-`readonly` strip lived at that ingress and
                            // a direct `ql.insert` bypassed it, so `readonly` meant
                            // two different things on two create paths. Since the
                            // maintainer ruling of 2026-09-03 (option C, #14147) the
                            // strip runs inside `engine.insert` for every non-system
                            // caller, so both routes are stripped identically, and the
                            // platform-object carve-out (a `sys_`/`managedBy` object's
                            // own guard must REJECT a forged value, not silently
                            // swallow it) is the engine's as well. The routing stands
                            // on what the ingress still owns: the #3770 object-
                            // existence gate, the #7823 `internal: true` response
                            // strip and the `droppedFields` relay — one create
                            // ingress, one response contract, and a future change to
                            // its policy covers the batch for free. `trxCtx` carries
                            // the caller's context (including `isSystem`) plus the
                            // open transaction, so the engine's strip decides exactly
                            // as it does on the single route and the insert still
                            // joins this transaction.
                            const batchCreateRequest: ServerScopedDataRequest<CreateDataRequest> = {
                                object: op.object, data, context: trxCtx,
                            };
                            const created: any = await p.createData(batchCreateRequest);
                            for (const e of (created?.droppedFields ?? []) as DroppedFieldsEvent[]) {
                                dropped.push({ ...e, index });
                            }
                            out.push(created?.record);
                        } else if (op.action === 'update') {
                            // Update needs no ingress detour for the WRITE half:
                            // the engine enforces both static `readonly` (#2948)
                            // and `readonlyWhen` (#3042) on its own update path,
                            // and reports them through this listener.
                            const onFieldsDropped = (e: DroppedFieldsEvent) => { dropped.push({ ...e, index }); };
                            const id = batchOpRowAddress(op, data);
                            const updated = await ql.update(op.object, { ...data, id }, { context: trxCtx, onFieldsDropped });
                            // [#7823] …but the RESPONSE half moved to the ingress
                            // (A-prime ruling, 2026-08-13): the engine keeps its
                            // write results whole, so this direct-`ql.update`
                            // mouth applies the shared write-response rules
                            // itself (credential-class mask, then `internal`
                            // omit) before the row rides `results` out. Called
                            // from `@objectstack/core` directly — never through
                            // an optional protocol method, which a protocol
                            // without it would skip silently. FAIL CLOSED: with
                            // no registered schema to judge the fields by, only
                            // the id is echoed.
                            const updateSchema = (ql as any).registry?.getObject?.(op.object);
                            if (!updateSchema) {
                                out.push(updated && typeof updated === 'object' ? { id: (updated as any).id ?? id } : updated);
                            } else {
                                omitInternalFieldsFromWriteResponse(updateSchema, updated);
                                out.push(updated);
                            }
                        } else { // 'delete'
                            out.push(await ql.delete(op.object, { where: { id: batchOpRowAddress(op, data) }, context: trxCtx }));
                        }
                    }
                    return out;
                }, context);

                res.json({ results, ...(dropped.length > 0 ? { droppedFields: dropped } : {}) });
            } catch (error: any) {
                // Log only genuine server faults; client 4xx (validation,
                // unresolved ref, atomic rollback of a bad op) are expected.
                // This site used to judge on `status >= 500` alone, which
                // also swallowed the un-coded 400 `mapDataError` degrades an
                // UNRECOGNISED error to — a handler `TypeError` inside a
                // batch transaction vanished here. The shared predicate
                // keeps that one loud while staying quiet on the coded 4xx.
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'Cross-object transactional batch (atomic create/update/delete across objects)',
            tags: ['data', 'batch'],
        },
    });

    // POST /data/:object/batch - Generic batch endpoint
    if (batch.enableBatchEndpoint && this.protocol.batchData) {
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/batch`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    // [#3391] bulk ∧ child(body.operation) — the object must grant
                    // the `bulk` primitive AND the batched write kind.
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', context, { bulkChild: req.body?.operation })) return;
                    // [#3899] Validate against the declared contract
                    // (`BatchUpdateRequestSchema`, catalog `requestSchema`) —
                    // this route used to hand the body straight to the
                    // protocol, so `{ operation: 'updat', records: {} }`
                    // reached the engine as-is. Validation only: the ORIGINAL
                    // body is forwarded, not the parse output, so
                    // `BatchOptionsSchema`'s defaults (e.g. `atomic: true`)
                    // are not injected into a request that never sent them.
                    const { BatchUpdateRequestSchema } = await import('@objectstack/spec/api');
                    const batchInput = req.body ?? {};
                    const parsedBatch = (BatchUpdateRequestSchema as any).safeParse(batchInput);
                    if (!parsedBatch.success) {
                        res.status(400).json({
                            error: 'Invalid batch request',
                            code: 'VALIDATION_FAILED',
                            fields: zodIssuesToFields(parsedBatch.error?.issues, batchInput),
                            object: req.params?.object,
                        });
                        return;
                    }
                    // [#3939] Cap AFTER the shape check, so a caller gets the
                    // more specific answer first.
                    if (this.enforceBatchSize(res, parsedBatch.data.records.length, maxBatch, req.params?.object)) return;
                    const batchRequest: ServerScopedDataRequest<BatchDataRequest> = {
                        object: req.params.object,
                        request: req.body,
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.batchData!(batchRequest);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error, req.params?.object);
                }
            },
            metadata: {
                summary: 'Batch operations',
                tags: ['data', 'batch'],
            },
        });
    }

    // POST /data/:object/createMany - Bulk create
    if (operations.createMany && this.protocol.createManyData) {
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/createMany`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    // [#3391] bulk ∧ create — createMany requires the `bulk` primitive.
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', context, { bulkChild: 'create' })) return;
                    // [#3899] Body IS the records array on this route (what
                    // `client.data.createMany` posts). Validate the assembled
                    // protocol request (`CreateManyDataRequestSchema`, catalog
                    // `requestSchema`) so `{ records: [...] }` — updateMany's
                    // envelope, an easy cross-route slip — or any other
                    // non-array body 400s instead of reaching the engine as a
                    // single garbage "record".
                    const { CreateManyDataRequestSchema } = await import('@objectstack/spec/api');
                    const createManyInput = { object: req.params.object, records: req.body ?? [] };
                    const parsedCreateMany = (CreateManyDataRequestSchema as any).safeParse(createManyInput);
                    if (!parsedCreateMany.success) {
                        res.status(400).json({
                            error: 'Invalid createMany request — the body must be a JSON array of record objects',
                            code: 'VALIDATION_FAILED',
                            fields: zodIssuesToFields(parsedCreateMany.error?.issues, createManyInput),
                            object: req.params?.object,
                        });
                        return;
                    }
                    // [#3939] Cap AFTER the shape check.
                    if (this.enforceBatchSize(res, parsedCreateMany.data.records.length, maxBatch, req.params?.object)) return;
                    const createManyRequest: ServerScopedDataRequest<CreateManyDataRequest> = {
                        object: req.params.object,
                        records: req.body || [],
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.createManyData!(createManyRequest);
                    res.status(201).json(result);
                } catch (error: any) {
                    handleRouteError(res, error, req.params?.object);
                }
            },
            metadata: {
                summary: 'Create multiple records',
                tags: ['data', 'batch'],
            },
        });
    }

    // POST /data/:object/updateMany - Bulk update
    if (operations.updateMany && this.protocol.updateManyData) {
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/updateMany`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    // [#3391] bulk ∧ update — updateMany requires the `bulk` primitive.
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', context, { bulkChild: 'update' })) return;
                    // [#3933] Validate against the spec contract, and write the
                    // PATH object last. The body used to be spread over
                    // `object: req.params.object`, so `{"object":"other", …}`
                    // moved the write to a different object than the one
                    // `enforceApiAccess` had just cleared — that gate reads
                    // `req.params.object`, so `enable.apiEnabled` / `apiMethods`
                    // (ADR-0049) was enforced on A while B was written. Zod also
                    // strips unknown keys, which keeps a body `context` from
                    // becoming the execution context on a deployment where none
                    // resolves (e.g. an anonymous public-book read, #3963).
                    const { UpdateManyDataRequestSchema } = await import('@objectstack/spec/api');
                    const updateManyInput = { ...(req.body ?? {}), object: req.params.object };
                    const parsedUpdate = UpdateManyDataRequestSchema.safeParse(updateManyInput);
                    if (!parsedUpdate.success) {
                        res.status(400).json({
                            error: 'Invalid updateMany request',
                            code: 'VALIDATION_FAILED',
                            fields: zodIssuesToFields(parsedUpdate.error?.issues, updateManyInput),
                            object: req.params?.object,
                        });
                        return;
                    }
                    // [#3939] Cap AFTER the shape check, so a caller gets the
                    // more specific answer first.
                    if (this.enforceBatchSize(res, parsedUpdate.data.records.length, maxBatch, req.params?.object)) return;
                    const updateManyRequest: ServerScopedDataRequest<UpdateManyDataRequest> = {
                        ...parsedUpdate.data,
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.updateManyData!(updateManyRequest);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error, req.params?.object);
                }
            },
            metadata: {
                summary: 'Update multiple records',
                tags: ['data', 'batch'],
            },
        });
    }

    // POST /data/:object/deleteMany - Bulk delete
    if (operations.deleteMany && this.protocol.deleteManyData) {
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/deleteMany`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    // [#3391] bulk ∧ delete — deleteMany requires the `bulk` primitive.
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', context, { bulkChild: 'delete' })) return;
                    // [#3897] Validate against the spec contract instead of
                    // splatting the raw body into the protocol request. Zod
                    // object schemas STRIP unknown keys, which is what makes
                    // this a security boundary and not just an error message:
                    // `options` is narrowed to `BatchOptions`, so a body key
                    // (`options.where`, `options.multi`) can no longer ride
                    // into the engine's delete options, and a top-level
                    // `context` can no longer forge the caller's principal on
                    // a route reachable without auth. The protocol layer
                    // refuses the same shapes independently (defence in
                    // depth) — this stops them one hop earlier, with a 400
                    // the caller can act on.
                    // [#3933] The PATH object is written LAST for the same
                    // reason: `enforceApiAccess` gates on `req.params.object`,
                    // so a body `object` would move the delete to an object
                    // whose exposure policy was never checked.
                    const { DeleteManyDataRequestSchema } = await import('@objectstack/spec/api');
                    const deleteManyInput = { ...(req.body ?? {}), object: req.params.object };
                    const parsed = DeleteManyDataRequestSchema.safeParse(deleteManyInput);
                    if (!parsed.success) {
                        res.status(400).json({
                            error: 'Invalid deleteMany request',
                            code: 'VALIDATION_FAILED',
                            fields: zodIssuesToFields(parsed.error?.issues, deleteManyInput),
                            object: req.params?.object,
                        });
                        return;
                    }
                    // [#3939] The cap that matters most: since #3897 this
                    // route deletes per id, so the list length IS the engine
                    // round-trip count.
                    if (this.enforceBatchSize(res, parsed.data.ids.length, maxBatch, req.params?.object)) return;
                    const deleteManyRequest: ServerScopedDataRequest<DeleteManyDataRequest> = {
                        ...parsed.data,
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result = await p.deleteManyData!(deleteManyRequest);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error, req.params?.object);
                }
            },
            metadata: {
                summary: 'Delete multiple records',
                tags: ['data', 'batch'],
            },
        });
    }
}
