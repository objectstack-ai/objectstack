// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 13e] The `/meta` object state-machine read of `RestServer` —
 * `GET {metaPath}/object/:name/state/:field`, the legal next states an object
 * field's state machine declares (ADR-0020 D3.3) — moved out of
 * `rest-server.ts`. It was the seventh group of
 * `RestServer#registerMetadataEndpointsInner`'s body, one statement, and that
 * method now calls the function below at its old position, so the `/meta`
 * routes still register in one order: after the history family, and above the
 * published read.
 *
 * A MOVE, not a redesign. The function below is that statement as it stood,
 * re-indented one level: the same route per base, by the same handler,
 * answering the same bodies, under no per-family switch (it answers to
 * `api.enableMetadata` alone, as the inner method's own docblock says, and
 * moving it under a switch is a decision, not a tidy-up). The moved comments
 * are moved text too: where one says "here", "below" or "the dispatcher
 * branch this mirrors", it still describes `rest-server.ts` and the inner
 * method as they were.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 13a set for `/meta` (`meta-collection-routes.ts`' header
 * carries the full reasoning). The class keeps the private method, and the
 * method keeps its head; at the position of the moved statement it builds one
 * host literal ({@link MetaObjectStateRouteHost}) and hands it, with the head's
 * one {@link MetaRouteScope}, to the function below as its `this` and its
 * argument.
 *
 * Each member was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE, and the literal that carries it is built
 *   INSIDE `registerMetadataEndpointsInner`, at the position of the statement
 *   it replaces. That placement is the load-bearing part. This route registers
 *   on the route manager directly, never through the per-item registrar (it is
 *   deliberately no member of the per-item face), and the body reads the
 *   manager only for that one `register` call. The call runs during the inner
 *   call, while `registerMetadataEndpoints`, the umbrella, has swapped the
 *   server's manager for its wrapping registrar, and nothing inside the inner
 *   method reassigns it, so the value captured there is the object that read
 *   returned: the route still mounts behind the anonymous-deny gate (#3963)
 *   and the type-level read and write admissions (#21087, #21124) the wrapper
 *   asks before every `/meta` handler. ⛔ A host built anywhere else — in
 *   `registerRoutes`, in the constructor, cached on the instance, or in the
 *   umbrella above the swap — captures the REAL manager, and this route would
 *   mount outside all three gates.
 * - `objectQLProvider` goes as a GETTER. The handler reads that provider FIELD
 *   at REQUEST time, twice (its presence, then the call, both through
 *   `wiredEngineOrLoud`), and the field is not `readonly`, so a value copied at
 *   registration could part from it. The getter reads the field the handler
 *   read, when it read it: slice 2's batch shape, unbound, per the seat's
 *   provider ruling (no shipped provider reads `this`).
 * - `resolveProtocol` is a METHOD, handed over as a closure that calls it on
 *   the server at call time, so a test double or spy set on the server is
 *   still the one the body reaches.
 *
 * The inner method's head declares the bindings every `/meta` group reads and
 * hands them over as ONE parameter, {@link MetaRouteScope}, built once there;
 * the function destructures the two its body reads (`metaPath` and
 * `isScoped`). The host stays class members only. Every token of the body is
 * the one it had: it reaches no private static.
 *
 * ## Module-level names
 *
 * `wiredEngineOrLoud`, the engine seam's loud reach, is declared in
 * `rest-server.ts`, stays there (the class head and the batch and published
 * doors read it too) and is imported from it; it is read only at request
 * time, so the two modules importing each other cannot see it uninitialised.
 * Every other name is imported from the module `rest-server.ts` imported it
 * from. The handler still loads `@objectstack/objectql` through a DYNAMIC
 * import inside a `try`: that package is a devDependency here, so a host
 * serving REST without the data engine answers `501` instead of failing to
 * load, and `scripts/check-undeclared-dep-imports.mjs` ledgers that probe
 * against this file. The package entry re-exports nothing from here, and the
 * published surface does not move.
 */

import { handleRouteError } from './error-response.js';
import type { MetaRouteScope } from './meta-collection-routes.js';
import * as metaReadGate from './meta-item-read-gate.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import { wiredEngineOrLoud, type RestServer } from './rest-server.js';

/**
 * The `RestServer` members {@link registerMetaObjectStateRoute} reads — every
 * one of them, and no other, in the order the body first reads them. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member the
 * class does not have is a compile error. The module header says why
 * `routeManager` is captured inside the swap and by value, and why the provider
 * field is a getter.
 */
export interface MetaObjectStateRouteHost {
    readonly routeManager: RestServer['routeManager'];
    readonly objectQLProvider: RestServer['objectQLProvider'];
    resolveProtocol: RestServer['resolveProtocol'];
}

/**
 * Register the `/meta` object state-machine read — the seventh group of
 * `RestServer#registerMetadataEndpointsInner`' body, called by that method at
 * its position in its registration order, with the server's members as `this`
 * and the method's head bindings as `scope`. The method's own docblock, which
 * the published declaration carries, names the families, their switches and
 * why this route answers to none of them.
 */
export function registerMetaObjectStateRoute(this: MetaObjectStateRouteHost, scope: MetaRouteScope): void {
    const { metaPath, isScoped } = scope;

    // GET /meta/object/:name/state/:field?from=:state — ADR-0020 D3.3
    // legal-next-state introspection. [#7526]
    //
    // Ledgered since #3563 (`route-ledger.ts`, `meta.getLegalNextStates`)
    // and implemented in the dispatcher's `/meta` branch — but REST's ~17
    // `/meta` routes topped out at THREE path segments and this one needs
    // four, so no registration here could ever deliver it and it answered
    // Hono's `notFound`, byte-identical to an unmounted path.
    //
    // SINGULAR ONLY, and the SDK calls this path (#9180 step 2): the
    // `/meta` type segment is always singular, so the plural twin that
    // used to be registered beside this one is retired here.
    //
    // What the retirement does NOT touch, because it is a different
    // mechanism: the plural was a DECLARED registration, never a
    // `META_URL_TO_SINGULAR` fold tolerance. This mount matches on a
    // LITERAL segment, so no request for it ever reached the fold — the
    // boundary's accept set for `/meta/:type/...` is unchanged, which is
    // what the 2026-08-17 re-weigh (item 3) requires of this step.
    //
    // [commit 7986d973f] The four-segment collision this comment used to describe is
    // GONE with the compound `/:type/:section/:name/published` twin. That
    // twin captured `/meta/object/x/state/published` as "the published
    // version of the compound name object/x/state", and only the literal
    // `object`/`state` segments winning kept the FSM reading — a field
    // literally named `published` was the ambiguity. With the twin retired
    // no other route matches four segments, so this mount is now the only
    // reading of that path rather than the preferred one.
    this.routeManager.register({
        method: 'GET',
        path: `${metaPath}/object/:name/state/:field`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const name = String(req.params?.name ?? '');
                const field = String(req.params?.field ?? '');
                // [#6877 shape] `?from=` narrows to ONE current state;
                // an array would reach `legalNextStates` as a
                // stringified pair and match no transition key.
                // [#23214] The list lives beside the shared decision, so the
                // runtime dispatcher's twin refuses the same name.
                if (refuseRepeatedQueryParams(req, res, metaReadGate.META_QUERY_ARITY_DOORS.state)) return;
                const from = req.query?.from !== undefined ? String(req.query.from) : undefined;
                // [#15405] The engine seam, reached the way its SIBLING at
                // `computeExecCtx` already reaches it — `wiredEngineOrLoud`
                // — so "no engine is wired" and "the engine WAS wired and
                // could not be resolved" stay two facts instead of one
                // `undefined`. The retired spelling this replaces:
                //
                //     this.objectQLProvider(environmentId).catch(() => undefined)
                //
                // ⚠️ That `.catch` was DEAD CODE until #13904. The shipped
                // provider used to be `try { … } catch { return undefined; }`
                // and so could not reject at all; the collapse happened one
                // layer earlier. #13904 made the provider re-raise PRECISELY
                // so a consumer could see the outage — and this consumer, the
                // slot's second and the one nobody enumerated, caught it
                // straight back. A wired-and-failing engine and a
                // never-registered one therefore both answered the
                // `404 NOT_FOUND · "Object not found"` twelve lines below:
                // this route lying about the cause during exactly the
                // incident it would be consulted in.
                //
                // ⛔ NOT `seamOrUndefined`. That helper SWALLOWS, and
                // swallowing at this seam IS the defect #13476 repaired —
                // its own docblock forbids routing the data-engine seam
                // back through it "to make the seams uniform".
                //
                // The wiring fact is the provider's PRESENCE, asked once and
                // never inferred from what it returned, so an UNWIRED engine
                // still reaches the 404 below byte-for-byte as before — and
                // so does a provider that RESOLVES `undefined`, which is the
                // seam contract declaring absence rather than failing.
                // `wiredEngineOrLoud` also invokes the provider
                // SYNCHRONOUSLY, so a host wiring a non-`async` provider —
                // which the seam's declared type cannot prevent — reaches the
                // same answer as one that rejects (commit add6a1b1c) instead of
                // escaping past a `.catch` that never came into existence.
                const ql = await wiredEngineOrLoud(
                    Boolean(this.objectQLProvider),
                    () => this.objectQLProvider!(environmentId),
                );
                // [#7557, #24210] The registry is a resolution reader and
                // keeps serving a disabled package's object, so this API
                // door asks first and answers what `GET /meta/object/:name`
                // answers: the protocol's own refusal, `404
                // OBJECT_PACKAGE_DISABLED` (the dispatcher twin's
                // `disabledObjectAnswer`); any other throw of that read is
                // answered as itself, never as an absence. A protocol that
                // does not refuse it gets this door's own answer for no
                // object, below. The schema is never read for such a name.
                const registry = (ql as any)?.registry;
                const disabledObject = typeof registry?.isObjectPackageDisabled === 'function'
                    && registry.isObjectPackageDisabled(name) === true;
                if (disabledObject) {
                    const p = await this.resolveProtocol(environmentId, req);
                    await p.getMetaItem({ type: 'object', name });
                }
                const schema = disabledObject ? undefined : registry?.getObject?.(name);
                if (!schema) {
                    // `{ error: { code, message } }`, the envelope
                    // `BaseResponseSchema` declares — not the bare
                    // `{ error: 'string' }` the dispatcher branch this
                    // mirrors emits. `pnpm check:route-envelope`
                    // ratchets both non-conforming shapes DOWN only, so
                    // a new route arrives conforming or not at all.
                    res.status(404).json({
                        error: { code: 'NOT_FOUND', message: 'Object not found' },
                    });
                    return;
                }
                // Dynamic import, matching the dispatcher branch this
                // mirrors: `@objectstack/objectql` is a devDependency
                // here, so a deployment serving REST without the data
                // engine must degrade rather than fail to load.
                let legalNextStates:
                    | ((s: { validations?: unknown[] } | null | undefined, f: string, c: string) => string[] | null)
                    | undefined;
                try {
                    ({ legalNextStates } = await import('@objectstack/objectql'));
                } catch {
                    legalNextStates = undefined;
                }
                if (typeof legalNextStates !== 'function') {
                    res.status(501).json({
                        error: {
                            code: 'NOT_IMPLEMENTED',
                            message: 'State-machine introspection is not available in this runtime',
                        },
                    });
                    return;
                }
                // Three answer values — `next: null`, `next: []` (a
                // declared dead end), and the legal-next list — the same
                // answer the dispatcher gives, because a UI asking "where
                // can this record go" must tell those apart. But `null`
                // is overloaded across TWO input conditions: no FSM
                // governs the field, or the caller omitted `?from=` (no
                // `from` => no transition table to answer with), which
                // the line below folds onto the same `null` without
                // consulting the rule. A UI therefore cannot read `null`
                // as "no state machine" unless it passed a `from`.
                const next = from === undefined ? null : legalNextStates(schema, field, from);
                res.json({ object: name, field, from: from ?? null, next });
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'List the legal next states declared by an object field\'s state machine',
            tags: ['metadata'],
        },
    });
}
