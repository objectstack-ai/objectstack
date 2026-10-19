// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 13d] The `/meta` history family of `RestServer` — the item's
 * change log (`GET {metaPath}/:type/:name/history`), its audit trail
 * (`GET {metaPath}/:type/:name/audit`), the promotion of its pending draft
 * (`POST {metaPath}/:type/:name/publish`), the restore of an earlier version
 * (`POST {metaPath}/:type/:name/rollback`) and the comparison of two stored
 * versions (`GET {metaPath}/:type/:name/diff`) — moved out of `rest-server.ts`.
 * They were the sixth group of `RestServer#registerMetadataEndpointsInner`'s
 * body, five statements, and that method now calls the first function below at
 * their old position, so the `/meta` routes still register in one order: after
 * the per-item writes, and above the object FSM read.
 *
 * [#23050 slice 13e] The second function below,
 * {@link registerMetaItemPublishedRoute}, is the eighth and last group of that
 * body: the published read (`GET {metaPath}/:type/:name/published`), one bare
 * block holding one route. It is a member of the same per-item face and goes
 * through the same per-item registrar, so it lives beside the family. It is a
 * function of its own because the object FSM read (now
 * `meta-object-state-routes.ts`), which is no member of that face, registers
 * between the two, and the inner method calls each at its own position. Its
 * section is the last one in this header.
 *
 * A MOVE, not a redesign. The first function below is those five statements as
 * they stood, re-indented one level: the same five routes per base, by the same
 * handlers, answering the same bodies, each still registered through the
 * per-item switch's registrar. The moved comments are moved text too: where one
 * says "the reset door above", "a few hundred lines up" or "this file", it
 * still describes `rest-server.ts` and the inner method's order as they were,
 * in which the item save and the reset (now in `meta-item-write-routes.ts`) sat
 * immediately above these five doors.
 *
 * ## How the moved body reaches the class
 *
 * The shape slices 13a and 13c set for `/meta` (`meta-collection-routes.ts`'
 * header carries the full reasoning, `meta-item-write-routes.ts`' the
 * pass-through through the per-item registrar). The class keeps the private
 * method, and the method keeps its head; at the position of the moved
 * statements it builds one host literal ({@link MetaItemHistoryRouteHost}) and
 * hands it, with the head's one {@link MetaRouteScope}, to the function below
 * as its `this` and its argument. A method is handed over as a closure that
 * calls it on the server at call time, so a test double or spy set on the
 * server is still the one the body reaches.
 *
 * Each member was checked on its own, not inherited from an earlier slice:
 *
 * - There is NO `routeManager` member. All five statements register through
 *   the inner method's per-item registrar, which reaches this module in the
 *   scope as the ONE closure the inner head declares. That closure reads the
 *   server's route manager at CALL time, and every call below runs during the
 *   inner call, while `registerMetadataEndpoints`, the umbrella, has swapped
 *   that manager for its wrapping registrar; so these five routes still mount
 *   behind the anonymous-deny gate (#3963) and the type-level read and write
 *   admissions (#21087, #21124), and still answer to the per-item switch
 *   (`metadata.endpoints.item`), which the same closure reads. ⛔ Never a
 *   module-local registrar: a copy here would be a second copy of a helper, it
 *   would read a host field instead of the server's manager, and a manager
 *   captured anywhere but inside the swap would mount all five doors outside
 *   those gates.
 * - `STORED_VERSION_DOOR_POLICY` goes BY VALUE, as it does for the per-item
 *   reads. It is the class's `private static readonly` field, assigned once,
 *   when the class is evaluated, from the constant of the same name in
 *   `meta-item-read-gate.ts`, and never reassigned, so the value the literal
 *   captures is the object every read of it returned.
 * - No member goes as a getter, because the body reads no instance FIELD at
 *   request time. The caller, the protocol, the event doors' refusal, the
 *   walled refusal, the write actor, the masker, the current document, the read
 *   gate and the schema mask are each resolved per request by a METHOD of the
 *   class, and every method goes as a closure.
 *
 * The inner method's head declares the bindings every `/meta` group reads and
 * hands them over as ONE parameter, {@link MetaRouteScope}, built once there;
 * the function destructures the three its body reads (`metaPath`, `isScoped`
 * and the per-item registrar). It does not read `metadata`: the per-item
 * switch is read inside that registrar, where it always was. The host stays
 * class members only.
 *
 * ## The six tokens that are not byte-identical
 *
 * The comparison door reached six of the class's PRIVATE STATICS as
 * `RestServer.…`, once each: the type normalizer `metaTypeSingular`, the two
 * type questions `gatesPerCaller` and `gatesOnItsOwnKey`, the side rebuild
 * `diffSides`, the field `STORED_VERSION_DOOR_POLICY` and the emitter
 * `diffEmittedFrom`. A private static is reachable by name only inside the
 * class, so that spelling does not compile here, and making a member public,
 * or moving it, changes the published declaration the move must keep
 * byte-identical. So each is reached the way every other class member this
 * body reads is reached: through the host, as `this.…` — the five methods as
 * closures on {@link MetaItemHistoryRouteHost} that call the static with the
 * same arguments, the field by value. None of the five methods reads anything
 * but its arguments (`gatesPerCaller` still asks `gatesOnItsOwnKey` on the
 * class), so the receiver is the whole difference, as it was for slices
 * 13a–13c. Those six receivers are the only tokens of the body that changed.
 *
 * ## Module-level names
 *
 * The history family reads ten names declared in `rest-server.ts`, which stay
 * there and are imported from it: the five doors' closed query sets (their
 * tests import them from there), the declared numeric query read and its
 * whole-number schema (the approvals, data-action and search modules import
 * both from there too), the package binding, the absence answer (the class's
 * event-door refusal sends it too), and the authoring-door refusal, which stays
 * beside the predicate it asks (that predicate is a docs anchor) and gained
 * `export` there rather than a second home. Every one of them is read only at
 * request time, so the two modules importing each other cannot see one
 * uninitialised. The imports only this body read left `rest-server.ts` with
 * it: the two declared request schemas the change log and the audit trail
 * parse their numbers through, the three declared request types and the member
 * selector. Every other name is imported from the module `rest-server.ts`
 * imports it from. The package entry re-exports nothing from here, and the
 * published surface does not move.
 *
 * ## The published read
 *
 * [#23050 slice 13e] {@link registerMetaItemPublishedRoute} is that bare block
 * as it stood, re-indented one level, braces included: the same route per
 * base, by the same handler, answering the same bodies, still registered
 * through the per-item switch's registrar, which reaches it in the same
 * {@link MetaRouteScope} as the ONE closure the inner head declares. So, as for
 * the history family, there is no `routeManager` member, and ⛔ never a
 * module-local registrar. Its host, {@link MetaItemPublishedRouteHost}, was
 * walked on its own, not inherited from the history family's:
 *
 * - `objectQLProvider` goes as a GETTER, the one member in this module that
 *   does. The disabled-owner check reads that provider FIELD at REQUEST time,
 *   twice (its presence, then the call, both through `wiredEngineOrLoud`), and
 *   the field is not `readonly`, so a value copied at registration could part
 *   from it. The getter reads the field the handler read, when it read it:
 *   slice 2's batch shape, unbound, per the seat's provider ruling (no shipped
 *   provider reads `this`).
 * - The masker, the protocol, the read gate, the schema mask and the metadata
 *   service are each resolved per request by a METHOD of the class, and every
 *   method goes as a closure.
 * - The door names the requested type through the private static
 *   `metaTypeSingular`, which it used to call as
 *   `RestServer.metaTypeSingular(…)`; for the reason the section above gives,
 *   it now reaches it through the host, as `this.metaTypeSingular(…)`, a
 *   closure that calls the static with the same argument. That receiver is the
 *   only token of the body that changed.
 *
 * It destructures the same three scope bindings. Two more names declared in
 * `rest-server.ts` are imported from it: `wiredEngineOrLoud` (the class head,
 * the batch door and the object FSM read reach the engine through it too) and
 * the `RestProtocol` type, the read gate's protocol annotation; both are read
 * only at request time. The imports only this body read left `rest-server.ts`
 * with it: the door's closed query set (its re-export there stays), the
 * URL-type canonicaliser, the mask's posture relation and the unknown-parameter
 * refusal; so did the route-error answer, whose one other reader there, the
 * object FSM read, left in the same slice. Every other name is imported from
 * the module `rest-server.ts` imported it from.
 */

import { rethrowAuthzStoreUnavailable } from '@objectstack/core';
// [#12702 · #20156] The `/meta` item write doors' capability predicate — see
// `rest-server.ts`' import of the same name for why it is shared — and the
// metadata-plane FLS names the comparison door's and the published read's mask
// reads.
import {
    ObjectSchemaMaskEvaluationError,
    metaWriteCapabilityVerdict,
    relateObjectSchemaMaskPosture,
    type ObjectSchemaMaskPosture,
} from '@objectstack/metadata-core';
// [#20061 / #20062 / #20139] The DECLARED request schemas the change log and the
// audit trail parse their numeric parameters through — see
// `readDeclaredQueryNumber` in `rest-server.ts`.
import { AuditMetaItemRequestSchema, HistoryMetaItemRequestSchema } from '@objectstack/spec/api';
import type { AuditMetaItemRequest, HistoryMetaItemRequest, PublishMetaItemRequest } from '@objectstack/spec/api';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { handleRouteError, sendFieldVisibilityFault, thrownAnswerIsBareNotFound } from './error-response.js';
import type { MetaRouteScope, TransportScopedMetaRequest } from './meta-collection-routes.js';
import { META_ITEM_MEMBER_PARAM, META_ITEM_PUBLISHED_PARAMS, metaMemberSelector } from './meta-item-read-gate.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import {
    META_ITEM_AUDIT_PARAMS,
    META_ITEM_DIFF_PARAMS,
    META_ITEM_HISTORY_PARAMS,
    META_ITEM_PUBLISH_PARAMS,
    META_ITEM_ROLLBACK_PARAMS,
    UNDECLARED_WHOLE_NUMBER_PARAM,
    metaItemPackageBinding,
    readDeclaredQueryNumber,
    refuseNonAuthoringCaller,
    sendMetaItemAbsent,
    wiredEngineOrLoud,
    type RestProtocol,
    type RestServer,
} from './rest-server.js';

/**
 * The `RestServer` members {@link registerMetaItemHistoryRoutes} reads — every
 * one of them, and no other, in the order the body first reads them. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member the
 * class does not have is a compile error. The six statics are typed as the
 * statics they are. The module header says why there is no `routeManager`
 * member, why `STORED_VERSION_DOOR_POLICY` goes by value, why the body reaches
 * the statics through the host, and why none of the members is a getter.
 */
export interface MetaItemHistoryRouteHost {
    resolveExecCtx: RestServer['resolveExecCtx'];
    resolveProtocol: RestServer['resolveProtocol'];
    eventDoorRefusal: RestServer['eventDoorRefusal'];
    walledCatalogRefusal: RestServer['walledCatalogRefusal'];
    resolveMetaWriteActor: RestServer['resolveMetaWriteActor'];
    metaTypeSingular: (typeof RestServer)['metaTypeSingular'];
    resolveObjectMasker: RestServer['resolveObjectMasker'];
    gatesPerCaller: (typeof RestServer)['gatesPerCaller'];
    fetchCurrentMetaDocument: RestServer['fetchCurrentMetaDocument'];
    gatesOnItsOwnKey: (typeof RestServer)['gatesOnItsOwnKey'];
    diffSides: (typeof RestServer)['diffSides'];
    metaItemReadGate: RestServer['metaItemReadGate'];
    readonly STORED_VERSION_DOOR_POLICY: (typeof RestServer)['STORED_VERSION_DOOR_POLICY'];
    diffEmittedFrom: (typeof RestServer)['diffEmittedFrom'];
    maskObjectDocument: RestServer['maskObjectDocument'];
}

/**
 * Register the `/meta` history family — the change log, the audit trail, the
 * publish, the rollback and the version comparison, the sixth group of
 * `RestServer#registerMetadataEndpointsInner`' body, called by that method at
 * its position in its registration order, with the server's members as `this`
 * and the method's head bindings as `scope`. The method's own docblock, which
 * the published declaration carries, names the families, their switches and
 * the ordering facts the routes below keep.
 */
export function registerMetaItemHistoryRoutes(this: MetaItemHistoryRouteHost, scope: MetaRouteScope): void {
    const { metaPath, isScoped, registerPerItemRoute } = scope;

    // GET /meta/:type/:name/history — durable change-log for one item.
    // Returns the sys_metadata_history events that the Studio "History"
    // tab renders as an audit timeline. Overlay-only metadata types
    // (view/dashboard/report/email_template) return real events;
    // non-overlay types return `{ events: [] }` (the legacy raw-engine
    // path does not record history).
    registerPerItemRoute({
        method: 'GET',
        path: `${metaPath}/:type/:name/history`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                // [#20378] AN AUTHORING DOOR — ruling 5865708652 (letter B).
                // `sys_metadata_history` is the authoring commit log
                // (ADR-0067), and a DRAFT save appends a row to it exactly
                // as an active save does, with nothing on the row to tell
                // the two apart — so this log, served to a caller who may
                // not read pending drafts, lists unpublished authoring work
                // (ADR-0106 D4: 「draft/preview reads are admin-gated
                // upstream」). The caller is asked
                // {@link mayReadAuthoringTrail} FIRST, and one it does not
                // admit is refused in `GET /meta/_drafts`'s shape
                // (403 `FORBIDDEN`, the same nested envelope): before the
                // protocol is resolved (no 501-vs-200 probe), before the
                // query is parsed, before any item or event is read. The
                // answer is therefore one and the same for an item that
                // exists, one that does not and a draft-only one — the door
                // is no existence oracle — and it carries no item or
                // version detail. The message names THIS door, never
                // drafts: a refusal worded about drafts would read as
                // "this item has one". Whoever it admits reads exactly what
                // they read before, the per-caller refusal below included.
                // [#23546] `setup.access` alone no longer admits it: under a
                // wall it handed every organization administrator the
                // environment-wide trail (see AUTHORING_TRAIL_READ_CAPABILITIES).
                //
                // Ruling 5856774816 (#20156) item 2 is narrowed for this
                // door and `/diff` only: `/layers` and `?layers=true` read
                // the active row and keep the pruned plain-read answer.
                //
                // `historyCtx` is this door's one caller resolution. The refusal is
                // {@link refuseNonAuthoringCaller}, shared with `/diff` and
                // `/audit` (#20441) so the three cannot drift apart.
                const historyCtx = await this.resolveExecCtx(environmentId, req)
                    .catch(rethrowAuthzStoreUnavailable);
                if (refuseNonAuthoringCaller(historyCtx, res, 'Reading a metadata item\'s version history')) return;
                const p = await this.resolveProtocol(environmentId, req);
                // The cast came off when `MetadataProtocol` declared
                // `historyMetaItem` (#12005 — the commit cccbe51bf pattern, exactly
                // as #11678 de-cast the audit twin below). The member is
                // declared OPTIONAL, so this truthiness guard is not just
                // feature detection: it is what narrows the member to
                // callable at the call site. Same guard semantics as
                // before, minus the cast.
                if (!p.historyMetaItem) {
                    res.status(501).json({
                        error: 'History query not supported by protocol implementation',
                    });
                    return;
                }
                // [#6877] `Number(['1','2'])` is `NaN`, which the
                // `Number.isFinite` spreads below drop — so a repeated
                // `?limit=` silently returned the UNLIMITED history instead
                // of the page the caller asked for.
                // [#22877] Recognition first, over the measured closed set.
                if (refuseUnknownQueryParams(req, res, META_ITEM_HISTORY_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res, ['sinceSeq', 'limit', META_ITEM_MEMBER_PARAM])) return;
                // [#20139] `sinceSeq` is parsed through its DECLARATION
                // (`HistoryMetaItemRequestSchema.sinceSeq`, `z.number().optional()`),
                // the way `limit` is just below: `?sinceSeq=abc` used to be `NaN`,
                // dropped by the spread below, and answered with the log read from
                // the START; `?sinceSeq=` became `Number('')` = 0, a cursor the
                // repository applies (`event_seq <= 0` rows skipped) that the
                // caller never sent. Both are refused now; any finite number is
                // still forwarded exactly as before.
                const sinceSeq = readDeclaredQueryNumber(req.query, 'sinceSeq',
                    HistoryMetaItemRequestSchema.shape.sinceSeq, { emptyIsAbsent: false });
                // [#20062] `limit` is parsed through its DECLARATION
                // (`HistoryMetaItemRequestSchema.limit`, `z.number().optional()`),
                // not coerced: `?limit=abc` used to be `NaN`, dropped by the
                // spread below, and answered with the WHOLE change log; `?limit=`
                // became `Number('')` = 0, a zero-event answer. Both are refused
                // now. The declaration carries no `int()` and no bounds, so any
                // finite number is still forwarded exactly as before.
                const limit = readDeclaredQueryNumber(req.query, 'limit',
                    HistoryMetaItemRequestSchema.shape.limit, { emptyIsAbsent: false });
                // [#20156] The plain read's refusal, where it refuses this
                // caller the item whole: a change log of a doc the caller
                // may not read, or of an app they may not open, discloses
                // who changed it, when and why — and an unpublished app's
                // log contradicts ADR-0045 §3's "externally unobservable".
                // See {@link eventDoorRefusal}.
                {
                    const refusal = await this.eventDoorRefusal(environmentId, req, p);
                    if (refusal) {
                        refusal(res);
                        return;
                    }
                }
                // [#13406 · ADR-0131 D6] The ENV partition, stated by
                // omission: `sys_metadata_history` is filtered by strict
                // equality on `organization_id`, and since the
                // per-organization overlay axis retired every write logs
                // there and `historyMetaItem` reads no other partition. A
                // legacy organization-scoped log is not served; its
                // promotion is ADR-0131 C7's.
                //
                // Typed through `TransportScopedMetaRequest` like the
                // reset door above, NOT as a plain `HistoryMetaItemRequest`
                // like the audit door below: this door still spreads the
                // transport-level `environmentId` (long-standing wire
                // shape, deliberately unchanged — the ruling commit 2a29caa53 landed keeps
                // it out of the protocol schema, and the implementation
                // never reads it), so the wrapper is what layers that one
                // member on. Every OTHER key is compiled against the spec
                // contract — an undeclared member here is now TS2353
                // instead of a payload member no contract has ever seen.
                const historyRequest: TransportScopedMetaRequest<HistoryMetaItemRequest> = {
                    type: req.params.type,
                    name: req.params.name,
                    ...(environmentId ? { environmentId } : {}),
                    // Both already finite or absent — the declared parses above
                    // refuse anything else, so no `Number.isFinite` drop is left here.
                    ...(sinceSeq !== undefined ? { sinceSeq } : {}),
                    ...(limit !== undefined ? { limit } : {}),
                    // [#22877] ONE member's events of the bundle's lineage.
                    ...metaMemberSelector(req.query),
                };
                const result = await p.historyMetaItem(historyRequest);
                res.json(result);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'List durable history events for a metadata item',
            tags: ['metadata'],
        },
    });

    // GET /meta/:type/:name/audit — ADR-0010 §3.6 / Phase 4.1.
    // Compliance trail for the metadata-protection layer: returns
    // recent sys_metadata_audit rows (save/publish/rollback/delete/
    // reset attempts, both allowed and denied) so Studio's "审计
    // 日志 / Audit log" tab can show who tried what and whether
    // a lock blocked it. Empty array on environments where the
    // table is not yet provisioned. An AUTHORING door (#20441): a
    // caller without an authoring capability is refused 403.
    registerPerItemRoute({
        method: 'GET',
        path: `${metaPath}/:type/:name/audit`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                // [#20441] AN AUTHORING DOOR — ruling 5865708652 (letter B),
                // carried to this door by triage's grade 5871509797.
                // `saveMetaItem` appends a success row to
                // `sys_metadata_audit` for EVERY save, a draft save
                // included, and `auditMetaItem` serves its `note: 'draft'`,
                // its actor and its time. So this trail, served to a caller
                // who may not read pending drafts, disclosed that an item
                // had unpublished authoring work, who saved it and when —
                // and for an item with nothing published, that it exists at
                // all, where the plain read answers `404` (ADR-0045 §3).
                // ADR-0106 D4: 「draft/preview reads are admin-gated
                // upstream」.
                //
                // The trail has no published-only answer to fall back to:
                // withholding only the draft-save rows would hand a member
                // a pruned log that reads as a true, complete one, the
                // shape the ruling measured wrong. So the caller is asked
                // {@link mayReadAuthoringTrail} FIRST and refused by
                // {@link refuseNonAuthoringCaller} — the refusal `/history`
                // and `/diff` give, and `GET /meta/_drafts`'s shape — before
                // the protocol is resolved (no 501-vs-200 probe), before the
                // query is parsed, and before any item or event is read.
                // Whoever it admits reads exactly what they read before,
                // the per-caller refusal below included. [#23546]
                // `setup.access` alone no longer admits it.
                //
                // `auditCtx` is this door's one caller resolution.
                const auditCtx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                if (refuseNonAuthoringCaller(auditCtx, res, 'Reading a metadata item\'s audit trail')) return;
                const p = await this.resolveProtocol(environmentId, req);
                if (typeof p.auditMetaItem !== 'function') {
                    // [#9426 / ADR-0110 D3] A MISS and a FAULT are different
                    // facts, and this branch is the second one: the resolved
                    // protocol cannot read an audit trail AT ALL, so the
                    // question was never asked. Answering `{ events: [] }`
                    // reported it as the first — "the trail WAS read and this
                    // item has no entries" — on a COMPLIANCE surface, where
                    // Studio's 审计日志 / Audit log tab renders the empty case
                    // as *nobody touched this item*. That is precisely the
                    // claim a compliance reader must not be given on false
                    // pretenses.
                    //
                    // ⚠️ This is NOT the unprovisioned-table condition this
                    // route's header comment describes. That one lives one
                    // layer down, inside
                    // `ObjectStackProtocolImplementation.auditMetaItem`,
                    // which catches a failed read and returns `{ events: [] }`
                    // after a `console.warn` — a path that requires the method
                    // to EXIST and to be CALLED. The two are separate frames
                    // in separate packages, and this branch returns BEFORE the
                    // call, so refusing here leaves the unprovisioned-table
                    // answer exactly as it was.
                    //
                    // Refusing HERE rather than asserting at assembly is
                    // deliberate, and is the reasoning PR #9425 landed one
                    // route over. `auditMetaItem` is a declared OPTIONAL
                    // member of `MetadataProtocol` (the commit-cccbe51bf-pattern
                    // catch-up that retired this door's `(p as any)` casts;
                    // it was an undeclared ADR-0076 D9 server-only
                    // extension before that). A host without the verb is
                    // therefore a CONFORMING deployment that lands here
                    // with no type error, and a boot-time assertion would
                    // promote a declared-optional member into a required
                    // one — a `packages/spec` contract decision, not a
                    // route one. The guard is also what narrows the member
                    // to callable below.
                    //
                    // Envelope per #7035: the ADR-0112 NESTED
                    // `{ error: { code, message } }` the sibling `/meta` 501
                    // refusals converged on — never the bare-string or
                    // sibling-`code` dialects, which make `body.error.code`
                    // read `undefined` and which `check:route-envelope`
                    // counts, shrink-only, on this file.
                    res.status(501).json({
                        error: {
                            code: 'NOT_IMPLEMENTED',
                            message: 'protocol.auditMetaItem() is not available in this kernel',
                        },
                    });
                    return;
                }
                // [#6877] Same `Number(...)` → `NaN` → dropped-limit shape as
                // the history twin above.
                // [#23072] Recognition first, over the measured closed set.
                if (refuseUnknownQueryParams(req, res, META_ITEM_AUDIT_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res, ['limit'])) return;
                // [#20139] Parsed through its DECLARATION
                // (`AuditMetaItemRequestSchema.limit`, `z.number().optional()`),
                // the history twin's reading: `?limit=abc` used to be `NaN`,
                // dropped by the spread below, and answered with the producer's
                // default 100 events; `?limit=` became `Number('')` = 0, which the
                // implementation clamps to ONE event. Both are refused now; any
                // finite number is still forwarded, and the implementation's own
                // `[1, 500]` clamp is unchanged.
                const limit = readDeclaredQueryNumber(req.query, 'limit',
                    AuditMetaItemRequestSchema.shape.limit, { emptyIsAbsent: false });
                // [#20156] The history twin's gate, for the same reason: the
                // audit trail of an item the plain read refuses this caller
                // is refused with the plain read's answer. See
                // {@link eventDoorRefusal}.
                {
                    const refusal = await this.eventDoorRefusal(environmentId, req, p);
                    if (refusal) {
                        refusal(res);
                        return;
                    }
                }
                // [#8747 · ADR-0131 D6] SCOPE THE READ: the
                // environment-wide rows only (`organization_id: null`),
                // never every tenant's. Since the per-organization overlay
                // axis retired every `/meta` write audits there; a legacy
                // organization-scoped audit row is not served.
                //
                // `environmentId` is not in this payload: `auditMetaItem`'s
                // request type never declared it. Environment scoping comes
                // from WHICH protocol `resolveProtocol` hands back.
                // (#20441), not a second resolution.
                //
                // The `(p as any)` casts this door carried came off when
                // `MetadataProtocol` declared `auditMetaItem` (the commit cccbe51bf
                // pattern, same as the publish door below): the literal is
                // now compiled against the spec contract, so an undeclared
                // key here is a compile error (TS2353) instead of a payload
                // member no contract has ever seen. Plain
                // `AuditMetaItemRequest` rather than the
                // `TransportScopedMetaRequest` wrapper on purpose: this
                // door stopped sending `environmentId` when #8747 scoped
                // the read (see the note above), so there is no
                // transport-level member left to layer on.
                const auditRequest: AuditMetaItemRequest = {
                    type: req.params.type,
                    name: req.params.name,
                    // Already finite or absent — the declared parse above
                    // refuses anything else.
                    ...(limit !== undefined ? { limit } : {}),
                };
                const result = await p.auditMetaItem(auditRequest);
                res.json(result);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'List protection-audit events for a metadata item',
            tags: ['metadata'],
        },
    });

    // POST /meta/:type/:name/publish — promote the pending draft
    // overlay to live. 404 `NO_DRAFT` when nothing to publish.
    registerPerItemRoute({
        method: 'POST',
        path: `${metaPath}/:type/:name/publish`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                // [commit b5378550e] Authoring capability gate — the SAME four lines the
                // `PUT` / `DELETE` / `_migrate-stored` doors carry, deliberately
                // not a second way of demanding the same capability.
                //
                // Promotion is authoring. `promoteDraftForPublish` flips the
                // `sys_metadata` row `state: 'draft'` → `'active'`, and
                // ADR-0027 (E)(5) defines sealing a publish as exactly that
                // flip — so this door decides which body is LIVE. Measured
                // before the gate: an authenticated principal holding no
                // authoring capability at all reached `publishMetaItem` and
                // got 200, i.e. it could take a draft somebody else authored
                // and make it the live overlay. The `/meta` umbrella already
                // refused ANONYMOUS here (401, `registerMetadataEndpoints`),
                // so this closes the authenticated-but-uncapable cohort — the
                // one the four sibling doors close and these two did not.
                //
                // ⛔ Not a publish-specific capability: `manage_metadata` is
                // ADR-0066 D1's authoring capability and the same one the save
                // door demands, so no caller who can author a draft is newly
                // refused (measured: the save→publish loop's own first step is
                // already gated on it). Splitting author from publisher would
                // need a DIFFERENT declared capability and is a product call.
                //
                // Gate FIRST — before the protocol is resolved — so an
                // unauthorized caller cannot use the 501-vs-200 answer to probe
                // which kernels implement publishing, and so nothing is promoted
                // before the refusal. `isSystem` bypasses, matching every other
                // capability gate on the platform.
                //
                // [#12702 · ADR-0131 D6] Same shared verdict as the save
                // door, because promotion is the second half of the
                // save→publish loop.
                const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                {
                    const verdict = metaWriteCapabilityVerdict({
                        isSystem: ctx?.isSystem === true,
                        systemPermissions: ctx?.systemPermissions,
                        operation: 'publish',
                    });
                    if (!verdict.allowed) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: verdict.message,
                            },
                        });
                        return;
                    }
                }
                // [ADR-0131 D3 · D12 items 7–8] The walled refusal, after the
                // capability gate and before the protocol is resolved: under
                // `isolated` / `group` every organization shares the
                // environment's metadata, so only the platform operator rung
                // (or the engine itself) writes it, whatever the type. Inert
                // under `single`. See {@link walledCatalogRefusal}.
                {
                    const walled = await this.walledCatalogRefusal(req.params.type, ctx, environmentId, req);
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
                if (!p.publishMetaItem) {
                    res.status(501).json({
                        error: 'Publish operation not supported by protocol implementation',
                    });
                    return;
                }
                // [#7749 producer, #7941 precedence] The request's authenticated
                // identity — one producer, shared by every `/meta` write (see
                // resolveMetaWriteActor). `X-Actor` is not consulted.
                const actor = await this.resolveMetaWriteActor(environmentId, req);
                const body = (req.body && typeof req.body === 'object') ? req.body : {};
                const message = typeof body.message === 'string' ? body.message : undefined;

                // [commit 9e04c3e35] Software-package binding for the PROMOTION —
                // `?package=<id>`, deliberately the SAME wire spelling and the
                // same normalisation the `PUT` door states it with a few
                // hundred lines up, not a second dialect for one value.
                //
                // Why this door needed it at all. #9612 taught the runtime
                // publish gate to narrow `objects` to the written item's
                // package closure, but only when the caller can NAME the
                // package. Three write doors reach that gate; `saveMetaItem`
                // and `publishPackageDrafts` both name one, and this one —
                // the single-item draft→active promotion — named nothing. So
                // every HTTP-driven promotion, which is precisely Studio's
                // designer save→publish loop on every edit, handed the gate
                // the whole tenant. The protocol half was already built and
                // waiting: `promoteDraftForPublish` declares
                // `packageId?: string | null` and threads it into both the
                // gate and `repo.promoteDraft`. Only the caller was mute.
                //
                // ⚠️ THE SHARP EDGE, and the reason this is a conditional
                // spread rather than a plain key. `promoteDraftForPublish`
                // forwards to `repo.promoteDraft` with
                // `...('packageId' in request ? { packageId: request.packageId ?? null } : {})`
                // — it branches on the KEY BEING PRESENT, not on the value,
                // because `null` is a meaningful scope there (pin the lookup
                // to the UNBOUND row) while an absent key means "match any
                // package", the historical resolution. Writing
                // `packageId: packageId` here would therefore put a
                // present-and-`undefined` key on every publish that names no
                // package, coercing it to `null` downstream and pinning the
                // lookup to unbound rows — so a draft authored under a package
                // would stop being found and the door would answer `no_draft`.
                // That is a silent outage on the untouched path, produced by a
                // change that reads like it only ADDS an option. The key must
                // be ABSENT when the caller states nothing.
                //
                // ⛔ Not read off the draft row either — see
                // `promoteDraftForPublish`'s own warning: `rowToItem` projects
                // `sys_metadata` into a `MetadataItem`, which carries no
                // package id, so a read from there is `undefined` on every
                // path — narrowing that never fires while looking like it
                // does. Widening `MetadataItem` is a `packages/spec` contract
                // change and stays filed rather than taken here.
                // [#22877] Recognition first, over the measured closed set.
                if (refuseUnknownQueryParams(req, res, META_ITEM_PUBLISH_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res, ['package', META_ITEM_MEMBER_PARAM])) return;
                const packageId = metaItemPackageBinding(req.query?.package);

                // [ADR-0131 D6] No organization, as on the `PUT` twin: a
                // draft is saved environment-wide, so the promotion looks in
                // the environment partition.
                // [#11145] The `(p as any)` cast this call carried came off
                // when `MetadataProtocol` declared `publishMetaItem` (commit cccbe51bf,
                // maintainer ruling 2026-08-22, option B). What the cast was
                // load-bearing FOR is recorded because it is counter-intuitive
                // and was measured, not assumed: deleting it while the member
                // was undeclared answered
                //   `TS2339: Property 'publishMetaItem' does not exist on
                //    type 'RestProtocol'`
                // — NOT a `TS2353` about an unknown key. The cast was feature
                // detection for an ADR-0076 D9 server-only extension, so only
                // declaring the member could retire it; widening the
                // implementation's own request type in
                // `@objectstack/metadata-protocol` (which this package
                // deliberately does not depend on) never could, and commit 490879ad0
                // measured exactly that.
                //
                // What replaces it is the point of the exercise, not a
                // side effect: the literal below is compiled against the spec
                // contract through the commit 2a29caa53 `TransportScopedMetaRequest`
                // wrapper, so an undeclared key here is a COMPILE ERROR
                // (`TS2353`, measured) instead of a payload member no contract
                // has ever seen. `environmentId` is the transport-level
                // routing key that wrapper layers on — ⛔ never a protocol
                // key; a key that belongs on the request belongs in the spec
                // schema.
                //
                // The 501 feature-detection guard above STAYS. The member is
                // declared OPTIONAL (ADR-0076 D9 promotion is additive to a
                // shipped contract, and a kernel may not implement the
                // promotion door at all), and that same guard is what narrows
                // it to callable here.
                const publishRequest: TransportScopedMetaRequest<PublishMetaItemRequest> = {
                    type: req.params.type,
                    name: req.params.name,
                    ...(environmentId ? { environmentId } : {}),
                    ...(actor ? { actor } : {}),
                    ...(message ? { message } : {}),
                    ...(packageId ? { packageId } : {}),
                    // [#22877] Publishes ONE member's draft of a bundled type.
                    ...metaMemberSelector(req.query),
                };
                const result = await p.publishMetaItem(publishRequest);
                res.json(result);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'Publish the pending draft overlay (promotes draft → active)',
            tags: ['metadata'],
        },
    });

    // POST /meta/:type/:name/rollback — restore a historical version
    // as the new live overlay. Body: { toVersion: <number>, message? }.
    registerPerItemRoute({
        method: 'POST',
        path: `${metaPath}/:type/:name/rollback`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                // [commit b5378550e] Authoring capability gate — the same four lines as
                // the sibling doors, and the sharper half of this pair.
                // `rollbackMetaItem` restores a CALLER-SUPPLIED `toVersion` as
                // the new live row, so without this gate it is a mechanism for
                // reverting security hardening: a permission set as it stood
                // before it was tightened, a validation rule from before it
                // existed, a layout from before field-level security. Measured
                // before the gate: an authenticated principal holding no
                // authoring capability reached `rollbackMetaItem` and got 200.
                //
                // It is also the door with the least behind it. Publish at
                // least re-runs `assertRuntimeAuthoringRules` on the promoted
                // draft (#4463 D1); rollback runs no content gate at all — its
                // only refusals are TYPE-level (`isOverlayAllowed` →
                // `NOT_OVERRIDABLE`) and the ADR-0010 lock. Neither reads the
                // caller, so nothing downstream was ever answering "may this
                // principal press this button".
                //
                // Gate FIRST — before the protocol is resolved — so 403-vs-501
                // leaks no kernel capability and nothing is restored before the
                // refusal. `isSystem` bypasses, as everywhere else.
                //
                // [#12702 · ADR-0131 D6] Same shared verdict as the
                // sibling doors.
                const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                {
                    const verdict = metaWriteCapabilityVerdict({
                        isSystem: ctx?.isSystem === true,
                        systemPermissions: ctx?.systemPermissions,
                        operation: 'rollback',
                    });
                    if (!verdict.allowed) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: verdict.message,
                            },
                        });
                        return;
                    }
                }
                // [ADR-0131 D3 · D12 items 7–8] The walled refusal, after the
                // capability gate and before the protocol is resolved: under
                // `isolated` / `group` every organization shares the
                // environment's metadata, so only the platform operator rung
                // (or the engine itself) writes it, whatever the type. Inert
                // under `single`. See {@link walledCatalogRefusal}.
                {
                    const walled = await this.walledCatalogRefusal(req.params.type, ctx, environmentId, req);
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
                if (!(p as any).rollbackMetaItem) {
                    res.status(501).json({
                        error: 'Rollback operation not supported by protocol implementation',
                    });
                    return;
                }
                // [#6877] The `Number(...)` below already refuses an array
                // — but as `INVALID_REQUEST` "'toVersion' (positive integer)
                // is required", which tells a caller who supplied two valid
                // integers that they supplied none. Refusing the multiplicity
                // by name says what actually happened.
                // [#22877] Recognition first, over the measured closed set.
                if (refuseUnknownQueryParams(req, res, META_ITEM_ROLLBACK_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res, ['toVersion', META_ITEM_MEMBER_PARAM])) return;
                const body = (req.body && typeof req.body === 'object') ? req.body : {};
                const toVersionRaw = body.toVersion ?? body.version ?? req.query?.toVersion;
                const toVersion = Number(toVersionRaw);
                if (!Number.isFinite(toVersion) || toVersion < 1) {
                    res.status(400).json({
                        error: `'toVersion' (positive integer) is required`,
                        code: 'INVALID_REQUEST',
                    });
                    return;
                }
                // [#7749 producer, #7941 precedence] The request's authenticated
                // identity — one producer, shared by every `/meta` write (see
                // resolveMetaWriteActor). `X-Actor` is not consulted.
                const actor = await this.resolveMetaWriteActor(environmentId, req);
                const message = typeof body.message === 'string' ? body.message : undefined;
                // [ADR-0131 D6] No organization, as on the `PUT` twin: the
                // rollback restores a version of the environment-wide row.
                const result = await (p as any).rollbackMetaItem({
                    type: req.params.type,
                    name: req.params.name,
                    toVersion,
                    ...(environmentId ? { environmentId } : {}),
                    ...(actor ? { actor } : {}),
                    ...(message ? { message } : {}),
                    // [#22877] Reverts ONE member of a bundled type.
                    ...metaMemberSelector(req.query),
                });
                res.json(result);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'Restore the body at the given history version as the new live row',
            tags: ['metadata'],
        },
    });

    // GET /meta/:type/:name/diff?from=N&to=M — structural diff
    // between two historical versions (or one version vs current).
    registerPerItemRoute({
        method: 'GET',
        path: `${metaPath}/:type/:name/diff`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                // [#20378] AN AUTHORING DOOR — ruling 5865708652 (letter B),
                // the `/history` twin's gate on the same log. A diff reads
                // stored versions out of `sys_metadata_history`, where a
                // DRAFT save is recorded exactly as an active save, so
                // `?from=`/`?to=` naming a draft save — or the default
                // range, once a draft is pending — served unpublished
                // content to a caller who may not read drafts. The version
                // store cannot tell a draft version from a published one,
                // so there is no exact published-only answer to fall back
                // to: the `/meta/_drafts` shape, not the draft switches'
                // "answer as if absent". The caller is asked
                // {@link mayReadAuthoringTrail} FIRST, and one it does not
                // admit is refused in `GET /meta/_drafts`'s shape
                // (403 `FORBIDDEN`, the same nested envelope): before the
                // protocol is resolved, before the query is parsed, before
                // the mask posture, the current document or any version is
                // read — one answer for an item that exists, one that does
                // not and a draft-only one, with no item or version detail,
                // so the door is no existence oracle. The message names THIS
                // door, never drafts. Whoever it admits reads exactly what
                // they read before: every per-caller gate below, and ruling
                // 5856774816's author exemption, still apply to them.
                // [#23546] `setup.access` alone no longer admits it.
                //
                // Ruling 5856774816 (#20156) item 2 is narrowed for this
                // door and `/history` only: `/layers` and `?layers=true`
                // read the active row and keep the pruned plain-read answer.
                //
                // `diffCtx` is this door's one caller resolution. The refusal is
                // {@link refuseNonAuthoringCaller}, shared with `/history`
                // and `/audit` (#20441) so the three cannot drift apart.
                const diffCtx = await this.resolveExecCtx(environmentId, req)
                    .catch(rethrowAuthzStoreUnavailable);
                if (refuseNonAuthoringCaller(diffCtx, res, 'Comparing a metadata item\'s stored versions')) return;
                const p = await this.resolveProtocol(environmentId, req);
                if (!(p as any).diffMetaItem) {
                    res.status(501).json({
                        error: 'Diff operation not supported by protocol implementation',
                    });
                    return;
                }
                // [#6877] A repeated `?from=` became `NaN`, the spreads below
                // omitted the bound, and the door quietly diffed a different
                // pair of versions and answered 200.
                // [#23072] Recognition first, over the measured closed set.
                if (refuseUnknownQueryParams(req, res, META_ITEM_DIFF_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res, ['from', 'fromVersion', 'to', 'toVersion'])) return;
                // [#20139] The same drop for a SINGLE unreadable value: the
                // `parseV` helper that stood here answered `undefined` for
                // `?from=abc` (and `Infinity`), so `diffMetaItem` substituted
                // "the version before `to`" — or, for `?to=abc`, the CURRENT
                // body — and the door answered 200 with a comparison nobody
                // asked for; `?from=1.5` was forwarded and diffed against a
                // version that cannot exist. No request schema is declared for
                // this door, so a version reads as a whole number. The name the
                // caller used is the one read (and the one a refusal names):
                // `from` / `to` win over `fromVersion` / `toVersion` exactly as
                // the old `??` had it, and an empty value stays absent, as
                // `parseV('')` already answered.
                const fromParam = req.query?.from != null ? 'from' : 'fromVersion';
                const toParam = req.query?.to != null ? 'to' : 'toVersion';
                const fromVersion = readDeclaredQueryNumber(req.query, fromParam,
                    UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: true });
                const toVersion = readDeclaredQueryNumber(req.query, toParam,
                    UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: true });
                // [#20156] A diff discloses BOTH versions' values — for a
                // doc its `content`, for an app its `navigation`, for an
                // object its `fields` — so it owes the plain read's
                // per-caller answer for each side. Resolved in the plain
                // read's order: the ADR-0106 mask posture BEFORE any fetch
                // (D2/D3), then the current document, which a type the gate
                // judges here must have — the plain read answers its
                // absence, and there is no gate input to judge the versions
                // against.
                const diffMetaType = this.metaTypeSingular(req.params.type);
                let diffMaskPosture: ObjectSchemaMaskPosture;
                try {
                    diffMaskPosture = await (await this.resolveObjectMasker(environmentId, req, diffMetaType))(req.params.name);
                } catch (maskError: any) {
                    if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                        sendFieldVisibilityFault(res, req.params.name);
                        return;
                    }
                    throw maskError;
                }
                const diffGated = this.gatesPerCaller(diffMetaType);
                let diffCurrent: any;
                try {
                    diffCurrent = diffGated
                        ? await this.fetchCurrentMetaDocument(req, p)
                        : undefined;
                } catch (currentError: any) {
                    // [#7557, #24210] A withheld item (a disabled package's)
                    // is answered in the plain read's body, as
                    // {@link eventDoorRefusal} answers it.
                    if (thrownAnswerIsBareNotFound(currentError)) {
                        sendMetaItemAbsent(res);
                        return;
                    }
                    throw currentError;
                }
                // [#22639] A list view's and a dashboard's per-caller gate
                // is the item's OWN `requiredPermissions`. With no
                // published row there is no current document to judge, so
                // — as the event doors answer for every gated type — the
                // diff is served as before, and a never-published view or
                // dashboard keeps its builder's diff whether or not it
                // names a capability: no key, no change. Its draft is
                // judged where it is served whole (`?state=draft`,
                // `/layers`).
                if (diffGated && diffCurrent == null && !this.gatesOnItsOwnKey(diffMetaType)) {
                    sendMetaItemAbsent(res);
                    return;
                }
                // [#13406 · ADR-0131 D6] The ENV partition, stated by
                // omission, as on the history twin: `diffMetaItem` reads
                // the environment's `sys_metadata_history` rows, and
                // `version` is a per-(org, type, name) lineage counter, so
                // the environment lineage is the one every `/meta` write
                // now extends.
                const result = await (p as any).diffMetaItem({
                    type: req.params.type,
                    name: req.params.name,
                    ...(environmentId ? { environmentId } : {}),
                    ...(fromVersion !== undefined ? { fromVersion } : {}),
                    ...(toVersion !== undefined ? { toVersion } : {}),
                });
                // [#20156] Judge the current document and both sides, with
                // ONE judge (one books read, one holdings resolution): a
                // side the caller may not read is not served beside one
                // they may. `per-caller`, the stored-version doors' policy —
                // see `MetaReadGatePolicy`.
                //
                // [#20156] And each side is EMITTED as the gate serves it:
                // ruling 5856774816 — a caller who may write an app reads
                // both sides whole, and any other caller who may open it
                // reads each side pruned, exactly as the plain read prunes
                // it ({@link diffEmittedFrom}).
                let served: any = result;
                if (diffGated && diffCurrent != null) {
                    const { from, to } = this.diffSides(diffCurrent, result);
                    const judge = this.metaItemReadGate(
                        environmentId, req, p, diffMetaType, req.params.name, [diffCurrent, from, to],
                        this.STORED_VERSION_DOOR_POLICY,
                    );
                    const sides: any[] = [];
                    for (const side of [diffCurrent, from, to]) {
                        const verdict = await judge(side);
                        if (verdict.kind === 'refuse') {
                            verdict.send(res);
                            return;
                        }
                        sides.push(verdict.document);
                    }
                    served = this.diffEmittedFrom(result, sides[1], sides[2]);
                }
                // [ADR-0106 D5(4)] The object mask on the one key it
                // projects, `fields`, in every bucket and on both sides —
                // the redaction precedent one frame down (the stored bodies
                // are compared raw, the EMITTED values are the projected
                // ones), so a field the caller may not read is not served
                // as a diff value either.
                if (diffMaskPosture.kind === 'project' && served && typeof served === 'object') {
                    let faulted = false;
                    const maskFields = (value: unknown): unknown => {
                        if (faulted || !value || typeof value !== 'object' || Array.isArray(value)) return value;
                        const masked = this.maskObjectDocument(res, diffMaskPosture, req.params.name, { fields: value });
                        if (!masked) { faulted = true; return value; }
                        return (masked.document as { fields: unknown }).fields;
                    };
                    const onFields = (e: any, keys: readonly string[]) =>
                        (e && e.path === 'fields'
                            ? { ...e, ...Object.fromEntries(keys.map((k) => [k, maskFields(e[k])])) }
                            : e);
                    const bucket = (list: unknown, keys: readonly string[]) =>
                        (Array.isArray(list) ? list.map((e) => onFields(e, keys)) : list);
                    served = {
                        ...(served as Record<string, unknown>),
                        added: bucket((served as any).added, ['value']),
                        removed: bucket((served as any).removed, ['value']),
                        changed: bucket((served as any).changed, ['from', 'to']),
                    };
                    // `maskObjectDocument` already answered the ADR-0106 D6
                    // 5xx: a side projected to NO fields is never served.
                    if (faulted) return;
                } else if (diffMaskPosture.kind === 'undetermined') {
                    res.header('Cache-Control', 'private, no-store');
                }
                res.json(served);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'Diff two metadata versions (from/to query params; to defaults to the active version, from to the nearest earlier version whose body differs)',
            tags: ['metadata'],
        },
    });
}

/**
 * The `RestServer` members {@link registerMetaItemPublishedRoute} reads — every
 * one of them, and no other, in the order the body first reads them. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member the
 * class does not have is a compile error. `metaTypeSingular` is the class's
 * private STATIC, typed as the static it is. The module header's last section
 * says why there is no `routeManager` member, why the provider field is a
 * getter and why the body reaches the static through the host.
 */
export interface MetaItemPublishedRouteHost {
    metaTypeSingular: (typeof RestServer)['metaTypeSingular'];
    resolveObjectMasker: RestServer['resolveObjectMasker'];
    resolveProtocol: RestServer['resolveProtocol'];
    metaItemReadGate: RestServer['metaItemReadGate'];
    maskObjectDocument: RestServer['maskObjectDocument'];
    readonly objectQLProvider: RestServer['objectQLProvider'];
    resolveMetadataService: RestServer['resolveMetadataService'];
}

/**
 * Register the `/meta` published read — the eighth and last group of
 * `RestServer#registerMetadataEndpointsInner`' body, called by that method at
 * its position in its registration order, after the object state-machine read,
 * with the server's members as `this` and the method's head bindings as
 * `scope`. The method's own docblock, which the published declaration carries,
 * names the families, their switches and the ordering facts the route below
 * keeps.
 */
export function registerMetaItemPublishedRoute(this: MetaItemPublishedRouteHost, scope: MetaRouteScope): void {
    const { metaPath, isScoped, registerPerItemRoute } = scope;

    // GET /meta/:type/:name/published — ADR-0033 published snapshot. [#7526]
    //
    // Ledgered since #3563 (`meta.getPublished`) and implemented in the
    // dispatcher, but never mounted here — so the request fell into the
    // compound-name route below with `section=:name, name='published'`,
    // which answered a protection-envelope stub. Identical before and
    // after publish, identical for a name that does not exist: a route
    // that structurally could not 404.
    //
    // ONE arity since commit 7986d973f (stage 3 of the maintainer-ruled
    // retirement of compound-name addressing, 2026-08-25). This route used
    // to be mounted twice — the second registration was
    // `/:type/:section/:name/published`, folding `section` and `name` back
    // into one slash-bearing key so the SDK's
    // `getPublished('lead', 'views/all_leads')` could reach it.
    //
    // Stage 1 (commit 311433f6b) declared the item-name grammar and refuses every
    // slash-bearing name at the publish door, so no name reachable ONLY
    // through that arity can exist any more. What remains addressable is a
    // pre-grammar residue row, and it is reachable HERE: a percent-encoded
    // `%2F` matches this single-segment pattern and Hono decodes the
    // parameter back to `views/all_leads` (measured, not assumed), which is
    // the spelling the SDK now sends for every name. So the compound arity
    // was removed WITHOUT removing the capability — D1's "any stored junk
    // name remains listable and clearable" still holds through this door.
    {
        registerPerItemRoute({
            method: 'GET',
            path: `${metaPath}/:type/:name/published`,
            handler: async (req: any, res: any) => {
                try {
                    // [#23072] Recognition first, over the measured closed
                    // set — empty: this door reads no query parameter.
                    if (refuseUnknownQueryParams(req, res, META_ITEM_PUBLISHED_PARAMS)) return;
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const type = String(req.params?.type ?? '');
                    // [commit 7986d973f] No `section` fold: this route has one arity.
                    // A percent-encoded slash arrives already decoded here,
                    // so a residue name reads exactly as it is stored.
                    const name = String(req.params?.name ?? '');
                    // [#8278] The AUTHORITATIVE published store is consulted
                    // first: the `state:'active'` `sys_metadata` overlay row.
                    // Mirrors the dispatcher fix (#8031 / PR #8254,
                    // `packages/runtime/src/domains/meta.ts`) onto the
                    // transport that actually serves the cloud runtime — the
                    // two doors answered the same question from two stores,
                    // and only one of them had been corrected.
                    //
                    // Two publish lifecycles write to two different places:
                    //
                    //   - `MetadataManager.publishPackage` snapshots a body
                    //     into the row-local `publishedDefinition` key of its
                    //     own in-memory registry — the ADR-0016-era package
                    //     publish, which is what `getPublished` below reads.
                    //   - `publishPackageDrafts` / `promoteDraft` flips the
                    //     artifact's `sys_metadata` row `state:'draft' →
                    //     'active'`. ADR-0027 (E)(5) defines sealing a publish
                    //     as exactly that flip, `SysMetadataRepository` names
                    //     `'active'` "the published, live overlay", and
                    //     ADR-0033 §2 routes EVERY runtime authoring write
                    //     into that same ADR-0027 draft — so promoting it is
                    //     what "published" means for anything authored at
                    //     runtime. Those items were absent from the registry
                    //     `getPublished` consults, so this route answered 404
                    //     about an item that IS published.
                    //
                    // `getMetaItemLayered` is the narrow primitive on purpose.
                    // Its overlay layer is a strict `state:'active'` lookup
                    // that never reads a draft, and it reports that layer
                    // SEPARATELY from the code layer — so a null overlay is
                    // positively "no runtime-published row" and falls through
                    // to the untouched `getPublished` path below, which keeps a
                    // code-published item resolving to byte-identical bytes.
                    // The broader `getMetaItem` would not do: it folds the code
                    // layer into its own answer, so this route could no longer
                    // tell the two stores apart.
                    //
                    // [ADR-0131 D6] NO `organizationId`: the per-organization
                    // overlay axis is retired, so every publish this
                    // transport produces lands environment-wide, and this
                    // door resolves exactly those. A legacy
                    // organization-scoped row is not served; its promotion is
                    // ADR-0131 C7's.
                    //
                    // Environment scoping still holds: it comes from WHICH
                    // protocol `resolveProtocol` hands back, not from the
                    // request payload (`getMetaItemLayered` declares no
                    // `environmentId` member).
                    // [#20156] This door serves ONE document, the same
                    // representation the plain read serves — so it answers
                    // exactly what the plain read answers this caller: every
                    // gate arm (`all`), a partly-withheld app PRUNED, and the
                    // ADR-0106 object mask, its posture resolved BEFORE the
                    // fetch (D2/D3's `fetch → mask → send`). It ran none of
                    // them, so a member the plain read refuses
                    // `crm_admin_runbook` read its body here, and an object's
                    // unreadable fields were served whole. Both exits below
                    // send through `servePublished`.
                    const publishedMetaType = this.metaTypeSingular(type);
                    let publishedMaskPosture: ObjectSchemaMaskPosture;
                    try {
                        publishedMaskPosture = await (await this.resolveObjectMasker(environmentId, req, publishedMetaType))(name);
                    } catch (maskError: any) {
                        if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                            sendFieldVisibilityFault(res, name);
                            return;
                        }
                        throw maskError;
                    }
                    let publishedProtocol: any;
                    try {
                        publishedProtocol = await this.resolveProtocol(environmentId, req);
                    } catch { /* fall through to the code/package snapshot below */ }
                    const servePublished = async (document: any): Promise<void> => {
                        // The gate reads the protocol for its inputs (books,
                        // the doc corpus, the object registry). The swallowed
                        // resolution above is a fall-through for the SNAPSHOT;
                        // a gate input is never read as absent, so a type the
                        // gate judges resolves it again and lets it throw.
                        const gateProtocol: RestProtocol = publishedProtocol
                            ?? await this.resolveProtocol(environmentId, req);
                        const verdict = await this.metaItemReadGate(
                            environmentId, req, gateProtocol, publishedMetaType, name, [document],
                            { arms: 'all', app: 'gate' },
                        )(document);
                        if (verdict.kind === 'refuse') {
                            verdict.send(res);
                            return;
                        }
                        let served = verdict.document;
                        if (publishedMaskPosture.kind === 'project') {
                            const related = await relateObjectSchemaMaskPosture(publishedMaskPosture, served); // [#21884]
                            const masked = this.maskObjectDocument(res, related, name, served);
                            if (!masked) return;
                            served = masked.document;
                        } else if (publishedMaskPosture.kind === 'undetermined') {
                            res.header('Cache-Control', 'private, no-store');
                        }
                        res.json(served);
                    };
                    // [#20156] The overlay found is SERVED outside the
                    // `try` below: that `catch` classifies a failed overlay
                    // READ, and a gate fault raised while serving must reach
                    // `handleRouteError` as itself — never fall through to
                    // the snapshot as though no overlay existed.
                    // [#7557, #24210] A disabled package's item is answered
                    // as a name with nothing behind it, as the plain read
                    // and the list answer it. Neither store below knows a
                    // disable (the layered read keeps serving its resolution
                    // reader, and the snapshot carries no owner), so the
                    // owner is the one the plain read's kept protection
                    // envelope names, `packageId`, asked of the registry's
                    // `isPackageDisabled`: the predicate the protocol asks of
                    // that same field. An object is the layered read's own
                    // refusal below; `package` is never hidden.
                    let withheld = false;
                    if (publishedMetaType !== 'object' && publishedMetaType !== 'package'
                        && typeof publishedProtocol?.getMetaItem === 'function') {
                        const ql = await wiredEngineOrLoud(
                            Boolean(this.objectQLProvider),
                            () => this.objectQLProvider!(environmentId),
                        );
                        const registry = (ql as any)?.registry;
                        if (typeof registry?.isPackageDisabled === 'function') {
                            const envelope = await publishedProtocol.getMetaItem({ type, name });
                            withheld = registry.isPackageDisabled(envelope?.packageId) === true;
                        }
                    }
                    let publishedOverlay: unknown;
                    if (!withheld && typeof publishedProtocol?.getMetaItemLayered === 'function') {
                        try {
                            const layered = await publishedProtocol.getMetaItemLayered({
                                type,
                                name,
                            });
                            if (layered?.overlay !== undefined && layered?.overlay !== null) {
                                // [#21002, #21986, ADR-0126 §2, ADR-0062 D4]
                                // When the layered read put a code layer
                                // over this stored row, this door serves
                                // that effective layer, not the row. The
                                // protocol decides it with one predicate,
                                // `declinesStoredRow`, for both name
                                // classes: a shipped flow name (the
                                // loader's body; `flow` is Regime C,
                                // "never an overlay read path") and a
                                // code-defined datasource name (the code
                                // definition; "code wins on collision").
                                // The predicate is ASKED of its owner with
                                // the answer's own `type` / `name`, never
                                // re-derived here, so this door, the
                                // by-name read, the list and
                                // `getMetaItemLayered` read one rule. Every
                                // other stored row is served exactly as
                                // before — an `object` too, whose effective
                                // layer differs from its row by folding, not
                                // by this decision — and so is every row of a
                                // protocol that brings no such predicate.
                                const decliner: { declinesStoredRow?(type: string, name: unknown): boolean } = publishedProtocol;
                                publishedOverlay = typeof decliner.declinesStoredRow === 'function'
                                    && decliner.declinesStoredRow(layered.type, layered.name)
                                    ? layered.effective
                                    : layered.overlay;
                            }
                        } catch (overlayError: any) {
                            // [#5532] The overlay read is NOT blanket-swallowed,
                            // and this is the second deliberate divergence from
                            // the dispatcher twin. `getMetaItemLayered` documents
                            // that it throws `503 SERVICE_UNAVAILABLE` ONLY when a
                            // read that would decide a layer did not happen; the
                            // benign "table not provisioned yet" case genuinely
                            // means "no overlay row" and returns normally with
                            // `overlay: null`. So a throw here is an availability
                            // failure, and falling through would let it reach the
                            // client as `404 Not found` — an availability failure
                            // reported as an existence fact, which is exactly the
                            // #5532 defect this package pins in
                            // `rest-meta-outage-vs-miss.test.ts`. A declared
                            // status is re-thrown so `handleRouteError` renders
                            // the producer's own 503; anything undeclared (a
                            // third-party protocol throwing something shapeless)
                            // still falls through, so this cannot make the
                            // code-published path newly fail closed.
                            if (typeof overlayError?.status === 'number') throw overlayError;
                        }
                    }
                    if (publishedOverlay !== undefined) {
                        await servePublished(publishedOverlay);
                        return;
                    }

                    const svc = await this.resolveMetadataService(environmentId, req);
                    if (typeof (svc as any)?.getPublished !== 'function') {
                        // [#8297] Reached ONLY when the overlay consult above
                        // found nothing (a null `layered.overlay`) — so this is
                        // no longer "this kernel cannot answer /published" (the
                        // pre-#8278 reading); it is the narrower, rarer
                        // condition the message below actually states: nothing
                        // is runtime-published for this item, AND this kernel's
                        // metadata slot has no code/package store to fall back
                        // to (`getPublished` is optional on `IMetadataService`
                        // and unimplemented here). Status, `code`, and routing
                        // order are unchanged — only the prose was stale.
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'Nothing is runtime-published for this item, and this kernel has no code/package store (metadata.getPublished() is not available).',
                            },
                        });
                        return;
                    }
                    // [commit 26f3588fb] FOLDED here too — the smaller second site
                    // of the same class. The layered consult above folds
                    // internally (protocol boundary), but this fallback
                    // reads the code/package registry, which stores
                    // CANONICAL types; handed the raw segment it answered
                    // 404 for a recognised plural and 200 for the singular
                    // twin of the same code-published item.
                    const data = withheld
                        ? undefined
                        : await (svc as any).getPublished(canonicalMetaUrlType(type), name);
                    // The 404 this route could never produce before. An
                    // item that exists but was never published still
                    // answers 200 with its current definition — that is
                    // `getPublished`'s documented fallback, and it is a
                    // different fact from "no such item".
                    if (data === undefined) {
                        res.status(404).json({
                            error: { code: 'NOT_FOUND', message: 'Not found' },
                        });
                        return;
                    }
                    await servePublished(data);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Get the published version of a metadata item',
                tags: ['metadata'],
            },
        });
    }
}
