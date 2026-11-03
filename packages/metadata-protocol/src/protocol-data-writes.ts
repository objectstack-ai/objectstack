// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E2 section 3] The single-record data writes of
 * `ObjectStackProtocolImplementation`: `validateData` (the dry-run judge),
 * `createData`, and the by-id `updateData` and `deleteData`.
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as it stood, re-indented one level, with `this.<member>`
 * read as `host.<member>` and nothing else changed
 * (`node scripts/host-split.mjs check <base> <member> protocol-data-writes.ts`
 * proves it). Each method stays on the class with its docblock and signature,
 * which the published `.d.ts` prints, and hands its body the host
 * (`protocol-host.ts`).
 *
 * The section's other bodies stay in the class for now: `findData`, `getData`,
 * `cloneData` and `probeRecord` hold the query-options erasure sites that
 * `scripts/query-options-erasure-baseline.json` grandfathers BY FILE, and that
 * key set only ever shrinks, so those sites cannot change files unedited.
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { recordNotFoundError } from '@objectstack/core';
import type { DroppedFieldsEvent, ValidationAdvisoryEvent } from '@objectstack/spec/data';
import { type SummaryRecomputeRefusal, staleSummaryRefusalOrThrow, withEarnedAnswer } from '@objectstack/types';
import { byIdUpdateRecord } from './protocol-data-request-shapes.js';
import type { ProtocolHost } from './protocol-host.js';
import { omitInternalFieldsFromWriteResponse } from './write-response-internal-fields.js';

/** The body of `ObjectStackProtocolImplementation#validateData`; the method's docblock there is its contract. */
export async function validateData(host: Pick<ProtocolHost, 'assertObjectRegistered' | 'engine'>, request: { object: string, data: any, mode?: 'insert' | 'update', context?: any }) {
    host.assertObjectRegistered(request.object);
    return host.engine.validate(request.object, request.data, {
        ...(request.mode !== undefined ? { mode: request.mode } : {}),
        ...(request.context !== undefined ? { context: request.context } : {}),
    });
}

/** The body of `ObjectStackProtocolImplementation#createData`; the method's docblock there is its contract. */
export async function createData(host: Pick<ProtocolHost, 'assertObjectRegistered' | 'engine'>, request: { object: string, data: any, context?: any }) {
    host.assertObjectRegistered(request.object); // [#3770]
    // [#14147] The static-`readonly` create strip is the ENGINE's now
    // (`engine.insert` → `stripReadonlyFields`, `isSystem`-gated, exactly as
    // on update), so this ingress hands the caller's payload over WHOLE and
    // reports the drop through the listener #3431 already wired here. The
    // ingress copy it replaces (`stripReadonlyForInsert`, #3043) is deleted
    // rather than kept as a second implementation — maintainer ruling,
    // 2026-09-03, superseding the 2026-07-24 "INSERT (all callers) exempt"
    // row. Two consequences worth stating, because they are what the
    // before/after diff used to fake:
    //  - the event now carries the ENGINE's verdict rather than this seam's
    //    reconstruction of it, so `droppedFields` says the same thing here,
    //    on `data.insert`, and in a `create_record` flow node;
    //  - and it is the engine's guards that decide, which are wider than a
    //    payload diff can be: a `beforeInsert` hook's own stamp is not a
    //    caller forgery (#5591/#14259), and the ingress ran before the hooks.
    const dropped: DroppedFieldsEvent[] = [];
    // [#22726] The advisory rule hits of THIS write, answered as `warnings`
    // — the engine reports them through the write's own options, so a
    // nested write a hook makes inside this one never adds to them.
    const warnings: ValidationAdvisoryEvent[] = [];
    // [#27703] The mentioned users the mention recipient gate withheld on
    // THIS write, answered as `withheldMentions` to this request alone: the
    // mention writer reads the listener off its `after*` hook's
    // `ctx.input.options`, which is this bag, so neither a nested write
    // nor any other request's answer ever carries them, and nothing is
    // stored on the comment.
    const withheldMentions = new Set<string>();
    // [#28000] The one message a hook on THIS write set to tell the
    // requester what the save set in motion, answered as `notice`. The hook
    // reads the listener off `ctx.input.options`, which is this bag, so a
    // nested write's hook never reaches it; a later call replaces an
    // earlier one, and anything but a non-empty string sets nothing.
    let notice: string | undefined;
    const opts: any = {
        onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); },
        onValidationAdvisory: (e: ValidationAdvisoryEvent) => { warnings.push(e); },
        onMentionsWithheld: (ids: readonly string[]) => { for (const id of ids) withheldMentions.add(id); },
        onNotice: (message: unknown) => { if (typeof message === 'string' && message.trim() !== '') notice = message; },
    };
    if (request.context !== undefined) opts.context = request.context;
    // [#28661] A roll-up that cannot recompute after the row landed throws
    // `ERR_SUMMARY_RECOMPUTE` carrying the written row: the answer below is
    // built from it and rides the refusal, rethrown at the end (see
    // `summary-recompute-answer.ts`).
    let stale: SummaryRecomputeRefusal | undefined;
    const result = await host.engine.insert(request.object, request.data, opts)
        .catch((e: unknown) => (stale = staleSummaryRefusalOrThrow(e)).written as any);
    // [#7823] The 201 body is a GENERIC-DATA-PATH surface: strip
    // `internal: true` fields here, at the ingress, per the A-prime ruling
    // (2026-08-13). The engine deliberately no longer strips its own write
    // results — better-auth reads a minted `sys_session.token` back off
    // them — so this line is what keeps a flagged credential out of the
    // external create response. Tripwire-enforced; see
    // `write-response-internal-fields.ts`.
    omitInternalFieldsFromWriteResponse(host.engine.registry?.getObject(request.object), result);
    const answer = {
        object: request.object,
        id: result.id,
        record: result,
        ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(withheldMentions.size > 0 ? { withheldMentions: [...withheldMentions] } : {}),
        ...(notice !== undefined ? { notice } : {}),
    };
    if (stale) throw withEarnedAnswer(stale, answer);
    return answer;
}

/** The body of `ObjectStackProtocolImplementation#updateData`; the method's docblock there is its contract. */
export async function updateData(host: Pick<ProtocolHost, 'assertObjectRegistered' | 'assertVersionMatch' | 'engine' | 'probeRecord'>, request: { object: string, id: string, data: any, expectedVersion?: string, context?: any }) {
    host.assertObjectRegistered(request.object); // [#3770]
    // [#4435] A PATCH of an id that names no row answers `404
    // RECORD_NOT_FOUND`, as `getData` does — never `200 { record: null }`,
    // a SUCCESS payload a client had to null-check to learn its write
    // never landed.
    //
    // ⭐ The write is judged FIRST and existence after, the order
    // `deleteData` below has always had. `engine.update` answers its
    // refusals — the security middleware's object- and row-level verdicts,
    // the external datasource's write guard — before its by-id branch asks
    // whether the row exists (the engine's not-found gate, which runs
    // inside the middleware chain and ahead of every `before*` hook). So an
    // update by id answers the same refusal whether or not the id exists,
    // as delete does, and a caller the write is open to still gets the 404.
    //
    // ⛔ No existence probe in front of the engine: existence is asked only
    // once the write has been authorized, on this door (below the write)
    // and on the by-id bulk faces ({@link assertRecordExists}).
    //
    // OCC is asked the way `deleteData` asks it — a probe only when the
    // caller sent a token ({@link assertVersionMatch}) — and a row that
    // probe does not find, or that the caller's own read returns no row
    // for, is left to the engine's answer: OCC has never treated a missing
    // record as a concurrency conflict, and a row absent from the caller's
    // read answers what a missing one does ({@link assertVersionOf}).
    await host.assertVersionMatch(request.object, request.id, request.expectedVersion, request.context);
    const opts: any = { where: { id: request.id } };
    if (request.context !== undefined) opts.context = request.context;
    // [#3407/#3431] Capture the engine's LEGAL write strips (static `readonly`
    // (#2948) / TRUE `readonlyWhen` (#3042)) so a REST/API caller is not left
    // to field-by-field diff the returned row to discover a value never
    // landed. The write still succeeds — this only makes the strip observable,
    // mirroring service-automation's `update_record` wiring (#3413). A faulty
    // listener never breaks the write (the engine catches + logs).
    const dropped: DroppedFieldsEvent[] = [];
    opts.onFieldsDropped = (e: DroppedFieldsEvent) => { dropped.push(e); };
    // [#22726] The advisory rule hits of THIS write, answered as `warnings`
    // (see `createData`).
    const warnings: ValidationAdvisoryEvent[] = [];
    opts.onValidationAdvisory = (e: ValidationAdvisoryEvent) => { warnings.push(e); };
    // [#27703] The mentions this update ADDED that the gate withheld,
    // answered as `withheldMentions` (see `createData`).
    const withheldMentions = new Set<string>();
    opts.onMentionsWithheld = (ids: readonly string[]) => { for (const id of ids) withheldMentions.add(id); };
    // [#28000] The hook-set message answered as `notice` (see `createData`).
    let notice: string | undefined;
    opts.onNotice = (message: unknown) => { if (typeof message === 'string' && message.trim() !== '') notice = message; };
    // [#6479] At THIS ingress the row is the one the caller named — `request.id`,
    // the path `:id` — and nothing in the payload gets to move it.
    //
    // The engine's dispatch reads the PAYLOAD first: a truthy scalar `data.id`
    // outranks `options.where.id` (`engine-update-dispatch.ts`, #5748's
    // payload-first ladder). That rule is correct and deliberate for a caller
    // who hands ObjectQL a payload and nothing else (#5748 / PR #5919, ruling
    // A); it is a HOLE here, because
    //
    // ⚠️ [#11142/#11230] The case this paragraph used to cite by name — *"a
    // SCALAR data.id still wins over a scalar where.id"*, `expectId: 'rec_1'`
    // — no longer exists in `ENGINE_UPDATE_DISPATCH_CASES`. A `where.id` that
    // DISAGREES with a bound payload id is refused at dispatch now
    // (`UPDATE_ID_MISMATCH`, 400), whether it is a different scalar (#11142)
    // or a non-scalar predicate over a row set (#11230). Nothing below
    // changes: the fold makes the two ids EQUAL, the one spelling both
    // rulings deliberately keep honoured. What changes is the pre-fix
    // behaviour described here — it is a loud refusal now, not a silent
    // cross-row write.
    // this caller has already named the row twice — in the URL and in `where` —
    // and the three gates around this line all judge THAT row:
    //
    //   OCC     → `assertVersionMatch(…, request.id, …)` (If-Match / expectedVersion)
    //   engine  → the by-id write, its refusals, then its not-found gate
    //   receipt → `{ id: request.id, record: result }`
    //
    // Passing `request.data` verbatim let a body `{"id":"rec_2"}` on
    // `PATCH /data/task/rec_1` bind rec_2: probed rec_1, OCC-checked rec_1,
    // WROTE rec_2, and answered `id: rec_1` beside rec_2's readback. rec_2 was
    // never probed and never version-checked, so a client that GETs a record,
    // edits it and PUTs the whole body back — with the wrong row's id picked up
    // from a mis-clicked list or a stale refresh — performed a silent cross-row
    // write past its own `If-Match`.
    //
    // The fix is the shape the BULK ingress has always used for the same
    // question (`rest-server.ts`, batch `update`: `ql.update(op.object,
    // { ...data, id }, …)` — the operation's id after the spread, so it wins).
    // Two ingresses, one answer (#4550 / #4434). It changes no engine verdict:
    // the call still dispatches `by-id`, on the id `where` already carried.
    //
    // Deliberately NOT route B (400 on mismatch) or route C (ban `id` in
    // `UpdateDataRequestSchema`) — both were rejected by the 2026-08-08 triage
    // ruling on #6479; B installs a new rejection on a shipped API and C
    // changes the accepted request shape.
    //
    // A non-record payload is passed through UNTOUCHED (`undefined`, `null`, an
    // array): the engine reads `data.id` unguarded on purpose, so `undefined`
    // is its `TypeError`, and an ingress that answered a non-record payload
    // more kindly than the producer would be the very looseness
    // `engine-update-dispatch.ts` exists to prevent. Those shapes carry no
    // scalar `id` to outrank `where.id` either, so the invariant holds for them
    // through `opts.where` alone.
    const writeData = (
        request.data !== null
        && typeof request.data === 'object'
        && !Array.isArray(request.data)
    )
        ? { ...(request.data as Record<string, unknown>), id: request.id }
        : request.data;
    // [#28661] The row landed even when a roll-up could not recompute after
    // it: the answer is built from the written row and rides the refusal
    // (see `createData`).
    let stale: SummaryRecomputeRefusal | undefined;
    const result = byIdUpdateRecord(await host.engine.update(request.object, writeData, opts)
        .catch((e: unknown) => (stale = staleSummaryRefusalOrThrow(e)).written as any));
    // The engine resolved, so the write was authorized. A `null` readback
    // is two answers by contract (`IDataEngine.update`): the row is not
    // there, or the write moved it out of the caller's row scope
    // (reassigning `owner_id` away from yourself under an owner-scoped
    // policy) and LANDED — answering 404 to that would report a write that
    // succeeded as one that never happened. Existence tells them apart,
    // asked now, after authorization, through the system-context
    // {@link probeRecord}. ObjectQL refuses a row that is not there
    // itself, so this reads only on a `null` readback.
    if (result == null && !(await host.probeRecord(request.object, request.id))) {
        throw recordNotFoundError(request.object, request.id);
    }
    // [#7823] The PATCH 200 body is the surface #7728's fourth measurement
    // caught: a client revoking a `sys_api_key` (apiMethods keeps `update`
    // open, #7727) got the stored hash back in this response. That closure
    // used to live in the engine's by-id update path and RELOCATED here
    // under the A-prime ruling (2026-08-13) — the engine's write results
    // stay whole for privileged server-side writers, and THIS line is the
    // sole closure of that surface. Pinned by
    // `api-key-hash-not-serialized.dogfood.test.ts` and the ingress
    // tripwire.
    omitInternalFieldsFromWriteResponse(host.engine.registry?.getObject(request.object), result);
    const answer = {
        object: request.object,
        id: request.id,
        record: result,
        ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(withheldMentions.size > 0 ? { withheldMentions: [...withheldMentions] } : {}),
        ...(notice !== undefined ? { notice } : {}),
    };
    if (stale) throw withEarnedAnswer(stale, answer);
    return answer;
}

/** The body of `ObjectStackProtocolImplementation#deleteData`; the method's docblock there is its contract. */
export async function deleteData(host: Pick<ProtocolHost, 'assertObjectRegistered' | 'assertVersionMatch' | 'engine'>, request: { object: string, id: string, expectedVersion?: string, context?: any }) {
    host.assertObjectRegistered(request.object); // [#3770]
    await host.assertVersionMatch(request.object, request.id, request.expectedVersion, request.context);
    const opts: any = { where: { id: request.id } };
    if (request.context !== undefined) opts.context = request.context;
    // [#28661] The row is gone even when a roll-up could not recompute
    // after it: the answer rides the refusal (see `createData`).
    let stale: SummaryRecomputeRefusal | undefined;
    const deleted = await host.engine.delete(request.object, opts)
        .catch((e: unknown) => (stale = staleSummaryRefusalOrThrow(e)).written as any);
    // [#4435] `success: true` used to be a LITERAL — the response said the
    // same thing for a real deletion, an already-deleted row and a typo'd
    // id, so nothing on the wire could tell them apart. The driver contract
    // (`IDataDriver.delete` — "True if deleted, false if not found") already
    // carries the answer; it was simply discarded here. Now it decides:
    // `false` is a 404, matching `getData` on the same id, and `success` on
    // the 200 finally means what it says.
    //
    // Read as `=== false` on purpose. That is the contract's own value for
    // "no row matched"; anything else — a driver returning the deleted row,
    // an `undefined` from an off-contract implementation — is not a
    // POSITIVE not-found signal, and inventing a 404 out of it would break
    // deletes against third-party drivers rather than report honestly.
    if (deleted === false) throw recordNotFoundError(request.object, request.id);
    // The same measurement, one outcome over: `success` was still a
    // LITERAL for every answer that was not the contract's `false`, so a
    // row that MATCHED and was deliberately NOT removed reported a
    // deletion. `sys_permission_set` was the shipped case until C3 stage
    // 8 retired that object — a package-declared set's delete was an
    // ADR-0005 RESET, the record re-projected to the declared body instead
    // of vanishing — and the envelope was byte-identical to a real
    // delete, so a UI fired a success toast and showed the row again on
    // refresh.
    //
    // `success` is declared "Whether deletion succeeded", and this is the
    // only key on `DeleteDataResponseSchema` that can carry the
    // difference; zero rows removed is a deletion that did not succeed.
    // The engine's delete result declares two arms — the driver's boolean
    // for a by-id write, a COUNT of rows removed otherwise — so a numeric
    // zero is the one answer that positively means "the row is still
    // there", and it is what the middleware that performs a reset now
    // returns. It cannot say so with `false`: that value is spoken for by
    // the not-found 404 above, which would be a second lie about a record
    // this caller can still GET.
    //
    // Everything else keeps its #4435 reading, including an off-contract
    // `undefined` from a third-party driver: only a POSITIVE zero is read
    // as "not removed".
    const answer = {
        object: request.object,
        id: request.id,
        success: deleted !== 0
    };
    if (stale) throw withEarnedAnswer(stale, answer);
    return answer;
}
