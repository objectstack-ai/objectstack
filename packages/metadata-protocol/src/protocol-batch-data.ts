// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 1] The bulk data writes of `ObjectStackProtocolImplementation` —
 * `batchData` (with its ADR-0119 atomic path), `createManyData`,
 * `insertManyData`, `updateManyData` and `deleteManyData`, the three per-row
 * loops behind them, and the builders that turn a loop's outcome into the
 * `BatchUpdateResponse` a caller reconciles against — moved out of
 * `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same engine calls, the
 * same per-row outcomes, the same rollback marking, refusing exactly where
 * they did. The two module-level declarations only these bodies read moved
 * with them, also unedited: `mergeDroppedFieldEvents` and
 * `rowOperationFailureFallback`.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method. The class keeps
 * every method — the published `dist/*.d.ts` lists each one's name, docblock
 * and position — and each body is one literal of exactly the
 * {@link BatchDataHost} members that method reads, plus a `.call`; a body that
 * reads no member takes no host and is called directly. The `async` methods
 * are no longer `async`: each returns the moved function's own promise, so a
 * caller awaits the same promise the body settles, with no extra wrapper. A
 * method is handed over as a closure that calls it on the protocol at call
 * time, so a test double or spy set on the instance is still the one the body
 * reaches — the moved bodies that call one another (`batchData` → its atomic
 * path → `runAtomicBatch` → the loop → the builders) do so through the
 * protocol, exactly as before.
 *
 * The two fields the bodies read, `engine` and `getServicesRegistry`, go as
 * GETTERS, so each read happens when the body makes it: tests replace them on a
 * constructed protocol.
 *
 * The other module-level declarations the bodies read stay in `protocol.ts`,
 * where code that did not move reads them too, and are imported from there:
 * the module cycle is evaluation-safe because every one of them is read only
 * inside a function body, never while the two modules are first evaluated.
 * `index.ts` names what it publishes from `protocol.ts` one by one, so the
 * `export` they gained for this keeps them off the published surface, and
 * nothing re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation, BatchDataLoopOutcome, BatchDataRowResult } from './protocol.js';
import { byIdUpdateRecord, rowRequiredIdError, toRowApiError } from './protocol.js';
import type { BatchUpdateRequest, BatchUpdateResponse, DeleteManyDataRequest, UpdateManyDataRequest } from '@objectstack/spec/api';
import type { DroppedFieldsEvent, EngineQueryOptionsParsed } from '@objectstack/spec/data';
import type { ISecurityService } from '@objectstack/spec/contracts';
import { engineCanRollBack, recordNotFoundError } from '@objectstack/core';
import { omitInternalFieldsFromWriteResponse } from './write-response-internal-fields.js';
import { staleSummaryAnswerLines, staleSummaryRefusalOrThrow, withEarnedAnswer, type SummaryRecomputeRefusal } from '@objectstack/types';

/**
 * [#3455] Collapse a batch's per-row `DroppedFieldsEvent`s into one event per
 * `(object, reason)` with the UNION of dropped field names.
 *
 * Used by both bulk-create surfaces at BATCH level. `createManyData`'s
 * `{ object, records, count }` response has no per-row slot to hang a
 * `droppedFields` on — a union is the only view that response can represent,
 * which is the whole reason this collapse exists. `insertManyData` has a
 * per-row slot and reports here anyway: the slot is real, a per-row answer is
 * not (its docblock states why), so it reports the union where the union is
 * true. (Since #14147 that strip is the ENGINE's, which reports one event per
 * CALL for it, so the aggregation is over the runtime-owned per-row events.)
 *
 * ⚠️ So read a name in a merged event as "AT LEAST ONE row dropped this field",
 * never "every row dropped the same set". Maintainer ruling C (#14147) put the
 * static-`readonly` strip INSIDE `engine.insert`, AFTER the `beforeInsert`
 * hooks, where it exempts keys a hook itself assigned — recorded PER ROW and
 * indexed per row at the call: `packages/objectql/src/engine.ts` hands
 * `stripReadonlyFields` the option `hookWrittenKeys: rowHookWrittenKeys[i]`,
 * and that option's only power is to turn a STRIP into a KEEP. A hook that
 * stamps a protected key on some rows and not others therefore makes those rows
 * drop DIFFERENT sets, so the union is faithful to the BATCH without being
 * faithful to any one row.
 *
 * Returns `[]` when nothing was dropped so callers can spread
 * `...(x.length ? { droppedFields: x } : {})` and keep the omit-when-empty shape.
 * The paths that DO keep row precision — `updateManyData` and `batchData` —
 * earn it mechanically rather than by inference: each row is its own
 * `engine.update` / `engine.insert` call, so that call's events are that row's.
 */
function mergeDroppedFieldEvents(events: DroppedFieldsEvent[]): DroppedFieldsEvent[] {
    if (events.length === 0) return [];
    const byKey = new Map<string, { object: string; reason: DroppedFieldsEvent['reason']; fields: Set<string> }>();
    for (const ev of events) {
        const key = `${ev.object}|${ev.reason}`;
        let bucket = byKey.get(key);
        if (!bucket) { bucket = { object: ev.object, reason: ev.reason, fields: new Set() }; byKey.set(key, bucket); }
        for (const f of ev.fields) bucket.fields.add(f);
    }
    return Array.from(byKey.values()).map((b) => ({ object: b.object, fields: Array.from(b.fields), reason: b.reason }));
}

/**
 * [#8502] The stable sentence a failed batch row says when nothing may be
 * quoted — the operation, named, and no interpolation of any kind.
 *
 * One vocabulary for all three loops, so a caller reconciling a mixed batch is
 * not reading three phrasings of one condition. Deliberately says where the
 * reason IS (the server log), because the row itself is the caller's only
 * channel here: a batch row rides response DATA on a 200, so there is no `cause`
 * for a boundary to print and no 5xx withhold anywhere above it.
 */
function rowOperationFailureFallback(operation: string): string {
    return `The ${operation} of this record failed. The reason is in the server log.`;
}

/**
 * The OBJECT-level half of the question `batchData`'s by-id upsert forks on —
 * may the CALLER read `object` at all? — asked of the `security` service's
 * `canReadObject`, the engine middleware's own read gate arm for arm
 * (`ISecurityService.canReadObject`), with the context the loop's writes run
 * under. The ROW-level half is the caller's own `findOne` by id, at the fork.
 *
 * Asked separately because the middleware answers a caller with no read grant
 * by REFUSING the `findOne` (`403`), not with `null`: without this half, a
 * caller who may create but not read would have every by-id upsert row refused
 * outright, where a create naming the same id is accepted. A `false` here is
 * "this caller can read no row of the object", so every row takes the insert
 * arm, which `engine.insert` still judges in full.
 *
 * `true` means only "not refused at this layer" and never widens anything: the
 * `findOne` that follows is still the middleware's, row scope included. So a
 * context-less in-process call (the read `findOne` makes without a context is
 * the one its writes make) is not asked about, and neither is a host whose
 * security service is absent or predates the method — `findOne` still
 * enforces there, so the absence can only make the answer stricter (a refusal
 * fails the row), as `searchAll` reasons for the same method. A
 * `canReadObject` that throws fails the row rather than choosing an arm.
 */
async function callerMayReadObject(
    this: Pick<BatchDataHost, 'getServicesRegistry'>,
    object: string,
    context: unknown,
): Promise<boolean> {
    if (context === undefined) return true;
    const security = this.getServicesRegistry?.().get('security') as Partial<ISecurityService> | undefined;
    if (typeof security?.canReadObject !== 'function') return true;
    return security.canReadObject(object, context as Parameters<NonNullable<ISecurityService['canReadObject']>>[1]);
}

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface BatchDataHost {
    assertObjectRegistered: ObjectStackProtocolImplementation['assertObjectRegistered'];
    assertRecordExists: ObjectStackProtocolImplementation['assertRecordExists'];
    buildBatchDataResponse: ObjectStackProtocolImplementation['buildBatchDataResponse'];
    buildDeleteManyResponse: ObjectStackProtocolImplementation['buildDeleteManyResponse'];
    buildRolledBackBatchResponse: ObjectStackProtocolImplementation['buildRolledBackBatchResponse'];
    buildUpdateManyResponse: ObjectStackProtocolImplementation['buildUpdateManyResponse'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    locateBatchCause: ObjectStackProtocolImplementation['locateBatchCause'];
    reconcileStoppedBatch: ObjectStackProtocolImplementation['reconcileStoppedBatch'];
    runAtomicBatch: ObjectStackProtocolImplementation['runAtomicBatch'];
    runAtomicBatchData: ObjectStackProtocolImplementation['runAtomicBatchData'];
    runBatchDataLoop: ObjectStackProtocolImplementation['runBatchDataLoop'];
    runDeleteManyLoop: ObjectStackProtocolImplementation['runDeleteManyLoop'];
    runUpdateManyLoop: ObjectStackProtocolImplementation['runUpdateManyLoop'];
}

/** The body of `ObjectStackProtocolImplementation#batchData`; the method's docblock there is its contract. */
export async function batchData(
    this: Pick<BatchDataHost, 'assertObjectRegistered' | 'buildBatchDataResponse' | 'engine' | 'runAtomicBatchData' | 'runBatchDataLoop'>,
    request: { object: string, request: BatchUpdateRequest, context?: any }): Promise<BatchUpdateResponse> {
    const { object, request: batchReq, context } = request;
    this.assertObjectRegistered(object); // [#3770]
    const { operation, records, options } = batchReq;

    // [#3043 → #14147] The batch endpoint is an external ingress, and it
    // used to strip forged read-only columns on create HERE; that strip is
    // `engine.insert`'s since the 2026-09-03 ruling, reported back per row
    // through `onFieldsDropped`. [#3455] It DOES resolve an execution
    // context (threaded by REST); thread it to every engine call so RLS/FLS,
    // `readonlyWhen` AND the create-side readonly strip run under the
    // caller, so a system caller is correctly exempt (the pre-#3455 code
    // hard-coded the strip context to `undefined`, treating every batch
    // create as non-system).
    const batchSchema = this.engine.registry?.getObject(object);

    // ADR-0119 D4 — `atomic` is REAL or REFUSED, never silent best-effort.
    // This flag used to only `break` the loop: every write before the
    // failure stayed COMMITTED while the response called itself atomic and
    // reported those rows `success: true`. Same class as #4346 — a
    // write-path guarantee declared but not enforced, silent and
    // destructive exactly when it matters.
    //
    // Opt-in is an explicit `=== true`. `BatchOptionsSchema` declared
    // `.default(true)` while no enforcement site ever delivered atomicity
    // (REST forwards the original body, so the parsed default never reached
    // this loop), so treating "absent" as atomic would silently flip every
    // existing caller's failure semantics. The declaration is aligned to
    // the enforced value instead; see the schema's note.
    if (options?.atomic === true) {
        return await this.runAtomicBatchData({ object, operation, records, options, batchSchema, context });
    }

    const outcome = await this.runBatchDataLoop({ object, operation, records, options, batchSchema, context, atomic: false });
    return this.buildBatchDataResponse(operation, records, options, outcome);
}

/** The body of `ObjectStackProtocolImplementation#runAtomicBatchData`; the method's docblock there is its contract. */
export async function runAtomicBatchData(
    this: Pick<BatchDataHost, 'buildBatchDataResponse' | 'buildRolledBackBatchResponse' | 'runAtomicBatch' | 'runBatchDataLoop'>,
    args: {
    object: string;
    operation: BatchUpdateRequest['operation'];
    records: BatchUpdateRequest['records'];
    options: BatchUpdateRequest['options'];
    batchSchema: any;
    context: any;
}): Promise<BatchUpdateResponse> {
    const { object, operation, records, options, batchSchema, context } = args;
    return await this.runAtomicBatch({
        object,
        context,
        runLoop: (trxCtx) => this.runBatchDataLoop({ object, operation, records, options, batchSchema, context: trxCtx, atomic: true }),
        onCommit: (outcome) => this.buildBatchDataResponse(operation, records, options, outcome),
        onRollback: (outcome) => this.buildRolledBackBatchResponse(operation, records, outcome),
    });
}

/** The body of `ObjectStackProtocolImplementation#runAtomicBatch`; the method's docblock there is its contract. */
export async function runAtomicBatch(
    this: Pick<BatchDataHost, 'engine'>,
    args: {
    object: string;
    context: any;
    runLoop: (trxCtx: any) => Promise<BatchDataLoopOutcome>;
    onCommit: (outcome: BatchDataLoopOutcome) => BatchUpdateResponse;
    onRollback: (outcome: BatchDataLoopOutcome) => BatchUpdateResponse;
}): Promise<BatchUpdateResponse> {
    const { object, context, runLoop, onCommit, onRollback } = args;

    // Two-level probe, shared with the ADR-0119 D2 migration-journal runner
    // as `engineCanRollBack` (#4617). `engine.transaction()` runs the
    // callback with NO transaction and NO rollback when the default driver
    // lacks `beginTransaction` — a declared caveat of the contract member
    // (ADR-0119 D1), and one that would turn "atomic" back into a lie
    // precisely where it matters. So where the driver registry is
    // inspectable, the driver is checked too; where it is not (test
    // doubles), the engine-level probe is all there is.
    //
    // Shared rather than restated: this and the runner's gate were the same
    // condition written twice, and two copies of "can this runtime actually
    // roll back?" drift by one clause and leave one caller believing it has
    // atomicity it does not have.
    const engineTx = engineCanRollBack(this.engine)
        ? this.engine.transaction.bind(this.engine)
        : undefined;

    if (!engineTx) {
        // REFUSE, do not degrade. A caller that asked for atomicity is
        // exactly the caller who must not silently receive best-effort —
        // silent degradation is how this flag came to lie in the first
        // place. Mirrors the cross-object /batch route's refusal; the
        // condition is generic, so it uses the standard error catalog
        // rather than registering an ADR-0112 synonym.
        const err: any = new Error(
            `Atomic batch on '${object}' requires engine transaction support; this runtime cannot roll back. ` +
            `Retry without options.atomic, or probe capabilities.transactionalBatch on /discovery first.`,
        );
        err.status = 501;
        err.code = 'NOT_IMPLEMENTED';
        throw err;
    }

    // Identity-checked sentinel: aborting the transaction is how a rollback
    // is requested, but the abort itself is not an error to propagate.
    const ABORT = new Error('atomic batch aborted — rolled back');
    let aborted: BatchDataLoopOutcome | undefined;
    try {
        return await engineTx(async (trxCtx: any) => {
            const outcome = await runLoop(trxCtx);
            if (outcome.failed > 0) {
                aborted = outcome;
                throw ABORT;
            }
            return onCommit(outcome);
        }, context);
    } catch (err) {
        if (err === ABORT && aborted) {
            return onRollback(aborted);
        }
        throw err;
    }
}

/**
 * [#28782] A per-row bulk write's `.catch`: a row the engine STORED but whose
 * parent roll-up could not be recomputed after it (`ERR_SUMMARY_RECOMPUTE`,
 * "the triggering records WERE written") answers as the row it is — a
 * success, built from the refusal's `written`, the result the same call
 * answers when every roll-up recomputes. Reporting it as a failed row told the
 * caller to retry a write that had landed, and a retried create duplicated
 * it; the non-atomic loop also stopped there, leaving every later row
 * unattempted. Every other error is rethrown to the loop's own catch.
 *
 * ⛔ Not on the ATOMIC arm: there the refusal is raised inside the batch's
 * transaction, the loop's failure rolls the whole batch back, and the
 * rolled-back answer is the truth — nothing landed, so nothing is duplicated
 * by a retry.
 *
 * The stale column is logged at `error` once per field per process
 * (`staleSummaryAnswerLines`, the line the single-record doors log): the batch
 * answer is a normal success, so this loop is the last place that sees it.
 */
function landedDespiteStaleSummary(e: unknown, atomic: boolean, object: string): any {
    if (atomic) throw e;
    const stale = staleSummaryRefusalOrThrow(e);
    for (const line of staleSummaryAnswerLines(stale, object)) console.error(`[protocol] ${line}`);
    return stale.written;
}

/** The body of `ObjectStackProtocolImplementation#runBatchDataLoop`; the method's docblock there is its contract. */
export async function runBatchDataLoop(
    this: Pick<BatchDataHost, 'assertRecordExists' | 'engine' | 'getServicesRegistry'>,
    args: {
    object: string;
    operation: BatchUpdateRequest['operation'];
    records: BatchUpdateRequest['records'];
    options: BatchUpdateRequest['options'];
    batchSchema: any;
    context: any;
    atomic: boolean;
}): Promise<BatchDataLoopOutcome> {
    const { object, operation, records, options, batchSchema, context, atomic } = args;
    const results: BatchDataRowResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // Spread form for options objects that already carry `where`/`onFieldsDropped`
    // (`{}` spread is a safe no-op). [#14147] EVERY `engine.insert` in this
    // loop — `create`, and both arms of `upsert` that create — builds an
    // options object: the readonly strip they report moved into
    // `engine.insert` and reaches this seam only through `onFieldsDropped`,
    // so the arg form (`undefined` when there is no context) is gone from
    // here. A create-shaped arm that passed no listener reported a silent
    // drop — the upsert arms did exactly that until the patch round.
    const ctxOpt = context !== undefined ? { context } : {};

    // The object-level half of the upsert fork's question (see the fork and
    // `callerMayReadObject`), asked at most once per loop: the object and the
    // context are the loop's, so every row gets the same answer.
    let objectReadable: Promise<boolean> | undefined;

    // [#4793] `index` is the row's position in the REQUEST array — the
    // correlation a caller needs for failure rows that carry no id.
    for (const [index, record] of records.entries()) {
        try {
            switch (operation) {
                case 'create': {
                    // [#3455/#14147] A batch-create caller sees the same
                    // `droppedFields` a single-write create surfaces (#3431) —
                    // read off the ENGINE's listener now that the readonly
                    // create strip lives there, instead of reconstructed from a
                    // before/after payload diff at this seam.
                    const rowDropped: DroppedFieldsEvent[] = [];
                    const created = await this.engine.insert(object, record.data || record, {
                        ...ctxOpt,
                        onFieldsDropped: (e: DroppedFieldsEvent) => { rowDropped.push(e); },
                    } as any).catch((e: unknown) => landedDespiteStaleSummary(e, atomic, object));
                    omitInternalFieldsFromWriteResponse(batchSchema, created); // [#7823]
                    const ev = mergeDroppedFieldEvents(rowDropped);
                    results.push({ id: created.id, success: true, data: created, index, ...(ev.length > 0 ? { droppedFields: ev } : {}) });
                    succeeded++;
                    break;
                }
                case 'update': {
                    if (!record.id) throw rowRequiredIdError('update');
                    // [#3455] Collect the engine's LEGAL write strips per row.
                    const dropped: DroppedFieldsEvent[] = [];
                    const updated = byIdUpdateRecord(await this.engine.update(object, record.data || {}, { where: { id: record.id }, onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); }, ...ctxOpt } as any).catch((e: unknown) => landedDespiteStaleSummary(e, atomic, object)));
                    // [#5088] Same existence answer as `updateMany` and the
                    // single-record PATCH, and in the same place: AFTER the
                    // engine has judged the write (its refusals, then its
                    // not-found gate ahead of every hook), so a refused row
                    // reads the same whether or not its id names a record —
                    // see `assertRecordExists`.
                    if (updated == null) await this.assertRecordExists(object, record.id);
                    omitInternalFieldsFromWriteResponse(batchSchema, updated); // [#7823]
                    results.push({ id: record.id, success: true, data: updated, index, ...(dropped.length > 0 ? { droppedFields: dropped } : {}) });
                    succeeded++;
                    break;
                }
                case 'upsert': {
                    if (record.id) {
                        // The update-or-insert fork asks what the CALLER can
                        // read. On the write doors a row the caller cannot
                        // read is a row that does not exist (ruling
                        // 5985885287 on #21771, the governing text for the
                        // write doors), so such a row takes the INSERT arm —
                        // what a create naming the same id does — and that
                        // insert meets the deployment-global primary key and
                        // answers the `409 UNIQUE_VIOLATION` a plain create
                        // with that id answers. A row the caller CAN read
                        // keeps the UPDATE arm, where `engine.update` still
                        // judges whether the caller may write it.
                        //
                        // "Can read" is the read door's question in both its
                        // halves, under the context the arm's write runs
                        // with (`ctxOpt`): the object-level admission
                        // (`callerMayReadObject`, once per loop) and then the
                        // caller's own `findOne` by id, where RLS, sharing
                        // and the organization wall all apply. Inside the
                        // atomic arm that context is the transaction's, so
                        // the read sees the batch's own uncommitted rows.
                        //
                        // ⚠️ This REVERSES #5099 / #5187, by ruling. #5187
                        // moved this fork FROM the caller's read TO the
                        // system-context `probeRecord`, because forking on
                        // visibility reported an authorization/update
                        // scenario as a key collision. That trade is now
                        // ruled the other way, for two reasons:
                        //
                        //  - forking on existence answered a row the caller
                        //    cannot read differently from an id that names
                        //    nothing — the update arm's refusal (`403`, or the
                        //    by-id pre-image check's `404`) beside a CREATED
                        //    row — so a caller holding create learned that a
                        //    row it cannot read exists, which ruling
                        //    5985885287 closed on the by-id update and delete
                        //    doors;
                        //  - the key collision #5187 called a misdirection is
                        //    the answer the maintainer ratified on 2026-11-01
                        //    as the accepted cost of a deployment-global key,
                        //    extending ruling 5934879010 on #21185 (rule 2),
                        //    which `SqlDriver.upsert` already follows for a
                        //    conflict in another organization: it tells the
                        //    caller exactly what a create with that id tells
                        //    it, and nothing more.
                        //
                        // ⛔ So a hidden collision gets NO answer of its own:
                        // no new code, field, detail or sentence, and nothing
                        // that names another organization. The collision is
                        // `engine.insert`'s own refusal, reported through the
                        // same row builder `case 'create'` uses.
                        //
                        // #5099's second observation stays true, as a fact
                        // about the store rather than this fork: on a store
                        // that does not enforce the primary key
                        // (`driver-memory` declares it out of scope) the
                        // insert lands a second row with that id, exactly as
                        // a create naming that id already does there.
                        //
                        // #5099's other half is kept unchanged: there is NO
                        // fallback. The arm is chosen before any write, so an
                        // update failure surfaces itself and is never buried
                        // under an insert's error — the masking ADR-0119 D4
                        // forbade inside the atomic arm.
                        objectReadable ??= callerMayReadObject.call(this, object, context);
                        const callerRead: EngineQueryOptionsParsed = { where: { id: record.id } };
                        if (context !== undefined) callerRead.context = context;
                        const existing = (await objectReadable)
                            ? await this.engine.findOne(object, callerRead)
                            : null;
                        if (existing) {
                            const dropped: DroppedFieldsEvent[] = [];
                            const updated = byIdUpdateRecord(await this.engine.update(object, record.data || {}, { where: { id: record.id }, onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); }, ...ctxOpt } as any).catch((e: unknown) => landedDespiteStaleSummary(e, atomic, object)));
                            omitInternalFieldsFromWriteResponse(batchSchema, updated); // [#7823]
                            results.push({ id: record.id, success: true, data: updated, index, ...(dropped.length > 0 ? { droppedFields: dropped } : {}) });
                        } else {
                            // [#14147] The upsert's CREATE arm is a create face
                            // too: same listener, same per-row `droppedFields`,
                            // as `case 'create'` above and the update arm just up.
                            const rowDropped: DroppedFieldsEvent[] = [];
                            const created = await this.engine.insert(object, { id: record.id, ...(record.data || {}) }, {
                                ...ctxOpt,
                                onFieldsDropped: (e: DroppedFieldsEvent) => { rowDropped.push(e); },
                            } as any).catch((e: unknown) => landedDespiteStaleSummary(e, atomic, object));
                            omitInternalFieldsFromWriteResponse(batchSchema, created); // [#7823]
                            const ev = mergeDroppedFieldEvents(rowDropped);
                            results.push({ id: created.id, success: true, data: created, index, ...(ev.length > 0 ? { droppedFields: ev } : {}) });
                        }
                    } else {
                        // [#14147] Same: an id-less upsert row IS a create.
                        const rowDropped: DroppedFieldsEvent[] = [];
                        const created = await this.engine.insert(object, record.data || record, {
                            ...ctxOpt,
                            onFieldsDropped: (e: DroppedFieldsEvent) => { rowDropped.push(e); },
                        } as any).catch((e: unknown) => landedDespiteStaleSummary(e, atomic, object));
                        omitInternalFieldsFromWriteResponse(batchSchema, created); // [#7823]
                        const ev = mergeDroppedFieldEvents(rowDropped);
                        results.push({ id: created.id, success: true, data: created, index, ...(ev.length > 0 ? { droppedFields: ev } : {}) });
                    }
                    succeeded++;
                    break;
                }
                case 'delete': {
                    if (!record.id) throw rowRequiredIdError('delete');
                    // [#5088] `deleteManyData` learned this in #4435; this
                    // branch — the OTHER by-id bulk delete, ten lines from
                    // it — kept discarding the driver's return and pushing
                    // `success: true` unconditionally, so a batch of typo'd
                    // ids reported every one of them deleted. Same `=== false`
                    // reading as both fixed faces: the contract's positive
                    // not-found value (`IDataDriver.delete`), never an
                    // inference from a falsy return, so a third-party driver
                    // that answers with the deleted row is not turned into a
                    // spurious 404.
                    const deleted = await this.engine.delete(object, { where: { id: record.id }, ...ctxOpt } as any).catch((e: unknown) => landedDespiteStaleSummary(e, atomic, object));
                    if (deleted === false) throw recordNotFoundError(object, record.id);
                    // [#19433] The SECOND half of this site, and the THIRD and
                    // last of the by-id delete doors to learn it — the
                    // single-record face (commit f9e16d856) and `deleteManyData` (#19412)
                    // both already read the engine's answer. The paragraph
                    // above fixed "no match"; this is "matched, and
                    // deliberately NOT removed", where `success` was still a
                    // LITERAL for every result that was not the contract's
                    // `false`, so that row was reported as a deletion too.
                    //
                    // `sys_permission_set` was the shipped shape of it until C3
                    // stage 8 retired that object: deleting a package-declared
                    // set was an ADR-0005 RESET — the overlay tombstoned and the
                    // record re-projected to the declared body instead of
                    // vanishing — so the row MATCHED, the write ran, and the
                    // record was still there. On a security-configuration
                    // write this envelope told an operator a permission set was
                    // gone while it was still being enforced.
                    //
                    // The defect rests on the CONTRACT, not on any shipped
                    // handler: `IDataEngine.delete` declares
                    // `Promise<boolean | number>` — the driver's boolean for a
                    // by-id write, a COUNT of rows removed otherwise — and
                    // `isDeleteResultShape` admits the number arm at the
                    // ADR-0112 hook gate, so an `afterDelete` handler or a
                    // non-ObjectQL engine may legally answer `0` today.
                    //
                    // ⛔ Not the `false` arm: that is spoken for by the 404
                    // above, about a record this caller can still GET, and
                    // answering it here would trade one wrong answer for a
                    // louder one. Everything else keeps its #4435 reading, an
                    // off-contract `undefined` from a third-party driver
                    // included: only a POSITIVE zero is read as "not removed".
                    //
                    // ⛔ And the row gets NO `errors[]` entry. A surviving
                    // record is an OUTCOME, not a fault — the single-record door
                    // answers the same case with a bare `success: false` on a
                    // 200 — and the two per-row codes this envelope owns
                    // (`ROLLED_BACK`, `NOT_ATTEMPTED`) both describe a row that
                    // never ran. Minting one for this ending is an
                    // ERROR_CODE_LEDGER widening in `packages/spec`, and belongs
                    // to the spec lane.
                    //
                    // This envelope's own consequences, measured here rather
                    // than inherited from `deleteManyData`: the row is counted
                    // in `failed` because `succeeded` and `failed` PARTITION
                    // `results` (#7539, `reconcileStoppedBatch`, shared by all
                    // three bulk faces), which makes the request-level `success`
                    // false and, on the `atomic` arm, aborts the batch through
                    // `runAtomicBatch`'s `failed > 0` — so an atomic batch
                    // holding a package-declared set now rolls back instead of
                    // committing under a response that called every row deleted.
                    // It does NOT stop a non-atomic run: the `continueOnError`
                    // stop belongs to the catch below and nothing was thrown, so
                    // every remaining record is still attempted. `returnRecords:
                    // false` keeps `success`, so the honest value survives that
                    // projection too. Only this `case` is touched — the sibling
                    // arms of this shared loop keep their own counters.
                    const removed = deleted !== 0;
                    results.push({ id: record.id, success: removed, index });
                    if (removed) succeeded++;
                    else failed++;
                    break;
                }
                default:
                    results.push({ id: record.id, success: false, index, errors: [{ code: 'VALIDATION_FAILED', message: `Unknown operation: ${operation}`, httpStatus: 400 }] });
                    failed++;
            }
        } catch (err: any) {
            // [#8502] `operation` is the request's own verb, so a mixed
            // batch's withheld rows each name what THEY were doing.
            results.push({ id: record.id, success: false, index, errors: [toRowApiError(err, rowOperationFailureFallback(operation))] });
            failed++;
            if (atomic) {
                // Abort on the first failure; the caller rolls back. Atomic
                // outranks `continueOnError` — there is nothing to continue
                // toward when every write so far is about to be undone.
                break;
            }
            if (!options?.continueOnError) {
                break;
            }
        }
    }

    return { results, succeeded, failed };
}

/** The body of `ObjectStackProtocolImplementation#reconcileStoppedBatch`; the method's docblock there is its contract. */
export function reconcileStoppedBatch(
    this: Pick<BatchDataHost, 'locateBatchCause'>,
    records: ReadonlyArray<{ id?: string }>,
    outcome: BatchDataLoopOutcome,
): BatchDataLoopOutcome {
    if (outcome.results.length >= records.length) return outcome;

    const cause = this.locateBatchCause(outcome.results);

    const results = outcome.results.slice();
    for (let index = results.length; index < records.length; index++) {
        results.push({
            // Echoed back so a caller can retry exactly the skipped rows.
            id: records[index]?.id,
            success: false,
            index,
            errors: [{
                code: 'NOT_ATTEMPTED' as const,
                message: (cause ? `${cause.clause}; the batch stopped there. ` : 'the batch stopped before this record. ')
                    + 'Set options.continueOnError to process the remaining records.',
            }],
        });
    }

    // Every padded row is a non-success, so this stays a PARTITION of
    // `results` rather than a second tally free to drift from it.
    return { results, succeeded: outcome.succeeded, failed: results.length - outcome.succeeded };
}

/** The body of `ObjectStackProtocolImplementation#locateBatchCause`; the method's docblock there is its contract. */
export function locateBatchCause(
    rows: ReadonlyArray<BatchDataRowResult>,
): { index: number; clause: string } | undefined {
    for (let index = rows.length - 1; index >= 0; index--) {
        const fault = rows[index]?.errors?.[0];
        if (fault) return { index, clause: `record ${index} failed — ${fault.message}` };
    }
    const stalled = rows.findIndex(r => !r.success);
    return stalled >= 0 ? { index: stalled, clause: `record ${stalled} did not succeed` } : undefined;
}

/** The body of `ObjectStackProtocolImplementation#buildBatchDataResponse`; the method's docblock there is its contract. */
export function buildBatchDataResponse(
    this: Pick<BatchDataHost, 'reconcileStoppedBatch'>,
    operation: BatchUpdateRequest['operation'],
    records: BatchUpdateRequest['records'],
    options: BatchUpdateRequest['options'],
    outcome: BatchDataLoopOutcome,
): BatchUpdateResponse {
    const { results, succeeded, failed } = this.reconcileStoppedBatch(records, outcome); // [#7539]
    return {
        success: failed === 0,
        operation,
        total: records.length,
        succeeded,
        failed,
        // [#3455] `returnRecords: false` drops the record payload (`data`)
        // but KEEPS `errors`, `index` and `droppedFields` — the last is a
        // small write-observability warning, not the record data the flag
        // suppresses.
        results: options?.returnRecords !== false ? results : results.map(r => ({ id: r.id, success: r.success, index: r.index, ...(r.errors ? { errors: r.errors } : {}), ...(r.droppedFields ? { droppedFields: r.droppedFields } : {}) })),
    } as BatchUpdateResponse;
}

/** The body of `ObjectStackProtocolImplementation#buildRolledBackBatchResponse`; the method's docblock there is its contract. */
export function buildRolledBackBatchResponse(
    this: Pick<BatchDataHost, 'locateBatchCause'>,
    operation: BatchUpdateRequest['operation'],
    // Only `length` and `id` are read, so `updateManyData`'s rows and the
    // id list `deleteManyData` rolls back reuse this verbatim (#4620) —
    // the marking a client reconciles against must be one implementation,
    // not three that agree today.
    records: ReadonlyArray<{ id?: string }>,
    outcome: BatchDataLoopOutcome,
): BatchUpdateResponse {
    const attempted = outcome.results;
    // [#19452] Same locator as the stopped-batch arm, for the same reason:
    // `!success` stopped meaning "this row failed" when #19412 widened it.
    // Both this builder's interpolations of the causal index read it, so
    // neither the ROLLED_BACK message nor the NOT_ATTEMPTED one can name a
    // row that merely survived — the two could not be fixed apart.
    const cause = this.locateBatchCause(attempted);

    const results: BatchDataRowResult[] = records.map((record, index) => {
        const attempt = attempted[index];
        if (!attempt) {
            return {
                id: record.id, success: false, index,
                errors: [{ code: 'NOT_ATTEMPTED' as const, message: cause ? `atomic batch aborted by record ${cause.index}` : 'atomic batch aborted' }],
            };
        }
        if (attempt.success) {
            return {
                id: attempt.id ?? record.id, success: false, index,
                errors: [{ code: 'ROLLED_BACK' as const, message: cause ? cause.clause : 'the atomic batch rolled back' }],
            };
        }
        return { id: attempt.id ?? record.id, success: false, index, errors: attempt.errors };
    });

    return {
        success: false,
        operation,
        total: records.length,
        succeeded: 0,
        failed: records.length,
        results,
    } as BatchUpdateResponse;
}

/** The body of `ObjectStackProtocolImplementation#createManyData`; the method's docblock there is its contract. */
export async function createManyData(
    this: Pick<BatchDataHost, 'assertObjectRegistered' | 'engine'>,
    request: { object: string, records: any[], context?: any }): Promise<any> {
    this.assertObjectRegistered(request.object); // [#3770]
    // [#3455/#5503/#14147] Both create-side strips are the engine's now —
    // runtime-owned `autonumber` (#5503) and, since #14147, static
    // author-declared `readonly` — so ONE listener carries both, and this
    // seam no longer diffs payloads to recover a strip it performed itself.
    // AGGREGATED: the `{ records, count }` response has no per-row slot, so
    // a union is the only representable view here. (`insertManyData` HAS a
    // per-row slot and still reports at the top level — the union cannot be
    // resolved to rows at either seam; see its own docblock.)
    const dropped: DroppedFieldsEvent[] = [];
    const opts: any = { onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); } };
    if (request.context !== undefined) opts.context = request.context;
    // [#28782] Rows the engine stored but whose parent roll-up it could not
    // recompute (`ERR_SUMMARY_RECOMPUTE`, one multi-row call, so `written` is
    // EVERY row) build this method's own answer, attached to the refusal and
    // rethrown, the way `createData` carries its single row since #28781: the
    // HTTP door answers it (`earnedAnswerOf`), any other caller reads the
    // refusal unchanged.
    let stale: SummaryRecomputeRefusal | undefined;
    const records = await this.engine.insert(request.object, request.records, opts)
        .catch((e: unknown) => (stale = staleSummaryRefusalOrThrow(e)).written as any);
    // [#7823] Bulk create is the same generic-data-path surface as the
    // single-record 201 — one strip over the returned rows, at the
    // ingress. (Today's `internal`-flagged objects grant no `bulk`
    // apiMethod, so this face cannot reach one over REST yet; the strip is
    // here so the flag's guarantee does not depend on that staying true.)
    omitInternalFieldsFromWriteResponse(this.engine.registry?.getObject(request.object), records);
    const merged = mergeDroppedFieldEvents(dropped);
    const answer = {
        object: request.object,
        records,
        count: records.length,
        ...(merged.length > 0 ? { droppedFields: merged } : {}),
    };
    if (stale) throw withEarnedAnswer(stale, answer);
    return answer;
}

/** The body of `ObjectStackProtocolImplementation#insertManyData`; the method's docblock there is its contract. */
export async function insertManyData(
    this: Pick<BatchDataHost, 'assertObjectRegistered' | 'engine'>,
    request: { object: string, records: any[], context?: any }): Promise<{ object: string; outcomes: Array<{ ok: boolean; record?: any; error?: unknown; droppedFields?: DroppedFieldsEvent[] }>; droppedFields?: DroppedFieldsEvent[] }> {
    this.assertObjectRegistered(request.object); // [#3770]
    const engineInsertMany = (this.engine as any)?.insertMany;
    if (typeof engineInsertMany !== 'function') {
        throw new Error('insertManyData requires an engine with insertMany: the partial-success batch insert, which reports an outcome per row so a bad row neither fails the whole batch nor makes the good rows run their beforeInsert hooks twice');
    }
    // [#5503/#14147] The engine's events are collected WHOLE and merged —
    // the same handling `createManyData` gives them, and for the reason
    // spelled out on this method: the union is reportable, a row set is not.
    // Keeping each event also keeps its own `reason`, which the old
    // flatten-into-a-Set-and-relabel could not.
    const dropped: DroppedFieldsEvent[] = [];
    const opts: any = { onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); } };
    if (request.context !== undefined) opts.context = request.context;
    // [#20922] Each `ok` outcome carries the ENGINE's per-row report
    // (`outcomes[i].droppedFields`), recorded at its strips — a separate
    // channel from the batch-level union below, which still names no row.
    // Passed through as the engine answers it; ⛔ nothing here derives a
    // row's drops from the union.
    const outcomes: Array<{ ok: boolean; record?: any; error?: unknown; droppedFields?: DroppedFieldsEvent[] }> = await engineInsertMany.call(
        this.engine,
        request.object,
        request.records,
        opts,
    );
    // [#7823] Per-outcome ingress strip — the partial-success face hands
    // each written row back as `outcomes[i].record`, so each is the same
    // generic-data-path surface as a single-record 201 body.
    if (Array.isArray(outcomes)) {
        const outcomeSchema = this.engine.registry?.getObject(request.object);
        for (const o of outcomes) {
            if (o?.record) omitInternalFieldsFromWriteResponse(outcomeSchema, o.record);
        }
    }
    const merged = mergeDroppedFieldEvents(dropped);
    return {
        object: request.object,
        outcomes,
        ...(merged.length > 0 ? { droppedFields: merged } : {}),
    };
}

/** The body of `ObjectStackProtocolImplementation#updateManyData`; the method's docblock there is its contract. */
export async function updateManyData(
    this: Pick<BatchDataHost, 'assertObjectRegistered' | 'buildRolledBackBatchResponse' | 'buildUpdateManyResponse' | 'runAtomicBatch' | 'runUpdateManyLoop'>,
    request: UpdateManyDataRequest & { context?: any }): Promise<BatchUpdateResponse> {
    const { object, records, options, context } = request;
    this.assertObjectRegistered(object); // [#3770]

    // [#4620] `atomic` used not to appear ANYWHERE in this method: the
    // option was accepted, declared in `BatchOptionsSchema` with a contract
    // that promises all-or-nothing, and never read — a caller asking for
    // atomicity silently got best-effort with no signal at all. Same
    // enforcement shape as `batchData` (ADR-0119 D4), same runner, so the
    // three bulk-write surfaces cannot drift apart again. `=== true` is the
    // deliberate opt-in from D4: absent/false keeps today's semantics
    // exactly.
    if (options?.atomic === true) {
        return await this.runAtomicBatch({
            object,
            context,
            runLoop: (trxCtx) => this.runUpdateManyLoop({ object, records, options, context: trxCtx, atomic: true }),
            onCommit: (outcome) => this.buildUpdateManyResponse(records, outcome),
            onRollback: (outcome) => this.buildRolledBackBatchResponse('update', records, outcome),
        });
    }

    const outcome = await this.runUpdateManyLoop({ object, records, options, context, atomic: false });
    return this.buildUpdateManyResponse(records, outcome);
}

/** The body of `ObjectStackProtocolImplementation#runUpdateManyLoop`; the method's docblock there is its contract. */
export async function runUpdateManyLoop(
    this: Pick<BatchDataHost, 'assertRecordExists' | 'engine'>,
    args: {
    object: string;
    records: UpdateManyDataRequest['records'];
    options: UpdateManyDataRequest['options'];
    context: any;
    atomic: boolean;
}): Promise<BatchDataLoopOutcome> {
    const { object, records, options, context, atomic } = args;
    const results: BatchDataRowResult[] = [];
    let succeeded = 0;
    let failed = 0;
    // [#7823] Ingress strip over each row's `data` payload — the bulk
    // update face is the same generic-data-path surface as the by-id
    // PATCH body, one row at a time. Resolved once; the loop reuses it.
    const updateManySchema = this.engine.registry?.getObject(object);

    for (const [index, record] of records.entries()) {
        try {
            // [#3455] Two gaps the pre-#3455 loop had, both fixed per row:
            //  1. `context` was never threaded — bulk updates ran the engine
            //     context-less, so RLS/FLS and `readonlyWhen` evaluated without
            //     the caller's principal. Thread it like single-write updateData.
            //  2. `onFieldsDropped` was never wired — the same static `readonly`
            //     (#2948) / `readonlyWhen` (#3042) strips that single-write now
            //     surfaces (#3431) happened silently here. Collect per row.
            //
            // [#5100] Same guard as `runBatchDataLoop`'s update branch
            // (#4793), same classification: an id-less row is a CALLER
            // error — VALIDATION_FAILED/400 — not a data-state one. The
            // REST entrance already rejects it (`UpdateManyRecordSchema`
            // requires `id`, #3939), but that invariant lives two packages
            // away; unguarded, an in-process caller's malformed row
            // reached the probe and the write as `{ id: undefined }`,
            // whose reading is up to each driver's undefined-where-key
            // handling — at best a 404 with `undefined` interpolated into
            // the message, at worst a where-clause with no id at all.
            if (!record.id) throw rowRequiredIdError('update');
            const dropped: DroppedFieldsEvent[] = [];
            const opts: any = { where: { id: record.id }, onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); } };
            if (context !== undefined) opts.context = context;
            const updated = byIdUpdateRecord(await this.engine.update(object, record.data || {}, opts).catch((e: unknown) => landedDespiteStaleSummary(e, atomic, object)));
            // [#5088] Third gap, the same shape: no existence answer. A row
            // naming no record came back `INTERNAL_ERROR` from #4775's
            // condition abort — blaming the hook for a caller's stale id. It
            // answers what the single-record PATCH answers now, asked where
            // that door asks it: AFTER the engine has judged the write (its
            // refusals, then its not-found gate ahead of every hook), so a
            // refused row reads the same whether or not its id names a
            // record — see `assertRecordExists`.
            if (updated == null) await this.assertRecordExists(object, record.id);
            omitInternalFieldsFromWriteResponse(updateManySchema, updated); // [#7823]
            results.push({ id: record.id, success: true, data: updated, index, ...(dropped.length > 0 ? { droppedFields: dropped } : {}) });
            succeeded++;
        } catch (err: any) {
            results.push({ id: record.id, success: false, index, errors: [toRowApiError(err, rowOperationFailureFallback('update'))] });
            failed++;
            if (atomic) {
                // Abort on the first failure; the caller rolls back.
                break;
            }
            if (!options?.continueOnError) {
                break;
            }
        }
    }

    return { results, succeeded, failed };
}

/** The body of `ObjectStackProtocolImplementation#buildUpdateManyResponse`; the method's docblock there is its contract. */
export function buildUpdateManyResponse(
    this: Pick<BatchDataHost, 'reconcileStoppedBatch'>,
    records: UpdateManyDataRequest['records'],
    outcome: BatchDataLoopOutcome,
): BatchUpdateResponse {
    // [#7539] Same under-report as `batchData`, ten lines away — the card's
    // "per-object bulk counters under-report whenever a row fails without
    // `continueOnError`". Fixed through the one shared reconciler, because
    // a second copy is how these three drifted apart before (#4620).
    const { results, succeeded, failed } = this.reconcileStoppedBatch(records, outcome);
    return {
        success: failed === 0,
        operation: 'update',
        total: records.length,
        succeeded,
        failed,
        results,
    } as BatchUpdateResponse;
}

/** The body of `ObjectStackProtocolImplementation#deleteManyData`; the method's docblock there is its contract. */
export async function deleteManyData(
    this: Pick<BatchDataHost, 'assertObjectRegistered' | 'buildDeleteManyResponse' | 'buildRolledBackBatchResponse' | 'runAtomicBatch' | 'runDeleteManyLoop'>,
    request: DeleteManyDataRequest & { context?: any }): Promise<BatchUpdateResponse> {
    const { object, options, context } = request;
    this.assertObjectRegistered(object); // [#3770]

    // Fail CLOSED on anything that is not a list of scalar ids. A non-scalar
    // entry (`{"ids":[{"$ne":null}]}`) must never reach `where.id` as an
    // operator object — that is the same "predicate widening" this endpoint
    // was just hardened against, one layer down.
    const isScalarId = (v: unknown) =>
        (typeof v === 'string' && v.length > 0) || typeof v === 'number' || typeof v === 'bigint';
    const ids = request.ids as unknown;
    if (!Array.isArray(ids) || ids.some((id) => !isScalarId(id))) {
        const err: any = new Error(
            `deleteMany on '${object}' requires 'ids' to be an array of record ids`,
        );
        err.code = 'VALIDATION_FAILED';
        err.status = 400;
        throw err;
    }

    // [#4620] `atomic` here was the same fake-atomic `batchData` carried
    // before ADR-0119 D4 — it only `break`-ed the loop, so every row deleted
    // before the failure stayed DELETED while the response called itself
    // atomic. Worse than the `batchData` case, because a partial delete has
    // no natural undo: the caller cannot reconstruct the rows from the
    // request. Same runner, same fail-closed gate, same row marking.
    if (options?.atomic === true) {
        const rows = ids.map((id) => ({ id: String(id) }));
        return await this.runAtomicBatch({
            object,
            context,
            runLoop: (trxCtx) => this.runDeleteManyLoop({ object, ids, options, context: trxCtx, atomic: true }),
            onCommit: (outcome) => this.buildDeleteManyResponse(ids, outcome),
            onRollback: (outcome) => this.buildRolledBackBatchResponse('delete', rows, outcome),
        });
    }

    const outcome = await this.runDeleteManyLoop({ object, ids, options, context, atomic: false });
    return this.buildDeleteManyResponse(ids, outcome);
}

/** The body of `ObjectStackProtocolImplementation#runDeleteManyLoop`; the method's docblock there is its contract. */
export async function runDeleteManyLoop(
    this: Pick<BatchDataHost, 'engine'>,
    args: {
    object: string;
    ids: unknown[];
    options: DeleteManyDataRequest['options'];
    context: any;
    atomic: boolean;
}): Promise<BatchDataLoopOutcome> {
    const { object, ids, options, context, atomic } = args;
    const results: BatchDataRowResult[] = [];
    let succeeded = 0;
    let failed = 0;
    const ctxOpt = context !== undefined ? { context } : {};

    for (const [index, id] of ids.entries()) {
        try {
            // [#4435] Per-row honesty on the bulk path. This discarded the
            // driver's return and pushed `success: true` unconditionally, so
            // `{"ids":["nonexistent_1"]}` answered `succeeded: 1` — a batch
            // of typo'd ids reported every one of them deleted. A caller
            // reconciling "which of my 200 ids were real" got a list that
            // agreed with whatever it sent. Same `=== false` reading as the
            // single-record path: the contract's positive not-found value,
            // never an inference from a falsy return.
            const deleted = await this.engine.delete(object, { where: { id }, ...ctxOpt } as any).catch((e: unknown) => landedDespiteStaleSummary(e, atomic, object));
            // `id` is `unknown` to this helper only because the caller's
            // fail-closed `isScalarId` guard is what proves it scalar.
            if (deleted === false) throw recordNotFoundError(object, id as string | number);
            // [#19412] The SECOND half of the same site. The paragraph above
            // fixed "no match"; this is "matched, and deliberately NOT
            // removed" — and until now `success` was still a LITERAL for
            // every answer that was not the contract's `false`, so that row
            // was reported as a deletion too.
            //
            // `sys_permission_set` was the shipped case until C3 stage 8
            // retired that object: a package-declared set's delete was an
            // ADR-0005 RESET — plugin-security's write-through tombstoned the
            // overlay and the record re-projected to the declared body
            // instead of vanishing — so the row MATCHED, the write ran, and
            // the record was still there. The
            // batch envelope said `success: true` and counted it in
            // `succeeded`, which on a security-configuration write tells an
            // operator a permission set is gone while it is still enforced.
            //
            // `IDataEngine.delete` declares `Promise<boolean | number>` —
            // the driver's boolean for a by-id write, a COUNT of rows
            // removed otherwise — so a numeric zero is the one value that
            // positively means "it is still there". ⛔ Not `false`: that
            // arm is spoken for by the 404 above, about a record this caller
            // can still GET, and answering it here would trade one wrong
            // answer for a louder one. Everything else keeps its #4435
            // reading, an off-contract `undefined` from a third-party driver
            // included: only a POSITIVE zero is read as "not removed".
            //
            // ⛔ The row is NOT given an `errors[]` entry. A surviving record
            // is an OUTCOME, not a fault — the single-record door answers the
            // same case with a bare `success: false` on a 200 — and the two
            // per-row codes this envelope owns (`ROLLED_BACK`,
            // `NOT_ATTEMPTED`) both describe a row that never ran. Whether
            // this ending deserves a per-row code of its own is a
            // `packages/spec` widening (ERROR_CODE_LEDGER) and belongs to the
            // spec lane, not here.
            //
            // It is counted in `failed` because that is the envelope's ONE
            // declared reading — `succeeded` and `failed` PARTITION `results`
            // (#7539, `reconcileStoppedBatch`) — which also makes the
            // request-level `success` false and, on the `atomic` arm, aborts
            // the batch through `runAtomicBatch`'s `failed > 0`. It does NOT
            // stop a non-atomic run: the `continueOnError` stop belongs to
            // the catch below, and nothing was thrown.
            const removed = deleted !== 0;
            results.push({ id: String(id), success: removed, index });
            if (removed) succeeded++;
            else failed++;
        } catch (err: any) {
            results.push({ id: String(id), success: false, index, errors: [toRowApiError(err, rowOperationFailureFallback('delete'))] });
            failed++;
            // Same stop semantics as `batchData`: `atomic` aborts the rest on
            // the first failure (the caller rolls back), and without
            // `continueOnError` a failure ends the run rather than silently
            // ploughing on.
            if (atomic) break;
            if (!options?.continueOnError) break;
        }
    }

    return { results, succeeded, failed };
}

/** The body of `ObjectStackProtocolImplementation#buildDeleteManyResponse`; the method's docblock there is its contract. */
export function buildDeleteManyResponse(
    this: Pick<BatchDataHost, 'reconcileStoppedBatch'>,
    ids: unknown[], outcome: BatchDataLoopOutcome): BatchUpdateResponse {
    // [#7539] Same reconciliation as the other two faces; `ids` are mapped
    // to the `{ id }` row shape the atomic arm already hands the rollback
    // builder, so a skipped id comes back echoed and retryable.
    const { results, succeeded, failed } = this.reconcileStoppedBatch(ids.map((id) => ({ id: String(id) })), outcome);
    return {
        success: failed === 0,
        operation: 'delete',
        total: ids.length,
        succeeded,
        failed,
        results,
    } as BatchUpdateResponse;
}
