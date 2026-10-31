// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 13b] The `/meta` per-item reads of `RestServer` — the reverse
 * reference sweep (`GET {metaPath}/:type/:name/references`), the layered read
 * (`GET {metaPath}/:type/:name/layers`), the book tree
 * (`GET {metaPath}/book/:name/tree`) and the item read itself
 * (`GET {metaPath}/:type/:name`) — moved out of `rest-server.ts`. They were the
 * fourth group of `RestServer#registerMetadataEndpointsInner`'s body, ONE `if`
 * statement on the per-item switch, and that method now calls the function below
 * at its old position, so the `/meta` routes still register in one order: after
 * the per-type list, and with `/references` and `/layers` still above the item
 * read they share a prefix with.
 *
 * A MOVE, not a redesign. The function below is that statement as it stood,
 * re-indented one level, its switch (`metadata.endpoints.item`) included: the
 * same four routes per base, by the same handlers, answering the same bodies.
 * The rest of the per-item face — the item writes and the history family —
 * stays in the inner method and still registers behind the same switch, which
 * that method spells as a call to its own per-item registrar. The moved
 * comments are moved text too: where one says "this block's closing brace" or
 * "below", it still describes the inner method's order, in which this statement
 * sits immediately above those writes.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 13a set for `/meta` (`meta-collection-routes.ts`' header
 * carries the full reasoning, and `data-action-routes.ts`' the shape it came
 * from). The class keeps the private method, and the method keeps its head; at
 * the position of the moved statement it builds one host literal
 * ({@link MetaItemReadRouteHost}) and hands it, with the head's one
 * {@link MetaRouteScope}, to the function below as its `this` and its argument.
 * A method is handed over as a closure that calls it on the server at call
 * time, so a test double or spy set on the server is still the one the body
 * reaches.
 *
 * Each member was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE, and the literal that carries it is built
 *   INSIDE `registerMetadataEndpointsInner`, at the position of the statement
 *   it replaces. That placement is the load-bearing part.
 *   `registerMetadataEndpoints`, the umbrella, swaps the server's route
 *   manager for a wrapping registrar for exactly the duration of the inner
 *   call and restores it in a `finally`; the wrapper is what puts every
 *   `/meta` route behind the anonymous-deny gate (#3963) and the type-level
 *   read and write admissions (#21087, #21124). The body reads the manager
 *   only for its four `register` calls, all of which run during that call, and
 *   nothing inside the inner method reassigns it, so the value captured there
 *   is the object every one of those reads returned. ⛔ A host built anywhere
 *   else — in `registerRoutes`, in the constructor, cached on the instance, or
 *   in the umbrella above the swap — captures the REAL manager, and these four
 *   routes would mount outside all three gates.
 * - `STORED_VERSION_DOOR_POLICY` goes BY VALUE too, and it is the first
 *   static FIELD a host carries. It is the class's `private static readonly`
 *   field, assigned once, when the class is evaluated, from the constant of
 *   the same name in `meta-item-read-gate.ts`, and never reassigned, so the
 *   value the literal captures is the object every read of it returned.
 * - No member goes as a getter, because the body reads no instance FIELD at
 *   request time. The protocol, the caller, the masker, the locale, the i18n
 *   service, the read gate, the answer sources and the translation are each
 *   resolved per request by a METHOD of the class, and every method goes as a
 *   closure. No provider field is read.
 *
 * The inner method's head declares the bindings every `/meta` group reads and
 * hands them over as ONE parameter, {@link MetaRouteScope}, built once there;
 * the function destructures the three its body reads (`metadata` for the
 * switch and the cache flag, `metaPath`, `isScoped`). The host stays class
 * members only.
 *
 * ## The four tokens that are not byte-identical
 *
 * The body reached three of the class's PRIVATE STATICS as `RestServer.…`: the
 * type normalizer `metaTypeSingular` (once in the layered read, once in the
 * item read), and, in the item read's stored-version branch, the field
 * `STORED_VERSION_DOOR_POLICY` and the refusal emitter `sendMetaReadRefusal`.
 * A private static is reachable by name only inside the class, so that
 * spelling does not compile here, and making a member public, or moving it,
 * changes the published declaration the move must keep byte-identical. So
 * each is reached the way every other class member this body reads is
 * reached: through the host, as `this.…` — the two methods as closures on
 * {@link MetaItemReadRouteHost} that call the static with the same
 * arguments, the field by value. Neither method reads anything but its
 * arguments, so the receiver is the whole difference, as it was for slice
 * 13a's `metaTypeSingular` and slice 11's `translateOptionsFor`. Those four
 * receivers are the only tokens of the body that changed.
 *
 * ## Module-level names
 *
 * The two module-level helpers only this body called moved with it, verbatim,
 * and sit at the end of this file: the reference sweep's declared-refusal
 * re-dresser and the intake reasons' ETag dimension. [#28044] A third, the
 * switched-off actions' ETag dimension, was born here. Five names declared in
 * `rest-server.ts` stay there and are imported from it: the reference sweep's
 * closed query set (its tests import it from there), the package binding and
 * the draft admission (both already exported), and the absence answer and the
 * intake-reason stamp, which the class reads too and which gained `export`
 * there rather than a second home. Every one of them is read only at request
 * time, so the two modules importing each other cannot see one uninitialised.
 * The imports only this body read left `rest-server.ts` with it; every other
 * name is imported from the module `rest-server.ts` imports it from. The
 * package entry re-exports nothing from here, and the published surface does
 * not move.
 */

import { rethrowAuthzStoreUnavailable } from '@objectstack/core';
// [ADR-0106 / #3682] Metadata-plane FLS — the item read's half of it; see
// `rest-server.ts`' import of the same module for why the normalizer lives in
// `@objectstack/metadata-core`.
import {
    ObjectSchemaMaskEvaluationError,
    foldVisibilityFingerprintIntoEtag,
    normalizeIfNoneMatch,
    relateObjectSchemaMaskPosture,
    resolveObjectSchemaRuntimeView,
    type ObjectSchemaMaskPosture,
    // [#21476] The ADR-0106 fingerprint the admin read folds the reason into
    // — and [#22639] the list views the read gate withheld.
    objectFieldVisibilityFingerprint,
} from '@objectstack/metadata-core';
import type { GetMetaItemCachedRequest, GetMetaItemRequest, GetMetaItemsRequest } from '@objectstack/spec/api';
import {
    boundedDeclaredRefusalMessage,
    declaredHttpStatus,
    handleRouteError,
    sendDeclaredFault,
    sendFieldVisibilityFault,
    thrownAnswerIsBareNotFound,
} from './error-response.js';
import type { MetaRouteScope, TransportScopedMetaRequest } from './meta-collection-routes.js';
import * as metaReadGate from './meta-item-read-gate.js';
import { metaMemberSelector, type MetaReadGatePolicy } from './meta-item-read-gate.js';
import { measureMetaRead } from './meta-read-timing.js';
import { sendMetaRepresentation } from './meta-representation-validator.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import {
    META_ITEM_REFERENCES_PARAMS,
    mayReadPendingDrafts,
    metaItemPackageBinding,
    sendMetaItemAbsent,
    stampAnonymousFormIntakeWarnings,
    type RestServer,
} from './rest-server.js';

/**
 * The `RestServer` members {@link registerMetaItemReadRoutes} reads — every
 * one of them, and no other, in the order the body first reads them. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member the
 * class does not have is a compile error. The three statics are typed as the
 * statics they are. The module header says why `routeManager` is captured
 * inside the swap and by value, why `STORED_VERSION_DOOR_POLICY` goes by value,
 * why the body reaches the statics through the host, and why none of the
 * members is a getter.
 */
export interface MetaItemReadRouteHost {
    readonly routeManager: RestServer['routeManager'];
    resolveProtocol: RestServer['resolveProtocol'];
    metaTypeSingular: (typeof RestServer)['metaTypeSingular'];
    resolveObjectMasker: RestServer['resolveObjectMasker'];
    serveMetaItemLayered: RestServer['serveMetaItemLayered'];
    metaReadAudienceSources: RestServer['metaReadAudienceSources'];
    extractLocale: RestServer['extractLocale'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    resolveI18nService: RestServer['resolveI18nService'];
    metaItemReadGate: RestServer['metaItemReadGate'];
    maskObjectDocument: RestServer['maskObjectDocument'];
    anonymousFormIntakeWarnings: RestServer['anonymousFormIntakeWarnings'];
    translateMetaEnvelope: RestServer['translateMetaEnvelope'];
    readonly STORED_VERSION_DOOR_POLICY: (typeof RestServer)['STORED_VERSION_DOOR_POLICY'];
    metaItemAnswerSources: RestServer['metaItemAnswerSources'];
    sendMetaReadRefusal: (typeof RestServer)['sendMetaReadRefusal'];
}

/**
 * Register the `/meta` per-item reads — the reference sweep, the layered read,
 * the book tree and the item read, the fourth group of
 * `RestServer#registerMetadataEndpointsInner`' body, called by that method at
 * its position in its registration order, with the server's members as `this`
 * and the method's head bindings as `scope`. The method's own docblock, which
 * the published declaration carries, names the families, their switches and
 * the ordering facts the routes below keep.
 */
export function registerMetaItemReadRoutes(this: MetaItemReadRouteHost, scope: MetaRouteScope): void {
    const { metadata, metaPath, isScoped } = scope;

    // GET /meta/:type/:name - Get specific item
    //
    // [#15542 / #15854] The first four members of the per-item face. The
    // rest of it — `PUT`, `DELETE` and the history family — is registered
    // below this block's closing brace and goes through
    // {@link registerPerItemRoute}, which carries the SAME switch. ⛔ The
    // brace is not the radius: read the pin table in
    // `rest-config-mount-table.pin.test.ts` for what `item` gates.
    if (metadata.endpoints.item !== false) {
        // Phase 3a-references: /meta/:type/:name/references must be
        // registered BEFORE /meta/:type/:name so the more-specific
        // path wins under any first-match router strategy.
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/:type/:name/references`,
            handler: async (req: any, res: any) => {
                try {
                    // [#23072] Recognition first, over the measured closed
                    // set — empty: the sweep reads no query parameter.
                    if (refuseUnknownQueryParams(req, res, META_ITEM_REFERENCES_PARAMS)) return;
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (typeof (p as any).findReferencesToMeta !== 'function') {
                        // [#9326 / ADR-0110 D3] A MISS and a FAULT are
                        // different facts, and this branch is the second
                        // one: the resolved protocol cannot compute the
                        // reference graph AT ALL, so the question was never
                        // asked. Answering `{ references: [] }` reported it
                        // as the first — "nothing depends on this item" —
                        // and the admin "Used by" panel renders that empty
                        // case as "Nothing in the metadata graph points at
                        // this item. Safe to delete.", shown to an operator
                        // about to delete something.
                        //
                        // Refusing HERE rather than asserting at assembly is
                        // deliberate. `findReferencesToMeta` is not a member
                        // of `RestProtocol` (= `DataProtocol &
                        // MetadataProtocol`) — it is an ADR-0076 D9
                        // server-only extension, which is why it is reached
                        // through a runtime cast at all. So a host that
                        // implements the DECLARED contract exactly is a
                        // CONFORMING deployment that lands here with no type
                        // error, and a boot-time assertion would promote an
                        // undeclared optional extension into a required one
                        // — a `packages/spec` contract decision, not a
                        // route one. What the route owes is that an
                        // unanswerable question comes back unanswered.
                        //
                        // Envelope per #7035: the ADR-0112 NESTED
                        // `{ error: { code, message } }` that the sibling
                        // `/meta` 501 refusals converged on — never the
                        // bare-string or sibling-`code` dialects, which make
                        // `body.error.code` read `undefined`.
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'protocol.findReferencesToMeta() is not available in this kernel',
                            },
                        });
                        return;
                    }
                    // [#13753 · ADR-0131 D6] The sweep reads the sources
                    // environment → code, the world the `/meta` doors serve:
                    // the per-organization overlay axis is retired, so no
                    // organization is stated. A legacy organization-scoped
                    // source row is served by no door until ADR-0131 C7
                    // promotes it, and that ceremony re-judges what it
                    // carries; it is not swept here.
                    // [#15685] The protocol's OWN refusal is re-answered in
                    // the nested envelope the branch above already uses —
                    // see {@link notImplementedRefusalAnswer} for why the
                    // repair is here and how narrow it is. The catch is
                    // scoped to the protocol call ALONE, so what this arm
                    // can re-dress is mechanically the set of things
                    // `findReferencesToMeta` raised: neither
                    // `resolveProtocol` nor the `resolveExecCtx` seam above
                    // can reach it, whatever they declare.
                    let result: unknown;
                    try {
                        result = await (p as any).findReferencesToMeta({
                            type: req.params.type,
                            name: req.params.name,
                            ...(environmentId ? { environmentId } : {}),
                        });
                    } catch (raised: any) {
                        const refusal = notImplementedRefusalAnswer(raised);
                        // Anything else is the outage it always was — the
                        // 503 `getMetaItems` raises for a `sys_metadata`
                        // failure (#8896) still propagates to the terminal
                        // below, message-withheld and logged, unchanged.
                        if (refusal === undefined) throw raised;
                        res.status(refusal.status).json(refusal.body);
                        return;
                    }
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'List metadata items that reference this item',
                tags: ['metadata'],
            },
        });

        // [#5882] GET /meta/:type/:name/layers — the three-layer diagnostic
        // projection as its OWN resource. Registered BEFORE
        // /meta/:type/:name for the same first-match reason as
        // /references above. [commit 7986d973f] It also used to have to precede the
        // compound `/:type/:section/:name`, which would otherwise capture
        // this path with section=<name>, name="layers"; that catch-all is
        // retired, so only the /references-style reason remains.
        //
        // This path exists because the projection used to be reachable only
        // as `GET /meta/:type/:name?layers=true` — the same route answering
        // a SECOND, undeclared body shape depending on a query flag, while
        // `packages/spec` declared one `responseSchema` for it. The ruled
        // fix (maintainer, 2026-08-06) was one path per response shape,
        // deliberately NOT teaching the route declaration to express
        // "two shapes chosen by a flag": that would add a primitive every
        // future tool has to understand, and conditional response selection
        // is exactly where codegen and AI-written clients go wrong.
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/:type/:name/layers`,
            handler: async (req: any, res: any) => {
                try {
                    // [#23072] Recognition first, over the measured closed
                    // set; `serveMetaItemLayered` keeps the multiplicity
                    // rule it shares with the deprecated `?layers=` spelling.
                    // [#26699] Recognition AND arity are now the one decision
                    // both transports ask (`metaItemQueryRefusal`, ruling
                    // 6138588561), as on the item read: the set gained the
                    // bundle member selector, read once, which the
                    // multiplicity rule below never named. Answered in the
                    // nested body `refuseUnknownQueryParams` wrote here.
                    const queryRefusal = metaReadGate.metaItemQueryRefusal('layers', req.query);
                    if (queryRefusal) {
                        res.status(queryRefusal.status).json({
                            error: { code: queryRefusal.code, message: queryRefusal.message },
                        });
                        return;
                    }
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    // [ADR-0106 D2/D5] The dedicated path is its own
                    // schema-serving outlet — it resolves the caller's
                    // field-visibility posture exactly like the plain meta
                    // read does, with the NORMALIZED type (#3984 / commit 83a3b1f2e).
                    const layeredMetaType = this.metaTypeSingular(req.params.type);
                    let maskPosture: ObjectSchemaMaskPosture;
                    try {
                        maskPosture = await (await this.resolveObjectMasker(environmentId, req, layeredMetaType))(req.params.name);
                    } catch (maskError: any) {
                        if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                            sendFieldVisibilityFault(res, req.params.name);
                            return;
                        }
                        throw maskError;
                    }
                    if (typeof (p as any).getMetaItemLayered !== 'function') {
                        // A dedicated path cannot fall through to the plain
                        // read the way the `?layers=` flag did — answering
                        // the merged `{ type, name, item }` envelope here
                        // would be answering a different resource with a
                        // shape this path never declares.
                        res.status(501).json({
                            error: 'Layered metadata view not supported by protocol implementation',
                            code: 'NOT_IMPLEMENTED',
                        });
                        return;
                    }
                    await this.serveMetaItemLayered(req, res, environmentId, p, maskPosture);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Get a metadata item as its three layers (code / overlay / effective)',
                tags: ['metadata'],
            },
        });

        // ADR-0046 §6 — GET /meta/book/:name/tree
        // Resolve a book spine against the docs that exist *now* into a
        // rendered tree (membership is DERIVED, never stored — §6.2.1). An
        // unknown name is treated as a package id and resolved against the
        // implicit per-package book (§6.4). Anonymous requests only see a
        // book whose `audience` is `public` (§6.7 read-layer gating).
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/book/:name/tree`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const prot = await this.resolveProtocol(environmentId, req);
                    // [#6877] One package scopes the book lookup. [#23214] The
                    // list lives beside the shared decision, as the list door's.
                    if (refuseRepeatedQueryParams(req, res, metaReadGate.META_QUERY_ARITY_DOORS['book-tree'])) return;
                    // [#22188] Read through {@link metaItemPackageBinding}: `all` names no package.
                    const packageId = metaItemPackageBinding(req.query?.package);
                    // [#20408] The route's whole answer is
                    // `createMetaBookTreeAnswer` in `./meta-item-read-gate.ts`
                    // — the book and doc reads, THE `DocsAudience` (#19790: one
                    // resolution, four doors), the §6.7 gate on the book's own
                    // audience, the doc locale collapse and the tree narrowed
                    // per caller — which the runtime dispatcher serves this
                    // route through too. ⛔ A step is added there, never here.
                    const answer = await metaReadGate.createMetaBookTreeAnswer(
                        {
                            ...this.metaReadAudienceSources(environmentId, req),
                            listTreeInput: (type, scopedPackageId) => {
                                const request: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                                    type,
                                    ...(scopedPackageId ? { packageId: scopedPackageId } : {}),
                                    ...(environmentId ? { environmentId } : {}),
                                };
                                return prot.getMetaItems(request);
                            },
                            requestLocale: (i18n) => this.extractLocale(req, i18n),
                            // [#26690] The book's own labels, from the bundle's `books` group.
                            resolveI18nService: () => this.resolveI18nService(environmentId, req),
                        },
                        { name: req.params.name, packageId },
                    );
                    if (!answer.ok) {
                        const { code, message, status } = answer.refusal;
                        sendDeclaredFault(res, { code, message, status });
                        return;
                    }
                    res.json(answer.tree);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Resolve a documentation book spine into its rendered tree (ADR-0046 §6)',
                tags: ['metadata'],
            },
        });

        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/:type/:name`,
            handler: async (req: any, res: any) => {
                try {
                    // [#6877] Declared at the top for the same reason #3984
                    // normalizes `:type` here: this handler reads its query
                    // parameters from four different branches hundreds of
                    // lines apart (`?layers=`, `?state=`, `?preview=`,
                    // `?package=`), and a per-branch gate is one a new branch
                    // inherits by accident rather than by construction.
                    // [#22877] …and RECOGNITION first, over the route's
                    // measured closed set (AGENTS.md route rule 5), which
                    // the bundle member selector joined.
                    // [#23072] All three of the route's query rules —
                    // recognition, arity and a member on the layered view —
                    // are ONE decision, `metaItemQueryRefusal` in
                    // `./meta-item-read-gate.ts`, which the runtime
                    // dispatcher's item read asks too (ruling 6138588561).
                    // The first two are answered here, in the nested body
                    // their gates always wrote; the third where the layered
                    // view is chosen, below. ⛔ A rule is added there, never
                    // here.
                    const queryRefusal = metaReadGate.metaItemQueryRefusal('item', req.query);
                    if (queryRefusal && queryRefusal.rule !== 'layered-member') {
                        res.status(queryRefusal.status).json({
                            error: { code: queryRefusal.code, message: queryRefusal.message },
                        });
                        return;
                    }
                    const memberSelector = metaMemberSelector(req.query);
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);

                    // [#3984 / commit 83a3b1f2e] Normalize the `:type` segment ONCE,
                    // here at the top, and let every gate below read THIS
                    // value. The route serves both spellings and Prime
                    // Directive #3 makes the plural one canonical
                    // (`/meta/books/:name`), so any gate comparing the raw
                    // param is a gate the canonical spelling walks past.
                    //
                    // #3984 ruled this shape for exactly that reason ("每个
                    // handler 顶部归一一次,后续所有闸门都用归一后的值"), and
                    // commit 83a3b1f2e is why the ruling is written into the code
                    // rather than trusted to memory: eight days after
                    // #3984 landed, the cache-branch condition below still
                    // excluded `doc`/`book` by LITERAL comparison, so
                    // `GET /meta/books/:name` took the cached branch and
                    // the §6.7 audience gate — which lives in the uncached
                    // branch — never ran at all. Measured on the real
                    // server, one `{ permissionSet }`-gated book, one
                    // signed-in caller holding no set:
                    //
                    //     singular "book"  :: cachedCalls=0 status=[403]
                    //     plural   "books" :: cachedCalls=1 status=[]  ← full body served
                    //
                    // A new per-type gate added below inherits the
                    // normalization by default now; there is no raw param
                    // in scope for it to compare against by accident.
                    const metaType = this.metaTypeSingular(req.params.type);

                    // [ADR-0106 D2/D5] Resolve the caller's field-visibility
                    // posture ONCE, here, before any fetch — every exit
                    // below (layered, cached, uncached) projects through
                    // THIS value. Resolving per-branch is how an outlet gets
                    // forgotten; resolving before the fetch is what makes
                    // D3's `fetch → mask → send` ordering structural rather
                    // than a convention.
                    let maskPosture: ObjectSchemaMaskPosture;
                    try {
                        maskPosture = await (await this.resolveObjectMasker(environmentId, req, metaType))(req.params.name);
                    } catch (maskError: any) {
                        if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                            sendFieldVisibilityFault(res, req.params.name);
                            return;
                        }
                        throw maskError;
                    }

                    // Phase 3a-layered-get: opt-in 3-state view when client
                    // asks for `?layers=true` (or any non-empty value).
                    // Skips the cache path entirely — layered view is a
                    // diagnostic endpoint, not on the hot read path.
                    //
                    // [#5563 → #5882] DEPRECATED SPELLING. This flag makes one
                    // route answer a SECOND resource representation — three
                    // layers side by side (`code` / `overlay` / `effective`),
                    // where `effective` is what the plain read returns — while
                    // the route declares a single `responseSchema`. #5563
                    // converged the ordinary read and left this half open
                    // because collapsing the layers into
                    // `GetMetaItemResponseSchema`'s single `item` would delete
                    // the diagnostic outright.
                    //
                    // #5882 closed it the other way (maintainer ruling, 2026-08-06):
                    // the projection is now its own path,
                    // `GET /meta/:type/:name/layers`, declared by
                    // `GetMetaItemLayeredResponseSchema`. One path, one shape.
                    //
                    // This branch stays for a deprecation window so existing
                    // callers (Studio's metadata editor) are not broken by the
                    // move. It answers the IDENTICAL body — same helper, not a
                    // copy — and advertises the successor in the response
                    // headers, so a client can discover the migration without
                    // reading the changelog. Delete this branch (and the
                    // headers with it) once the callers have moved.
                    //
                    // [#20478] The flag's parse (`wantsMetaItemLayers`) and its
                    // headers (`metaItemLayersDeprecationHeaders`: RFC 9745
                    // `Deprecation` + RFC 8288 `Link` to the successor) are the
                    // ones the runtime dispatcher's item read asks too, so the
                    // deprecated spelling is one answer on both transports.
                    //
                    // [#20508] The `Link` names the path THIS request arrived
                    // on (`IHttpRequest.path`), read the way the dispatcher
                    // reads its request URL (`requestedItemPath`, runtime
                    // `domains/meta.ts`): parsed as a URL path, without its
                    // trailing slash. ⛔ Never `metaPath` — on the
                    // environment-scoped mount that is the route TEMPLATE, and
                    // the successor read `/environments/:environmentId/…/layers`,
                    // a path no client can request. The parse is what keeps the
                    // path a valid URI reference: the Hono adapter hands over a
                    // `decodeURI`'d path (`lead%20all` arrives as `lead all`),
                    // and the parse percent-encodes it again. A request with no
                    // path names no successor: `Deprecation` alone, as the
                    // helper prescribes for a transport that cannot say where
                    // it serves the item.
                    const wantLayered = metaReadGate.wantsMetaItemLayers(req.query);
                    // [#22877] The deprecated `?layers=` spelling reads no
                    // member, so a member named beside it is refused rather
                    // than answered with the canonical member's layers; a
                    // member's layers are `/layers?member=` (#26699).
                    // [#23072] The decision's
                    // third rule (`layered-member`), the only one that can
                    // still be pending here; thrown to `handleRouteError` as
                    // it always was.
                    if (queryRefusal) {
                        throw Object.assign(new Error(queryRefusal.message), {
                            code: queryRefusal.code,
                            status: queryRefusal.status,
                        });
                    }
                    if (wantLayered && typeof (p as any).getMetaItemLayered === 'function') {
                        const requestPath: unknown = req.path;
                        const deprecation = metaReadGate.metaItemLayersDeprecationHeaders(
                            typeof requestPath === 'string' && requestPath.startsWith('/')
                                ? new URL(`http://rest-server.invalid${requestPath}`).pathname.replace(/\/+$/, '') || undefined
                                : undefined,
                        );
                        for (const [header, value] of Object.entries(deprecation)) res.header(header, value);
                        await this.serveMetaItemLayered(req, res, environmentId, p, maskPosture);
                        return;
                    }

                    // Check if cached version is available.
                    // For `app` metadata we skip the cache path so the
                    // per-user RBAC filter below can apply without
                    // corrupting shared ETags across admin vs member
                    // viewers of the same app schema. Drafts also
                    // bypass cache: the cache is keyed on the
                    // published checksum and drafts are out-of-band.
                    const isAppType = metaType === 'app';
                    // [#20338] The caller, resolved ABOVE the two draft
                    // switches because each is admitted per caller.
                    // Memoised per request — not a new seam.
                    const readCtx = await this.resolveExecCtx(environmentId, req)
                        .catch(rethrowAuthzStoreUnavailable);
                    // [#20338] Both draft switches are declared WITH their
                    // admission ({@link mayReadPendingDrafts}). A caller who
                    // may not read drafts is answered this read as if
                    // neither switch were present — the published item,
                    // pruned as the plain read prunes it, or its absence —
                    // and no later branch re-reads `?state=` past the gate
                    // (the uncached arm used to parse it a second time).
                    const isDraftRead = typeof req.query?.state === 'string'
                        && req.query.state.toLowerCase() === 'draft'
                        && mayReadPendingDrafts(readCtx);
                    // ADR-0033/0037 — `?preview=draft` overlays a pending
                    // draft on the active item (draft wins, falls back to
                    // active). Must also bypass the cache: ETags are keyed
                    // on the published checksum, so a cached 304 would pin
                    // the preview to the stale published world.
                    const previewDrafts = typeof req.query?.preview === 'string'
                        && req.query.preview.toLowerCase() === 'draft'
                        && mayReadPendingDrafts(readCtx);
                    // ADR-0048 — a `?package=` read is package-scoped
                    // (prefer-local). The cached path keys ETags on
                    // type+name only and does NOT thread `packageId` into
                    // `getMetaItemCached`, so two installed packages shipping
                    // the same type/name would share one cache entry and the
                    // scope hint would be silently dropped. Bypass the cache
                    // when a package scope is requested so the disambiguating
                    // `getMetaItem(type, name, packageId)` path runs.
                    const packageScoped = typeof req.query?.package === 'string'
                        && req.query.package.length > 0;
                    // `doc` and `book` bypass the shared cache: their §6.7
                    // audience gate is per-caller, and a shared ETag would
                    // leak gated content across viewers.
                    //
                    // [commit 83a3b1f2e] That sentence was already here while the
                    // exclusion beneath it compared the RAW param against
                    // the literals `'doc'` / `'book'`, so the canonical
                    // plural spelling took the cached branch and shipped
                    // the gated body. The exclusion is not incidental
                    // tidying — it is the stated security invariant above,
                    // and it now reads the normalized `metaType`.
                    //
                    // The bypass exists only to make the per-caller gate in
                    // the uncached branch reachable ({@link metaItemReadGate},
                    // whose `book` / `doc` arm is the §6.7 gate). [#20156]
                    // A type that gate judges and this exclusion misses is
                    // served ungated from the cache: the census in
                    // `meta-alternate-door-read-gates.test.ts` drives this
                    // read with a cached protocol method present, so that
                    // miss reddens its plain-read row.
                    //
                    // [#5881] `dashboard` bypasses it too, and the reason is
                    // NOT the one above — worth writing down, because the
                    // obvious reading says a dashboard needn't bypass at all.
                    // Its ADR-0057 D10 widget gate (`filterDashboardForUser`,
                    // below) is per-DEPLOYMENT — it asks which optional kernel
                    // services are registered — never per-caller, so there is
                    // no cross-viewer leak to avoid. What rules out sharing
                    // the cached path is the validator itself: the ETag is
                    // `simpleHash(locale + JSON.stringify(item))` over the
                    // UNFILTERED document (metadata-protocol `getMetaItemCached`),
                    // so it cannot express the gate dimension at all, and
                    // `notModified` is decided inside the protocol before this
                    // layer could re-judge it. Gating the cached body would
                    // therefore ship a filtered body under a validator that
                    // identifies the unfiltered one.
                    //
                    // That mismatch is not academic, because the two have
                    // different lifetimes. Within one boot the registered-service
                    // set is fixed (`Kernel.use()` throws once bootstrap has
                    // started, and no deregistration API exists), so the gate
                    // verdict is stable per process — but `Cache-Control:
                    // private, no-cache` means the client STORES the body and
                    // revalidates, and that stored body outlives the process.
                    // A redeploy that turns the optional service off does not
                    // change the document, so the ETag is unchanged, every
                    // revalidation answers 304, and the stale unfiltered body
                    // stands: the dead tile D10 exists to prevent, now cached
                    // indefinitely. Bypassing costs nothing to weigh against
                    // that — `getMetaItemCached` delegates to `getMetaItem`,
                    // so the server does identical work either way and only
                    // the 304's saved body bytes are given up.
                    //
                    // Compared on the NORMALIZED type, like every other
                    // exclusion in this condition (`/meta/dashboards/x` is
                    // the canonical plural spelling under Prime Directive
                    // #3, and an exclusion it could be spelled around would
                    // not be an exclusion). The `doc` / `book` literals
                    // that stood at the end of this condition had exactly
                    // that hole; commit 83a3b1f2e closed it.
                    const isDashboardType = metaType === 'dashboard';
                    // ADR-0046 §6.7 — the two audience-gated types, excluded
                    // from the cache so {@link metaItemReadGate} judges them.
                    const isAudienceGatedType = metaType === 'book' || metaType === 'doc';
                    // [#22877] A member-addressed read bypasses the cache
                    // too: the cached read takes no member and keys its
                    // validator on type and name, so it can only answer the
                    // canonical member.
                    const memberScoped = memberSelector.member !== undefined;
                    if (metadata.enableCache && p.getMetaItemCached && !isAppType && !isDashboardType && !isDraftRead && !previewDrafts && !packageScoped && !memberScoped && !isAudienceGatedType) {
                        // [ADR-0106 D3] When a projection applies, the
                        // protocol is NOT allowed to judge the conditional
                        // request: `getMetaItemCached` hashes the UNFILTERED
                        // document, so a `304` decided there would pin this
                        // caller to a body no mask ever touched — the same
                        // validator-vs-served-body mismatch #5881 recorded
                        // for the dashboard gate. The comparison moves below,
                        // against the fingerprinted ETag, which is the one
                        // that identifies what we are actually sending.
                        // [#22250] A D4-exempt caller's posture carrying
                        // `runtime` is one: the definition is served whole,
                        // but the `sortability` beside it follows that
                        // caller's own field permission, which the
                        // protocol's validator does not hash either.
                        const maskApplies = maskPosture.kind !== 'passthrough' || maskPosture.runtime !== undefined;
                        // [#21476] Same move for a `view`: its body can carry
                        // the public-form intake reason, which derives from
                        // the posture and the bound object, and the
                        // protocol's validator hashes neither. With no reason
                        // the folded ETag is byte-identical, so a view's
                        // `304` answers exactly as before.
                        const intakeFolds = metaType === 'view';
                        // [#22639] And for the two types this arm serves that
                        // the per-caller read gate judges — a list view (one
                        // refused whole, a container pruned) and an object
                        // (its own `listViews` pruned): the body varies per
                        // caller by what the gate withheld, which the
                        // protocol's validator does not hash. Nothing
                        // withheld folds nothing, so the `304` answers as
                        // before.
                        const audienceFolds = metaType === 'view' || metaType === 'object';
                        const cacheRequest = {
                            ifNoneMatch: (maskApplies || intakeFolds || audienceFolds) ? undefined : (req.headers['if-none-match'] as string),
                            ifModifiedSince: req.headers['if-modified-since'] as string,
                        };

                        // Resolve the response locale up-front and fold it
                        // into the cache key. The body is translated below
                        // (`translateMetaItem`) *after* this validator runs,
                        // so without a locale-aware ETag a language switch
                        // would return a stale-locale 304 (issue #1319).
                        const cacheI18n = await this.resolveI18nService(environmentId, req);
                        const cacheLocale = this.extractLocale(req, cacheI18n);

                        // [commit 2a29caa53] Typed request — `as any` retired. The
                        // cached read carries NO draft-visibility members
                        // on purpose: this branch is unreachable when a
                        // draft switch is ADMITTED (`previewDrafts` /
                        // `isDraftRead` true — the fork above bypasses the
                        // cache for both), and the implementation's
                        // `getMetaItemCached` signature declares neither.
                        // [#20320] The query PARAMETER still reaches here:
                        // a caller `mayReadPendingDrafts` does not admit
                        // sends `?state=draft` / `?preview=draft` and is
                        // answered this arm, the plain read's (#20338).
                        const cachedRequest: TransportScopedMetaRequest<GetMetaItemCachedRequest> = {
                            type: req.params.type,
                            name: req.params.name,
                            cacheRequest,
                            ...(cacheLocale ? { locale: cacheLocale } : {}),
                            ...(environmentId ? { environmentId } : {}),
                            // [#9454] The cached door is the `view` arm, and
                        };
                        const result = await measureMetaRead(() => p.getMetaItemCached!(cachedRequest));
                        // [#23316] The automation engine's verdict on a
                        // FLOW, beside the document and never inside it:
                        // this branch is the default door of
                        // `GET /meta/flow/:name`, so without it a flow the
                        // engine refused was served here as its stored
                        // `status` alone. The protocol reads it live from
                        // its delegate read on every call; it is in no
                        // validator, so a read carrying it is never
                        // answered 304 (`getMetaItemCached` says why).
                        // Flow only — every other type's cached envelope
                        // is unchanged.
                        const cachedRegistration = metaType === 'flow' && result.registration !== undefined
                            ? { registration: result.registration }
                            : {};
                        // [#27842] The action twin, for an OBJECT: the
                        // packaged actions the activation ledger switches
                        // off, beside the document, read live on every call.
                        // This branch is the default door of
                        // `GET /meta/object/:name`. An object's validator is
                        // folded and judged HERE (`audienceFolds`), so unlike
                        // `registration` the key need not stand the 304
                        // down: [#28044] the served list is folded into the
                        // validator below (`disabledActionsFingerprint`), so
                        // an administrator's switch moves the ETag and an
                        // unchanged switch set still revalidates to 304.
                        const cachedDisabledActions = metaType === 'object' && result.disabledActions !== undefined
                            ? { disabledActions: result.disabledActions }
                            : {};
                        // [#28001] …and the objects a delete of one of its
                        // records can cascade into, beside the document on
                        // the same terms as `disabledActions`: read live,
                        // folded into the validator below
                        // (`cascadeDeleteObjectsFingerprint`), so an object
                        // registered later that cascades into this one moves
                        // the ETag.
                        const cachedCascadeDeleteObjects = metaType === 'object' && result.cascadeDeleteObjects !== undefined
                            ? { cascadeDeleteObjects: result.cascadeDeleteObjects }
                            : {};
                        const cachedBeside = { ...cachedRegistration, ...cachedDisabledActions, ...cachedCascadeDeleteObjects };
                        // Only what is beside the document and in NO
                        // validator stands the 304 down — `registration`.
                        const besideJudged = Object.keys(cachedRegistration).length > 0;
                        const disabledActionsFingerprint = cachedDisabledActionsFingerprint(cachedDisabledActions.disabledActions);
                        const cascadeDeleteObjectsFingerprint = cachedDisabledActionsFingerprint(
                            cachedCascadeDeleteObjects.cascadeDeleteObjects,
                        );

                        if (result.notModified) {
                            res.status(304).send();
                            return;
                        }

                        // [ADR-0106 D1/D3] fetch → mask → send. The shared
                        // cache still stores ONE full schema per (type,
                        // name, locale, environment) — no caller dimension
                        // in the key — and what varies per caller is this
                        // projection plus the validator below.
                        let cachedDocument: any = result.data;
                        // [#22639] THE per-caller read gate, before the mask —
                        // the item chain's order (`createMetaItemAnswer`: gate,
                        // then mask). This arm serves `view` and `object`, the
                        // two types it judges here: a list view the caller
                        // does not hold is refused whole, a container and an
                        // object are served minus the list views withheld.
                        // The same judge every other door asks — ⛔ no
                        // decision of its own here. What it withheld is
                        // folded into the validator below.
                        let audienceFingerprint = '';
                        if (audienceFolds) {
                            const verdict = await this.metaItemReadGate(
                                environmentId, req, p, metaType, req.params.name, [cachedDocument],
                                { arms: 'all', app: 'gate' },
                            )(cachedDocument);
                            if (verdict.kind === 'refuse') {
                                verdict.send(res);
                                return;
                            }
                            audienceFingerprint = objectFieldVisibilityFingerprint(
                                metaReadGate.withheldListViewNames(cachedDocument, verdict.document),
                            );
                            cachedDocument = verdict.document;
                        }
                        let visibilityFingerprint = '';
                        if (maskPosture.kind === 'project') {
                            // [#21884] Related to the fetched document: its `objectOverride` params name other objects.
                            const related = await relateObjectSchemaMaskPosture(maskPosture, cachedDocument);
                            const masked = this.maskObjectDocument(res, related, req.params.name, cachedDocument);
                            if (!masked) return;
                            cachedDocument = masked.document;
                            visibilityFingerprint = masked.fingerprint;
                        }
                        // [#21476] The administrator's read names why an open
                        // public form is not offered on this posture.
                        let intakeFingerprint = '';
                        if (intakeFolds) {
                            const warnings = await this.anonymousFormIntakeWarnings(environmentId, req, p, cachedDocument);
                            cachedDocument = stampAnonymousFormIntakeWarnings(cachedDocument, warnings);
                            intakeFingerprint = anonymousFormIntakeFingerprint(warnings);
                        }
                        // [#22250] The caller's runtime view of what is
                        // served — the document itself unless the caller is
                        // D4-exempt and their own field permission withholds
                        // some of its fields — which `sortability` derives
                        // from, and whose fingerprint the validator folds.
                        const runtimeView = await resolveObjectSchemaRuntimeView(cachedDocument, maskPosture);

                        // [ADR-0106 D6 tier 2] Visibility undetermined →
                        // the body is unmasked, so it must not be stored or
                        // revalidated under a SHARED validator: a later 304
                        // would hand this body to a caller whose projection
                        // did resolve. No ETag, no Last-Modified, no-store.
                        if (maskPosture.kind === 'undetermined') {
                            res.header('Cache-Control', 'private, no-store');
                            res.header('Vary', 'Accept-Language');
                            res.json(await this.translateMetaEnvelope(
                                req, req.params.type, environmentId,
                                { type: metaType, name: req.params.name, ...cachedBeside },
                                cachedDocument, cacheI18n, runtimeView.document,
                            ));
                            return;
                        }

                        // Set cache headers
                        if (result.etag) {
                            // [ADR-0106 D3] Fold the caller's field-visibility
                            // fingerprint into the shared validator. An
                            // unrestricted caller denies nothing → the
                            // fingerprint is empty → the ETag is byte-identical
                            // to the pre-ADR one. A cohort shares 304s; a
                            // permission change moves the fingerprint and
                            // self-invalidates the stale 304. [#22250] So does
                            // the runtime view's: a D4-exempt caller whose
                            // permission withholds a field is served a
                            // different `sortability`, never a 304 for another's.
                            // [#22639] …and so does what the read gate
                            // withheld: a caller who no longer holds a list
                            // view's capability is never answered a `304`
                            // for the body that carried it. [#28044] …and so
                            // does the switched-off list served beside an
                            // object: a switch flipped off or on is never
                            // answered a `304` for the list it replaced.
                            // [#28001] …and so does the cascade list served
                            // beside an object: a cascading object registered
                            // or removed is never answered a `304`.
                            const value = foldVisibilityFingerprintIntoEtag(
                                foldVisibilityFingerprintIntoEtag(
                                    foldVisibilityFingerprintIntoEtag(
                                        foldVisibilityFingerprintIntoEtag(
                                            foldVisibilityFingerprintIntoEtag(
                                                foldVisibilityFingerprintIntoEtag(result.etag.value, visibilityFingerprint),
                                                runtimeView.fingerprint,
                                            ),
                                            intakeFingerprint,
                                        ),
                                        audienceFingerprint,
                                    ),
                                    disabledActionsFingerprint,
                                ),
                                cascadeDeleteObjectsFingerprint,
                            );
                            const etagValue = result.etag.weak
                                ? `W/"${value}"`
                                : `"${value}"`;
                            res.header('ETag', etagValue);
                            if ((maskApplies || intakeFolds || audienceFolds) && !besideJudged
                                && normalizeIfNoneMatch(req.headers['if-none-match']) === value) {
                                res.status(304).send();
                                return;
                            }
                        }
                        if (result.lastModified) {
                            res.header('Last-Modified', new Date(result.lastModified).toUTCString());
                        }
                        if (result.cacheControl) {
                            // `max-age` is a placeholder directive in the
                            // array; its real value is appended from the
                            // `maxAge` field. Strip the bare token before
                            // joining so the two never collide into the
                            // malformed `public, max-age, max-age=3600`.
                            const parts: string[] = result.cacheControl.directives
                                .filter((d: string) => d !== 'max-age');
                            if (result.cacheControl.maxAge != null) {
                                parts.push(`max-age=${result.cacheControl.maxAge}`);
                            }
                            res.header('Cache-Control', parts.join(', '));
                        }

                        res.header('Vary', 'Accept-Language');
                        // [#5563] `getMetaItemCached` hands back the metadata
                        // document with the envelope already stripped
                        // (`result.data`; it does `const item = result?.item`
                        // internally). This branch is the DEFAULT — `enableCache`
                        // defaults to `true` — so leaving it unwrapped made the
                        // one shape `packages/spec` declares for this route the
                        // one a default deployment could never obtain. Rebuild
                        // the declared envelope here, in the REST layer that
                        // owns the response contract.
                        //
                        // `type` is folded to the canonical singular exactly as
                        // `metadata-protocol` folds it (#4432), so `/meta/objects/x`
                        // and `/meta/object/x` cannot answer two different `type`
                        // values across a configuration switch. The cached read
                        // carries no `lock` — it is the fast published-value path
                        // and never consulted the lock resolver; a caller that
                        // needs the ADR-0008 OCC carriers reads the uncached path.
                        // [#22114] That includes `version`, the read's token. Its
                        // ETag above stays the CACHE validator and is not the token:
                        // the validator varies by locale (#1319), by the caller's
                        // field visibility (ADR-0106 D3) and by the served bytes
                        // (`getMetaItemCached`, #16525), none of which moves the
                        // stored row's version, and an item with no stored row has
                        // a validator but no version at all.
                        const cachedEnvelope = {
                            type: metaType,
                            name: req.params.name,
                            ...cachedBeside,
                        };
                        res.json(await this.translateMetaEnvelope(
                            req, req.params.type, environmentId, cachedEnvelope, cachedDocument, cacheI18n,
                            runtimeView.document,
                        ));
                    } else {
                        // Non-cached version
                        // [#22128] The save door's reading of `?package=`
                        // ({@link metaItemPackageBinding}): the served
                        // `version` is resolved at the address that save
                        // writes, so `all` names no package here either.
                        const packageId = metaItemPackageBinding(req.query?.package);
                        // [commit 2a29caa53] Typed against the spec request shape —
                        // the `as any` this literal used to carry is
                        // retired now that the spec declares `state` and
                        // `previewDrafts`.
                        // No transport envelope: this door does not thread
                        // `environmentId` (the kernel was already resolved
                        // above), so the plain declared shape suffices.
                        const itemRequest: GetMetaItemRequest = {
                            type: req.params.type,
                            name: req.params.name,
                            packageId,
                            // [#20338] The ADMITTED switches declared above,
                            // never `req.query` re-read here.
                            ...(isDraftRead ? { state: 'draft' as const } : {}),
                            ...(previewDrafts ? { previewDrafts: true } : {}),
                            // [#22877] The member, read once above.
                            ...memberSelector,
                        };
                        const envelope = await measureMetaRead(() => p.getMetaItem(itemRequest)) as Record<string, any>;

                        // [#20408] Everything this read does to the envelope
                        // after the store read is ONE chain,
                        // `createMetaItemAnswer` in `./meta-item-read-gate.ts`,
                        // which the runtime dispatcher's `/meta` item read calls
                        // too. Its docblock carries each step's rule and their
                        // order — [#18066] absence judged BEFORE the gate (a name
                        // with nothing behind it can never become #8013's `403`),
                        // [#20156] THE per-caller read gate, the ADR-0046 doc
                        // locale collapse, the [ADR-0106 D1/D5(1)] mask under the
                        // posture resolved above (this uncached exit serves
                        // `?state=draft`, `?preview=draft`, `?package=` and every
                        // `enableCache: false` deployment, so a mask living only
                        // in the cached arm would be walked past by a query
                        // parameter), and the body: the translation and #10235's
                        // `sortability`. ⛔ An item step is added there, never
                        // here (`meta-list-projection-parity.test.ts` in
                        // `@objectstack/runtime` derives its census from this
                        // handler and fails on one added here).
                        //
                        // The gate's policy is this read's: every arm and the app
                        // PRUNED, to every caller, its authors included
                        // (read-to-display is per user) — save [#20290] the
                        // `?state=draft` branch, which serves a STORED version
                        // (the pending draft row) and so reads under the
                        // stored-version doors' policy
                        // ({@link STORED_VERSION_DOOR_POLICY}): Studio's designers
                        // merge this answer over the layered view and save it
                        // back, so whoever may save the app reads its draft
                        // whole, every other caller pruned per caller (ruling
                        // 5856774816), and no per-DEPLOYMENT gate. [#20338] "Every
                        // other caller" is every other caller who may READ
                        // drafts: one who may not never reaches this branch
                        // (`isDraftRead` is false for them).
                        const readPolicy: MetaReadGatePolicy = isDraftRead
                            ? this.STORED_VERSION_DOOR_POLICY
                            : { arms: 'all', app: 'gate' };
                        const answer = await metaReadGate.createMetaItemAnswer(
                            this.metaItemAnswerSources(environmentId, req, p, readPolicy),
                            { metaType, name: req.params.name, policy: readPolicy, maskPosture },
                        )(envelope);
                        if (answer.kind === 'refuse') {
                            // `absent` is {@link sendMetaItemAbsent}, byte for byte.
                            this.sendMetaReadRefusal(res, answer.refusal);
                            return;
                        }
                        if (answer.kind === 'mask-fault') {
                            sendFieldVisibilityFault(res, answer.object);
                            return;
                        }
                        // [ADR-0106 D6 tier 2] Visibility undetermined → the
                        // body is unmasked, so it must not be stored or
                        // revalidated under a shared validator.
                        // [#27627] Otherwise the chain's validator of the
                        // served envelope, `private, no-cache`, and a `304`
                        // when the caller already holds it. This exit is the
                        // one `app`, `dashboard`, `doc` and `book` always take
                        // (their gates keep them off the shared cache above),
                        // so before this they were served with no validator.
                        res.header('Vary', 'Accept-Language');
                        sendMetaRepresentation(req, res, answer.envelope, answer, metadata.enableCache !== false);
                    }
                } catch (error: any) {
                    // [#18402] THE one absence answer, whichever arm
                    // produced it — the last half of #18066.
                    //
                    // #18066 gave this route a single absence EMITTER
                    // ({@link sendMetaItemAbsent}) and reached it from the
                    // two conditions that RETURN nothing. The conditions
                    // that THROW one were left on the classification door
                    // below, which renders the flat `{ error: '<message>',
                    // code }` — so `body.error.code`, the accessor #8013
                    // settled on and objectui#4252 reads, was `undefined`
                    // on exactly those. Which one a caller got was decided
                    // by two things it cannot see:
                    //
                    //  - `metadata.enableCache` (default TRUE). The cached
                    //    arm's `getMetaItemCached` THROWS
                    //    `metadataItemNotFoundError` on a falsy `item`; the
                    //    uncached arm resolves item-less and returns. One
                    //    request, one missing name, two envelopes, chosen
                    //    by a server setting — the #7035 failure class.
                    //  - which protocol implementation is mounted. The
                    //    in-repo `metadata-protocol` resolves item-less
                    //    from `getMetaItem`, but a protocol that throws the
                    //    miss instead reached the same flat door
                    //    (pinned in `rest-meta-outage-vs-miss.test.ts`).
                    //
                    // Recognised by the ANSWER this repo's own
                    // classification door would have given — see
                    // {@link thrownAnswerIsBareNotFound}, which asks that
                    // door rather than re-reading the error, so this fork
                    // and the `handleRouteError` it forks away from cannot
                    // drift apart about what a caught value means.
                    //
                    // ⛔ NOT "the status is 404", and that narrowing was
                    // measured rather than assumed. `NO_DRAFT` is a 404 on
                    // THIS route — the Studio designer's `?state=draft`
                    // probe, pinned byte-for-byte two files over — and it
                    // says the item IS there and its draft is not.
                    // Answering it as absence would tell a designer the
                    // object does not exist, which is #5532's flattening
                    // reintroduced by the repair for a sibling of it. Same
                    // reasoning excludes a producer-declared code the
                    // ledger does not know: ADR-0112 keeps that spelling in
                    // `declaredCode`, and converting would delete it.
                    //
                    // ⭐ It STRENGTHENS the ADR-0045 §3 property rather
                    // than merely preserving it. The unpublished app and
                    // the service-gated one answer through the emitter, so
                    // an absence that kept the thrown dialect was a
                    // response pair that told them apart — by envelope
                    // shape, and by the producer's `Metadata item
                    // <type>/<name> not found` prose where the emitter says
                    // one fixed sentence. Four arms, one body now; the
                    // byte-identity is pinned in
                    // `meta-item-absent-404.test.ts` §2 and §5.
                    //
                    // ⛔ NOT a convergence of the flat dialect itself. The
                    // audience gate's `sendDeclaredFault` 401/403 beside
                    // this, and the door in `error-response.ts`, still
                    // answer flat: that position is the live ratchet
                    // #9559 owns repo-wide (`check:route-envelope`), and
                    // converting two of its four emissions here would mint
                    // a new divergence — the same refusal answering two
                    // shapes depending on which ROUTE served it.
                    if (thrownAnswerIsBareNotFound(error)) {
                        sendMetaItemAbsent(res);
                        return;
                    }
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Get specific metadata item',
                tags: ['metadata'],
            },
        });
    }
}

// [#23050 slice 13b] Moved here from `rest-server.ts`, verbatim, with the body above:
// its one caller is the reference sweep's catch, and "this door" and "this route" in
// its docblock are that sweep.
/**
 * [#15685] The `/meta/:type/:name/references` door's PROTOCOL-RAISED refusal,
 * re-dressed in the ADR-0112 NESTED envelope that door's other refusal exit
 * already publishes. Answers `undefined` for everything else, so the caller
 * keeps `handleRouteError` for the rest.
 *
 * ## The defect this closes
 *
 * The door can refuse in two ways and, measured on one boot, the two answers
 * agreed on neither the envelope nor the message:
 *
 * ```
 * A  protocol-raised, unanswerable TARGET type (#9327)
 *    501 {"error":"Internal server error","code":"NOT_IMPLEMENTED"}
 * B  the resolved kernel has no `findReferencesToMeta` at all (#9326)
 *    501 {"error":{"code":"NOT_IMPLEMENTED","message":"protocol.findReferencesToMeta() is not available in this kernel"}}
 * ```
 *
 * Two facts are lost on A, and both of them are the operator's:
 *
 *  1. **The PRESCRIPTION.** A's message is not decoration — `findReferencesToMeta`
 *     says so in as many words ("The message is prescriptive per ADR-0110 D3:
 *     it names the answerable question"). It tells the operator what to ask
 *     INSTEAD: `Ask the owning object instead: GET /api/v1/meta/object/<owner>/references`.
 *     That sentence is what keeps "the question was never asked" from being
 *     read as "nothing depends on this item" — the whole of ADR-0110 D3
 *     (#8896), in front of an operator whose next click is a delete, because
 *     the admin "Used by" panel renders its empty case as "Nothing in the
 *     metadata graph points at this item. Safe to delete." On the wire the
 *     sentence was replaced by "Internal server error".
 *  2. **The `code`'s POSITION.** `body.error.code` reads on B and `undefined`
 *     on A. This door's own comment on the B branch warns against precisely
 *     that dialect ("never the bare-string or sibling-`code` dialects, which
 *     make `body.error.code` read `undefined`") — so the route was violating
 *     its own written rule at its other exit, reached by a different path.
 *
 * ## Why the repair is HERE and not at the relay
 *
 * A reaches the wire through `handleRouteError` → {@link declaredServerFaultAnswer},
 * which keeps `status` and `code` and replaces the prose with
 * `INTERNAL_ERROR_MESSAGE`. That arm is correct and argued for a server FAULT
 * (#11718, #5582) — a fault message may carry driver internals, and withholding
 * it is the point. What it cannot see is that a producer-declared 5xx might be
 * a deliberate REFUSAL whose message is authored FOR the caller. Teaching it
 * that distinction would change platform-wide behaviour for every
 * producer-declared 5xx at every door; that is a maintainer's decision and is
 * handed back as its own finding, not taken here. This arm is the bounded half:
 * ONE door, re-dressing ONE refusal in the dialect it already publishes.
 *
 * ⛔ It is therefore NOT a general "5xx prose is relayed now" rule, and the
 * three conditions below are what keep it from becoming one.
 *
 * ## The three conditions, and why each is exactly this narrow
 *
 *  - **`501`**, read through {@link declaredHttpStatus} so both declaration
 *    spellings (`status` / `statusCode`, #7525) reach the same verdict rather
 *    than through a fourth local opinion about which field declares a status.
 *  - **`code === 'NOT_IMPLEMENTED'`**, the literal this route already publishes
 *    on its B exit. Matching the LITERAL rather than "any declared code" is
 *    also how the #9232 vocabulary narrowing is honoured by CONSTRUCTION: an
 *    unregistered producer spelling can never reach this exit, so no second
 *    copy of `thrownCodeFields`' demotion rule is needed and no new door ships
 *    an un-narrowed code. ⚠️ The cost is stated rather than hidden: a future
 *    SECOND refusal code on this route would fall back to the flat fault answer
 *    until whoever adds it comes here. That is a visible, one-line extension,
 *    not a silent gap.
 *  - **A DECLARED refusal.** [#16146] This was "a non-empty message", and it
 *    was this arm's own opinion about which producer-declared 5xx keeps its
 *    prose — the very question the relay could not answer when this was
 *    written. It can now: the director seat ruled the distinction a
 *    producer-side declaration on the published ADR-0112 envelope (decision
 *    batch #58, 2026-09-06, option C) and the producer sets it
 *    (`findReferencesToMeta`, `metadata-protocol`). So the condition is
 *    {@link boundedDeclaredRefusalMessage} — the shared relay's own answer,
 *    bound and all — and this route holds no refusal/fault opinion of its own
 *    any more.
 *
 * ## [#16146] What was RETIRED here, and the one half that could not be
 *
 * The ruling says to retire this route-local patch once the relay handles
 * `/references`, and its PROSE half is retired exactly as ruled: the sentence
 * now reaches the wire because the relay keeps it at EVERY door, the bound is
 * the shared one rather than this arm's unbounded pass-through, and deleting
 * the call below would change no message on this route.
 *
 * ⚠️ What deleting it WOULD change is the ENVELOPE, and that is a different
 * decision. This function also re-dresses the answer into the NESTED ADR-0112
 * envelope this door's B exit publishes; the relay is flat
 * (`{ error, code }` through `handleRouteError`), so removing this arm would
 * put `body.error.code` back to `undefined` on the A exit and re-open the
 * SECOND half of the defect #15685 measured and pinned positionally in
 * `rest-server-meta-references-refusal-envelope.test.ts`. Envelope POSITION is
 * owned by the `check:route-envelope` ratchet and is explicitly a separate
 * line from vocabulary (ADR-0112's #9232 amendment says so in as many words),
 * so it is not folded into a prose ruling. What remains here is therefore a
 * pure position adapter over the shared answer — ⛔ not a second withhold arm,
 * and ⛔ not a place to add a refusal rule.
 *
 * ⛔ And it does not re-derive `REFERENCE_SITES.unanswerableTargetTypes` to
 * decide whether the target was answerable. That set, its canonical-type fold
 * and its refusal all belong to `findReferencesToMeta`; a second copy at the
 * transport is the tolerant-consumer direction, and it would drift the moment
 * the set changed. The route reads what the protocol DECLARED, which is what a
 * transport is for.
 */
function notImplementedRefusalAnswer(
    error: any,
): { status: number; body: { error: { code: string; message: string } } } | undefined {
    if (declaredHttpStatus(error) !== 501) return undefined;
    if (error?.code !== 'NOT_IMPLEMENTED') return undefined;
    const message = boundedDeclaredRefusalMessage(error);
    if (message === undefined) return undefined;
    return { status: 501, body: { error: { code: 'NOT_IMPLEMENTED', message } } };
}

// [#23050 slice 13b] Moved here from `rest-server.ts`, verbatim, with the body above:
// its one caller is the item read's intake-reason fold.
/** [#21476] Those reasons' ETag dimension; empty when there is none (the ADR-0106 D3 fold). */
function anonymousFormIntakeFingerprint(warnings: ReadonlyArray<{ path: string; message: string }>): string {
    return objectFieldVisibilityFingerprint(warnings.map((w) => JSON.stringify([w.path, w.message])));
}

/**
 * [#28044] The ETag dimension of the `disabledActions` served beside an object
 * (#27842), hashed over the list exactly as served, so the validator describes
 * the representation sent. Absent (no ledger answered) folds nothing and keeps
 * the ETag byte-identical; `[]` (a ledger that switches none of them off) folds
 * a fingerprint of its own, so a ledger attaching or detaching moves it too.
 *
 * [#28001] The same dimension, on the same terms, for the
 * `cascadeDeleteObjects` served beside an object: a name list hashed as served.
 */
function cachedDisabledActionsFingerprint(disabledActions: readonly string[] | undefined): string {
    return disabledActions === undefined ? '' : objectFieldVisibilityFingerprint([JSON.stringify(disabledActions)]);
}
