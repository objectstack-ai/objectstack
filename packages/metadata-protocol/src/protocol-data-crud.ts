// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Data CRUD" facet of
 * `ObjectStackProtocolImplementation`: the bodies of `getData`, `cloneData`,
 * `probeRecord` moved out of `protocol.ts` whole by
 * `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. `ProtocolDataCrudFacet` is a stateless facet over the host
 * (ruling 6624345766): each static method below is the body of the class
 * member of the same name as `packages/metadata-protocol/scripts/host-split.mjs`
 * moves one (ruling E, item E1), with `this.<member>` read as `host.<member>`
 * and nothing else changed. The facet holds no state: the fields stay on the
 * class, and a body reaches them through the host (`protocol-host.ts`).
 *
 * The class keeps every member as a one-line delegation. A public member
 * keeps its docblock there, which the published `.d.ts` prints; a private
 * member's docblock moved here with its body (docblock ownership).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { recordNotFoundError } from '@objectstack/core';
import { staleSummaryRefusalOrThrow, withEarnedAnswer } from '@objectstack/types';
import type { SummaryRecomputeRefusal } from '@objectstack/types';
import { omitInternalFieldsFromWriteResponse } from './write-response-internal-fields.js';
import type { DroppedFieldsEvent, EngineQueryOptions, ValidationAdvisoryEvent } from '@objectstack/spec/data';
import {
    redactStoredMetadataRow,
    serveStoredMetadataHashColumns,
    storedMetadataBodyProjection,
} from './metadata-redaction.js';
import { CLONE_STRIP_FIELDS } from './protocol-write-constants.js';
import { projectionFieldsValue } from './protocol-list-query-params.js';
import type { ProtocolHost } from './protocol-host.js';

export class ProtocolDataCrudFacet {
    /** The body of `ObjectStackProtocolImplementation#getData`; the method's docblock there is its contract. */
    static async getData(host: Pick<ProtocolHost, 'assertExpandTargetsExist' | 'assertObjectRegistered' | 'assertProjectionFieldsExist' | 'engine' | 'servedExpand' | 'storedHashDigest'>, request: { object: string, id: string, expand?: string | string[], select?: string | string[], context?: any }): Promise<{
            object: string;
            id: string;
            record: Record<string, any>;
        }> {
        host.assertObjectRegistered(request.object); // [#3770]
        const queryOptions: any = {
            where: { id: request.id }
        };
        if (request.context !== undefined) {
            queryOptions.context = request.context;
        }

        // Support fields for single-record retrieval
        //
        // [#4226] Gated exactly as on the list path. `GET /data/:object/:id` and
        // `GET /data/:object` read the same `select`/`expand` against the same
        // field map, so answering one with a 400 and the other with a silently
        // widened projection would recreate, one route over, the very split
        // ("two routes, opposite answers for one input") this issue was filed
        // about.
        //
        // [#26644] …including the empty projection: a blank `?select=` was
        // falsy and skipped, a comma-only one became `[]` — both answered every
        // column. Asked on any value present, as the list path asks it.
        if (request.select != null) {
            queryOptions.fields = typeof request.select === 'string' || Array.isArray(request.select)
                ? projectionFieldsValue(request.select, 'select')
                : request.select;
            host.assertProjectionFieldsExist(request.object, queryOptions.fields, 'select');
        }
        // [#21086] Same read projection as the list path (`findData`): the row's
        // `type` is read even when `select` named only the body.
        const bodyProjection = storedMetadataBodyProjection(request.object, queryOptions.fields);
        if (bodyProjection.addedType) queryOptions.fields = bodyProjection.fields;

        // Support expand for single-record retrieval
        if (request.expand) {
            const expandNames = typeof request.expand === 'string'
                ? request.expand.split(',').map((s: string) => s.trim()).filter(Boolean)
                : request.expand;
            host.assertExpandTargetsExist(request.object, expandNames);
            const expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                expand[rel] = { object: rel };
            }
            // [#22661] The same exposure judgement as the list path: an entry
            // whose target does not serve `get` is withheld ({@link servedExpand}).
            const served = host.servedExpand(request.object, expand, 0);
            if (Object.keys(served).length > 0) queryOptions.expand = served;
        }

        // [#29764] The bag `engine.findOne` receives is typed as the engine
        // declares it. `queryOptions` stays the working bag: the projection
        // helpers above answer `unknown` (they serve the raw list query too), so
        // its `fields` has no declared type until it is handed on here. Keys are
        // copied only when present, so the engine sees the same bag as before.
        const findOneQuery: EngineQueryOptions = {
            where: queryOptions.where,
            ...(queryOptions.context !== undefined ? { context: queryOptions.context } : {}),
            ...(queryOptions.fields !== undefined ? { fields: queryOptions.fields } : {}),
            ...(queryOptions.expand !== undefined ? { expand: queryOptions.expand } : {}),
        };
        const result = await host.engine.findOne(request.object, findOneQuery);
        if (result) {
            return {
                object: request.object,
                id: request.id,
                // [#21207] Same served form as the list path: the content-hash
                // columns keyed.
                record: await serveStoredMetadataHashColumns(
                    request.object,
                    redactStoredMetadataRow(request.object, result, { dropType: bodyProjection.addedType }),
                    host.storedHashDigest(),
                ),
            };
        }
        throw recordNotFoundError(request.object, request.id);
    }

    /** The body of `ObjectStackProtocolImplementation#cloneData`; the method's docblock there is its contract. */
    static async cloneData(host: Pick<ProtocolHost, 'assertObjectRegistered' | 'engine'>, request: { object: string, id: string, overrides?: Record<string, any>, context?: any }): Promise<{
            warnings?: {
                rule: string;
                severity: "info" | "warning";
                field: string;
                code: string;
                message: string;
            }[] | undefined;
            droppedFields?: {
                object: string;
                fields: string[];
                reason: "readonly" | "computed" | "readonly_when" | "primary_key" | "stored_expression";
            }[] | undefined;
            object: string;
            id: any;
            sourceId: string;
            record: any;
        }> {
        // [#3770] This object-existence check used to be open-coded here and
        // was the ONLY one on the whole data plane; it is now the shared gate
        // every data entry point runs. Same error envelope as before.
        host.assertObjectRegistered(request.object);
        const schema: any = host.engine.registry?.getObject(request.object);
        // `enable.clone` defaults to true in the spec; treat an absent block /
        // absent flag as enabled and only block on an explicit `false`.
        if (schema?.enable?.clone === false) {
            const err: any = new Error(`Cloning is disabled for object '${request.object}'`);
            err.code = 'CLONE_DISABLED';
            err.status = 403;
            err.object = request.object;
            throw err;
        }

        const ctx = request.context;
        const ctxOpt = ctx !== undefined ? { context: ctx } : undefined;

        const source = await host.engine.findOne(
            request.object,
            { where: { id: request.id }, ...ctxOpt },
        );
        if (!source) throw recordNotFoundError(request.object, request.id);

        // Copy the source, then strip the columns the engine owns so the insert
        // path re-derives them rather than carrying the source's values over.
        const data: Record<string, any> = { ...source };
        for (const f of CLONE_STRIP_FIELDS) delete data[f];
        const fields: Record<string, any> = schema?.fields || {};
        for (const [name, def] of Object.entries(fields)) {
            if (!def) continue;
            // Engine-/automation-owned values: injected system/audit columns,
            // engine-generated autonumbers, and computed formula/summary fields.
            if ((def as any).system === true
                || (def as any).type === 'autonumber'
                || (def as any).type === 'formula'
                || (def as any).type === 'summary') {
                delete data[name];
                continue;
            }
            // [#29200] A read-only column the source left EMPTY is not carried
            // into the insert. Carried, it reached `engine.insert`'s strip as a
            // present key and was reported in `droppedFields` (and the
            // `X-ObjectStack-Dropped-Fields` header) although neither the caller
            // nor the source supplied a value. Leaving it out stores the same
            // row: the strip would have taken it from a non-system caller, and
            // the insert's defaults treat an explicit `null` exactly as an
            // omitted key. A read-only column that HOLDS a value is still
            // carried, stripped and reported (#15703), and so is one the caller
            // sets through `overrides`, which are applied below.
            if ((def as any).readonly && data[name] == null) delete data[name];
        }
        // Caller overrides win (new name, cleared unique field, reset status…).
        if (request.overrides && typeof request.overrides === 'object') {
            Object.assign(data, request.overrides);
        }

        // [#3043/#14147] A clone is a create: a non-system caller must not carry
        // over (or override in) a read-only column — copying the source's
        // `approval_status` or forging one via `overrides` would mint an approved
        // record. That strip is `engine.insert`'s since #14147, so the payload
        // goes over whole and the insert re-derives the field's `defaultValue`,
        // symmetric with createData. `overrides` are applied ABOVE this line, so
        // a readonly key smuggled through them is still judged by the strip.
        //
        // [#15703] And the verdict is REPORTED, the same listener `createData`
        // wires: a clone is the one create shape that carries a read-only column
        // without the caller typing it (the source's `approval_status` travels in
        // the copy), so the 201 body says which keys the engine dropped instead of
        // leaving the caller to diff `record` against the source. Maintainer
        // ruling 2026-09-08 (option 1); `CloneDataResponseSchema` declares the
        // member in the same change, because that schema is declared AS PRODUCED.
        const dropped: DroppedFieldsEvent[] = [];
        // [#22726] A clone is a create: its advisory rule hits are answered as
        // `warnings`, the same listener `createData` wires.
        const warnings: ValidationAdvisoryEvent[] = [];
        const opts: any = {
            onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); },
            onValidationAdvisory: (e: ValidationAdvisoryEvent) => { warnings.push(e); },
        };
        if (ctx !== undefined) opts.context = ctx;
        // [#28782] A copy the engine stored but whose parent roll-up it could
        // not recompute carries this method's answer on the refusal, as
        // `createData` does since #28781 (`withEarnedAnswer`).
        let stale: SummaryRecomputeRefusal | undefined;
        const result = await host.engine.insert(request.object, data, opts)
            .catch((e: unknown) => (stale = staleSummaryRefusalOrThrow(e)).written as any);
        // [#7823] Same ingress strip as `createData` — a clone's 201 body is
        // the same generic-data-path surface. (The SOURCE row was read through
        // the engine's find path, which already omits internal fields, so the
        // copy never carried one in; this guards the INSERT RESULT, which the
        // engine returns whole by design.)
        omitInternalFieldsFromWriteResponse(schema, result);
        const answer = {
            object: request.object,
            id: result.id,
            sourceId: request.id,
            record: result,
            ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
            ...(warnings.length > 0 ? { warnings } : {}),
        };
        if (stale) throw withEarnedAnswer(stale, answer);
        return answer;
    }

    /**
     * [#4435] Does this row EXIST? A fact about the database — deliberately
     * NOT "may this caller see it".
     *
     * Read with a system context so no row-level policy narrows it. That is
     * load-bearing, and the first version of this fix got it wrong: probing
     * with the CALLER's context turns the existence gate into an authorization
     * gate, because a row the caller cannot read comes back `null` and the
     * PATCH answers 404. Two things break when it does.
     *
     * 1. It silently changes RLS semantics. Whether an unreadable row may be
     *    written by id is the #1994 pre-image check's decision, made inside
     *    `engine.update` where the write policy lives. A probe in front of it
     *    quietly adds a second, different rule — scope creep into the security
     *    model, from a bug fix about missing records.
     *
     * 2. It disarms a revert-provable security proof. `@proof: rls-by-id-write`
     *    (`packages/qa/dogfood/test/rls-fixture.dogfood.test.ts`, referenced by
     *    the `permission.rowLevelSecurity.using` liveness ledger entry) boots a
     *    fixture whose member can read nothing but has no write policy, and
     *    asserts the runner reports `rls-hole`. A caller-scoped probe 404s that
     *    PATCH, so the RED half goes green — and the gate can no longer prove
     *    it is able to go red. If the #1994 fix were ever reverted, this probe
     *    would MASK it. Accidentally hardening one path is not worth
     *    permanently blinding the gate that watches the whole class.
     *
     * So the probe answers existence only, and authorization stays exactly
     * where it was. The one behaviour this adds is the 404 the issue asked for:
     * an id that names no row at all.
     *
     * ⛔ And what it finds never answers IN FRONT of the write's
     * authorization. Its readers are OCC's `updated_at` comparison, asked only
     * when the caller sent a token ({@link assertVersionMatch}) and answering
     * only for a row the caller's own read returns ({@link assertVersionOf}),
     * and the by-id update's existence check, asked only after `engine.update`
     * has judged and resolved the write (`updateData`, and the bulk faces
     * through {@link assertRecordExists}) — so an update by id answers the same
     * refusal whether or not the id exists, as delete does. With a mismatched
     * token, a caller whose read of the row is refused gets that read refusal.
     */
    static async probeRecord(host: Pick<ProtocolHost, 'engine'>, object: string, id: string): Promise<any> {
        return host.engine.findOne(object, { where: { id }, context: { isSystem: true } });
    }
}
