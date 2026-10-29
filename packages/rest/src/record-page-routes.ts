// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27627] `POST {basePath}/data/:object/:id/page` — the record page payload
 * (`RecordPageRequestSchema` → `RecordPageResponseSchema`, `@objectstack/spec/api`).
 *
 * One request answers what a record page asked of the server in up to three
 * serial stages when it opened. Every part is the answer of the read it
 * replaces, asked as the same caller through the same call, and the route adds
 * no judgement of its own (the part-to-read table is the spec module's header):
 * the record is `getData` after the object-exposure gate, and its refusal is
 * the whole answer, before any other part is asked; a related list is
 * `findData` with `count` after the child's own exposure gate, filtered by the
 * parent condition this route composes AND the list's declared scope; then
 * `getRecordFieldAccess`, the security service's `explain` and the approval
 * service's `listRequests` / `getRequest` / `getRecordLock`. Object
 * permissions, row-level security, sharing and field-level security are
 * therefore whatever those calls apply, by construction.
 *
 * The page names the lists (which ones it draws is its own derivation); this
 * route never derives one. It owns the meaning of an entry: the child field
 * must be a relationship that points at this object, or the request is refused.
 * The closed query-parameter set is empty (AGENTS.md, Route & surface
 * ownership 5), and the body is parsed strictly.
 */

import {
    RecordPageRequestSchema,
    zodIssuesToFields,
    type GetDataRequest,
    type FindDataRequest,
    type RecordPageRequest,
} from '@objectstack/spec/api';
import { isMultiValueField, parseFilterAST } from '@objectstack/spec/data';
import { measureServerTiming } from '@objectstack/observability';
import { sendError, sendOk } from '@objectstack/types';
import { recordNotFoundError } from '@objectstack/core';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { logUnexpectedRouteError, mapDataError, nestedRefusalEnvelope } from './error-response.js';
import type { ServerScopedDataRequest } from './data-action-routes.js';
import { apiAccessDenialFromEnable, type RestServer } from './rest-server.js';

/** The closed query-parameter set of `POST {basePath}/data/:object/:id/page`: EMPTY. */
export const RECORD_PAGE_PARAMS: readonly string[] = [];

/** The relationship field types a related list follows back to its parent. */
const RELATIONSHIP_TYPES = new Set(['lookup', 'master_detail']);

/**
 * The `RestServer` members {@link registerRecordPageEndpoints} reads — every
 * one of them, and no other (`data-action-routes.ts`' header carries why each
 * entry is shaped the way it is). `approvalsServiceProvider` is a getter: it is
 * read at request time and the server may assign it after registration.
 */
export interface RecordPageRouteHost {
    readonly config: RestServer['config'];
    readonly routeManager: RestServer['routeManager'];
    readonly approvalsServiceProvider: ((environmentId?: string) => Promise<any | undefined>) | undefined;
    resolveProtocol: RestServer['resolveProtocol'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
    enforceApiAccess: RestServer['enforceApiAccess'];
    resolveSecurityService: RestServer['resolveSecurityService'];
    /** The object's metadata item as the exposure gate reads it, or `undefined`. */
    loadObjectItem: (p: any, environmentId: string | undefined, name: string) => Promise<any | undefined>;
}

/** A part's refusal, as the replaced read answers it. */
interface PartRefusal {
    code: string;
    status: number;
    message: string;
}

/** The data door's own classification of a thrown error, as a part refusal. */
function refusalOf(error: unknown, object: string): PartRefusal {
    const mapped = mapDataError(error, object);
    logUnexpectedRouteError(error, mapped);
    const nested = nestedRefusalEnvelope(mapped);
    return { code: nested.code, status: nested.status, message: nested.message };
}

/** A field definition by name, from either served shape of an object's `fields`. */
function fieldDefOf(item: any, name: string): any | undefined {
    const fields = item?.fields;
    if (Array.isArray(fields)) return fields.find((f: any) => f?.name === name);
    if (fields && typeof fields === 'object') {
        return Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined;
    }
    return undefined;
}

/** The target object a relationship field declares (`reference`, the spec's one spelling). */
function referenceOf(def: any): string | undefined {
    const ref = def?.reference;
    return typeof ref === 'string' && ref ? ref : undefined;
}

/**
 * Register the record page payload route — called by
 * `RestServer#registerRecordPageEndpoints` with a {@link RecordPageRouteHost}
 * as `this`.
 */
export function registerRecordPageEndpoints(this: RecordPageRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');
    const dataPath = `${basePath}${this.config.crud.dataPrefix}`;

    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/:object/:id/page`,
        handler: async (req: any, res: any) => {
            const object = String(req.params?.object ?? '');
            const id = String(req.params?.id ?? '');
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (await this.enforceApiAccess(req, res, p, environmentId, 'get')) return;
                if (refuseUnknownQueryParams(req, res, RECORD_PAGE_PARAMS)) return;

                const rawBody = req.body ?? {};
                const parsed = (RecordPageRequestSchema as any).safeParse(rawBody);
                if (!parsed.success) {
                    sendError(res, 400, 'VALIDATION_FAILED', 'Invalid record page request', {
                        details: { object, fields: zodIssuesToFields(parsed.error?.issues, rawBody) },
                    });
                    return;
                }
                const body = parsed.data as RecordPageRequest;
                const scope = {
                    ...(environmentId ? { environmentId } : {}),
                    ...(context ? { context } : {}),
                };

                // Each related entry must name a relationship of the child that
                // points at THIS object. Judged before anything is read, so a
                // malformed entry refuses the request without a single read.
                // An entry whose child the caller may not reach through the API
                // is not judged here: its read below answers that refusal.
                const related = body.related ?? [];
                const childItems = await measureServerTiming('meta', () => Promise.all(
                    related.map((entry) => this.loadObjectItem(p, environmentId, entry.object)),
                ), 'Metadata reads');
                const malformed: Array<{ field: string; code: string; message: string }> = [];
                related.forEach((entry, index) => {
                    const item = childItems[index];
                    if (!item || apiAccessDenialFromEnable(item.enable, entry.object, 'list')) return;
                    const def = fieldDefOf(item, entry.field);
                    if (!def || !RELATIONSHIP_TYPES.has(String(def.type)) || referenceOf(def) !== object) {
                        malformed.push({
                            field: `related.${index}.field`,
                            code: 'invalid_relationship',
                            message: `'${entry.field}' on '${entry.object}' is not a lookup or master-detail field that references '${object}'.`,
                        });
                    }
                });
                if (malformed.length > 0) {
                    sendError(res, 400, 'VALIDATION_FAILED', 'Invalid record page request', {
                        details: { object, fields: malformed },
                    });
                    return;
                }

                // The record, as `GET /data/:object/:id` reads it. Its refusal
                // is the whole request's answer (the catch below).
                const got: any = await p.getData({
                    object,
                    id,
                    ...(body.expand && body.expand.length > 0 ? { expand: body.expand } : {}),
                    ...scope,
                } satisfies ServerScopedDataRequest<GetDataRequest>);
                const record = got?.record ?? got;
                if (!record || typeof record !== 'object') throw recordNotFoundError(object, id);

                const answerRelated = async (entry: NonNullable<RecordPageRequest['related']>[number], index: number) => {
                    const head = { object: entry.object, field: entry.field };
                    const item = childItems[index];
                    const denial = item ? apiAccessDenialFromEnable(item.enable, entry.object, 'list') : null;
                    if (denial) {
                        const nested = nestedRefusalEnvelope(denial);
                        return { ...head, error: { code: nested.code, status: nested.status, message: nested.message } };
                    }
                    try {
                        const def = fieldDefOf(item, entry.field);
                        const parentScope = { [entry.field]: def && isMultiValueField(def) ? { $contains: id } : id };
                        const declared = entry.filter === undefined ? undefined : parseFilterAST(entry.filter);
                        const where = declared === undefined ? parentScope : { $and: [parentScope, declared] };
                        const found: any = await p.findData({
                            object: entry.object,
                            query: {
                                filter: where,
                                top: entry.top,
                                count: true,
                                ...(entry.sort && entry.sort.length > 0 ? { orderBy: entry.sort } : {}),
                            } as any,
                            ...scope,
                        } satisfies ServerScopedDataRequest<FindDataRequest>);
                        const records = Array.isArray(found?.records) ? found.records : [];
                        const total = typeof found?.total === 'number' ? found.total : records.length;
                        return { ...head, total, records };
                    } catch (error) {
                        return { ...head, error: refusalOf(error, entry.object) };
                    }
                };

                const answerFieldAccess = async () => {
                    try {
                        const security = await this.resolveSecurityService(environmentId, req);
                        if (typeof security?.getRecordFieldAccess !== 'function') {
                            return { error: { code: 'NOT_IMPLEMENTED', status: 501, message: 'The record field projection is not available on this deployment.' } };
                        }
                        const access = await security.getRecordFieldAccess(object, id, context);
                        if (access === null) throw recordNotFoundError(object, id);
                        if (access === undefined) {
                            return { error: { code: 'NOT_IMPLEMENTED', status: 501, message: `The record field projection has no answer for '${object}'.` } };
                        }
                        return access;
                    } catch (error) {
                        return { error: refusalOf(error, object) };
                    }
                };

                const answerExplain = async () => {
                    const out: Record<string, unknown> = {};
                    const security = await this.resolveSecurityService(environmentId, req);
                    for (const operation of new Set(body.explain ?? [])) {
                        try {
                            // `POST /security/explain` answers only an
                            // identified caller; so does this part.
                            if (!context?.userId) {
                                out[operation] = { error: { code: 'UNAUTHORIZED', status: 401, message: 'The access-explanation endpoint requires an authenticated caller.' } };
                                continue;
                            }
                            if (typeof security?.explain !== 'function') {
                                out[operation] = { error: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Access explanation is not available on this deployment.' } };
                                continue;
                            }
                            out[operation] = await security.explain({ object, operation, recordId: id } as any, context);
                        } catch (error) {
                            out[operation] = { error: refusalOf(error, object) };
                        }
                    }
                    return out;
                };

                const answerApprovals = async () => {
                    try {
                        const provider = this.approvalsServiceProvider;
                        const svc = provider ? await provider(environmentId).catch(() => undefined) : undefined;
                        if (!svc) return { requests: [], lock: null };
                        const rows: any[] = (await svc.listRequests({ object, recordId: id }, context ?? {})) ?? [];
                        const pending = rows.find((r) => r?.status === 'pending');
                        let enriched: any = null;
                        if (pending && typeof svc.getRequest === 'function') {
                            const full = await svc.getRequest(pending.id, context ?? {}).catch(() => null);
                            if (full && full.id === pending.id) enriched = { ...pending, ...full };
                        }
                        const requests = enriched ? rows.map((r) => (r === pending ? enriched : r)) : rows;
                        let lock: { locked: boolean } | null = null;
                        if (typeof svc.getRecordLock === 'function') {
                            const answer = await svc.getRecordLock(object, id, context ?? {});
                            lock = answer ? { locked: answer.locked === true } : null;
                        }
                        return { requests, lock };
                    } catch (error) {
                        return { error: refusalOf(error, object) };
                    }
                };

                const [relatedAnswers, fieldAccess, explain, approvals] = await Promise.all([
                    Promise.all(related.map(answerRelated)),
                    body.fieldAccess ? answerFieldAccess() : Promise.resolve(undefined),
                    body.explain && body.explain.length > 0 ? answerExplain() : Promise.resolve(undefined),
                    body.approvals ? answerApprovals() : Promise.resolve(undefined),
                ]);

                sendOk(res, {
                    object,
                    id,
                    record,
                    related: relatedAnswers,
                    ...(fieldAccess !== undefined ? { fieldAccess } : {}),
                    ...(explain !== undefined ? { explain } : {}),
                    ...(approvals !== undefined ? { approvals } : {}),
                });
            } catch (error: any) {
                const mapped = mapDataError(error, object);
                logUnexpectedRouteError(error, mapped);
                res.status(mapped.status).json(mapped.body);
            }
        },
        metadata: {
            summary: 'Record page payload: the record, its related lists\' counts and first rows, its field projection, access verdicts and approval state in one request',
            tags: ['data'],
        },
    });
}
