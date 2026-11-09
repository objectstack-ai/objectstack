// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, epic #31527 child G1] `GET /meta/:type/:ns/:name` and
 * `GET /meta/:type/_env/:name` — the qualified by-name read, on the REST
 * route manager.
 *
 * It is the item read `GET /meta/:type/:name` with its holder named exactly,
 * and it answers through THAT read's handler (`registerMetaItemReadRoutes`
 * hands it back), never a copy of it:
 *
 *  - an installed namespace: the read is `?package=<the namespace's holder>`,
 *    the exact qualifier the protocol judges (`admitExactQualifier`): the
 *    package's item with its bound overlay, or `409 RESOURCE_CONFLICT` naming
 *    every holder;
 *  - `_env`: the environment's own item, or `409` naming every holder
 *    (`admitEnvironmentQualifier`), read as a caller with no package.
 *
 * D5's order, as the runtime dispatcher's `/meta` domain reads the same path:
 * a sub-resource literal in the last position keeps its route — registered
 * before this one, so the route manager's first match is the literal
 * (`/meta/app/crm/history` is the app `crm`'s history; ruling Q1 on #31691);
 * a last segment that is a literal of a type with no such route answers what
 * it answered before this route existed, `404 ROUTE_NOT_FOUND`. So does a
 * middle segment that is neither `_env` nor an installed namespace. A
 * qualified path that also sends `?package=` names two addresses and is
 * refused `400`.
 */

import { META_ITEM_SUBRESOURCE_SEGMENTS, type MetaItemAddress } from '@objectstack/metadata-protocol';
import { handleRouteError } from './error-response.js';
import type { MetaRouteScope } from './meta-collection-routes.js';
import type { MetaItemReadHandler } from './meta-item-read-routes.js';
import type { RestServer } from './rest-server.js';

/** The `RestServer` members {@link registerMetaQualifiedItemRoute} reads. */
export interface MetaQualifiedItemRouteHost {
    readonly routeManager: RestServer['routeManager'];
    resolveProtocol: RestServer['resolveProtocol'];
}

/** The protocol reads this route asks, feature-detected. */
interface QualifiedAddressProtocol {
    resolveMetaItemAddress?(request: { type: string; segment: string; name: string }): MetaItemAddress | undefined;
    admitEnvironmentQualifier?(request: { type: string; name: string; member?: string }): void;
}

function routeNotFound(res: any, req: any): void {
    const route = `GET ${String(req?.path ?? '')}`;
    res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: `Route Not Found: ${route}` } });
}

/** A copy of `req` addressed as the bare item read, with `params` and `query` replaced. */
function asItemRead(req: any, params: Record<string, unknown>, query: Record<string, unknown>): any {
    return Object.assign(Object.create(Object.getPrototypeOf(req ?? {})), req, { params, query });
}

/**
 * Register `GET {metaPath}/:type/:ns/:name`. Call it AFTER every other `/meta`
 * route, so each literal three-segment sibling is matched first.
 */
export function registerMetaQualifiedItemRoute(
    this: MetaQualifiedItemRouteHost,
    scope: MetaRouteScope,
    readItem: MetaItemReadHandler | undefined,
): void {
    if (!readItem) return;
    const { metaPath, isScoped } = scope;
    this.routeManager.register({
        method: 'GET',
        path: `${metaPath}/:type/:ns/:name`,
        handler: async (req: any, res: any) => {
            try {
                const { ns: segment, ...params } = (req.params ?? {}) as Record<string, string>;
                if (META_ITEM_SUBRESOURCE_SEGMENTS.includes(params.name)) return routeNotFound(res, req);
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req) as unknown as QualifiedAddressProtocol;
                const address = typeof p?.resolveMetaItemAddress === 'function'
                    ? p.resolveMetaItemAddress({ type: params.type, segment, name: params.name })
                    : undefined;
                if (!address) return routeNotFound(res, req);
                const query = { ...((req.query ?? {}) as Record<string, unknown>) };
                // Two qualifiers on one read name two addresses; neither is picked.
                if (query.package !== undefined) {
                    res.status(400).json({
                        error: {
                            code: 'VALIDATION_ERROR',
                            message: `The path names its ${address.kind === 'environment' ? 'environment' : `namespace '${segment}'`} `
                                + 'as the exact qualifier, so `?package=` cannot name another one. Send one of the two (ADR-0150 D5).',
                        },
                    });
                    return;
                }
                if (address.kind === 'namespace') {
                    query.package = address.packageId;
                } else {
                    const member = typeof query.member === 'string' && query.member !== '' ? query.member : undefined;
                    p.admitEnvironmentQualifier?.({ type: params.type, name: params.name, ...(member ? { member } : {}) });
                }
                await readItem(asItemRead(req, params, query), res);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'Get a metadata item by its qualified address (ADR-0150 D5)',
            tags: ['metadata'],
        },
    });
}
