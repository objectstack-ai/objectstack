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
 *  - `_env`: the environment's own item, or `409` naming every served
 *    holder (`admitEnvironmentQualifier`), read as a caller with no package;
 *    a name only disabled packages hold answers that read's `404` (#33385).
 *
 * D5's order, as the runtime dispatcher's `/meta` domain reads the same path:
 * a sub-resource literal in the last position keeps its route — registered
 * before this one, so the route manager's first match is the literal
 * (`/meta/app/crm/history` is the app `crm`'s history; ruling Q1 on #31691);
 * a last segment that is a literal of a type with no such route answers what
 * it answered before this route existed: the host's unmatched answer,
 * `404 ENDPOINT_NOT_FOUND` "Not found". So does a middle segment that is
 * neither `_env` nor an installed namespace. A
 * qualified path that also sends `?package=` names two addresses and is
 * refused `400`; so is one that sends the caller arm, `?callerPackage=`
 * (#32310).
 */

import { rethrowAuthzStoreUnavailable } from '@objectstack/core';
import { sendError } from '@objectstack/types';
import { handleRouteError } from './error-response.js';
import { wantsMetaItemLayers } from './meta-item-read-gate.js';
import type { MetaRouteScope } from './meta-collection-routes.js';
import type { MetaItemReadHandler } from './meta-item-read-routes.js';
import { mayReadPendingDrafts, type RestServer } from './rest-server.js';

/** The `RestServer` members {@link registerMetaQualifiedItemRoute} reads. */
export interface MetaQualifiedItemRouteHost {
    readonly routeManager: RestServer['routeManager'];
    resolveProtocol: RestServer['resolveProtocol'];
    /** [#33385, review S1] The caller, asked only to judge an admitted draft switch at `_env`. */
    resolveExecCtx: RestServer['resolveExecCtx'];
}

/**
 * How the protocol reads the middle segment (`MetaItemAddress` in
 * `@objectstack/metadata-protocol`, spelled structurally: this package reaches
 * the protocol as a service, never as an import).
 */
type MetaItemAddress =
    | { readonly kind: 'environment' }
    | { readonly kind: 'namespace'; readonly namespace: string; readonly packageId: string };

/** The protocol reads this route asks, feature-detected. */
interface QualifiedAddressProtocol {
    resolveMetaItemAddress?(request: { type: string; segment: string; name: string }): MetaItemAddress | undefined;
    admitEnvironmentQualifier?(request: { type: string; name: string; member?: string }): void;
    getMetaItem?(request: { type: string; name: string; member?: string }): Promise<{ item?: unknown } | undefined>;
}

/**
 * [#33385, #32183 row 17] The `Symbol.for` key of the mark
 * `admitEnvironmentQualifier` sets on its refusal of a name only disabled
 * packages hold (`DISABLED_HOLDERS_ONLY_REFUSAL` in
 * `@objectstack/metadata-protocol`; this package reaches the protocol as a
 * service, never as an import). The runtime dispatcher reads the same key.
 */
const DISABLED_HOLDERS_ONLY_REFUSAL = Symbol.for('objectstack.metadata-protocol.disabledHoldersOnlyRefusal');

/**
 * Admit `_env` for `request`, or throw the protocol's refusal. A refusal
 * marked {@link DISABLED_HOLDERS_ONLY_REFUSAL} is admitted when the read
 * naming no package withholds the name: a disabled package holds no name,
 * so `_env` answers the read's own 404, naming no package. When that read
 * serves an item or refuses, a package holds the name through a stored row
 * the registry has not read, and the refusal stands.
 *
 * [#33385, review S1] Only the read that judged the name is admitted this
 * way. An admitted draft read (`?state=draft`, `?preview=draft`) or the
 * deprecated layered view (`?layers=`) reads other rows than the plain read,
 * so for it the marked refusal stands, as on `main` (`readsAsJudged`, asked
 * only once the refusal is marked).
 */
async function admitEnvironmentAddress(
    p: QualifiedAddressProtocol,
    request: { type: string; name: string; member?: string },
    readsAsJudged: () => Promise<boolean>,
): Promise<void> {
    try {
        p.admitEnvironmentQualifier?.(request);
    } catch (refusal) {
        if ((refusal as Record<symbol, unknown> | null)?.[DISABLED_HOLDERS_ONLY_REFUSAL] !== true
            || typeof p.getMetaItem !== 'function'
            || !(await readsAsJudged())) throw refusal;
        let withheld: boolean;
        try {
            withheld = (await p.getMetaItem(request))?.item == null;
        } catch {
            throw refusal;
        }
        if (!withheld) throw refusal;
    }
}

/** What the host answered this path before the route existed: its unmatched 404. */
function routeNotFound(res: any): void {
    sendError(res, 404, 'ENDPOINT_NOT_FOUND', 'Not found');
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
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req) as unknown as QualifiedAddressProtocol;
                const address = typeof p?.resolveMetaItemAddress === 'function'
                    ? p.resolveMetaItemAddress({ type: params.type, segment, name: params.name })
                    : undefined;
                if (!address) return routeNotFound(res);
                const query = { ...((req.query ?? {}) as Record<string, unknown>) };
                // [ADR-0150 D3, #32310] A qualified address is already exact,
                // so the caller arm beside it names a second address: refused
                // like `?package=`, naming both.
                if (query.callerPackage !== undefined) {
                    sendError(res, 400, 'VALIDATION_ERROR',
                        `The path names its ${address.kind === 'environment' ? 'environment' : `namespace '${segment}'`} `
                        + 'as the exact qualifier, so `?callerPackage=` cannot resolve the name from another package. Send one '
                        + 'of the two: the bare path with `?callerPackage=`, or the qualified path (ADR-0150 D3, D5).');
                    return;
                }
                // Two qualifiers on one read name two addresses; neither is picked.
                if (query.package !== undefined) {
                    sendError(res, 400, 'VALIDATION_ERROR',
                        `The path names its ${address.kind === 'environment' ? 'environment' : `namespace '${segment}'`} `
                        + 'as the exact qualifier, so `?package=` cannot name another one. Send one of the two (ADR-0150 D5).');
                    return;
                }
                if (address.kind === 'namespace') {
                    query.package = address.packageId;
                } else {
                    const member = typeof query.member === 'string' && query.member !== '' ? query.member : undefined;
                    // [#33385, review S1] The read the item read answers this caller: the
                    // plain read unless `?layers=` asks for the layered view, or a
                    // draft switch is sent by a caller `mayReadPendingDrafts` admits.
                    const readsAsJudged = async (): Promise<boolean> => {
                        if (wantsMetaItemLayers(query)) return false;
                        const draft = (value: unknown) => typeof value === 'string' && value.toLowerCase() === 'draft';
                        if (!draft(query.state) && !draft(query.preview)) return true;
                        return !mayReadPendingDrafts(await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable));
                    };
                    await admitEnvironmentAddress(p, { type: params.type, name: params.name, ...(member ? { member } : {}) }, readsAsJudged);
                }
                await readItem(asItemRead(req, params, query), res);
            } catch (error: any) {
                // [#32201] A shareable namespace both owners hold, or `_env`
                // for a name the environment does not hold: the refusal with
                // its holders as `details.candidates`.
                handleRouteError(res, error, undefined, { packageScopedCandidates: true });
            }
        },
        metadata: {
            summary: 'Get a metadata item by its qualified address (ADR-0150 D5)',
            tags: ['metadata'],
        },
    });
}
