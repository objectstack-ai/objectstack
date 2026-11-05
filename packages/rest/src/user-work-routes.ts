// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30205] The assigned-work routes: a user's open work, counted, and handed
 * over in bulk — what an administrator needs when they ban someone.
 *
 *   GET  {basePath}/security/users/:id/assigned-work            per-object counts
 *   POST {basePath}/security/users/:id/assigned-work/transfer   one bounded hand-over
 *
 * The rules (which records count, whose reads and writes, the caps) live in
 * `@objectstack/core`'s `user-assigned-work.ts`; this module only serves them.
 * Both routes run as the CALLER: the counts are what the caller can read, and
 * each moved row is an ordinary update under the caller's context, so neither
 * route needs a gate of its own beyond an authenticated caller — a caller who
 * could not read or edit a record by hand cannot count or move it here either.
 *
 * Neither route touches the ban. A ban is urgent and stands alone
 * (`POST /api/v1/auth/admin/ban-user`); these routes are the optional step
 * beside it.
 *
 * Both declare their CLOSED query-parameter set — none — on the day they land
 * (AGENTS.md, route rule 5), and the transfer body is closed as well: an
 * unknown key is a `400`, never a silently ignored option.
 *
 * ## How the body reaches the class
 *
 * The shape the `rest-server.ts` split set (`data-action-routes.ts`' header
 * carries the reasoning): the class keeps a private registrar method that hands
 * this body one host literal of exactly the members it reads, methods as
 * closures and the `objectQLProvider` field as a getter, read at request time.
 */

import { sendError, sendServerFault } from '@objectstack/types';
import {
    countUserAssignedWork,
    transferUserAssignedWork,
    UserWorkTransferRefusal,
    type UserWorkEngine,
} from '@objectstack/core';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { wiredEngineOrLoud, type RestServer } from './rest-server.js';

/** The `RestServer` members {@link registerUserWorkEndpoints} reads — every one of them, and no other. */
export interface UserWorkRouteHost {
    readonly routeManager: RestServer['routeManager'];
    readonly objectQLProvider: RestServer['objectQLProvider'];
    resolveRequestEnvironmentId: RestServer['resolveRequestEnvironmentId'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
}

/** Neither route reads a query parameter. */
export const USER_WORK_QUERY_PARAMS: readonly string[] = [];

/** The keys a transfer body may carry. */
const TRANSFER_BODY_KEYS = new Set(['toUserId', 'objects']);

/**
 * Register the assigned-work routes — `RestServer#registerUserWorkEndpoints`'
 * body, called by that method with the server as `this`.
 */
export function registerUserWorkEndpoints(this: UserWorkRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');

    /** The request's engine, `undefined` when none is wired; an outage throws. */
    const resolveEngine = async (environmentId: string | undefined, req: any): Promise<UserWorkEngine | undefined> =>
        wiredEngineOrLoud(
            Boolean(this.objectQLProvider),
            async () => this.objectQLProvider!(await this.resolveRequestEnvironmentId(environmentId, req)),
        ) as Promise<UserWorkEngine | undefined>;

    const userIdOf = (req: any): string | undefined => {
        const id = req.params?.id;
        return typeof id === 'string' && id.length > 0 ? id : undefined;
    };

    this.routeManager.register({
        method: 'GET',
        path: `${basePath}/security/users/:id/assigned-work`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (refuseUnknownQueryParams(req, res, USER_WORK_QUERY_PARAMS)) return;
                const userId = userIdOf(req);
                if (!userId) return sendError(res, 400, 'VALIDATION_ERROR', 'The user id is required');
                const engine = await resolveEngine(environmentId, req);
                if (!engine) return sendError(res, 501, 'NOT_IMPLEMENTED', 'No data engine is configured on this deployment');
                const summary = await countUserAssignedWork(engine, userId, context);
                return res.json({ success: true, data: summary });
            } catch (err) {
                return sendServerFault(res, 500, 'INTERNAL_ERROR', 'Counting the user\'s assigned work failed', err);
            }
        },
        metadata: { summary: 'Count the records a user owns or is assigned, per object, as the caller can read them', tags: ['security'] },
    });

    this.routeManager.register({
        method: 'POST',
        path: `${basePath}/security/users/:id/assigned-work/transfer`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (refuseUnknownQueryParams(req, res, USER_WORK_QUERY_PARAMS)) return;
                const userId = userIdOf(req);
                if (!userId) return sendError(res, 400, 'VALIDATION_ERROR', 'The user id is required');
                const body = req.body;
                if (!body || typeof body !== 'object' || Array.isArray(body)) {
                    return sendError(res, 400, 'VALIDATION_ERROR', 'The body must be an object: { toUserId, objects? }');
                }
                const unknown = Object.keys(body).filter((k) => !TRANSFER_BODY_KEYS.has(k));
                if (unknown.length > 0) {
                    return sendError(res, 400, 'VALIDATION_ERROR', `Unknown body key(s): ${unknown.join(', ')}. A transfer takes toUserId and, optionally, objects`);
                }
                const toUserId = body.toUserId;
                if (typeof toUserId !== 'string' || toUserId.length === 0) {
                    return sendError(res, 400, 'VALIDATION_ERROR', 'toUserId is required: the id of the active user who takes over the records');
                }
                const objects = body.objects;
                if (objects !== undefined
                    && !(Array.isArray(objects) && objects.every((o: unknown) => typeof o === 'string' && o.length > 0))) {
                    return sendError(res, 400, 'VALIDATION_ERROR', 'objects, when given, must be a list of object names');
                }
                const engine = await resolveEngine(environmentId, req);
                if (!engine) return sendError(res, 501, 'NOT_IMPLEMENTED', 'No data engine is configured on this deployment');
                try {
                    const report = await transferUserAssignedWork(engine, userId, toUserId, context, { objects });
                    return res.json({ success: true, data: report });
                } catch (err) {
                    if (!(err instanceof UserWorkTransferRefusal)) throw err;
                    return sendError(res, err.status, err.code, err.message, err.field ? {
                        details: { fields: [{ field: err.field.field, code: err.field.code, message: err.message }] },
                    } : undefined);
                }
            } catch (err) {
                return sendServerFault(res, 500, 'INTERNAL_ERROR', 'Transferring the user\'s assigned work failed', err);
            }
        },
        metadata: { summary: 'Hand a user\'s owned and assigned records to another active user, as the caller, in bounded batches', tags: ['security'] },
    });
}
