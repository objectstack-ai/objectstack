// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35402] The Change Owner routes: one record, or a list of records, handed
 * to another owner — a person or an ownership queue — as the caller.
 *
 *   POST {basePath}/data/:object/:id/change-owner      body: { ownerId | queue, notify?, cascade? }
 *   POST {basePath}/data/:object/change-owner          body: { ids, ownerId | queue, notify?, cascade? }
 *   GET  {basePath}/data/:object/change-owner/cascades  the declared cascades the dialog may offer
 *
 * The rules (which objects offer the action, whose writes, the target, the
 * row cap) live in `@objectstack/core`'s `change-record-owner.ts`; this module
 * only serves them. Both routes run as the CALLER behind the `/data` door's
 * own two gates — an authenticated caller, and the object's API exposure for
 * an `update` — and every row moves by an ordinary by-id update, so the write
 * path's ownership gate decides each one as it decides a hand edit of the
 * owner.
 *
 * - The single route answers the moved record (`ChangeOwnerResult`), or the
 *   refusal the `PATCH /data/:object/:id` door would answer for the same
 *   throw: the transfer grant missing is that door's `403`, a row out of the
 *   caller's reach its `404`.
 * - The bulk route answers `200` with a per-row report (`ChangeOwnerReport`,
 *   the #30205 hand-over's outcome shape): every row that did not move is
 *   listed with its id, code and sentence, worded as the `/data` write door
 *   words the same throw.
 *
 * ## Cascade (#35315 phase 2, ruling 7000907189 point 4)
 *
 * `cascade` is an optional leg of the same two requests, not a route of its
 * own: a list of `{ object, field }`, each a relationship whose child's
 * reference field declares `transferBehavior: 'cascade'`. The rules —
 * declared and eligible only, previous owner's rows only, the caller's own
 * writes, every refused row reported, the row cap — are core's
 * (`change-record-owner.ts`); both answers then carry `cascade`, one outcome
 * per named relationship. The `GET …/change-owner/cascades` read lists the
 * candidates (`transferCascadeRelations`): the relationships declared to the
 * object whose child offers Change Owner itself. The caller's own transfer
 * verdict on each child is the explain engine's, which the dialog asks; the
 * write path judges every cascaded row again.
 *
 * Both refuse the whole call before any write when the object does not offer
 * Change Owner (`403 CHANGE_OWNER_DISABLED`), when the target names no user or
 * a banned one, and when the body is not the closed shape below. Both declare
 * their CLOSED query-parameter set — none — on the day they land (AGENTS.md,
 * route rule 5), and the bodies are closed as well: an unknown key is a `400`,
 * never a silently ignored option.
 *
 * ## How the body reaches the class
 *
 * The shape the `rest-server.ts` split set (`data-action-routes.ts`' header
 * carries the reasoning): the class keeps a private registrar method that hands
 * this body one host literal of exactly the members it reads, methods as
 * closures and the `objectQLProvider` field as a getter, read at request time.
 */

import { sendError, sendOk } from '@objectstack/types';
import {
    changeOwnerOffReason,
    changeOwnerOffRefusal,
    changeRecordOwner,
    changeRecordsOwner,
    objectNotFoundError,
    transferCascadeRelations,
    UserWorkTransferRefusal,
    type ChangeOwnerCascadeRelation,
    type ChangeOwnerEngine,
    type ChangeOwnerMessaging,
    type ChangeOwnerTarget,
} from '@objectstack/core';
import { handleRouteError, nestedRefusalEnvelope } from './error-response.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { wiredEngineOrLoud, type RestServer } from './rest-server.js';

/** The `RestServer` members {@link registerChangeOwnerEndpoints} reads — every one of them, and no other. */
export interface ChangeOwnerRouteHost {
    readonly config: RestServer['config'];
    readonly routeManager: RestServer['routeManager'];
    readonly objectQLProvider: RestServer['objectQLProvider'];
    resolveProtocol: RestServer['resolveProtocol'];
    resolveRequestEnvironmentId: RestServer['resolveRequestEnvironmentId'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
    enforceApiAccess: RestServer['enforceApiAccess'];
    /** The request environment's `messaging` service, `undefined` when none is mounted or it cannot be read. */
    resolveMessagingService(environmentId: string | undefined, req: unknown): Promise<unknown>;
}

/** Neither route reads a query parameter. */
export const CHANGE_OWNER_QUERY_PARAMS: readonly string[] = [];

/** The keys the single route's body may carry. */
const SINGLE_BODY_KEYS = new Set(['ownerId', 'queue', 'notify', 'cascade']);

/** The keys the bulk route's body may carry. */
const BULK_BODY_KEYS = new Set(['ids', 'ownerId', 'queue', 'notify', 'cascade']);

/** The keys one `cascade` entry may carry. */
const CASCADE_ENTRY_KEYS = new Set(['object', 'field']);

/** A refused request body: the sentence, and the member it names. */
interface BodyRefusal { message: string; field?: string }

/**
 * Read the target and the `notify` flag out of a body whose keys are already
 * known to be allowed: exactly one of `ownerId` (a person) or `queue`, each a
 * non-empty string, and `notify`, when given, a boolean that only a person
 * target can take — a queue has nobody to tell.
 */
function readTarget(body: Record<string, unknown>): { target: ChangeOwnerTarget; notify: boolean; cascade?: ChangeOwnerCascadeRelation[] } | BodyRefusal {
    const { ownerId, queue, notify, cascade } = body;
    if (ownerId !== undefined && queue !== undefined) {
        return { message: 'Name either ownerId (a person) or queue (an ownership queue), not both' };
    }
    if (ownerId === undefined && queue === undefined) {
        return { message: 'ownerId is required: the id of the active user who takes the record — or queue, to move it to an ownership queue', field: 'ownerId' };
    }
    if (ownerId !== undefined && (typeof ownerId !== 'string' || ownerId.length === 0)) {
        return { message: 'ownerId must be a user id', field: 'ownerId' };
    }
    if (queue !== undefined && (typeof queue !== 'string' || queue.length === 0)) {
        return { message: 'queue must be the name of an ownership queue', field: 'queue' };
    }
    if (notify !== undefined && typeof notify !== 'boolean') {
        return { message: 'notify, when given, must be true or false', field: 'notify' };
    }
    if (notify === true && queue !== undefined) {
        return { message: 'notify tells the new owner, and a queue target has none; leave notify out when moving records to a queue', field: 'notify' };
    }
    const target: ChangeOwnerTarget = typeof ownerId === 'string' ? { ownerId } : { queue: queue as string };
    if (cascade === undefined) return { target, notify: notify === true };
    const cascadeRefusal = {
        message: 'cascade, when given, must be a list of { object, field }: the related object, and its reference field to this object',
        field: 'cascade',
    };
    if (!Array.isArray(cascade)) return cascadeRefusal;
    const relations: ChangeOwnerCascadeRelation[] = [];
    for (const entry of cascade) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return cascadeRefusal;
        const e = entry as Record<string, unknown>;
        if (Object.keys(e).some((k) => !CASCADE_ENTRY_KEYS.has(k))) return cascadeRefusal;
        if (typeof e.object !== 'string' || e.object.length === 0 || typeof e.field !== 'string' || e.field.length === 0) {
            return cascadeRefusal;
        }
        relations.push({ object: e.object, field: e.field });
    }
    return { target, notify: notify === true, cascade: relations };
}

/** The body as an object whose every key is in `allowed`, or the refusal. */
function closedBody(body: unknown, allowed: Set<string>, shape: string): Record<string, unknown> | BodyRefusal {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { message: `The body must be an object: ${shape}` };
    }
    const unknown = Object.keys(body).filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
        return { message: `Unknown body key(s): ${unknown.join(', ')}. A Change Owner request takes ${shape}` };
    }
    return body as Record<string, unknown>;
}

function isRefusal(value: unknown): value is BodyRefusal {
    return typeof (value as BodyRefusal | undefined)?.message === 'string' && !('target' in (value as object));
}

function sendBodyRefusal(res: any, refusal: BodyRefusal): void {
    sendError(res, 400, 'VALIDATION_ERROR', refusal.message, refusal.field ? {
        details: { fields: [{ field: refusal.field, code: 'invalid_value', message: refusal.message }] },
    } : undefined);
}

/**
 * The `/data` door's answer for a throw — status and flat body — read off
 * `handleRouteError` through a sink, so it logs exactly as that door does.
 */
function classifiedAnswer(err: unknown, object: string): { status: number; body: Record<string, unknown> } {
    const sink: { httpStatus: number; body?: Record<string, unknown>; status(httpStatus: number): typeof sink; json(body: Record<string, unknown>): typeof sink } = {
        httpStatus: 500,
        status(httpStatus) { sink.httpStatus = httpStatus; return sink; },
        json(body) { sink.body = body; return sink; },
    };
    handleRouteError(sink, err, object);
    return { status: sink.httpStatus, body: sink.body ?? {} };
}

/**
 * A refused row, worded the way the `/data` write door answers the same throw:
 * the shared classification (`handleRouteError`) sent to a sink — the
 * assigned-work hand-over's describer, for the same reason (`user-work-routes.ts`).
 */
function rowFailureAnswer(err: unknown, object: string): { code: string; message: string } {
    const { body } = classifiedAnswer(err, object);
    const nested = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : undefined;
    const code = typeof body.code === 'string' && body.code.length > 0 ? body.code
        : typeof nested?.code === 'string' && nested.code.length > 0 ? nested.code : 'UPDATE_FAILED';
    const message = typeof body.error === 'string' ? body.error
        : typeof nested?.message === 'string' ? nested.message : 'The record could not be updated';
    return { code, message };
}

/**
 * Register the Change Owner routes — `RestServer#registerChangeOwnerEndpoints`'
 * body, called by that method with the server as `this`.
 */
export function registerChangeOwnerEndpoints(this: ChangeOwnerRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');
    const dataPath = `${basePath}${this.config.crud.dataPrefix}`;

    /** The request's engine, `undefined` when none is wired; an outage throws. */
    const resolveEngine = async (environmentId: string | undefined, req: any): Promise<ChangeOwnerEngine | undefined> =>
        wiredEngineOrLoud(
            Boolean(this.objectQLProvider),
            async () => this.objectQLProvider!(await this.resolveRequestEnvironmentId(environmentId, req)),
        ) as Promise<ChangeOwnerEngine | undefined>;

    const resolveMessaging = async (environmentId: string | undefined, req: any): Promise<ChangeOwnerMessaging | undefined> => {
        try {
            return (await this.resolveMessagingService(environmentId, req)) as ChangeOwnerMessaging | undefined;
        } catch {
            return undefined;
        }
    };

    /**
     * The gates every `/data` write passes after the authenticated-caller
     * floor (which each handler states itself, as the shared floor census
     * reads it), in that door's order. Answers `true` when it sent a refusal.
     */
    const gate = async (req: any, res: any, environmentId: string | undefined, context: unknown): Promise<boolean> => {
        if (refuseUnknownQueryParams(req, res, CHANGE_OWNER_QUERY_PARAMS)) return true;
        const p = await this.resolveProtocol(environmentId, req);
        return this.enforceApiAccess(req, res, p, environmentId, 'update', context);
    };

    const sendRefusal = (res: any, err: unknown, object: string): void => {
        if (err instanceof UserWorkTransferRefusal) {
            sendError(res, err.status, err.code, err.message, err.field ? {
                details: { fields: [{ field: err.field.field, code: err.field.code, message: err.message }] },
            } : undefined);
            return;
        }
        // The `/data` door's classification, answered in the nested envelope
        // this module declares: the same status and code a PATCH of the
        // record would answer, never the flat `{ code, error }` dialect.
        const nested = nestedRefusalEnvelope(classifiedAnswer(err, object));
        sendError(res, nested.status, nested.code, nested.message, nested.extra);
    };

    // [#35315 phase 2] The cascade candidates: a three-segment literal, read
    // before any `{data}/:object/:id/...` matcher could take `change-owner` as
    // an id. Same gates as the writes (the dialog is about to write), no body.
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/:object/change-owner/cascades`,
        handler: async (req: any, res: any) => {
            const object = String(req.params?.object ?? '');
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (await gate(req, res, environmentId, context)) return;
                const engine = await resolveEngine(environmentId, req);
                if (!engine) return sendError(res, 501, 'NOT_IMPLEMENTED', 'No data engine is configured on this deployment');
                const def = engine.getSchema(object);
                if (!def || typeof def !== 'object') throw objectNotFoundError(object);
                const reason = changeOwnerOffReason(object, def);
                if (reason) throw changeOwnerOffRefusal(object, reason);
                return sendOk(res, { object, cascades: transferCascadeRelations(engine, object) });
            } catch (err) {
                return sendRefusal(res, err, object);
            }
        },
        metadata: { summary: 'List the related objects a Change Owner of this object may cascade to', tags: ['data', 'change-owner'] },
    });

    // The bulk route first: `{data}/:object/change-owner` is a two-segment
    // literal beside the greedy `{data}/:object/:id` matchers, and the router
    // is first-match-wins (this registrar runs before the CRUD routes).
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/:object/change-owner`,
        handler: async (req: any, res: any) => {
            const object = String(req.params?.object ?? '');
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (await gate(req, res, environmentId, context)) return;
                const shape = '{ ids, ownerId | queue, notify?, cascade? }';
                const body = closedBody(req.body, BULK_BODY_KEYS, shape);
                if (isRefusal(body)) return sendBodyRefusal(res, body);
                const ids = body.ids;
                if (!Array.isArray(ids) || !ids.every((id: unknown) => typeof id === 'string' && id.length > 0)) {
                    return sendBodyRefusal(res, { message: 'ids is required: a list of the record ids whose owner changes', field: 'ids' });
                }
                const read = readTarget(body);
                if (isRefusal(read)) return sendBodyRefusal(res, read);
                const engine = await resolveEngine(environmentId, req);
                if (!engine) return sendError(res, 501, 'NOT_IMPLEMENTED', 'No data engine is configured on this deployment');
                const report = await changeRecordsOwner(engine, object, ids as string[], read.target, context, {
                    notify: read.notify,
                    messaging: read.notify ? await resolveMessaging(environmentId, req) : undefined,
                    describeFailure: rowFailureAnswer,
                    ...(read.cascade ? { cascade: read.cascade } : {}),
                });
                return sendOk(res, report);
            } catch (err) {
                return sendRefusal(res, err, object);
            }
        },
        metadata: { summary: 'Change the owner of a list of records, as the caller, with a per-row report', tags: ['data', 'change-owner'] },
    });

    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/:object/:id/change-owner`,
        handler: async (req: any, res: any) => {
            const object = String(req.params?.object ?? '');
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (await gate(req, res, environmentId, context)) return;
                const body = closedBody(req.body, SINGLE_BODY_KEYS, '{ ownerId | queue, notify?, cascade? }');
                if (isRefusal(body)) return sendBodyRefusal(res, body);
                const read = readTarget(body);
                if (isRefusal(read)) return sendBodyRefusal(res, read);
                const engine = await resolveEngine(environmentId, req);
                if (!engine) return sendError(res, 501, 'NOT_IMPLEMENTED', 'No data engine is configured on this deployment');
                const result = await changeRecordOwner(engine, object, String(req.params.id), read.target, context, {
                    notify: read.notify,
                    messaging: read.notify ? await resolveMessaging(environmentId, req) : undefined,
                    ...(read.cascade ? { cascade: read.cascade, describeFailure: rowFailureAnswer } : {}),
                });
                return sendOk(res, result);
            } catch (err) {
                return sendRefusal(res, err, object);
            }
        },
        metadata: { summary: 'Change the owner of one record, as the caller', tags: ['data', 'change-owner'] },
    });
}
