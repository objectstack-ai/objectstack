// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 10] The UI view route of `RestServer` —
 * `GET {basePath}/ui/view/:object/:type`, the door onto the protocol's
 * `getUiView` — moved out of `rest-server.ts` whole. `registerRoutes` calls the
 * registrar for each base it mounts, and only while `api.enableUi` is on.
 *
 * A MOVE, not a redesign. The function below is the body of
 * `RestServer#registerUiEndpoints` as it stood, re-indented one level and
 * otherwise unedited: the same route, registered at the same position, by the
 * same handler, answering the same bodies, its guards running in the same
 * order. It calls no class `static`, so no token of it changed. The order of
 * those guards is a ruling, recorded on the method's own docblock in
 * `rest-server.ts`, which the published declaration carries.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps the private method —
 * the published `dist/*.d.ts` lists its name, docblock and position — and the
 * body is one host literal ({@link UiRouteHost}) plus `.call(host, basePath)`.
 * A method is handed over as a closure that calls it on the server at call
 * time, so a test double or spy set on the server is still the one the body
 * reaches.
 *
 * Each member was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE. The body reads it only for its one
 *   `register` call, which runs while registration runs, and the class's one
 *   `routeManager` reassignment wraps `registerMetadataEndpointsInner`, never
 *   this registrar.
 * - No member goes as a getter, because the body reads no FIELD at request
 *   time. The environment, the caller, the ownership verdict and the protocol
 *   that answers are each resolved per request by a METHOD of the class, and
 *   every method goes as a closure.
 *
 * `handleRouteError` is imported from the module `rest-server.ts` imports it
 * from. `GetUiViewRequest`, which only this body read, is imported here from
 * `@objectstack/spec/api` instead of there. One module-level declaration moved
 * here with the body: the meta doors' request envelope, below. No export was
 * added to `rest-server.ts`, so the published surface does not move.
 */

import type { GetUiViewRequest } from '@objectstack/spec/api';
import { handleRouteError } from './error-response.js';
import type { RestServer } from './rest-server.js';

// [#23050 slice 10] Moved here from `rest-server.ts`, verbatim, because this module is
// the first one outside that file to need it: exporting it from there changed the
// published `dist/*.d.ts` by one line, and a second copy is not an option. The meta
// doors and listing helpers still in `rest-server.ts` import it from here, and the
// block's "here" and "this file" still mean `rest-server.ts`, where they live.
/**
 * [commit 2a29caa53] Typed TRANSPORT envelope for the meta-read doors.
 *
 * `environmentId` is the multi-kernel routing key, and it is OUT of the
 * protocol request shape **by explicit maintainer decision** (ruling recorded
 * 2026-08-18, landed as commit 2a29caa53): `resolveProtocol(environmentId)` selects the target
 * kernel *before* the protocol call, and the implementation's parameter types
 * (`@objectstack/metadata-protocol`) never read it off the request — the spec
 * schemas (`protocol.zod.ts`) record the same exclusion schema-side. The doors
 * here still spread it into the outgoing payload (long-standing wire shape,
 * deliberately unchanged by the ruling), so this alias declares that one
 * transport-level member on top of the declared request type. The point is
 * what it makes the compiler do: every OTHER key in a door's request literal
 * is now checked against the spec contract — an undeclared member is a compile
 * error at the call site, not a cast-and-hope. Never add protocol members
 * here; a key that belongs to the request belongs in the spec schema.
 *
 * [commit 45862a53d] The same typing now covers the NON-door `getMetaItems` helper call
 * sites in this file (the object, book, doc, view and dataset listings). Two
 * spellings those sites carry deliberately SURVIVE the tightening, because
 * retiring either would change behaviour rather than typing:
 *
 *   - The OPTIONAL CALL (`getMetaItems?.(…)`) and the
 *     `typeof … === 'function'` guards. `getMetaItems` is a REQUIRED
 *     `MetadataProtocol` member, so these are not feature detection in the
 *     type sense — but a host may occupy the protocol slot with an object
 *     that does not implement the whole surface, which is the measured reason
 *     they exist (`metaTypeIsLive` documents the same deliberate spelling for
 *     `getMetaTypes`). Retiring one turns a tolerated absence into a
 *     `TypeError`.
 *   - The RESULT handling. `getMetaItems` is declared to return
 *     `{ type, items }`, while these sites also tolerate the bare-array shape
 *     older hosts and stubs return (see `metaItemsArray`), so the response
 *     stays runtime-shaped on purpose.
 *
 * The REQUEST is what is fully typeable today, and the request is what is
 * typed — which is the whole point: an undeclared key in one of these
 * literals is now a compile error instead of a cast-and-hope.
 */
export type TransportScopedMetaRequest<R> = R & { environmentId?: string };

/**
 * The `RestServer` members {@link registerUiEndpoints} reads — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for why none of them is a getter.
 */
export interface UiRouteHost {
    readonly routeManager: RestServer['routeManager'];
    resolveRequestEnvironmentId: RestServer['resolveRequestEnvironmentId'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
    enforceEnvironmentOwnership: RestServer['enforceEnvironmentOwnership'];
    resolveProtocol: RestServer['resolveProtocol'];
}

/**
 * Register the UI view endpoint — `RestServer#registerUiEndpoints`' body,
 * called by that method with the server as `this`. The method's own docblock,
 * which the published declaration carries, names the route's guards and the
 * ruled order they run in.
 */
export function registerUiEndpoints(this: UiRouteHost, basePath: string): void {
    const uiPath = `${basePath}/ui`;
    const isScoped = basePath.includes('/environments/:environmentId');

    // GET /ui/view/:object/:type - Resolve view for object
    this.routeManager.register({
        method: 'GET',
        path: `${uiPath}/view/:object/:type`,
        handler: async (req: any, res: any) => {
            try {
                const routeEnvironmentId = isScoped ? req.params?.environmentId : undefined;
                // [commit cc837dbfe] THE environment decision for this request, taken
                // once through the shared entry point and then reused — so
                // the identity below, the ownership comparison and the
                // protocol that answers cannot be about three different
                // environments.
                const environmentId = await this.resolveRequestEnvironmentId(routeEnvironmentId, req);
                // A BARE site, deliberately, and the census in
                // `execctx-consumer-census.test.ts` is what makes that a
                // decision rather than an omission: the 52 sites whose very
                // next statement is the shared anonymous floor carry no
                // local `.catch`, because `computeExecCtx` already converts
                // every fault except an authz-store outage into `undefined`
                // and re-raises that one — which this handler's own
                // `try/catch` turns into the declared fault response. A
                // local `.catch(rethrowAuthzStoreUnavailable)` here would be
                // behaviourally identical and would make this the only site
                // that is both locally caught AND behind the floor, which is
                // exactly the split that census asserts does not exist.
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (this.enforceEnvironmentOwnership(req, res, environmentId, context)) return;
                const p = await this.resolveProtocol(environmentId, req);
                if (p.getUiView) {
                    const viewRequest: TransportScopedMetaRequest<GetUiViewRequest> = {
                        object: req.params.object,
                        type: req.params.type,
                        // [commit cc837dbfe] `routeEnvironmentId`, NOT the resolved id.
                        // The gate above changed WHO may reach the producer;
                        // it deliberately did not change WHAT the producer is
                        // told. This key has only ever been present on the
                        // scoped mount, and the shipped `getUiView` declares
                        // `{ object, type }` alone — widening the argument on
                        // the unscoped mount would be an unrelated behaviour
                        // change riding on a security fix.
                        ...(routeEnvironmentId ? { environmentId: routeEnvironmentId } : {}),
                    };
                    const view = await p.getUiView(viewRequest);
                    res.json(view);
                } else {
                    res.status(501).json({ error: 'UI View resolution not supported by protocol implementation', code: 'NOT_IMPLEMENTED' });
                }
            } catch (error: any) {
                handleRouteError(res, error, req.params?.object);
            }
        },
        metadata: {
            summary: 'Resolve UI View for object',
            tags: ['ui'],
        },
    });
}
