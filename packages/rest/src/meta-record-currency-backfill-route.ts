// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST {metaPath}/_migrate-record-currency-codes` — the tenant-admin door for
 * the record-currency code backfill, the REST twin of
 * `os migrate record-currency-codes` (ADR-0144; ruling 6670707546, letter C,
 * item B).
 *
 * ## Why a door
 *
 * An existing amount switched to `currencyMode: 'record'` leaves every row it
 * already stored holding an amount beside a blank code; the metadata save that
 * makes the switch answers 409 `destructive_change` naming the backfill. The
 * CLI form needs a shell on the deployment's database, which a cloud-managed
 * tenant admin does not have. This door is that admin's finish line, shaped on
 * `POST {metaPath}/_migrate-stored` (`meta-collection-routes.ts`): preview
 * unless `apply: true`, the report the CLI's `--json` prints, mounted behind
 * the same `metadata.endpoints.maintenance` switch.
 *
 * ## One organization: the caller's
 *
 * The walk, the counts and the writes are `@objectstack/objectql`'s
 * `backfillRecordCurrencyCodes`, called with `organizationId` = the caller's
 * CURRENT organization (`ExecutionContext.tenantId`, vetted by the resolver),
 * so the door reads and writes that organization's rows only. ⛔ There is no
 * environment-wide form, and no `organizationId` (or `allOrganizations`) in
 * the body: every organization has its own home currency, and an organization
 * admin answers for one organization's rows. A body key outside
 * `{ object, field, code, apply }` is refused with `400 VALIDATION_ERROR`
 * naming it, so a caller who meant to name another organization is told so
 * instead of silently filling its own. A caller with no current organization
 * is refused `403 FORBIDDEN` before anything is read.
 *
 * ## The gate: `setup.write`
 *
 * The capability the ruling recommends (`manage_metadata` is the alternative
 * the maintainer may still name): the tenant Setup write capability, resolved
 * — like every `systemPermissions` member — for the caller's current
 * organization. `isSystem` bypasses, as on every capability gate here. Asked
 * FIRST of all, before the body is judged or the engine resolved, so a refused
 * caller learns nothing about which objects or kernels exist (the
 * `_migrate-stored` posture). There is no walled refusal: unlike the stored
 * metadata `_migrate-stored` rewrites, these rows are the organization's own,
 * under every tenancy posture.
 *
 * ## The engine, and why the import is dynamic
 *
 * The engine is the REQUEST's environment's (`objectQLProvider`, through the
 * shared environment resolver), reached by `wiredEngineOrLoud` as the object
 * state read reaches it. `@objectstack/objectql` is a devDependency of this
 * package, deliberately (the stance `meta-object-state-routes.ts` records), so
 * the function is loaded through a DYNAMIC import inside a `try`: a host serving
 * REST without the data engine answers `501 NOT_IMPLEMENTED` instead of failing
 * to load. `scripts/check-undeclared-dep-imports.mjs` ledgers that probe
 * against this file.
 *
 * ## Errors
 *
 * Only codes the registry already carries: `FORBIDDEN` (capability, no current
 * organization), `VALIDATION_ERROR` (the body), `NOT_IMPLEMENTED` (no engine),
 * and the backfill's own refusals (`INVALID_FIELD` for a field that is not a
 * record-mode amount or a code outside ISO 4217, the object-not-found answer),
 * each answered through `handleRouteError` with the status the function gave.
 */

import { rethrowAuthzStoreUnavailable } from '@objectstack/core';
import { handleRouteError } from './error-response.js';
import { logWarn } from './log.js';
import type { MetaRouteScope } from './meta-collection-routes.js';
import { wiredEngineOrLoud, type RestServer } from './rest-server.js';

/** The capability the door demands, in the caller's current organization (ruling 6670707546 item B). */
export const RECORD_CURRENCY_BACKFILL_CAPABILITY = 'setup.write';

/** The body keys the door reads — the whole closed set. */
const BODY_KEYS: readonly string[] = ['object', 'field', 'code', 'apply'];

/**
 * The `RestServer` members {@link registerMetaRecordCurrencyBackfillRoute}
 * reads — every one of them, and no other. Each is typed AS the class member,
 * so a signature change on the class is a change here too. `routeManager` is
 * captured by value inside `registerMetadataEndpoints`' swap (the gated
 * registrar, as for every `/meta` group), and the provider field goes as a
 * getter, read at request time.
 */
export interface MetaRecordCurrencyBackfillRouteHost {
    readonly routeManager: RestServer['routeManager'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    readonly objectQLProvider: RestServer['objectQLProvider'];
    resolveRequestEnvironmentId: RestServer['resolveRequestEnvironmentId'];
}

/** `400 VALIDATION_ERROR` naming the body key it judges. */
function bodyRefusal(field: string, message: string): Error {
    return Object.assign(new Error(message), { code: 'VALIDATION_ERROR', status: 400, field });
}

/** The three names and the apply flag, judged before the engine is resolved. */
function readBody(body: unknown): { object: string; field: string; code: string; apply: boolean } {
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw bodyRefusal('body', 'The body must be a JSON object: { object, field, code, apply? }.');
    }
    const b = body as Record<string, unknown>;
    for (const key of Object.keys(b)) {
        if (BODY_KEYS.includes(key)) continue;
        throw bodyRefusal(
            key,
            key === 'organizationId' || key === 'allOrganizations'
                ? `'${key}' is not accepted: this door fills the rows of your current organization only. ` +
                  'Switch to the organization whose rows you mean, and send { object, field, code, apply? }.'
                : `Unknown body key '${key}': the body is { object, field, code, apply? }.`,
        );
    }
    for (const key of ['object', 'field', 'code'] as const) {
        const value = b[key];
        if (typeof value !== 'string' || value.trim() === '') {
            throw bodyRefusal(key, `'${key}' is required and must be a non-blank string.`);
        }
    }
    if (b.apply !== undefined && typeof b.apply !== 'boolean') {
        throw bodyRefusal('apply', "'apply' must be true or false; omit it for a preview.");
    }
    return { object: b.object as string, field: b.field as string, code: b.code as string, apply: b.apply === true };
}

/**
 * Register `POST {metaPath}/_migrate-record-currency-codes`, behind
 * `metadata.endpoints.maintenance`, with the server's members as `this` and
 * the `/meta` head bindings as `scope`. A literal `POST` path: no `POST
 * {metaPath}/:type` exists to capture it, so its place in the order is free.
 */
export function registerMetaRecordCurrencyBackfillRoute(
    this: MetaRecordCurrencyBackfillRouteHost,
    scope: MetaRouteScope,
): void {
    const { metadata, metaPath, isScoped } = scope;
    if (metadata.endpoints.maintenance === false) return;
    this.routeManager.register({
        method: 'POST',
        path: `${metaPath}/_migrate-record-currency-codes`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                const held = new Set<string>(Array.isArray(ctx?.systemPermissions) ? ctx.systemPermissions : []);
                if (!ctx?.isSystem && !held.has(RECORD_CURRENCY_BACKFILL_CAPABILITY)) {
                    res.status(403).json({
                        error: {
                            code: 'FORBIDDEN',
                            message:
                                'Backfilling record currency codes requires the `setup.write` capability in your ' +
                                'current organization.',
                        },
                    });
                    return;
                }
                const organizationId = typeof ctx?.tenantId === 'string' && ctx.tenantId !== '' ? ctx.tenantId : undefined;
                if (organizationId === undefined) {
                    res.status(403).json({
                        error: {
                            code: 'FORBIDDEN',
                            message:
                                'This request has no current organization, and the backfill fills the rows of the ' +
                                'caller\'s current organization only: select the organization whose rows you mean ' +
                                'and retry. Nothing was read.',
                        },
                    });
                    return;
                }
                const body = readBody(req.body);
                const ql: any = await wiredEngineOrLoud(
                    Boolean(this.objectQLProvider),
                    async () => this.objectQLProvider!(await this.resolveRequestEnvironmentId(environmentId, req)),
                );
                let backfill: typeof import('@objectstack/objectql')['backfillRecordCurrencyCodes'] | undefined;
                try {
                    ({ backfillRecordCurrencyCodes: backfill } = await import('@objectstack/objectql'));
                } catch {
                    backfill = undefined;
                }
                if (
                    typeof backfill !== 'function'
                    || typeof ql?.getObject !== 'function'
                    || typeof ql?.find !== 'function'
                    || typeof ql?.update !== 'function'
                ) {
                    res.status(501).json({
                        error: {
                            code: 'NOT_IMPLEMENTED',
                            message: 'The record currency code backfill is not available in this runtime: it has no data engine.',
                        },
                    });
                    return;
                }
                // Per-row failures are in the report the caller receives; the
                // log line is the operator's copy.
                const logger = { info: () => {}, warn: (message: string) => logWarn(message) };
                const report = await backfill(ql, logger, { ...body, organizationId });
                res.json(report);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'Write a currency code into the current organization\'s codeless rows of a record-mode amount',
            tags: ['metadata'],
        },
    });
}
