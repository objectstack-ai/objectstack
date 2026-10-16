// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 9] The global search route of `RestServer` —
 * `GET {basePath}/search`, the cross-object search door onto the protocol's
 * `searchAll` — moved out of `rest-server.ts` whole. `registerRoutes` calls the
 * registrar for each base it mounts, and only while `api.enableSearch` is on.
 *
 * A MOVE, not a redesign. The function below is the body of
 * `RestServer#registerSearchEndpoints` as it stood, re-indented one level and
 * otherwise unedited: the same route, registered at the same position, by the
 * same handler, answering the same bodies. It calls no class `static`, so no
 * token of it changed.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps the private method —
 * the published `dist/*.d.ts` lists its name, docblock and position — and the
 * body is one host literal ({@link SearchRouteHost}) plus
 * `.call(host, basePath)`. A method is handed over as a closure that calls it
 * on the server at call time, so a test double or spy set on the server is
 * still the one the body reaches.
 *
 * Each member was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE. The body reads it only for its one
 *   `register` call, which runs while registration runs, and the class's one
 *   `routeManager` reassignment wraps `registerMetadataEndpointsInner`, never
 *   this registrar.
 * - No member goes as a getter, because the body reads no FIELD at request
 *   time. The protocol the door searches and the caller it answers are each
 *   resolved per request by a METHOD of the class, and every method goes as a
 *   closure.
 *
 * Module-level helpers stay where they were and are imported:
 * `GLOBAL_SEARCH_PARAMS`, `UNDECLARED_WHOLE_NUMBER_PARAM` and
 * `readDeclaredQueryNumber` from `rest-server.ts`, which already exported all
 * three; the rest from the modules `rest-server.ts` imports them from. No
 * export was added anywhere, so the published surface does not move.
 */

import { logUnexpectedRouteError, mapDataError } from './error-response.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import {
    GLOBAL_SEARCH_PARAMS,
    UNDECLARED_WHOLE_NUMBER_PARAM,
    readDeclaredQueryNumber,
    type RestServer,
} from './rest-server.js';

/**
 * The `RestServer` members {@link registerSearchEndpoints} reads — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for why none of them is a getter.
 */
export interface SearchRouteHost {
    readonly routeManager: RestServer['routeManager'];
    resolveProtocol: RestServer['resolveProtocol'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
}

/**
 * Register the global cross-object search endpoint —
 * `RestServer#registerSearchEndpoints`' body, called by that method with the
 * server as `this`. The method's own docblock, which the published declaration
 * carries, names the route and its query parameters.
 */
export function registerSearchEndpoints(this: SearchRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');
    this.routeManager.register({
        method: 'GET',
        path: `${basePath}/search`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const searchAll = (p as any).searchAll;
                if (typeof searchAll !== 'function') {
                    res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Search not supported by this protocol' });
                    return;
                }
                // [#6877] `String(['a','b'])` searched for the literal
                // term `'a,b'`. `objects` is NOT listed: the next line reads
                // its array arm deliberately — a cross-object search over a
                // LIST of objects is the whole point of the parameter.
                // [#7606] Recognition before arity, same order and same
                // envelope as the export route — see `query-allowlist.ts`.
                // A dropped `?objects=` is the widening case at its worst:
                // the term fans out across every searchable object while the
                // caller believes they scoped it to one.
                if (refuseUnknownQueryParams(req, res, GLOBAL_SEARCH_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res, ['q', 'query', 'limit', 'perObject'])) return;
                const q = String(req.query?.q ?? req.query?.query ?? '');
                const objectsParam = req.query?.objects;
                const objects = typeof objectsParam === 'string'
                    ? objectsParam.split(',').map((s: string) => s.trim()).filter(Boolean)
                    : Array.isArray(objectsParam) ? objectsParam : undefined;
                // [#20062] Read, not coerced: `?limit=abc` used to reach
                // `searchAll` as `NaN`, and `hits.length >= NaN` is never true,
                // so the overall cap was silently gone. No request schema is
                // declared for this door, so the reading is "a whole number";
                // `searchAll`'s own `[1, 100]` clamp is unchanged, and an empty
                // `?limit=` stays absent as the old falsy guard had it.
                const limit = readDeclaredQueryNumber(req.query, 'limit',
                    UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: true });
                // [#20139] `perObject`, the same way: `?perObject=abc` reached
                // `searchAll` as `NaN`, its `Math.max(1, Math.min(25, NaN))` is
                // `NaN`, and the per-object cap was silently gone. Whole number;
                // the `[1, 25]` clamp stays `searchAll`'s own, and an empty
                // `?perObject=` stays absent as the old falsy guard had it.
                const perObject = readDeclaredQueryNumber(req.query, 'perObject',
                    UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: true });
                const result = await searchAll.call(p, {
                    q,
                    objects,
                    limit,
                    perObject,
                    ...(context ? { context } : {}),
                });
                res.json(result);
            } catch (error: any) {
                const mapped = mapDataError(error);
                logUnexpectedRouteError(error, mapped);
                res.status(mapped.status).json(mapped.body);
            }
        },
        metadata: {
            summary: 'Global cross-object search',
            tags: ['search'],
        },
    });
}
