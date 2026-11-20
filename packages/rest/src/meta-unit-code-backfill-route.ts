// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST {metaPath}/_migrate-unit-codes` — the tenant-admin door for the unit
 * code backfill, the REST twin of `os migrate unit-codes` (ADR-0158 U7 R1;
 * Open item 12, the backfill half, point 7).
 *
 * It mirrors `POST {metaPath}/_migrate-record-currency-codes`
 * (`meta-record-currency-backfill-route.ts`, whose header carries the
 * reasoning), point for point: behind the `metadata.endpoints.maintenance`
 * switch; gated on `setup.write` in the caller's current organization, asked
 * FIRST; the caller's CURRENT organization only (`ExecutionContext.tenantId`),
 * with no organization in the body and a `403 FORBIDDEN` for a caller with
 * none; preview unless `apply: true`; the engine of the request's environment,
 * the function loaded through a guarded dynamic import (`501 NOT_IMPLEMENTED`
 * with no data engine; `scripts/check-undeclared-dep-imports.mjs` ledgers it);
 * the report as the `data` of the shared envelope, the payload the CLI's
 * `--json` prints as its `report`.
 *
 * The one difference is the body: `{ object, field, mapping?, apply? }`, where
 * `field` is the unit code field and `mapping` the operator's object of stored
 * text to unit code, never derived (`""`: a blank unit beside a quantity).
 * Omitted, the preview lists every stored value with its row count. A body key
 * outside that set is refused `400 VALIDATION_ERROR` naming it. The
 * backfill's own refusals keep their status and code: `INVALID_FIELD` for a
 * field that is no unit code field or a target that is no member,
 * `VALIDATION_ERROR` for a malformed mapping and for an apply run over a value
 * with no mapping entry (`unmatched`, naming each value, before any write), and
 * the object-not-found answer.
 */

import { rethrowAuthzStoreUnavailable } from '@objectstack/core';
import { demotedDeclaredCode, resolveThrownHttpError, sendError, sendOk, sendServerFault } from '@objectstack/types';
import { logWarn } from './log.js';
import type { MetaRouteScope } from './meta-collection-routes.js';
import { wiredEngineOrLoud, type RestServer } from './rest-server.js';

/** The capability the door demands, in the caller's current organization (the currency backfill door's). */
export const UNIT_CODE_BACKFILL_CAPABILITY = 'setup.write';

/** The body keys the door reads — the whole closed set. */
const BODY_KEYS: readonly string[] = ['object', 'field', 'mapping', 'apply'];

/** The `RestServer` members {@link registerMetaUnitCodeBackfillRoute} reads, typed as the class members. */
export interface MetaUnitCodeBackfillRouteHost {
    readonly routeManager: RestServer['routeManager'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    readonly objectQLProvider: RestServer['objectQLProvider'];
    resolveRequestEnvironmentId: RestServer['resolveRequestEnvironmentId'];
}

function bodyRefusal(field: string, message: string): Error {
    return Object.assign(new Error(message), { code: 'VALIDATION_ERROR', status: 400, field });
}

/** The names, the mapping and the apply flag, judged before the engine is resolved. */
function readBody(body: unknown): { object: string; field: string; mapping?: Record<string, unknown>; apply: boolean } {
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw bodyRefusal('body', 'The body must be a JSON object: { object, field, mapping?, apply? }.');
    }
    const b = body as Record<string, unknown>;
    for (const key of Object.keys(b)) {
        if (BODY_KEYS.includes(key)) continue;
        throw bodyRefusal(
            key,
            key === 'organizationId' || key === 'allOrganizations'
                ? `'${key}' is not accepted: this door converts the rows of your current organization only. ` +
                  'Switch to the organization whose rows you mean, and send { object, field, mapping?, apply? }.'
                : `Unknown body key '${key}': the body is { object, field, mapping?, apply? }.`,
        );
    }
    for (const key of ['object', 'field'] as const) {
        if (typeof b[key] !== 'string' || (b[key] as string).trim() === '') {
            throw bodyRefusal(key, `'${key}' is required and must be a non-blank string.`);
        }
    }
    const { mapping } = b;
    if (mapping !== undefined && (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping))) {
        throw bodyRefusal('mapping', "'mapping' must be an object of stored text to unit code, for example { \"kg\": \"KGM\" }.");
    }
    if (b.apply !== undefined && typeof b.apply !== 'boolean') {
        throw bodyRefusal('apply', "'apply' must be true or false; omit it for a preview.");
    }
    return {
        object: b.object as string,
        field: b.field as string,
        ...(mapping !== undefined ? { mapping: mapping as Record<string, unknown> } : {}),
        apply: b.apply === true,
    };
}

/**
 * Register `POST {metaPath}/_migrate-unit-codes`, behind
 * `metadata.endpoints.maintenance`, with the server's members as `this` and
 * the `/meta` head bindings as `scope`. A literal `POST` path: no `POST
 * {metaPath}/:type` exists to capture it.
 */
export function registerMetaUnitCodeBackfillRoute(this: MetaUnitCodeBackfillRouteHost, scope: MetaRouteScope): void {
    const { metadata, metaPath, isScoped } = scope;
    if (metadata.endpoints.maintenance === false) return;
    this.routeManager.register({
        method: 'POST',
        path: `${metaPath}/_migrate-unit-codes`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                const held = new Set<string>(Array.isArray(ctx?.systemPermissions) ? ctx.systemPermissions : []);
                if (!ctx?.isSystem && !held.has(UNIT_CODE_BACKFILL_CAPABILITY)) {
                    return sendError(res, 403, 'FORBIDDEN', 'Converting stored unit text requires the `setup.write` capability in your current organization.');
                }
                const organizationId = typeof ctx?.tenantId === 'string' && ctx.tenantId !== '' ? ctx.tenantId : undefined;
                if (organizationId === undefined) {
                    return sendError(
                        res,
                        403,
                        'FORBIDDEN',
                        'This request has no current organization, and the unit code backfill converts the rows of the caller\'s ' +
                            'current organization only: select the organization whose rows you mean and retry. Nothing was read.',
                    );
                }
                const body = readBody(req.body);
                const ql: any = await wiredEngineOrLoud(
                    Boolean(this.objectQLProvider),
                    async () => this.objectQLProvider!(await this.resolveRequestEnvironmentId(environmentId, req)),
                );
                let backfill: typeof import('@objectstack/objectql')['backfillUnitCodes'] | undefined;
                try {
                    ({ backfillUnitCodes: backfill } = await import('@objectstack/objectql'));
                } catch {
                    backfill = undefined;
                }
                if (typeof backfill !== 'function' || typeof ql?.getObject !== 'function' || typeof ql?.find !== 'function' || typeof ql?.update !== 'function') {
                    return sendError(res, 501, 'NOT_IMPLEMENTED', 'The unit code backfill is not available in this runtime: it has no data engine.');
                }
                const logger = { info: () => {}, warn: (message: string) => logWarn(message) };
                const report = await backfill(ql, logger, { ...body, mapping: body.mapping as Record<string, string> | undefined, organizationId });
                return sendOk(res, report);
            } catch (error: unknown) {
                // A refusal the body judge or the backfill DECLARED (a 4xx with its code) is the caller's answer.
                const thrown = resolveThrownHttpError(error);
                if (thrown.declaredStatus !== undefined && thrown.status >= 400 && thrown.status < 500) {
                    const field = (error as { field?: unknown } | null)?.field;
                    const unmatched = (error as { unmatched?: unknown } | null)?.unmatched;
                    const declaredCode = demotedDeclaredCode(thrown);
                    return sendError(res, thrown.status, thrown.code, thrown.message, {
                        ...(typeof field === 'string' || Array.isArray(unmatched)
                            ? {
                                details: {
                                    ...(typeof field === 'string' ? { fields: [{ field, code: thrown.code, message: thrown.message }] } : {}),
                                    ...(Array.isArray(unmatched) ? { unmatched } : {}),
                                },
                            }
                            : {}),
                        ...(declaredCode !== undefined ? { declaredCode } : {}),
                    });
                }
                const status = thrown.declaredStatus !== undefined && thrown.status >= 500 ? thrown.status : 500;
                return sendServerFault(res, status, status === 500 ? 'INTERNAL_ERROR' : thrown.code, 'Converting stored unit text failed.', error);
            }
        },
        metadata: {
            summary: 'Rewrite the current organization\'s stored unit text into unit codes, from the caller\'s mapping',
            tags: ['metadata'],
        },
    });
}
