// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148] The recycle bin's REST doors, one object at a time,
 * under the data surface:
 *
 *   GET    {data}/:object/recycle-bin                   list (newest first)
 *   DELETE {data}/:object/recycle-bin                   empty the object's bin
 *   POST   {data}/:object/recycle-bin/:entryId/restore  restore one entry
 *   DELETE {data}/:object/recycle-bin/:entryId          purge one entry
 *
 * Each door is a thin face over the engine's own verb (`ObjectQL.listRecycleBin`,
 * `empty`, `restore`, `purge`), called as the caller: the engine and the
 * security layer decide who may do what (ADR-0148 D5). Listing and purging are
 * the recycle-bin manager's (`manageRecycleBin`); a restore needs
 * `allowRestoreOwnDeleted` and, for an entry someone else deleted,
 * `manageRecycleBin`. Every refusal the engine or the security layer raises is
 * answered in the shared envelope at its own status and code.
 *
 * ## Why under `/data/:object`
 *
 * Every act on the bin is per object: an entry belongs to the object its
 * master row came from, `empty` takes one object per call, and the listing
 * applies field-level security on that object. So the doors sit under the
 * advertised data base, and an entry addressed under an object it does not
 * belong to is not found (the engine's `object` option). The two two-segment
 * paths (`GET` / `DELETE {data}/:object/recycle-bin`) are literals beside the
 * greedy `{data}/:object/:id`, so `rest-server.ts` registers this family
 * before the CRUD routes, as it does the data actions (`…/export`).
 *
 * ## API exposure
 *
 * Each door passes the object's `enable` gate (`enforceApiAccess`) as every
 * data door does: the listing and the restore as `restore`, the purge and the
 * empty as `purge`, the two operations the spec derives from the object's
 * `delete` primitive (`API_METHOD_DERIVATION`).
 *
 * ## Field-level security on the listing
 *
 * The engine serves the snapshot unmasked (`recycle-bin/list.ts`); this door
 * masks it. Each snapshot row keeps its `id` and only the values of the
 * fields the caller may QUERY on the row's object (`getQueryableFields`): the
 * fields it may read minus the fields it sees masked, since a stored value is
 * the unmasked one. With no answer for an object (the method is absent, or it
 * answered `undefined`), a row keeps its `id` alone. A deployment that
 * registers no security service has no field-level security to apply, and
 * the values are served as the engine answered them. The references the
 * delete cleared are not served: they name rows and fields of other records.
 */

import { z } from 'zod';
import { isSummaryRecomputeRefusal, sendError, sendOk, sendServerFault, staleSummaryAnswerLines, validationFailureDetails } from '@objectstack/types';
import { isAuthzStoreUnavailableError } from '@objectstack/core';
import {
    classifiedRefusalAnswer,
    logUnexpectedRouteError,
    mapDataError,
    nestedRefusalEnvelope,
    sandboxFaultAnswer,
} from './error-response.js';
import { logError } from './log.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { readDeclaredQueryNumber, wiredEngineOrLoud, type RestServer } from './rest-server.js';

/**
 * The `RestServer` members {@link registerRecycleBinEndpoints} reads — every
 * one of them, and no other. Each is typed AS the class member, so a change
 * to a member's signature on the class is a change here too. The two
 * provider fields go as getters: the handlers read them at request time.
 */
export interface RecycleBinRouteHost {
    readonly config: RestServer['config'];
    readonly routeManager: RestServer['routeManager'];
    readonly objectQLProvider: RestServer['objectQLProvider'];
    resolveProtocol: RestServer['resolveProtocol'];
    resolveRequestEnvironmentId: RestServer['resolveRequestEnvironmentId'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
    enforceApiAccess: RestServer['enforceApiAccess'];
    resolveSecurityService: RestServer['resolveSecurityService'];
}

/** The listing's closed query-parameter set (#7527): paging only. */
export const RECYCLE_BIN_LIST_QUERY_PARAMS: readonly string[] = ['limit', 'offset'];

/** The restore, purge and empty doors take no query parameter. */
export const RECYCLE_BIN_ACT_QUERY_PARAMS: readonly string[] = [];

/** The keys a refusal of a bin act carries, forwarded to the caller as `details`. */
const REFUSAL_DETAIL_KEYS = ['entryId', 'object', 'recordId', 'field', 'parentObject', 'parentId', 'parentEntryId', 'param'] as const;

/** What the doors call on the engine. */
interface RecycleBinEngine {
    listRecycleBin(object: string, options?: { context?: unknown; limit?: number; offset?: number }): Promise<{
        object: string;
        entries: ReadonlyArray<{
            id: string;
            object: string;
            recordId: string;
            recordCount: number;
            snapshot?: { rows?: ReadonlyArray<{ object: string; id: string; values: Record<string, unknown> }> };
            deletedBy?: string;
            deletedAt?: string;
            retentionDays?: number;
            purgeAfter?: string;
        }>;
        hasMore: boolean;
    }>;
    restore(entryId: string, options?: { context?: unknown; object?: string }): Promise<unknown>;
    purge(entryId: string, options?: { context?: unknown; object?: string }): Promise<boolean>;
    empty(object: string, options?: { context?: unknown }): Promise<number>;
    getSchema?(object: string): { fields?: Record<string, { maskingRule?: unknown }> } | undefined;
}

/**
 * The declared reading of the listing's two paging parameters, each read
 * through `readDeclaredQueryNumber` (#20139): a whole number in the engine's
 * own range (`limit` 1 to 200, the engine's `RECYCLE_BIN_LIST_MAX_LIMIT`, which
 * re-checks it; `offset` from 0), and the `400 VALIDATION_FAILED` the
 * declaration refuses otherwise. `?limit=` is refused, never read as absent:
 * the door is new, so there is no earlier answer to keep.
 */
const RECYCLE_BIN_LIST_PAGING: Readonly<Record<'limit' | 'offset', z.ZodType<number | undefined>>> = {
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
};

/**
 * A restore's answer, read off the engine's report field by field: the entry,
 * the master row's id, every row written back as `{ object, id }`, and the
 * re-linked count. A receipt, never a record body (#8497): whatever else the
 * engine's report carries is not served.
 */
function restoreReceipt(report: any): Record<string, unknown> {
    const rows = Array.isArray(report?.rows) ? report.rows : [];
    return {
        entryId: report?.entryId,
        object: report?.object,
        recordId: report?.recordId,
        rows: rows.map((row: any) => ({ object: row?.object, id: row?.id })),
        relinked: report?.relinked,
    };
}

/**
 * Answer a thrown error, in the nested envelope:
 *
 *  - an unreadable authorization input (the engine or the security service
 *    could not be resolved) is the `/data` door's `503`;
 *  - a paging parameter its declaration refuses is `400 VALIDATION_FAILED`
 *    with `details.fields` naming it;
 *  - a sandboxed body's fault is answered as the doors answer it, its words
 *    withheld (`sandboxFaultAnswer`);
 *  - a refusal the engine or the security layer classified is answered at its
 *    own status and code, with the entry, row and parent it names as
 *    `details`, so a client can restore a parent entry first;
 *  - anything else is a server fault, its text withheld.
 */
function answerThrown(res: any, error: any, fault: string): void {
    if (isAuthzStoreUnavailableError(error)) {
        const mapped = mapDataError(error);
        logUnexpectedRouteError(error, mapped);
        const nested = nestedRefusalEnvelope(mapped);
        return sendError(res, nested.status, nested.code, nested.message);
    }
    // A paging parameter its declaration refuses (`readDeclaredQueryNumber`):
    // the data surface's `400 VALIDATION_FAILED` naming the parameter.
    const invalid = validationFailureDetails(error);
    if (invalid) return sendError(res, 400, 'VALIDATION_FAILED', String(error.message), { details: { fields: invalid.fields } });
    const sandboxFault = sandboxFaultAnswer(error);
    if (sandboxFault) {
        logError('[REST] recycle-bin error:', error);
        const nested = nestedRefusalEnvelope(sandboxFault);
        return sendError(res, nested.status, nested.code, nested.message, nested.extra);
    }
    const refusal = classifiedRefusalAnswer(error);
    if (!refusal) return sendServerFault(res, 500, 'INTERNAL_ERROR', fault, error);
    const nested = nestedRefusalEnvelope(refusal);
    const details: Record<string, unknown> = {};
    for (const key of REFUSAL_DETAIL_KEYS) {
        const value = error?.[key];
        if (typeof value === 'string' || typeof value === 'number') details[key] = value;
    }
    return sendError(res, nested.status, nested.code, nested.message, {
        ...nested.extra,
        ...(Object.keys(details).length > 0 ? { details } : {}),
    });
}

/**
 * Register the recycle-bin doors — `RestServer#registerRecycleBinEndpoints`'
 * body, called by that method with the server as `this`.
 */
export function registerRecycleBinEndpoints(this: RecycleBinRouteHost, basePath: string): void {
    const binPath = `${basePath}${this.config.crud.dataPrefix}/:object/recycle-bin`;
    const isScoped = basePath.includes('/environments/:environmentId');

    const resolveEngine = async (environmentId: string | undefined, req: any): Promise<RecycleBinEngine | undefined> => {
        const ql = await wiredEngineOrLoud(
            Boolean(this.objectQLProvider),
            async () => this.objectQLProvider!(await this.resolveRequestEnvironmentId(environmentId, req)),
        ) as Partial<RecycleBinEngine> | undefined;
        if (!ql || typeof ql.listRecycleBin !== 'function' || typeof ql.restore !== 'function'
            || typeof ql.purge !== 'function' || typeof ql.empty !== 'function') return undefined;
        return ql as RecycleBinEngine;
    };
    const noBin = (res: any) => sendError(res, 501, 'NOT_IMPLEMENTED', 'The recycle bin is not available on this deployment');

    /**
     * The fields of `object` whose stored values the caller may see: those it
     * may query on. `null` means no field-level security applies (no security
     * service is registered); `undefined` means no answer, and the row keeps
     * its `id` alone.
     */
    const servedFieldsOf = async (
        security: Awaited<ReturnType<RecycleBinRouteHost['resolveSecurityService']>>,
        engine: RecycleBinEngine,
        object: string,
        context: unknown,
    ): Promise<ReadonlySet<string> | null | undefined> => {
        if (!security) return null;
        try {
            if (typeof security.getQueryableFields === 'function') {
                const queryable = await security.getQueryableFields(object, context as any);
                return Array.isArray(queryable) ? new Set(queryable) : undefined;
            }
            if (typeof security.getReadableFields !== 'function') return undefined;
            const readable = await security.getReadableFields(object, context as any);
            if (!Array.isArray(readable)) return undefined;
            // An older service that cannot say for whom a mask is lifted: every
            // field that declares a `maskingRule` is withheld, whoever asks.
            const fields = engine.getSchema?.(object)?.fields ?? {};
            return new Set(readable.filter((name) => fields[name]?.maskingRule == null));
        } catch {
            return undefined;
        }
    };

    // GET {data}/:object/recycle-bin — one page of the object's entries.
    this.routeManager.register({
        method: 'GET',
        path: binPath,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (refuseUnknownQueryParams(req, res, RECYCLE_BIN_LIST_QUERY_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res, RECYCLE_BIN_LIST_QUERY_PARAMS)) return;
                const paging: { limit?: number; offset?: number } = {};
                for (const param of ['limit', 'offset'] as const) {
                    const value = readDeclaredQueryNumber(req.query, param, RECYCLE_BIN_LIST_PAGING[param], { emptyIsAbsent: false });
                    if (value !== undefined) paging[param] = value;
                }
                if (await this.enforceApiAccess(req, res, p, environmentId, 'restore', context)) return;
                const object = String(req.params.object);
                const engine = await resolveEngine(environmentId, req);
                if (!engine) return noBin(res);
                const page = await engine.listRecycleBin(object, { context, ...paging });
                const security = await this.resolveSecurityService(environmentId, req);
                const served = new Map<string, ReadonlySet<string> | null | undefined>();
                const entries = [];
                for (const entry of page.entries) {
                    const rows = [];
                    for (const row of entry.snapshot?.rows ?? []) {
                        if (!served.has(row.object)) served.set(row.object, await servedFieldsOf(security, engine, row.object, context));
                        const fields = served.get(row.object);
                        const values: Record<string, unknown> = {};
                        for (const [name, value] of Object.entries(row.values ?? {})) {
                            if (fields === null || fields?.has(name)) values[name] = value;
                        }
                        values.id = row.id;
                        rows.push({ object: row.object, id: row.id, values });
                    }
                    entries.push({
                        id: entry.id,
                        object: entry.object,
                        recordId: entry.recordId,
                        recordCount: entry.recordCount,
                        deletedBy: entry.deletedBy ?? null,
                        deletedAt: entry.deletedAt ?? null,
                        retentionDays: entry.retentionDays ?? null,
                        purgeAfter: entry.purgeAfter ?? null,
                        rows,
                    });
                }
                return sendOk(res, { object: page.object, entries, hasMore: page.hasMore });
            } catch (error) {
                return answerThrown(res, error, 'Listing the recycle bin failed');
            }
        },
        metadata: { summary: 'List the recycle-bin entries of an object, newest first (recycle-bin managers)', tags: ['data', 'recycle-bin'] },
    });

    // DELETE {data}/:object/recycle-bin — remove every entry of the object.
    this.routeManager.register({
        method: 'DELETE',
        path: binPath,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (refuseUnknownQueryParams(req, res, RECYCLE_BIN_ACT_QUERY_PARAMS)) return;
                if (await this.enforceApiAccess(req, res, p, environmentId, 'purge', context)) return;
                const object = String(req.params.object);
                const engine = await resolveEngine(environmentId, req);
                if (!engine) return noBin(res);
                const removed = await engine.empty(object, { context });
                return sendOk(res, { object, removed });
            } catch (error) {
                return answerThrown(res, error, 'Emptying the recycle bin failed');
            }
        },
        metadata: { summary: 'Empty the recycle bin of an object: purge every entry the caller\'s organization holds', tags: ['data', 'recycle-bin'] },
    });

    // POST {data}/:object/recycle-bin/:entryId/restore — write one entry back.
    this.routeManager.register({
        method: 'POST',
        path: `${binPath}/:entryId/restore`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (refuseUnknownQueryParams(req, res, RECYCLE_BIN_ACT_QUERY_PARAMS)) return;
                if (await this.enforceApiAccess(req, res, p, environmentId, 'restore', context)) return;
                const object = String(req.params.object);
                const entryId = String(req.params.entryId);
                const engine = await resolveEngine(environmentId, req);
                if (!engine) return noBin(res);
                const restored = await engine.restore(entryId, { context, object });
                if (restored == null) {
                    return sendError(res, 404, 'RECORD_NOT_FOUND', `No recycle-bin entry '${entryId}' of '${object}' is visible to you`, {
                        details: { object, entryId },
                    });
                }
                return sendOk(res, restoreReceipt(restored));
            } catch (error) {
                // [#28661] The rows came back and only a roll-up could not
                // recompute after them: the restore's own answer, never a 500.
                const written = isSummaryRecomputeRefusal(error) ? (error as { written?: unknown }).written : undefined;
                if (written !== null && typeof written === 'object') {
                    for (const line of staleSummaryAnswerLines(error as any, req.params?.object)) logError(`[REST] ${line}`);
                    return sendOk(res, restoreReceipt(written));
                }
                return answerThrown(res, error, 'Restoring the recycle-bin entry failed');
            }
        },
        metadata: { summary: 'Restore one recycle-bin entry: write its records back under their original ids', tags: ['data', 'recycle-bin'] },
    });

    // DELETE {data}/:object/recycle-bin/:entryId — purge one entry.
    this.routeManager.register({
        method: 'DELETE',
        path: `${binPath}/:entryId`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (refuseUnknownQueryParams(req, res, RECYCLE_BIN_ACT_QUERY_PARAMS)) return;
                if (await this.enforceApiAccess(req, res, p, environmentId, 'purge', context)) return;
                const object = String(req.params.object);
                const entryId = String(req.params.entryId);
                const engine = await resolveEngine(environmentId, req);
                if (!engine) return noBin(res);
                const purged = await engine.purge(entryId, { context, object });
                if (!purged) {
                    return sendError(res, 404, 'RECORD_NOT_FOUND', `No recycle-bin entry '${entryId}' of '${object}' is visible to you`, {
                        details: { object, entryId },
                    });
                }
                return sendOk(res, { object, entryId, purged: true });
            } catch (error) {
                return answerThrown(res, error, 'Purging the recycle-bin entry failed');
            }
        },
        metadata: { summary: 'Purge one recycle-bin entry: its records can no longer be restored', tags: ['data', 'recycle-bin'] },
    });
}
