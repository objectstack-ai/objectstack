// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 13a] The first three `/meta` route groups of `RestServer` —
 * the type list (`GET {metaPath}` and its `GET {metaPath}/types` spelling,
 * one handler on two paths), the whole-store maintenance family
 * (`GET {metaPath}/diagnostics`, `GET {metaPath}/_drafts` and the
 * `POST {metaPath}/_migrate-stored` write door) and the per-type list
 * (`GET {metaPath}/:type`) — moved out of `rest-server.ts`. They were the first
 * three groups of `RestServer#registerMetadataEndpointsInner`'s body, and that
 * method now calls the function below at their old position, so the `/meta`
 * routes still register in one order, the literal segments still above the
 * `:type` parameter that would otherwise capture them.
 *
 * A MOVE, not a redesign. The function below is those groups' statements as
 * they stood, re-indented one level: the same seven routes per base, under the
 * same three switches (`metadata.endpoints.types`, `.maintenance` and
 * `.items`), by the same handlers, answering the same bodies. The rest of the
 * inner method — its head and the per-item, history, object-state and
 * published groups — stays where it is.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps the private method,
 * and the method keeps its head; at the position of the moved statements it
 * builds one host literal ({@link MetaCollectionRouteHost}) and calls
 * `registerMetaCollectionRoutes.call(host, scope)`. A method is handed over as
 * a closure that calls it on the server at call time, so a test double or spy
 * set on the server is still the one the body reaches.
 *
 * Each member was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE, and the literal that carries it is built
 *   INSIDE `registerMetadataEndpointsInner`, at the position of the
 *   statements it replaces. That placement is the load-bearing part.
 *   `registerMetadataEndpoints`, the umbrella, swaps the server's route
 *   manager for a wrapping registrar for exactly the duration of the inner
 *   call and restores it in a `finally`; the wrapper is what puts every
 *   `/meta` route behind the anonymous-deny gate (#3963) and the type-level
 *   read and write admissions (#21087, #21124). The body reads the manager
 *   only for its six `register` calls, all of which run during that call, and
 *   nothing inside the inner method reassigns it, so the value captured there
 *   is the object every one of those reads returned. ⛔ A host built anywhere
 *   else — in `registerRoutes`, in the constructor, cached on the instance, or
 *   in the umbrella above the swap — captures the REAL manager, and these
 *   seven routes would mount outside all three gates.
 * - No member goes as a getter, because the body reads no FIELD at request
 *   time. The protocol, the caller, the walled refusal, the write actor, the
 *   list's type check, its answer sources and the type-list translation are
 *   each resolved per request by a METHOD of the class, and every method goes
 *   as a closure. No provider field is read.
 *
 * The inner method's head declares four bindings every `/meta` group reads
 * (`metadata`, `metaPath`, `isScoped` and the per-item registrar). They are
 * computed once per base and shared by every group, so they stay in that head
 * and reach a moved group as ONE parameter, {@link MetaRouteScope}, built
 * once there; the function destructures the three its body reads. The host
 * stays class members only.
 *
 * ## The one token that is not byte-identical
 *
 * The per-type list names the requested type to the list chain through the
 * class's PRIVATE STATIC `metaTypeSingular`, which it used to call as
 * `RestServer.metaTypeSingular(…)`. A private static is reachable by name only
 * inside the class, so that spelling does not compile here, and making the
 * member public, or moving it, changes the published declaration the move must
 * keep byte-identical. So the call reaches it the way every other class member
 * this body reads is reached: through the host, as `this.metaTypeSingular(…)`,
 * a closure on {@link MetaCollectionRouteHost} that calls
 * `RestServer.metaTypeSingular` with the same argument. The static reads
 * nothing but its argument, so the receiver is the whole difference, as it was
 * for slice 11's `translateOptionsFor`. That receiver is the only token of the
 * body that changed.
 *
 * Module-level names stay where they are declared. `metaItemPackageBinding`
 * (on the package entry) and `mayReadPendingDrafts` (which the analytics module
 * imports too) are declared in `rest-server.ts`, stay there and are imported
 * from it; both are read only at request time, so the two modules importing
 * each other cannot see them uninitialised. Every other name is imported from
 * the module `rest-server.ts` imports it from, and every one of them is still
 * read there too. Two declarations live here: {@link MetaRouteScope}, new, and
 * the meta doors' request envelope `TransportScopedMetaRequest`, moved here
 * from `ui-routes.ts` because this module holds the first `/meta` door outside
 * `rest-server.ts` (see the note above its block). The package entry
 * re-exports neither, and the published surface does not move.
 */

import { rethrowAuthzStoreUnavailable } from '@objectstack/core';
import type { GetMetaItemsRequest } from '@objectstack/spec/api';
import { handleRouteError, sendFieldVisibilityFault } from './error-response.js';
import * as metaReadGate from './meta-item-read-gate.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import { mayReadPendingDrafts, metaItemPackageBinding, type RestServer } from './rest-server.js';
import type { RouteManager } from './route-manager.js';

// [#23050 slice 13a] Moved here from `ui-routes.ts`, verbatim. Slice 10 had moved it
// there from `rest-server.ts` with the UI view door, its first reader outside that
// file; it is the `/meta` doors' envelope, and this module holds the first `/meta`
// door outside that file, so every `/meta` module the split adds imports it from its
// home. A second copy is not an option. The UI view door, the public form doors and
// the meta doors and listing helpers still in `rest-server.ts` import it from here,
// and the block's "here" and "this file" still mean `rest-server.ts`, where they live.
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
 * [#23050 slice 13a] The four bindings `RestServer#registerMetadataEndpointsInner`
 * declares in its head, handed to each moved `/meta` group as ONE parameter.
 * They are computed once per base and every group reads them, so they stay in
 * that head rather than moving with any one group:
 *
 * - `metadata` — the normalized `config.metadata`, whose `endpoints.*`
 *   switches gate each family;
 * - `metaPath` — `{basePath}{metadata.prefix}`, the mount every route is under;
 * - `isScoped` — whether this base is the environment-scoped one, which alone
 *   decides whether a handler reads `req.params.environmentId`;
 * - `registerPerItemRoute` — the per-item switch's registrar. It is the inner
 *   method's OWN closure, handed over as it is, and it reads the server's route
 *   manager at CALL time; ⛔ never a module-local copy, which would be a second
 *   copy of a helper and would read a host's field instead.
 *
 * Each module destructures only the bindings its body reads.
 */
export interface MetaRouteScope {
    readonly metadata: RestServer['config']['metadata'];
    readonly metaPath: string;
    readonly isScoped: boolean;
    readonly registerPerItemRoute: (entry: Parameters<RouteManager['register']>[0]) => void;
}

/**
 * The `RestServer` members {@link registerMetaCollectionRoutes} reads — every
 * one of them, and no other, in the order the body first reads them. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member the
 * class does not have is a compile error. `metaTypeSingular` is the class's
 * private STATIC, typed as the static it is. The module header says why
 * `routeManager` is captured inside the swap and by value, why the body reaches
 * the static through the host, and why none of the members is a getter.
 */
export interface MetaCollectionRouteHost {
    resolveProtocol: RestServer['resolveProtocol'];
    translateMetaTypesResponse: RestServer['translateMetaTypesResponse'];
    readonly routeManager: RestServer['routeManager'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    walledCatalogRefusal: RestServer['walledCatalogRefusal'];
    resolveMetaWriteActor: RestServer['resolveMetaWriteActor'];
    refuseUnknownMetaListType: RestServer['refuseUnknownMetaListType'];
    metaListAnswerSources: RestServer['metaListAnswerSources'];
    metaTypeSingular: (typeof RestServer)['metaTypeSingular'];
}

/**
 * Register the `/meta` type list, the whole-store maintenance family and the
 * per-type list — the first three groups of
 * `RestServer#registerMetadataEndpointsInner`' body, called by that method at
 * their position in its registration order, with the server's members as
 * `this` and the method's head bindings as `scope`. The method's own docblock,
 * which the published declaration carries, names the families, their switches
 * and the ordering facts the routes below keep.
 */
export function registerMetaCollectionRoutes(this: MetaCollectionRouteHost, scope: MetaRouteScope): void {
    const { metadata, metaPath, isScoped } = scope;

    // GET /meta - List all metadata types
    //
    // Also mounted at `/meta/types`, the spelling the dispatcher's `/meta`
    // branch has always implemented (`parts[0] === 'types'`) and the
    // spelling `route-ledger.ts` has always declared. ONE handler, two
    // paths, deliberately: the dispatcher's two branches return the same
    // `protocol.getMetaTypes()` body, so a second REST handler would be a
    // second thing to keep true.
    if (metadata.endpoints.types !== false) {
        const listMetaTypes = async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const types = await p.getMetaTypes();
                const translated = await this.translateMetaTypesResponse(req, environmentId, types);
                res.header('Vary', 'Accept-Language');
                res.json(translated);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        };
        this.routeManager.register({
            method: 'GET',
            path: metaPath,
            handler: listMetaTypes,
            metadata: {
                summary: 'List all metadata types',
                tags: ['metadata'],
            },
        });

        // GET /meta/types — REGISTERED BEFORE `/meta/:type`, and that is
        // the entire fix (#7526).
        //
        // The branch existed in the dispatcher and the row existed in the
        // ledger; the REST mount is a THIRD place and nobody wrote it here.
        // So `/meta/types` fell into the `:type` catch-all below and
        // answered `{"type":"types","items":[]}` — byte-shaped like
        // `/meta/zzz_not_a_type`, a 200 no client can tell from "that type
        // is empty". Hono is first-match-wins (MEASURED, not assumed —
        // `plugin-hono-server`'s `mounted-route-introspection.test.ts`
        // registers a literal and a `:param` sibling in both orders and
        // pins that the later one never runs), so moving this below
        // `/meta/:type` silently re-breaks it — the same shape that already
        // put `diagnostics` / `_drafts` / `_migrate-stored` above it. The
        // order is pinned by `meta-route-registration-order.test.ts`.
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/types`,
            handler: listMetaTypes,
            metadata: {
                summary: 'List all metadata types (explicit `/types` spelling)',
                tags: ['metadata'],
            },
        });
    }

    // GET /meta/diagnostics - Cross-type spec-validation sweep
    //
    // Returns every metadata entry that fails its registered Zod
    // schema, scoped to the environment (and optionally org /
    // package) of the request. Powers the Studio governance
    // dashboard and `os doctor`-style CLI checks.
    //
    // Registered BEFORE `/meta/:type` so the `diagnostics` segment
    // is not captured as a `:type` parameter.
    //
    // [#15542] First of the three WHOLE-STORE operations, and they share
    // one switch of their own — `metadata.endpoints.maintenance`. They
    // used to ride `endpoints.items`, whose declared meaning is the
    // per-type list, so closing a listing read silently took this sweep,
    // `/_drafts` and the `POST /_migrate-stored` write door with it.
    if (metadata.endpoints.maintenance !== false) {
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/diagnostics`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (typeof (p as any).getMetaDiagnostics !== 'function') {
                        res.status(501).json({
                            error: { code: 'NOT_IMPLEMENTED', message: 'protocol.getMetaDiagnostics() is not available in this kernel' },
                        });
                        return;
                    }
                    // [#6877] All three narrow the diagnostics query to ONE
                    // value each; the `as string` casts are exactly the
                    // laundering that kept `tsc` silent about the array arm.
                    if (refuseRepeatedQueryParams(req, res, ['severity', 'type', 'package'])) return;
                    const severityParam = (req.query?.severity as string | undefined) ?? 'error';
                    const severity = severityParam === 'warning' ? 'warning' : 'error';
                    const diagnosticsType = (req.query?.type as string | undefined) || undefined;
                    // [ADR-0131 D6] No organization: the sweep reads each
                    // type environment → code, the partition every `/meta`
                    // write now lands in. A legacy organization-scoped row
                    // is not swept; its promotion is ADR-0131 C7's.
                    const result = await (p as any).getMetaDiagnostics({
                        type: diagnosticsType,
                        severity,
                        // [#22188] The list's reading ({@link metaItemPackageBinding}):
                        // each swept type is a list read, so `all` names no package.
                        packageId: metaItemPackageBinding(req.query?.package),
                    });
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'List metadata entries that fail spec validation',
                tags: ['metadata'],
            },
        });
    }

    // GET /meta/_drafts - Pending DRAFT items (ADR-0033)
    //
    // Surfaces draft-state metadata that the active-only `/meta/:type`
    // list hides, so the console can show a "pending changes" view and
    // draft-aware package contents (a just-built app package no longer
    // looks empty). Optionally narrowed by `?packageId=` and/or `?type=`.
    //
    // Registered BEFORE `/meta/:type` so the `_drafts` segment is not
    // captured as a `:type` parameter.
    //
    // [#15542] Whole-store operation — `metadata.endpoints.maintenance`.
    if (metadata.endpoints.maintenance !== false) {
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/_drafts`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [ADR-0106 D5(4) / #6599] `_drafts` is an AUTHORING
                    // surface — the console's pending-changes view and
                    // draft-aware package reads — not a general read. A
                    // pending object draft carries its full `fields` map, so
                    // serving it unfiltered leaks every hidden field's
                    // label, type, options, formula and `requiredPermissions`
                    // to any authenticated caller, which is the disclosure
                    // ADR-0106 closes one route over. The other `/meta`
                    // exits MASK per field; this one GATES per caller, on the
                    // SAME `systemPermissions` judgement D4 uses for its
                    // read exemption (`isObjectSchemaMaskExempt`) — a caller
                    // who could not see a field on `/meta/object` has no
                    // authoring reason to see the draft that carries it. The
                    // gate is intentionally independent of the D8 field-mask
                    // escape hatch: opting out of per-field masking is not
                    // consent to expose pending drafts to non-authors.
                    //
                    // Gate FIRST — before resolving the protocol — so an
                    // unauthorized caller cannot use the 501-vs-200 answer to
                    // probe which kernels support drafts (same posture as
                    // `_migrate-stored` below).
                    //
                    // [#20338] Asked through {@link mayReadPendingDrafts},
                    // the one question every draft door in this file asks.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                    if (!mayReadPendingDrafts(ctx)) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: 'Reading pending metadata drafts requires an authoring capability (studio.access, setup.access or manage_metadata).',
                            },
                        });
                        return;
                    }
                    const p = await this.resolveProtocol(environmentId, req);
                    if (typeof (p as any).listDrafts !== 'function') {
                        res.status(501).json({
                            error: { code: 'NOT_IMPLEMENTED', message: 'protocol.listDrafts() is not available in this kernel' },
                        });
                        return;
                    }
                    // [#6877] Both narrow the draft list to one package /
                    // one type; an array reached `listDrafts` untouched.
                    // [#23214] The list lives beside the shared decision, so the
                    // runtime dispatcher's twin refuses the same names.
                    if (refuseRepeatedQueryParams(req, res, metaReadGate.META_QUERY_ARITY_DOORS.drafts)) return;
                    // [ADR-0131 D6] No organization: a draft is saved
                    // environment-wide, so the list reads the environment
                    // partition, symmetric with the save door. A legacy
                    // organization-scoped draft is not listed; its
                    // promotion is ADR-0131 C7's.
                    const result = await (p as any).listDrafts({
                        packageId: (req.query?.packageId as string | undefined) || undefined,
                        type: (req.query?.type as string | undefined) || undefined,
                    });
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'List pending draft metadata items',
                tags: ['metadata'],
            },
        });
    }

    // POST /meta/_migrate-stored — rewrite stored sys_metadata rows into
    // today's canonical shape (ADR-0087; #4327 / #4454 / #4498).
    //
    // The server-side form of `os migrate meta --stored`. The CLI form
    // needs shell access to the deployment's database, which a hosted
    // operator does not have — so without this route the stored-metadata
    // chain has no finish line on a managed deployment, only the per-read
    // conversion that runs forever. Flow rows are covered here for free:
    // `migrateStoredMetadata` resolves the automation engine from the
    // services registry (#4498), and a server always has a live one.
    //
    // Registered BEFORE `/meta/:type` so the leading-underscore segment is
    // not captured as a `:type` parameter (same reason as `_drafts`).
    //
    // [#15542] Whole-store operation — `metadata.endpoints.maintenance`.
    // This is the WRITE door the card was filed about: it used to be
    // unmounted by `endpoints.items: false`, a switch declared as "list
    // items of type".
    if (metadata.endpoints.maintenance !== false) {
        this.routeManager.register({
            method: 'POST',
            path: `${metaPath}/_migrate-stored`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // Gate FIRST — before resolving the protocol — so an
                    // unauthorized caller cannot use the 501 vs 200 answer
                    // to probe which kernels can be migrated.
                    //
                    // This rewrites every eligible row in the deployment,
                    // so unlike the single-item `PUT /meta/:type/:name` it
                    // demands an explicit capability rather than only a
                    // session. `manage_metadata` is ADR-0066 D1's authoring
                    // capability, and a canonicalization rewrite is
                    // authoring; `isSystem` bypasses, matching every other
                    // capability gate on the platform.
                    //
                    // [#12702] Deliberately NOT `metaWriteCapabilityVerdict`:
                    // an install-wide stored-metadata rewrite is env-wide by
                    // definition, so `manage_org_presentation`'s "org-scoped
                    // to the caller's own active organization" condition can
                    // never hold here. `manage_metadata`-only, unchanged —
                    // do not copy the item doors' acceptance in.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                    const held = new Set<string>(
                        Array.isArray(ctx?.systemPermissions) ? ctx!.systemPermissions : [],
                    );
                    if (!ctx?.isSystem && !held.has('manage_metadata')) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: 'Rewriting stored metadata requires the `manage_metadata` capability.',
                            },
                        });
                        return;
                    }
                    // [ADR-0131 D12 items 7–8] The walled refusal, after the
                    // capability gate and before the protocol is resolved or
                    // a row is read: this rewrites every stored row of the
                    // environment's metadata, which under `isolated` /
                    // `group` is the platform operator's (ruling A on
                    // #23231). A preview is refused too: it is the same
                    // install-wide pass, without the write. Inert under
                    // `single`. See {@link walledCatalogRefusal}.
                    {
                        const walled = await this.walledCatalogRefusal('sys_metadata', ctx, environmentId, req);
                        if (!walled.allowed) {
                            res.status(403).json({
                                error: {
                                    code: 'FORBIDDEN',
                                    message: walled.message,
                                },
                            });
                            return;
                        }
                    }
                    const p = await this.resolveProtocol(environmentId, req);
                    if (typeof (p as any).migrateStoredMetadata !== 'function') {
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'protocol.migrateStoredMetadata() is not available in this kernel',
                            },
                        });
                        return;
                    }
                    const rawTypes = (req.body as any)?.types;
                    const types = Array.isArray(rawTypes)
                        ? rawTypes.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
                        : [];
                    // Preview by default — `apply` must be explicitly true,
                    // the same posture the CLI takes. A caller who sends an
                    // empty body gets a report and no writes.
                    // Attributed to the caller: this writes history rows,
                    // and "who ran the migration" is the question they
                    // exist to answer. [#23068] By user id alone — the
                    // identity this request was authorized as, read by the
                    // producer every `/meta` write door shares — or by
                    // nobody. It lands in `recorded_by` / `updated_by`,
                    // `lookup('sys_user')` columns, so ⛔ never the route's
                    // name: the pass records its origin on `source`.
                    const actor = await this.resolveMetaWriteActor(environmentId, req);
                    const report = await (p as any).migrateStoredMetadata({
                        apply: (req.body as any)?.apply === true,
                        ...(types.length > 0 ? { types } : {}),
                        ...(actor ? { actor } : {}),
                    });
                    res.json(report);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Rewrite stored metadata rows into the canonical protocol shape',
                tags: ['metadata'],
            },
        });
    }

    // GET /meta/:type - List items of a type
    //
    // [#15542] The whole of `metadata.endpoints.items` — this one mount,
    // and nothing else, which is what its `describe()` has always said.
    if (metadata.endpoints.items !== false) {
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/:type`,
            handler: async (req: any, res: any) => {
                try {
                    // [#6877] Five single-valued parameters on this list
                    // route, declared together at the top so the gate cannot
                    // be missed by whichever branch reads its parameter
                    // several hundred lines down: `?object=` (the view
                    // switcher's `String(req.query.object)`, which turned
                    // `['a','b']` into the object name `'a,b'` — a name no
                    // view has, so the switcher silently emptied) and
                    // `?include=` (repeated, it stopped equalling
                    // `'content'`, so a caller who asked for doc bodies got
                    // the slimmed list back with a 200).
                    //
                    // [#7566] `?id=` joined them when the app branch below
                    // started honouring it. It is declared HERE, with the
                    // rest, rather than beside the filter that reads it, for
                    // the reason this block exists: a filter that arrives as
                    // `['crm','account']` and is compared against one app
                    // name matches nothing, and an empty app list is exactly
                    // the plausible-looking wrong answer #7566 was filed
                    // against. Refused, not resolved — see
                    // `query-multiplicity.ts` for why picking one of two
                    // conflicting intents is worse than a 400.
                    // [#23214] The list lives beside the shared decision, so the
                    // runtime dispatcher's twin refuses the same names.
                    if (refuseRepeatedQueryParams(req, res, metaReadGate.META_QUERY_ARITY_DOORS.list)) return;
                    // [#22188] Read through {@link metaItemPackageBinding}:
                    // `all`, this list's "show everything" scope, names no package.
                    const packageId = metaItemPackageBinding(req.query?.package);
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    // [#9488] …and BEFORE any listing work: a `:type` that
                    // names no metadata type is refused here rather than
                    // served as a real-but-empty collection, which the write
                    // door has refused since #8421. See
                    // {@link refuseUnknownMetaListType} for the union it
                    // consults, why the static verdict alone is the wrong
                    // rule on a READ door, and why it throws instead of
                    // building a body.
                    await this.refuseUnknownMetaListType(p, req.params?.type);
                    // [#20338] The caller, for the draft-preview admission
                    // below. The list names no organization (ADR-0131 D6):
                    // it reads environment → code.
                    const listCtx = await this.resolveExecCtx(environmentId, req)
                        .catch(rethrowAuthzStoreUnavailable);
                    // ADR-0033/0037 draft-overlay preview: `?preview=draft`
                    // overlays pending drafts on the active list, exactly as
                    // the runtime dispatcher's /metadata/:type route does —
                    // the console's draft preview (Live Canvas) reads THIS
                    // route, so dropping the flag here silently renders the
                    // published-only world.
                    //
                    // [#20338] …for a caller who may read drafts. Anyone
                    // else is answered the list as if the switch were
                    // absent — {@link mayReadPendingDrafts} says why that,
                    // and not a refusal. Declared WITH its admission so no
                    // later branch of this handler can read the switch past it.
                    const previewDrafts = typeof req.query?.preview === 'string'
                        && req.query.preview.toLowerCase() === 'draft'
                        && mayReadPendingDrafts(listCtx);
                    // [commit 2a29caa53] Typed against the spec request shape plus the
                    // transport-level `environmentId` — the `as any` this
                    // literal used to carry is retired now that the spec
                    // declares `previewDrafts`.
                    const listRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                        type: req.params.type,
                        packageId,
                        ...(previewDrafts ? { previewDrafts: true } : {}),
                        ...(environmentId ? { environmentId } : {}),
                    };
                    const items = await p.getMetaItems(listRequest);

                    // [#20320] Everything this route does to the list after
                    // the read — the #5224 `api` served-set face, THE
                    // per-caller list gate (#20237), `?id=` for apps (#7566),
                    // `?object=` for views, the ADR-0046 doc locale collapse
                    // and content slim, the ADR-0106 object mask and the
                    // translation step — is ONE chain,
                    // `createMetaListAnswer` in `./meta-item-read-gate.ts`,
                    // which the runtime dispatcher's `/meta` list branch
                    // calls too. Its docblock carries each step's rule and
                    // their order; ⛔ a list step is added there, never here
                    // (`meta-list-projection-parity.test.ts` in
                    // `@objectstack/runtime` derives its census from this
                    // handler and fails on one added here). `getMetaItems`
                    // answers a bare array or the `{ type, items }` envelope;
                    // the chain answers the same shape.
                    //
                    // `previewDrafts` is handed in ADMITTED — the one
                    // declaration above — and the chain never re-reads it.
                    const answer = await metaReadGate.createMetaListAnswer(
                        this.metaListAnswerSources(environmentId, req, p),
                        { metaType: this.metaTypeSingular(req.params.type), query: req.query, previewDrafts },
                    )(items);
                    if (!answer.ok) {
                        sendFieldVisibilityFault(res, answer.object);
                        return;
                    }
                    // [ADR-0106 D6 tier 2] The chain's cache posture — an
                    // undetermined field visibility serves the list
                    // `private, no-store`, exactly as this route always has.
                    if (answer.cacheControl) res.header('Cache-Control', answer.cacheControl);
                    res.header('Vary', 'Accept-Language');
                    res.json(answer.data);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'List metadata items of a type',
                tags: ['metadata'],
            },
        });
    }
}
