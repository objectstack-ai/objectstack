// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/meta` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-10,
 * the terminal cut). The metadata read/write surface: type listing, item
 * CRUD (ADR-0033 draft-aware via the protocol service), the ADR-0046 doc
 * slimming, and org-scoped reads. The anonymous gate keys off the
 * anonymous-deny gate (unconditional since #3963).
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
// [commit 67ceb9aef] `canonicalMetaUrlType` is the FOLD this transport was missing.
// See the two call sites below for what each one was deciding raw.
import { canonicalMetaUrlType, pluralToSingular } from '@objectstack/spec/shared';
import { CoreServiceName } from '@objectstack/spec/system';
// [ADR-0106 / #3682] Metadata-plane FLS — the SAME projection the REST `/meta`
// exits run. Two dispatchers, one normalizer (`@objectstack/metadata-core`),
// because D5's "every schema-serving outlet" is only true if a future exit
// inherits the decision instead of re-deciding it.
import {
    OBJECT_SCHEMA_MASK_NOT_APPLICABLE,
    ObjectSchemaMaskEvaluationError,
    isObjectSchemaMaskExempt,
    isObjectSchemaMaskingEnabled,
    relateObjectSchemaMaskPosture,
    resolveObjectSchemaMaskPosture,
    type ObjectSchemaMaskPosture,
    // [#8805] Moved to `metadata-core` so the REST `/meta` write doors decide
    // this the same way rather than through a second copy. Behaviour unchanged.
    organizationIdForMetaWrite,
    // [#12702] The capability half of the same decision, from the same home
    // and for the same no-second-copy reason: `manage_metadata` as before,
    // plus `manage_org_presentation` for org-overridable types written
    // org-scoped to the caller's own active organization.
    metaWriteCapabilityVerdict,
} from '@objectstack/metadata-core';
// [#15238] The DECLARED protocol contracts this domain's request literals are
// compiled against. Imported, never restated: a second hand-written
// `getMetaItem(…)` signature here would silently drift from the one the spec
// declares and `ObjectStackProtocolImplementation` states it `implements` —
// which is the whole reason `MetaDomainProtocol` below is `Pick`ed rather than
// written out. Same move `domains/packages.ts` and `domains/mcp.ts` make.
import type { MetadataProtocol } from '@objectstack/spec/api';
// [#21002] The implementation class, for the ONE member it declares that this
// domain asks (`isShippedFlowName`) — `Pick`ed below, never restated.
import type { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#20193] THE per-caller read gate of a `/meta/:type/:name` document — the one
// `RestServer` asks, published by `@objectstack/rest` so this transport asks it
// too instead of a second audience resolver (ruling `5793362670` item 1).
// [#20237] …and its LIST twin, for `/meta/:type`, on the same ports.
// [#20320] …and the rest of what `RestServer`'s `/meta` reads answer: the list
// route's whole post-read chain, the locale parse it reads, the anonymous
// gates' `public`-audience predicate and the stored-version doors' policy.
// [#20408] …and the item route's post-read chain, the book-tree route, the
// list's unknown-type refusal, the object mask's cache posture and the
// organization a caller's `/meta` request is scoped to.
// [#20478] …and the layered view, on both of its spellings: its post-read
// chain, the deprecated `?layers=` flag's parse and the headers that flag is
// served under.
// Imported, never restated — AGENTS.md 〈Route & surface ownership〉 rule 1.
import {
    createMetaBookTreeAnswer,
    createMetaItemAnswer,
    createMetaItemReadGate,
    createMetaLayeredAnswer,
    createMetaListAnswer,
    isPublicAudienceRead,
    metaCallerOrganizationId,
    metaItemLayersDeprecationHeaders,
    metaReadOrganizationId,
    metaRequestLocale,
    metaTypeReadRefusal,
    metaTypeWriteRefusal,
    projectMetaObjectSchema,
    refuseUnknownMetaListType,
    STORED_VERSION_DOOR_POLICY,
    translateMetaEnvelope,
    translateMetaList,
    wantsMetaItemLayers,
    type MetaItemAnswer,
    type MetaItemAnswerSources,
    type MetaItemReadGateSources,
    type MetaLayeredAnswer,
    type MetaListAnswerSources,
    type MetaListTranslationSources,
    type MetaPublicReadRoute,
    type MetaReadGateCaller,
    type MetaReadGatePolicy,
} from '@objectstack/rest';
import { buildApiError } from '../error-envelope.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * [#15238] The `protocol` service slot **as this domain reaches it** — one
 * statement of the handle, replacing nine independent `protocol` seams in this
 * file, four of which reached a verb through an `any` cast.
 *
 * ## What was wrong with the seam
 *
 * `deps.resolveService(context, 'protocol')` answers `any`. That is not an
 * oversight — {@link DomainHandlerDeps.resolveService} types its return from
 * `ServiceSlotContracts`, and `protocol` is deliberately left unmapped there
 * ("real services with no written contract, so they keep today's `any` rather
 * than being given a shape here that nothing verifies"). The `any` is honest
 * about the SLOT. What it also did, silently, was hand every request literal
 * downstream of it an unchecked call target: the end state of commit cccbe51bf's ruled pattern —
 * "an undeclared key in a request literal is a compile error" — stopped one
 * seam short here, so a misspelt or undeclared key in these literals compiled,
 * and so did a misspelt VERB.
 *
 * ## Why the type is here and not on the slot
 *
 * Mapping `'protocol'` in `ServiceSlotContracts` would type every consumer at
 * once, but it is a `packages/spec` change that would state that a filled slot
 * IS a `MetadataProtocol`, whose members are mostly REQUIRED — the shape the
 * probes below exist to deny — and it would have to answer for the three verbs
 * in the second group, which no contract declares at all. So the narrowing
 * happens at the consumer, once, exactly as `domains/packages.ts` (#13598) and
 * `domains/mcp.ts` (commit e783e163d) narrow the same slot for their own seams.
 *
 * ## ⛔ Every member is OPTIONAL, and the runtime probes STAY
 *
 * A host may occupy this slot with a partial object — that is the documented
 * reason the `typeof protocol.<verb> === 'function'` probes exist, and every
 * one of them survives this change unchanged in meaning. `Partial<…>` is what
 * makes the type agree with them instead of contradicting them: tightening the
 * type and then deleting a probe would trade a compile-time improvement for a
 * runtime crash. The type answers "is this key declared?"; the probe answers
 * "did THIS host bring the verb?". Two different questions, both still asked.
 *
 * ## Where the ledger honestly ends
 *
 * The first group names shapes someone DECLARES: the spec's `MetadataProtocol`,
 * whose `GetMetaItemRequest` / `GetMetaItemsRequest` / `SaveMetaItemRequest` /
 * `GetMetaItemLayeredRequest` are what this file's literals are now compiled
 * against. The second group has no declared request shape anywhere:
 * `@objectstack/metadata-protocol` types `listDrafts`, `migrateStoredMetadata`
 * and `getProjectId` inline on the implementation class and exports nothing for
 * them. Writing a structural request type for them HERE would be a private
 * restatement that nothing verifies — the thing #9846 retired one file over. So
 * their request keeps `any` and the gap stays visible and greppable: declaring
 * them is producer-side work, not this consumer's to invent. What the entries
 * still buy is the verb NAME — `protocol.migrateStoredMetadta` is now a compile
 * error where the `any` handle took any spelling at all.
 *
 * `environmentId` is a PROPERTY, not a verb: the scope probe at the object-read
 * branch reads it as the fallback for a host that brings no `getProjectId`.
 * `unknown` rather than `string`, for the same reason the verbs above keep
 * `any` requests — nothing declares its type, and the only thing that branch
 * asks of it is whether it is `undefined`.
 *
 * [#21002] A third group: `isShippedFlowName`, the predicate the layered read
 * decides its effective layer with, which `/published` asks so it follows that
 * decision. Its signature is DECLARED — on `ObjectStackProtocolImplementation`
 * itself — so it is `Pick`ed from that class, never restated: a rename at the
 * producer is a compile error here, the same move `domains/automation.ts`
 * makes for `packagedBaseRefusal`.
 */
export type MetaDomainProtocol =
    Partial<Pick<MetadataProtocol,
        'getMetaTypes' | 'getMetaItems' | 'getMetaItem' | 'saveMetaItem' | 'getMetaItemLayered'>>
    & Partial<Pick<ObjectStackProtocolImplementation, 'isShippedFlowName'>>
    & {
        /** ⚠️ Undeclared request shapes — see "Where the ledger honestly ends". */
        listDrafts?(request: any): Promise<any>;
        migrateStoredMetadata?(request: any): Promise<any>;
        getProjectId?(): unknown;
        /** ⚠️ Undeclared PROPERTY — the `getProjectId` fallback, read for presence only. */
        environmentId?: unknown;
    };

/**
 * [#15238] Resolve the `protocol` slot as {@link MetaDomainProtocol}.
 *
 * THE one narrowing point for this file, mirroring `domains/packages.ts`'s
 * `resolveProtocol`. `resolveService` answers `any` for this name, so the
 * widening happens here and nowhere else — every call site downstream holds a
 * typed handle, and a tenth call site added next month gets the type by
 * construction rather than by remembering to write one.
 *
 * ⛔ Not a guard and not a replacement for one: it neither probes for verbs nor
 * rejects a partial host. `undefined` still means "no protocol service", and
 * each caller still asks its own `typeof … === 'function'` capability question.
 */
async function resolveProtocol(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<MetaDomainProtocol | undefined> {
    return await deps.resolveService(context, 'protocol');
}

/**
 * [#20338] May this caller read PENDING metadata (a `sys_metadata` row in
 * `state: 'draft'`)? The one question this domain's draft doors ask —
 * `_drafts`, the item and list reads' `?preview=draft` and [#20320] the item
 * read's `?state=draft` — delegated, never
 * restated, to the predicate `_drafts` has always asked
 * (`isObjectSchemaMaskExempt`: a system caller, `studio.access`, `setup.access`
 * or `manage_metadata`). `RestServer` asks the same predicate through its own
 * `mayReadPendingDrafts`, whose docblock carries the rule: a caller this does
 * not admit is answered the read as if the switch were absent (the published
 * version, or the door's own absence); only `_drafts`, which has no published
 * answer, refuses. `meta-draft-read-builder-gate.test.ts` beside this file
 * ledgers every draft switch here and holds this to a bare delegation.
 */
function mayReadPendingDrafts(caller: unknown): boolean {
    return isObjectSchemaMaskExempt(caller);
}

/**
 * [commit 4fc4a3c0b] The methods `/metadata/:type/:name` actually serves — the single
 * source for both the `Allow` header and the refusal message, so the two
 * cannot drift apart.
 *
 * `PUT` is the save branch; `GET` is the read that follows it. `HEAD` is in the
 * set because it is **measured to be served today**: driven through the real
 * `createHonoApp` catch-all, `HEAD /api/v1/meta/object/account` returns `200`
 * with `protocol.getMetaItem` called once (the transport strips the body), so
 * refusing it would not restore an invariant — it would regress a legitimate
 * read verb that works.
 */
const METADATA_ITEM_METHODS = ['GET', 'HEAD', 'PUT'] as const;

export function createMetaDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/meta',
        handler: (req, context) =>
            handleMetadataRequest(deps, req.path.substring(5), context, req.method, req.body, req.query),
    };
}

/**
 * [#20320] The READ route shape this domain would serve `parts` with, as the
 * shared `isPublicAudienceRead` names it — or `undefined` for every shape that
 * is not one of this domain's list, item or book-tree reads.
 *
 * [#20408] `book/:name/tree` is one of them now: this domain serves the route
 * `RestServer` serves ({@link isBookTreePath}), with its type segment LITERAL
 * as there — `/meta/books/:name/tree` is no route on either transport. Every
 * other path of three or more segments is `/published`, [#20478] `/layers`, the
 * FSM `/state/:field` read or the located `ROUTE_NOT_FOUND`, and none is exempt
 * — as on `RestServer`, where `/layers` keeps the anonymous deny and only the
 * item read's `?layers=` flag reaches a `public` book's §6.7 gate.
 */
function metaReadRouteOf(parts: readonly string[]): MetaPublicReadRoute | undefined {
    if (parts.length === 1) return 'list';
    if (parts.length === 2) return 'item';
    if (isBookTreePath(parts)) return 'book-tree';
    return undefined;
}

/** [#20408] `GET /meta/book/:name/tree` — the ADR-0046 §6 book-tree route, matched exactly as `RestServer` registers it. */
function isBookTreePath(parts: readonly string[]): boolean {
    return parts.length === 3 && parts[0] === 'book' && parts[2] === 'tree';
}

/**
 * [#20320 · #20408] A `deps.success` answer that carries the headers a `/meta`
 * read owes — `Vary: Accept-Language` on a body translated per request, and
 * `Cache-Control: private, no-store` on an object schema served under an
 * undetermined field visibility (ADR-0106 D6 tier 2). `deps.success` takes no
 * headers, so this is the ONE place this domain builds such an answer; its
 * body is `deps.success`'s declared envelope, spread. A header whose value is
 * `undefined` is not owed; with none owed the answer is `deps.success`'s own.
 */
function successWithHeaders(
    deps: DomainHandlerDeps,
    data: unknown,
    headers: Readonly<Record<string, string | undefined>>,
): HttpDispatcherResult {
    return withHeaders(deps.success(data), headers);
}

/**
 * [#20478] ANY `deps.*` answer, carrying the headers a `/meta` read owes it —
 * the ONE place this domain builds an answer with headers ({@link
 * successWithHeaders} is its success case). The deprecated `?layers=` flag owes
 * `Deprecation` and `Link` on EVERY answer it gets, refusals included, as on
 * `RestServer`, which sets them before it reads; `deps.error` takes no headers
 * either. The body is the `deps.*` helper's declared envelope, spread. A header
 * whose value is `undefined` is not owed; with none owed the answer is the
 * helper's own.
 */
function withHeaders(
    response: { status: number; body: any },
    headers: Readonly<Record<string, string | undefined>>,
): HttpDispatcherResult {
    const set: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) if (value !== undefined) set[name] = value;
    if (Object.keys(set).length === 0) return { handled: true, response };
    return { handled: true, response: { ...response, headers: set } };
}

/**
 * [#5224 · #20320] Said once per process: this host's `api` list face has no
 * endpoint matcher to ask, so it lists what is STORED — which may advertise a
 * route that answers 404. `error`, as `RestServer`'s twin notice: the
 * consequence is a contract face that may lie, and the remedy is wiring.
 */
let warnedMissingEndpointMatcher = false;
function notifyMissingEndpointMatcher(surface: string): void {
    if (warnedMissingEndpointMatcher) return;
    warnedMissingEndpointMatcher = true;
    (globalThis as any).console?.error?.(
        `[HttpDispatcher] no endpoint matcher is reachable (no \`metadata\` service with \`matchEndpoint\`), so ${surface} `
        + 'cannot narrow declared `api` items to the ones this runtime serves. It is listing what is STORED instead, '
        + 'which may advertise routes that answer 404. Register a metadata service that implements `matchEndpoint` '
        + 'in the kernel this dispatcher serves to restore the guarantee.',
    );
}

/**
 * [ADR-0106 D6 tier 3] The dispatcher's answer when the caller's field
 * visibility could not be evaluated: a 503, never the unmasked body and never
 * an empty-fields 200. Mirrors the REST layer's `sendFieldVisibilityFault`.
 */
function fieldVisibilityFault(deps: DomainHandlerDeps, objectName: string): HttpDispatcherResult {
    return { handled: true, response: fieldVisibilityFaultResponse(deps, objectName) };
}

/** [#20478] {@link fieldVisibilityFault}'s response alone, for an answer that owes it headers ({@link withHeaders}). */
function fieldVisibilityFaultResponse(deps: DomainHandlerDeps, objectName: string): { status: number; body: any } {
    return deps.error(
        `Field visibility for object '${objectName}' could not be evaluated; the object schema is not being served.`,
        503,
    );
}

/**
 * [ADR-0106 D2/D4/D6/D7/D8] Build this request's object-schema masker — the
 * dispatcher-side twin of `RestServer.resolveObjectMasker`.
 *
 * Resolved once per request and asked per object name, so the `/metadata` list
 * read pays one context + service resolution for the whole page.
 *
 * [#20408] `metaType` is the FOLDED type the masker serves, as on `RestServer`:
 * every type but `object` is answered the not-applicable passthrough without
 * resolving anything, so an exit that serves every type (the item read) can
 * resolve its posture unconditionally, before its fetch.
 */
async function resolveObjectMasker(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    metaType: string,
): Promise<(objectName: string) => Promise<ObjectSchemaMaskPosture>> {
    if (metaType !== 'object') return async () => OBJECT_SCHEMA_MASK_NOT_APPLICABLE;
    const enabled = isObjectSchemaMaskingEnabled();
    if (!enabled) {
        const disabled: ObjectSchemaMaskPosture = { kind: 'passthrough', reason: 'disabled' };
        return async () => disabled;
    }
    const security = await deps.resolveService(context, 'security').catch(() => undefined);
    const execCtx = (context as any)?.executionContext;
    return (objectName: string) => resolveObjectSchemaMaskPosture({
        objectName,
        context: execCtx,
        security: security as any,
        enabled: true,
        telemetry: {
            warn: (message, meta) => {
                (globalThis as any).console?.warn?.(message, meta);
            },
        },
    });
}

/**
 * Project one served object schema, or report the D6 tier-3 fault.
 *
 * `'fault'` covers both the throw tier and the empty-projection case — see
 * `applyObjectSchemaMask`'s `emptied` for why an empty-fields 200 is not an
 * option the ADR leaves open.
 *
 * [#20408] The projection is the shared `projectMetaObjectSchema`, so the
 * answer carries the `Cache-Control` an undetermined posture owes (ADR-0106 D6
 * tier 2: the schema goes out UNMASKED, `private, no-store`). This exit masked
 * without it — the schema was served with no cache header at all, where
 * `RestServer` answers `private, no-store`.
 */
async function maskObjectSchema(
    masker: (objectName: string) => Promise<ObjectSchemaMaskPosture>,
    objectName: string,
    document: any,
): Promise<{ ok: true; document: any; cacheControl?: string } | { ok: false }> {
    let posture: ObjectSchemaMaskPosture;
    try {
        posture = await masker(objectName);
    } catch (error) {
        if (error instanceof ObjectSchemaMaskEvaluationError) return { ok: false };
        throw error;
    }
    // [#21884] Related to the fetched document: its `objectOverride` params name other objects.
    return projectMetaObjectSchema(await relateObjectSchemaMaskPosture(posture, document), document);
}

/**
 * [#20193] The policy the plain item read and `/published` run the shared gate
 * under — every arm, the per-deployment ones included, and the app PRUNED: the
 * two doors that serve the document a client renders, exactly as `RestServer`
 * runs them (`MetaReadGatePolicy` in `@objectstack/rest` says why).
 */
const RENDERED_DOCUMENT_POLICY: MetaReadGatePolicy = Object.freeze({ arms: 'all', app: 'gate' });

/**
 * [#20193] Where the shared gate's nav-servability prune log records what it
 * has already said — one line per `app|entry|object|reason` per process, the
 * dedupe `RestServer` keeps per instance.
 */
const NAV_PRUNE_LOGGED = new Set<string>();

/**
 * [#20193] This transport's I/O, as the shared per-caller read gate takes it
 * — and, [#20237], the list gate beside it, which takes the same ports.
 *
 * Only I/O — ⛔ no decision lives here; every verdict is
 * `createMetaItemReadGate`'s, the one `RestServer` asks:
 *
 *  - the caller is the execution context `dispatch()` already resolved for
 *    this request (the shared `resolveAuthzContext`, the same resolution the
 *    REST transport runs);
 *  - the security service holdings are read through is this request's;
 *  - a metadata LIST read is the protocol's `getMetaItems`, whose environment
 *    is the kernel `dispatch()` resolved — `undefined` when this host's
 *    protocol has no list read, which the gate treats as an unreadable input
 *    (fail closed, ADR-0049), never as an empty one;
 *  - the ADR-0057 D10 service probe is `resolveService`, the capability probe
 *    whose collapsed `undefined` is exactly "not registered here".
 *
 * [#20320] `mayWriteItem` — handed in only by a door whose policy honours the
 * author exemption (the `?state=draft` read): this transport's own save-door
 * answer (`saveVerdict` in {@link handleMetadataRequest}), carried on a COPY of
 * the context — the same object serves every other consumer of this request.
 */
function metaItemReadGateSources(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    protocol: MetaDomainProtocol | undefined,
    mayWriteItem?: boolean,
): MetaItemReadGateSources {
    return {
        resolveCaller: async () => {
            const caller = context.executionContext as MetaReadGateCaller | undefined;
            return mayWriteItem === undefined || !caller ? caller : { ...caller, mayWriteItem };
        },
        resolveSecurityService: () => deps.resolveService(context, 'security'),
        listMetaItems: (type) => (typeof protocol?.getMetaItems === 'function' ? protocol.getMetaItems({ type }) : undefined),
        serviceProbe: () => async (name: string) => {
            try {
                return (await deps.resolveService(context, name)) != null;
            } catch {
                return false;
            }
        },
        navPruneLogged: NAV_PRUNE_LOGGED,
    };
}

/**
 * [#20193] Ask the shared per-caller read gate about ONE document `/published`
 * is about to serve, and write its refusal on this transport's wire.
 *
 * [#20408] The plain item read and its `?state=draft` branch no longer come
 * here: they hand their envelope to the whole item chain
 * ({@link answerMetaItem}), whose first step is this same gate.
 *
 * The item read and `/published` used to serve whatever the store answered:
 * no ADR-0046 §6.7 docs audience, no app nav filter, no ADR-0057 D10 gate. On a
 * host that mounts just the `${prefix}/*` catch-all this handler is the only
 * answer to those reads, so a member `RestServer` refuses a
 * `{ permissionSet }`-gated doc read its body here, and an app's
 * `requiredPermissions` entries reached every member.
 *
 * The refusals, in this transport's envelope (`deps.error`, the ADR-0112 nested
 * one every other refusal in this file speaks), with `RestServer`'s status and
 * code:
 *
 *  - `absent` → the SAME `deps.error('Not found', 404)` this handler answers
 *    for a name with nothing behind it, so an unpublished app stays externally
 *    unobservable (ADR-0045 §3);
 *  - `app-permission` / `docs-audience` → `403 PERMISSION_DENIED` /
 *    `401 UNAUTHENTICATED` with the gate's message.
 *
 * A gate input that could not be read (the books or doc list read threw) is
 * answered as that fault — its own status, `500` for a shapeless one — ⛔ never
 * as the document, and never as a 403 that would tell a holder they hold
 * nothing.
 */
async function gateMetaItemDocument(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    protocol: MetaDomainProtocol | undefined,
    metaType: string,
    name: string,
    document: any,
): Promise<{ ok: true; document: any } | { ok: false; response: { status: number; body: any } }> {
    let verdict;
    try {
        const judge = createMetaItemReadGate(
            metaItemReadGateSources(deps, context, protocol), metaType, name, [document], RENDERED_DOCUMENT_POLICY,
        );
        verdict = await judge(document);
    } catch (e: any) {
        return { ok: false, response: deps.errorFromThrown(e, 500) };
    }
    if (verdict.kind === 'serve') return { ok: true, document: verdict.document };
    const { refusal } = verdict;
    if (refusal.reason === 'absent') return { ok: false, response: deps.error('Not found', 404) };
    return { ok: false, response: deps.error(refusal.message, refusal.status, { code: refusal.code }) };
}

/**
 * [#20237 · #20320] Answer ONE list this transport is about to serve: hand the
 * store's answer to THE list chain (`createMetaListAnswer`, the one
 * `RestServer`'s `GET /meta/:type` calls — ⛔ no step lives here) and write
 * its answer on this transport's wire.
 *
 * The chain runs, in `RestServer`'s order, the `api` served-set face, the
 * per-caller list gate, `?id=`, `?object=`, the doc locale collapse and slim,
 * the object mask over this transport's masker ({@link resolveObjectMasker}) and
 * the translation.
 * This branch used to run the gate, the mask and a doc slim that compared the
 * RAW segment — so `?id=`, `?object=`, `/meta/docs`, the locale, the
 * translation and the served-set face all answered differently here.
 *
 * `data` is either list shape this branch hands around (a bare array or a
 * `{ type, items }` envelope), and the answer keeps that shape; `listType` is
 * the folded singular type; `previewDrafts` is the ADMITTED switch the branch
 * declared. The answer carries `Vary: Accept-Language` because its body now
 * varies by it, as `RestServer`'s does, and [#20408] `Cache-Control: private,
 * no-store` when the chain says an undetermined posture served a schema
 * unmasked (ADR-0106 D6 tier 2). A gate or matcher input that could not
 * be read (a doc list's books read threw) is answered as that fault — its own
 * status, `500` for a shapeless one — ⛔ never as the unfiltered list; so is a
 * mask fault that is not the D6 tier-3 one, which keeps its `503`.
 */
async function answerMetaList(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    protocol: MetaDomainProtocol | undefined,
    listType: string,
    query: any,
    previewDrafts: boolean,
    data: any,
): Promise<HttpDispatcherResult> {
    // The locale parse `RestServer.extractLocale` runs, over this request.
    const requestLocale = (i18n?: unknown) => metaRequestLocale({ headers: context.request?.headers, query }, i18n);
    const sources: MetaListAnswerSources = {
        ...metaItemReadGateSources(deps, context, protocol),
        resolveEndpointMatcher: async () => {
            try {
                return await deps.resolveService(context, 'metadata');
            } catch {
                return undefined;
            }
        },
        notifyMissingEndpointMatcher,
        // [#20408] The masker only: the chain projects each schema and says
        // which cache posture the page owes.
        resolveObjectMasker: () => resolveObjectMasker(deps, context, 'object'),
        requestLocale,
        translateList: (metaType, items) => translateMetaList(
            metaTranslationSources(deps, context, protocol, requestLocale), metaType, items,
        ),
    };
    try {
        const answer = await createMetaListAnswer(sources, { metaType: listType, query, previewDrafts })(data);
        if (!answer.ok) return fieldVisibilityFault(deps, answer.object);
        return successWithHeaders(deps, answer.data, {
            'Cache-Control': answer.cacheControl,
            Vary: 'Accept-Language',
        });
    } catch (e: any) {
        return { handled: true, response: deps.errorFromThrown(e, 500) };
    }
}

/**
 * [#20320 · #20408] This transport's I/O for a metadata translation — the
 * request's i18n service, its protocol (for the #8284 packaged object base)
 * and the locale parse `RestServer.extractLocale` runs, over this request.
 */
function metaTranslationSources(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    protocol: MetaDomainProtocol | undefined,
    requestLocale: (i18n?: unknown) => string | undefined,
): MetaListTranslationSources {
    return {
        resolveI18nService: async () => {
            try {
                return await deps.resolveService(context, 'i18n');
            } catch {
                return undefined;
            }
        },
        resolveProtocol: async () => protocol,
        requestLocale,
    };
}

/**
 * [#20408] Answer ONE `/meta/:type/:name` document this transport is about to
 * serve: hand the store's envelope to THE item chain (`createMetaItemAnswer`,
 * the one `RestServer`'s plain read calls — ⛔ no step lives here) and write
 * its answer on this transport's wire.
 *
 * The chain runs, in `RestServer`'s order, absence, the per-caller gate under
 * the door's `policy`, the doc locale collapse, the ADR-0106 mask under the
 * posture resolved before the fetch, and the body: the translation and
 * `sortability` beside an object schema. This read used to run the gate and
 * the mask alone, so it served every item untranslated, a doc with its whole
 * `translations` map, an object schema with no `sortability`, no `Vary`, and
 * no `Cache-Control` on an undetermined posture.
 *
 * The answers, in this transport's envelope, with `RestServer`'s status and
 * code: `absent` → the SAME `deps.error('Not found', 404)` this handler answers
 * for a name with nothing behind it (ADR-0045 §3: an unpublished app stays
 * externally unobservable); `app-permission` / `docs-audience` →
 * `403 PERMISSION_DENIED` / `401 UNAUTHENTICATED`; `mask-fault` → the D6
 * field-visibility fault. A gate input that could not be read is answered as
 * that fault — its own status, `500` for a shapeless one — ⛔ never as the
 * document. `mayWriteItem` is handed in only by a door whose policy honours the
 * author exemption (see {@link metaItemReadGateSources}).
 */
async function answerMetaItem(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    protocol: MetaDomainProtocol | undefined,
    request: { metaType: string; name: string; policy: MetaReadGatePolicy; maskPosture: ObjectSchemaMaskPosture },
    query: any,
    envelope: any,
    mayWriteItem?: boolean,
): Promise<HttpDispatcherResult> {
    const requestLocale = (i18n?: unknown) => metaRequestLocale({ headers: context.request?.headers, query }, i18n);
    const translation = metaTranslationSources(deps, context, protocol, requestLocale);
    const sources: MetaItemAnswerSources = {
        ...metaItemReadGateSources(deps, context, protocol, mayWriteItem),
        requestLocale,
        translateEnvelope: (itemEnvelope, document) =>
            translateMetaEnvelope(translation, request.metaType, itemEnvelope, document),
    };
    let answer: MetaItemAnswer;
    try {
        answer = await createMetaItemAnswer(sources, request)(envelope);
    } catch (e: any) {
        return { handled: true, response: deps.errorFromThrown(e, 500) };
    }
    switch (answer.kind) {
        case 'serve':
            return successWithHeaders(deps, answer.envelope, {
                'Cache-Control': answer.cacheControl,
                Vary: 'Accept-Language',
            });
        case 'mask-fault':
            return fieldVisibilityFault(deps, answer.object);
        case 'refuse': {
            const { refusal } = answer;
            if (refusal.reason === 'absent') return { handled: true, response: deps.error('Not found', 404) };
            return { handled: true, response: deps.error(refusal.message, refusal.status, { code: refusal.code }) };
        }
    }
}

/** [#20320] This transport's save-door admission of `:type/:name` — see `saveVerdict` in {@link handleMetadataRequest}. */
type MetaSaveVerdict = (
    canonicalType: string,
    activeOrganizationId: string | undefined,
) => ReturnType<typeof metaWriteCapabilityVerdict>;

/**
 * [#20320] `GET /meta/:type/:name?state=draft` for a caller who may read
 * drafts — the pending draft ROW (ADR-0033), answered exactly as `RestServer`'s
 * plain read answers that caller:
 *
 *  - the protocol's draft read (`state: 'draft'`), whatever the type — the
 *    `object` branch below included, and ⛔ never the `MetadataService` or
 *    registry fallbacks, which know only published values;
 *  - nothing pending → the protocol's own `404 NO_DRAFT`, answered as ITSELF
 *    (the item IS there, its draft is not) — never this read's plain 404,
 *    never the published item;
 *  - [#20408] the item chain (`createMetaItemAnswer`, through
 *    {@link answerMetaItem}) under `STORED_VERSION_DOOR_POLICY` — the constant
 *    `RestServer`'s draft branch runs (#20290): per-caller arms only, and an
 *    app WHOLE for a caller this transport's save door admits (`saveVerdict`,
 *    the `PUT` branch's own admission, carried as `mayWriteItem`), pruned per
 *    caller for everyone else; then the doc locale collapse, the ADR-0106 mask
 *    and the body, as the plain read answers them.
 *
 * Only an admitted caller arrives: the switch is declared with
 * {@link mayReadPendingDrafts} at the item read's entry.
 *
 * [#20408] Scoped to the caller's VETTED organization — the read to
 * {@link metaReadOrganizationId}'s partition, the author exemption to the save
 * door's verdict over {@link metaCallerOrganizationId} — exactly as
 * `RestServer`'s plain read scopes both. It read the session's claim as stored,
 * so a member removed from an organization read that organization's pending
 * drafts here.
 */
async function readPendingDraft(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    type: string,
    name: string,
    packageId: string | undefined,
    previewDrafts: boolean,
    saveVerdict: MetaSaveVerdict,
    item: { maskPosture: ObjectSchemaMaskPosture; query: any },
): Promise<HttpDispatcherResult> {
    const singularType = pluralToSingular(type);
    const protocol = await resolveProtocol(deps, context);
    if (!protocol || typeof protocol.getMetaItem !== 'function') {
        return { handled: true, response: deps.error('Not found', 404) };
    }
    const caller = context.executionContext as MetaReadGateCaller | undefined;
    let envelope: any;
    try {
        envelope = await protocol.getMetaItem({
            type: singularType, name, packageId, organizationId: metaReadOrganizationId(type, caller), state: 'draft', previewDrafts,
        });
    } catch (e: any) {
        return { handled: true, response: deps.errorFromThrown(e, 404) };
    }
    if (envelope?.item == null) return { handled: true, response: deps.error('Not found', 404) };

    const mayWriteItem = saveVerdict(canonicalMetaUrlType(type), metaCallerOrganizationId(caller)).allowed;
    return answerMetaItem(
        deps, context, protocol,
        { metaType: singularType, name, policy: STORED_VERSION_DOOR_POLICY, maskPosture: item.maskPosture },
        item.query, envelope, mayWriteItem,
    );
}

/**
 * [#20478] The path THIS request's item read arrived on, as the client sent it
 * — `/api/v1/meta/app/crm` for `GET /api/v1/meta/app/crm?layers=true` — read
 * off the request's own URL (`createHonoApp` hands `dispatch()` the raw Fetch
 * `Request`, whose `url` is absolute; a Node request's is path-only), without
 * its query and trailing slash. `undefined` when the request carries no URL.
 *
 * It is the path the deprecated `?layers=` spelling names its successor under
 * (`metaItemLayersDeprecationHeaders`). This domain is handed a path with the
 * host's API prefix stripped, so the request's own URL is the only statement of
 * where this host serves the item; with none there is no successor this
 * transport can name, and the flag is answered with `Deprecation` alone.
 */
function requestedItemPath(context: HttpProtocolContext): string | undefined {
    const url = (context.request as { url?: unknown } | undefined)?.url;
    if (typeof url !== 'string' || url.length === 0) return undefined;
    try {
        const path = new URL(url, 'http://dispatcher.invalid').pathname.replace(/\/+$/, '');
        return path.length > 0 ? path : undefined;
    } catch {
        return undefined;
    }
}

/** [#20478] A protocol whose `getMetaItemLayered` the caller has PROBED — the handle {@link answerMetaLayered} reads through. */
type MetaLayeredProtocol = MetaDomainProtocol & Required<Pick<MetaDomainProtocol, 'getMetaItemLayered'>>;

/**
 * [#20478] Answer the layered view — `GET /meta/:type/:name/layers`, and the
 * deprecated `?layers=` flag on the item read: read the protocol's
 * `getMetaItemLayered` exactly as `RestServer`'s layered read reads it, hand the
 * answer to THE layered chain (`createMetaLayeredAnswer`, the one `RestServer`
 * serves both spellings through; ⛔ no step lives here) and write its answer on
 * this transport's wire.
 *
 * The read is scoped to the caller's VETTED organization
 * ({@link metaReadOrganizationId}, the partition the plain read reads — ⛔ never
 * the session's claim as stored) and to `?package=` (ADR-0048). The chain
 * judges every present layer under `STORED_VERSION_DOOR_POLICY` — whole for a
 * caller this transport's save door admits (`saveVerdict`, the `PUT` branch's
 * own admission, carried as `mayWriteItem`), pruned as the plain read prunes
 * it for everyone else (ruling 5856774816) — and projects every layer through
 * the ADR-0106 mask under the posture resolved before the read. The dispatcher
 * served neither spelling: the route answered a located `404 ROUTE_NOT_FOUND`,
 * and the flag answered the PLAIN read's `{ type, name, item }` with a `200`.
 *
 * The answers, in this transport's envelope, with `RestServer`'s status and
 * code: the layered answer (no `Vary`: it is not translated; `private,
 * no-store` when an undetermined posture served a schema unmasked);
 * `absent` → the SAME `deps.error('Not found', 404)` the item read answers for
 * a name with nothing behind it (ADR-0045 §3); `app-permission` /
 * `docs-audience` → `403 PERMISSION_DENIED` / `401 UNAUTHENTICATED`;
 * `mask-fault` → the D6 field-visibility fault; a read or gate input that
 * could not be read → that fault, `500` for a shapeless one — ⛔ never a layered
 * view with a layer missing. `headers` (the flag's `Deprecation` and `Link`)
 * ride EVERY one of those answers.
 */
async function answerMetaLayered(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    protocol: MetaLayeredProtocol,
    request: { type: string; name: string; packageId: string | undefined; maskPosture: ObjectSchemaMaskPosture },
    saveVerdict: MetaSaveVerdict,
    headers: Readonly<Record<string, string | undefined>> = {},
): Promise<HttpDispatcherResult> {
    const { type, name, packageId, maskPosture } = request;
    const caller = context.executionContext as MetaReadGateCaller | undefined;
    const organizationId = metaReadOrganizationId(type, caller);
    const mayWriteItem = saveVerdict(canonicalMetaUrlType(type), metaCallerOrganizationId(caller)).allowed;
    let answer: MetaLayeredAnswer;
    try {
        const layered = await protocol.getMetaItemLayered({
            type,
            name,
            ...(packageId ? { packageId } : {}),
            ...(organizationId ? { organizationId } : {}),
        });
        answer = await createMetaLayeredAnswer(
            metaItemReadGateSources(deps, context, protocol, mayWriteItem),
            { metaType: pluralToSingular(type), name, maskPosture },
        )(layered);
    } catch (e: any) {
        return withHeaders(deps.errorFromThrown(e, 500), headers);
    }
    switch (answer.kind) {
        case 'serve':
            return withHeaders(deps.success(answer.layered), { ...headers, 'Cache-Control': answer.cacheControl });
        case 'mask-fault':
            return withHeaders(fieldVisibilityFaultResponse(deps, answer.object), headers);
        case 'refuse': {
            const { refusal } = answer;
            if (refusal.reason === 'absent') return withHeaders(deps.error('Not found', 404), headers);
            return withHeaders(deps.error(refusal.message, refusal.status, { code: refusal.code }), headers);
        }
    }
}

/**
 * Percent-decode the `:name` path segment. [commit 7986d973f]
 *
 * This dispatcher splits the RAW path (`path.split('/')`) and, unlike the
 * `packages/rest` Hono routes, nothing decodes its parameters for it —
 * measured, not assumed: Hono's `c.req.path`, which the adapter's catch-all
 * hands to `dispatch()`, returns `/meta/lead/views%2Fall_leads` verbatim while
 * `c.req.param('name')` on the same request yields `views/all_leads`.
 *
 * That difference is load-bearing here. Until commit 7986d973f the compound fold
 * (`parts.slice(1).join('/')`) is what let a slash-bearing name be addressed
 * on this transport at all — unencoded, across segments. Retiring the fold
 * without decoding would leave a pre-grammar residue row addressable through
 * `packages/rest` and NOT through the dispatcher, breaking commit 311433f6b's landed
 * acceptance criterion that "reads and `deleteMetaItem` still answer for
 * pre-grammar residue rows, so any stored junk name remains listable and
 * clearable". Decoding makes ONE spelling — percent-encoded, the spelling the
 * SDK now sends everywhere — correct on both transports.
 *
 * `decodeURIComponent` throws `URIError` on a malformed escape (a literal `%`
 * that starts no valid sequence). A name is a store key, so the right answer
 * to un-decodable input is the RAW segment: it simply will not match a stored
 * row, and the caller gets the ordinary 404 rather than a 500 from the split.
 *
 * The sibling `domains/packages.ts` already decodes its own id segments the
 * same way; this domain was the outlier.
 */
function decodeMetaNameSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/**
 * Handles Metadata requests
 * Standard: /metadata/:type/:name
 * Fallback for backward compat: /metadata (all objects), /metadata/:objectName (get object)
 */
export async function handleMetadataRequest(deps: DomainHandlerDeps, path: string, _context: HttpProtocolContext, method?: string, body?: any, query?: any): Promise<HttpDispatcherResult> {
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // [#12702 · #20320] May this caller SAVE `:type/:name` on THIS transport?
    // The admission of the item branch's `PUT`, spelled ONCE: that door asks
    // it, and so does every read door that honours the author exemption — the
    // `?state=draft` read and [#20478] the layered view, on both of its
    // spellings (ruling 5856774816, item 1: 「whoever can save it must see it
    // whole, or a save drops entries silently」), which
    // `MetaReadGateCaller.mayWriteItem` says must be the transport's own
    // save-door answer. A second spelling at a read could drift from the door
    // it stands for. `canonicalType` is the folded segment and
    // `activeOrganizationId` the one resolution each caller already made, so
    // authorization and scope read one value. [#20478] Declared here, above
    // every branch, so the `/layers` branch asks the same one.
    const saveVerdict: MetaSaveVerdict = (canonicalType, activeOrganizationId) => {
        const ec: any = _context.executionContext;
        return metaWriteCapabilityVerdict({
            isSystem: ec?.isSystem === true,
            systemPermissions: ec?.systemPermissions,
            canonicalType,
            activeOrganizationId,
            operation: 'save',
        });
    };

    // Defense-in-depth: the metadata catch-all must honour the same
    // anonymous-deny (#2567) as the REST `/meta` routes (which serve `/meta` on
    // the cloud runtime). Object/field schemas — SYSTEM-object schemas on a
    // tenant-less host — must not be readable by anonymous callers when the
    // an anonymous, non-system caller. Unconditional since #3963.
    //
    // [#20320] …with `RestServer`'s ONE exception, asked of the same
    // predicate: an anonymous GET of this domain's book or doc LIST or ITEM
    // read skips the deny, and the ADR-0046 §6.7 audience gate inside that read
    // decides instead — `'public'` only; `org` and `{ permissionSet }` still
    // refuse (401). This granted reachability on `RestServer` alone, so a
    // `public` book answered 401 here. Every other type, every other verb and
    // every other route shape (`/published`, `/state/:field`, an unrouted
    // path) keeps the deny.
    const anonymousDeny = (): HttpDispatcherResult => ({
        handled: true,
        response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
    });
    const anonymous = shouldDenyAnonymous({
        userId: (_context.executionContext as any)?.userId,
        isSystem: (_context.executionContext as any)?.isSystem,
    });
    if (anonymous && !isPublicAudienceRead(method, metaReadRouteOf(parts), parts[0])) return anonymousDeny();

    // [#21087] …and `RestServer`'s type-level read admission, asked of the same
    // predicate at the same point — after the anonymous deny, before any branch
    // reads the store: a read of a datasource-family type is admitted on the
    // capability that type's own door requires, so a dispatcher-only host
    // refuses the caller `RestServer` refuses, whatever route shape the read
    // took and whether or not the name exists. A request that names no verb is
    // a read here (every read branch below accepts `!method`), so it is asked
    // as one.
    const typeReadRefusal = metaTypeReadRefusal(method ?? 'GET', parts[0], _context.executionContext);
    if (typeReadRefusal) {
        return {
            handled: true,
            response: deps.error(typeReadRefusal.message, typeReadRefusal.status, { code: typeReadRefusal.code }),
        };
    }

    // [#21124] …and the write-side twin, asked at the same point of the same
    // predicate `RestServer`'s registrar asks: a write verb on a `/meta` path
    // whose type is a datasource definition is admitted on the capability the
    // datasource admin door requires for the same create / update / remove —
    // before the `PUT` branch's own authoring admission resolves the protocol,
    // so a refused caller writes nothing, whatever route shape the request
    // took and whether or not the name exists. A request that names no verb is
    // a read (see above), so it is never judged here.
    const typeWriteRefusal = metaTypeWriteRefusal(method, parts[0], _context.executionContext);
    if (typeWriteRefusal) {
        return {
            handled: true,
            response: deps.error(typeWriteRefusal.message, typeWriteRefusal.status, { code: typeWriteRefusal.code }),
        };
    }

    // GET /metadata/types
    if (parts[0] === 'types') {
        // PRIORITY 1: Try protocol service — it returns BOTH legacy
        // `types: string[]` AND the richer `entries` array (with
        // JSON Schemas, allowOrgOverride flags, domain, etc) needed by
        // the metadata admin UI. It internally also merges
        // MetadataService runtime types, so this path is strictly richer.
        const protocol = await resolveProtocol(deps, _context);
        if (protocol && typeof protocol.getMetaTypes === 'function') {
            try {
                const result = await protocol.getMetaTypes({});
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                console.warn('[HttpDispatcher] protocol.getMetaTypes() failed:', e?.message);
            }
        }
        // PRIORITY 2: MetadataService fallback (types only, no entries)
        const metadataService = await deps.resolveService(_context, 'metadata', _context.environmentId);
        if (metadataService && typeof (metadataService as any).getRegisteredTypes === 'function') {
            try {
                const types = await (metadataService as any).getRegisteredTypes();
                return { handled: true, response: deps.success({ types }) };
            } catch (e: any) {
                console.warn('[HttpDispatcher] MetadataService.getRegisteredTypes() failed:', e.message);
            }
        }
        // Last resort: hardcoded defaults
        return { handled: true, response: deps.success({ types: ['object', 'app', 'plugin'] }) };
    }

    // GET /metadata/objects/:name/state/:field?from=:state
    // ADR-0020 D3.3 introspection: the legal next states declared by the
    // object's `state_machine` validation rule for `:field`. Lets UIs /
    // AI authors ask "from here, where can this record go?" instead of
    // hard-coding the transition table. `next: []` is a declared
    // dead-end state. `next: null` has TWO causes: no FSM governs the
    // field, or the caller omitted `?from=` (no `from` => no transition
    // table to answer with) — the handler short-circuits on that before
    // it ever consults the rule. So a `null` answered to a call
    // that passed no `from` is not evidence the field has no state
    // machine; re-ask with `?from=`.
    if (parts.length === 4 && (parts[0] === 'objects' || parts[0] === 'object') && parts[2] === 'state' && (!method || method === 'GET')) {
        const name = parts[1];
        const field = parts[3];
        const from = query?.from !== undefined ? String(query.from) : undefined;
        const qlService = await deps.getObjectQL(_context);
        const schema = qlService?.registry?.getObject(name);
        if (!schema) return { handled: true, response: deps.error('Object not found', 404) };
        // Dynamic import (matches the runtime convention for @objectstack/objectql)
        // so the dispatcher module graph doesn't statically pull in the objectql barrel.
        const { legalNextStates } = await import('@objectstack/objectql');
        const next = from === undefined ? null : legalNextStates(schema, field, from);
        return { handled: true, response: deps.success({ object: name, field, from: from ?? null, next }) };
    }

    // GET /metadata/book/:name/tree — ADR-0046 §6: a book spine resolved against
    // the docs that exist NOW into its rendered tree.
    //
    // [#20408] `RestServer` serves this route, and this domain had none: the
    // path fell to the located `ROUTE_NOT_FOUND` tail below, so a
    // dispatcher-only host answered `404` to a signed-in reader and `401` to an
    // anonymous reader of a `public` book — the reader the route exists for.
    // The whole answer is `createMetaBookTreeAnswer` in `@objectstack/rest`, the
    // one `RestServer`'s handler calls: the book and doc reads (`?package=`
    // scopes both, ADR-0048), THE `DocsAudience`, the §6.7 gate on the book's
    // own audience, the doc locale collapse and the tree narrowed per caller.
    // This branch supplies I/O and writes the answer on this transport's wire.
    // The anonymous gate above lets an anonymous GET reach it
    // (`metaReadRouteOf` names it `book-tree`), and the §6.7 gate refuses every
    // audience but `public` — the one `RestServer` exempts, by the same predicate.
    if (isBookTreePath(parts) && (!method || method.toUpperCase() === 'GET')) {
        const protocol = await resolveProtocol(deps, _context);
        if (!protocol || typeof protocol.getMetaItems !== 'function') {
            return { handled: true, response: deps.error('Not found', 404) };
        }
        const packageId = typeof query?.package === 'string' && query.package.length > 0 ? query.package : undefined;
        try {
            const answer = await createMetaBookTreeAnswer(
                {
                    ...metaItemReadGateSources(deps, _context, protocol),
                    listTreeInput: (type, scopedPackageId) =>
                        Promise.resolve(protocol.getMetaItems!({ type, ...(scopedPackageId ? { packageId: scopedPackageId } : {}) })),
                    requestLocale: (i18n) => metaRequestLocale({ headers: _context.request?.headers, query }, i18n),
                },
                { name: decodeMetaNameSegment(parts[1]), packageId },
            );
            if (!answer.ok) {
                const { refusal } = answer;
                return { handled: true, response: deps.error(refusal.message, refusal.status, { code: refusal.code }) };
            }
            return { handled: true, response: deps.success(answer.tree) };
        } catch (e: any) {
            return { handled: true, response: deps.errorFromThrown(e, 500) };
        }
    }

    // GET /metadata/:type/:name/layers — the three-layer diagnostic projection
    // (`code` / `overlay` / `effective`, `GetMetaItemLayeredResponseSchema`) as
    // its own resource (#5882).
    //
    // [#20478] `RestServer` serves this route, and this domain had none: the
    // path fell to the located `ROUTE_NOT_FOUND` tail below. Everything after
    // the read is `createMetaLayeredAnswer` in `@objectstack/rest` ({@link
    // answerMetaLayered}), the chain `RestServer`'s handler calls. EXACTLY three
    // segments, like `/published` beside it. The anonymous gate above keeps its
    // deny here (`metaReadRouteOf` names no route), as `RestServer`'s does.
    if (parts.length === 3 && parts[2] === 'layers' && (!method || method.toUpperCase() === 'GET')) {
        const type = parts[0];
        const name = decodeMetaNameSegment(parts[1]);
        const protocol = await resolveProtocol(deps, _context);
        // [ADR-0106 D2/D5] Its own schema-serving outlet: the caller's posture,
        // resolved before the read with the FOLDED type, as `RestServer`'s route
        // resolves it — and before the capability probe, in the same order.
        let maskPosture: ObjectSchemaMaskPosture;
        try {
            maskPosture = await (await resolveObjectMasker(deps, _context, pluralToSingular(type)))(name);
        } catch (maskError) {
            if (maskError instanceof ObjectSchemaMaskEvaluationError) return fieldVisibilityFault(deps, name);
            throw maskError;
        }
        if (!protocol || typeof protocol.getMetaItemLayered !== 'function') {
            // A dedicated path cannot fall through to the plain read the way the
            // `?layers=` flag does — `RestServer`'s `501 NOT_IMPLEMENTED`, in this
            // transport's envelope.
            return {
                handled: true,
                response: deps.error('Layered metadata view not supported by protocol implementation', 501),
            };
        }
        const packageId = query?.package || undefined;
        return answerMetaLayered(
            deps, _context, protocol as MetaLayeredProtocol,
            { type, name, packageId, maskPosture }, saveVerdict,
        );
    }

    // GET /metadata/:type/:name/published → get published version
    //
    // [commit 7986d973f] EXACTLY three segments, and no fold. This used to be
    // `parts.length >= 3` with `parts.slice(1, -1).join('/')`, which re-joined
    // every middle segment into one slash-bearing key so
    // `lead/views/all_leads/published` resolved as name `views/all_leads`.
    // Stage 1 (commit 311433f6b) refuses every slash-bearing name at the publish door,
    // so that fold could only ever address a name that can no longer be
    // written.
    if (parts.length === 3 && parts[2] === 'published' && (!method || method === 'GET')) {
        const type = parts[0];
        const name = decodeMetaNameSegment(parts[1]);

        // [#8031] The AUTHORITATIVE published store is consulted first: the
        // `state:'active'` `sys_metadata` overlay row.
        //
        // Two publish lifecycles write to two different places, and this route
        // used to know only the older one:
        //
        //   - `MetadataManager.publishPackage` snapshots a body into the
        //     row-local `publishedDefinition` key of its own in-memory
        //     registry — the ADR-0016-era package publish, which is what
        //     `getPublished` below reads.
        //   - `publishPackageDrafts` / `promoteDraft` flips the artifact's
        //     `sys_metadata` row `state:'draft' → 'active'`. ADR-0027 (E)(5)
        //     defines sealing a publish as exactly that flip, and
        //     `SysMetadataRepository` names `'active'` "the published, live
        //     overlay". ADR-0033 §2 — the ADR this route cites — routes EVERY
        //     authoring write into that same ADR-0027 draft, so promoting it
        //     is what "published" means for anything authored at runtime.
        //
        // The dispatcher's own `POST /packages/:id/publish-drafts` comment
        // states that path has "no metadata service dependency", so the two
        // shared no store at all: an item published at runtime was absent from
        // the registry `getPublished` consults and this route answered 404 —
        // a false statement about an item that IS published.
        //
        // `getMetaItemLayered` is the narrow primitive on purpose. Its overlay
        // layer is a strict `state:'active'` lookup (org-scoped first, then
        // env-wide, ADR-0048 package preference) that never reads a draft, and
        // it reports that layer SEPARATELY from the code layer. So a null
        // overlay is positively "no runtime-published row" and falls through to
        // the untouched `getPublished` path below — which is what keeps a
        // code-published item resolving to the same bytes it always did. The
        // broader `getMetaItem` would not do: it folds the code layer into its
        // own answer, so this route could no longer tell the two stores apart.
        const protocol = await resolveProtocol(deps, _context);

        // [#20193] This door serves ONE document, the same representation the
        // plain read below serves — so it answers exactly what `RestServer`'s
        // `/published` answers this caller: the shared per-caller read gate
        // (every arm, a partly-withheld app PRUNED) and the ADR-0106 object
        // mask, the one the plain read below already runs. It ran neither, so a
        // member refused `crm_admin_runbook` read its body here, and an object's
        // unreadable fields were served whole. Every exit that serves a
        // document goes through `servePublished`, OUTSIDE the `try`s below:
        // those classify a failed store READ, and a gate fault raised while
        // serving must be answered as itself — never fall through to the
        // snapshot as though no overlay existed.
        const publishedType = pluralToSingular(type);
        const publishedMasker = publishedType === 'object' ? await resolveObjectMasker(deps, _context, publishedType) : undefined;
        const servePublished = async (document: any): Promise<HttpDispatcherResult> => {
            const gated = await gateMetaItemDocument(deps, _context, protocol, publishedType, name, document);
            if (!gated.ok) return { handled: true, response: gated.response };
            let served = gated.document;
            let cacheControl: string | undefined;
            if (publishedMasker) {
                const masked = await maskObjectSchema(publishedMasker, name, served);
                if (!masked.ok) return fieldVisibilityFault(deps, name);
                served = masked.document;
                // [#20408] ADR-0106 D6 tier 2 — as `RestServer`'s `/published`.
                cacheControl = masked.cacheControl;
            }
            return successWithHeaders(deps, served, { 'Cache-Control': cacheControl });
        };

        let publishedOverlay: unknown;
        if (protocol && typeof protocol.getMetaItemLayered === 'function') {
            try {
                // [#20408] The caller's VETTED organization, as `RestServer`'s
                // `/published` reads it (`ctx.tenantId`, raw — the protocol's
                // layered read gates it by type itself). The session's claim as
                // stored served a removed member the overlay of the organization
                // they had left.
                const organizationId = metaCallerOrganizationId(_context.executionContext as MetaReadGateCaller | undefined);
                const layered = await protocol.getMetaItemLayered({
                    type,
                    name,
                    ...(organizationId ? { organizationId } : {}),
                });
                if (layered?.overlay !== undefined && layered?.overlay !== null) {
                    // [#21002, ADR-0126 §2] As `RestServer`'s `/published`: when
                    // the layered read put the LOADER's body over this stored
                    // row — a shipped flow name, decided by the protocol's
                    // `isShippedFlowName`, asked with the answer's own `type` /
                    // `name` and never re-derived here — serve that effective
                    // layer, not the row (`flow` is Regime C, "never an overlay
                    // read path"). Every other stored row, an `object`'s
                    // included, and every row of a protocol without the
                    // predicate, is served exactly as before.
                    publishedOverlay = typeof protocol.isShippedFlowName === 'function'
                        && protocol.isShippedFlowName(layered.type, layered.name)
                        ? layered.effective
                        : layered.overlay;
                }
            } catch { /* fall through to the code/package snapshot below */ }
        }
        if (publishedOverlay !== undefined) return servePublished(publishedOverlay);

        const metadataService = await deps.getService(_context, CoreServiceName.enum.metadata);
        if (metadataService && typeof (metadataService as any).getPublished === 'function') {
            // [commit 67ceb9aef] FOLDED — the smaller second site of the same class,
            // dispatcher edition (the REST twin folds at the same point). The
            // layered consult above folds internally at the protocol boundary;
            // this fallback reads the code/package registry, which stores
            // CANONICAL types. Handed the raw segment it answered 404 under a
            // recognised plural and 200 under the singular twin — of the same
            // code-published item.
            const data = await (metadataService as any).getPublished(canonicalMetaUrlType(type), name);
            if (data === undefined) return { handled: true, response: deps.error('Not found', 404) };
            return servePublished(data);
        }
        // Fallback — try MetadataService via resolveService
        const metaSvc = await deps.resolveService(_context, 'metadata', _context.environmentId);
        if (metaSvc && typeof (metaSvc as any).getPublished === 'function') {
            let fallbackData: unknown;
            try {
                // [commit 67ceb9aef] Same fold — this slot reads the same canonical store.
                fallbackData = await (metaSvc as any).getPublished(canonicalMetaUrlType(type), name);
            } catch { /* fall through */ }
            if (fallbackData !== undefined) return servePublished(fallbackData);
        }
        return { handled: true, response: deps.error('Not found', 404) };
    }

    // /metadata/:type/:name — EXACTLY two segments. [commit 7986d973f]
    //
    // This used to be `parts.length >= 2` with `parts.slice(1).join('/')`: every
    // segment after the type was re-joined into one slash-bearing lookup key,
    // so `/metadata/lead/views/all_leads` resolved as name `views/all_leads`.
    // That fold WAS compound-name addressing on this transport, and stage 1
    // (commit 311433f6b) made every name it could reach unwritable at the publish door.
    //
    // ⚠️ The `>=` also swallowed three-segment paths that were never compound
    // names at all — `/metadata/object/foo/references` folded to name
    // `foo/references` — so a sub-resource verb this dispatcher does not
    // implement was answered as a metadata READ of a name nothing stores,
    // rather than as the ROUTE_NOT_FOUND it is. Requiring exactly two segments
    // ends that silently-wrong reading too.
    //
    // A pre-grammar residue row stays addressable: the caller percent-encodes
    // the name, which keeps the segment count at two, and
    // `decodeMetaNameSegment` restores the stored spelling.
    if (parts.length === 2) {
        const type = parts[0];
        const name = decodeMetaNameSegment(parts[1]);
        // Extract optional package filter from query string
        const packageId = query?.package || undefined;

        // PUT /metadata/:type/:name (Save)
        //
        // [#8842] The condition is the METHOD alone. It used to be
        // `method === 'PUT' && body`, and the `&& body` was not a guard — it
        // was a hole. Every path inside this block returns (including the
        // terminal `501`), so a falsy body did not merely skip the write: it
        // fell through to the read `try` below and was answered with the
        // ordinary metadata READ. A write verb came back looking like a
        // successful read, with no status, header or field telling the caller
        // their write never happened — the shape "Absence must be loud" exists
        // to prevent (AGENTS.md, Route & surface ownership §3). It also meant
        // the `manage_metadata` gate below, the first thing this block does,
        // was skipped entirely for such a request.
        //
        // Reachable from an ordinary client: the host mounting this path is the
        // Hono adapter's catch-all, which builds `body` as
        // `await c.req.json().catch(() => ({}))`. The `.catch` covers a parse
        // FAILURE (empty body, garbage) — not a SUCCESSFUL parse of a falsy
        // JSON value, so a payload of `null`, `false`, `0` or `""` arrives here
        // falsy. Driven, not read: see `meta-put-falsy-body.test.ts`.
        if (method === 'PUT') {
            // [#7019] The SECOND TRANSPORT for the operation #6603 gated on the
            // REST side. Same `protocol.saveMetaItem`, same metadata, different
            // door — so a gate on only one of them is not a gate, it is a
            // detour sign. Mechanism copied from `POST /_migrate-stored` below
            // in this very file rather than reinvented.
            //
            // The read side of this dispatcher already runs the ADR-0106 mask
            // (`resolveObjectMasker` / `maskObjectSchema` above), which is
            // exactly the read/write asymmetry #6603 describes: a caller is
            // served an object schema with the fields they may not read removed
            // WHOLE, and sending that document straight back used to persist it
            // — deleting those fields. Refusing the write is the write-side
            // answer, here as there.
            //
            // Independently of masking: before this, any authenticated session
            // could clobber any metadata item through this transport.
            //
            // Gate FIRST — before the protocol service is resolved — so an
            // unauthorized caller cannot use the 501-vs-200 answer to probe
            // which kernels can save, and so nothing is written before the
            // refusal. `manage_metadata` is ADR-0066 D1's authoring capability;
            // engine self-invocation (`isSystem`) bypasses, matching
            // `actionPermissionError` and the migrate-stored gate below.
            //
            // [#12702] The gate is the shared `metaWriteCapabilityVerdict`
            // (`@objectstack/metadata-core` — the same home as the org-scope
            // predicate below, for the same no-second-copy reason): beside
            // `manage_metadata` it admits `manage_org_presentation`, ONLY for
            // a type whose registry entry declares `allowOrgOverride: true`
            // AND a session with an active organization — which is exactly the
            // organization `organizationIdForMetaWrite` threads below, so an
            // admitted write can only land org-scoped in the caller's own
            // partition, never env-wide and never another org's. The active
            // organization is resolved HERE, once, and reused by the write
            // threading below — authorization and scope read one value (the
            // single-resolution shape the REST doors carry, commit b5378550e). Resolving
            // it is a session read, not a protocol probe: the 403-vs-501
            // discipline above is untouched.
            // [commit 67ceb9aef] Folded at the boundary, once — the verdict and the
            // scope decision below must read the same spelling.
            const canonicalType = canonicalMetaUrlType(type);
            // [#20408] The caller's VETTED organization — the `tenantId`
            // `resolveAuthzContext` left on the execution context, the value
            // `RestServer`'s `PUT` door reads — ⛔ never the session's claim as
            // stored: under a walled posture a claim naming an organization the
            // caller has LEFT is dropped there, and this door read it anyway, so
            // a removed member's write landed in that organization's partition.
            // No read at all now, so the 403-vs-501 discipline above is
            // untouched.
            const activeOrganizationId = metaCallerOrganizationId(_context.executionContext as MetaReadGateCaller | undefined);
            // [#20320] Spelled once (`saveVerdict` above), because the
            // `?state=draft` read's author exemption asks this same question.
            const verdict = saveVerdict(canonicalType, activeOrganizationId);
            if (!verdict.allowed) {
                // `deps.error(msg, 403)` derives the code from the status —
                // `PERMISSION_DENIED`, this transport's pinned spelling.
                return {
                    handled: true,
                    response: deps.error(verdict.message, 403),
                };
            }

            // [#8842] Fold a nullish body to `{}` and let the per-type schema
            // refuse it downstream with `422 INVALID_METADATA`, rather than
            // minting a second, bespoke refusal here. This is byte-for-byte
            // what the sibling transport already does — `packages/rest`'s
            // `PUT /meta/:type/:name` opens `const body = req.body ?? {}` and
            // proceeds into the save unconditionally. Two doors onto one
            // `saveMetaItem` disagreeing about what a bodyless metadata write
            // means was the actual defect; one answer, from one authority.
            const item = body ?? {};

            // Try to get the protocol service directly
            const protocol = await resolveProtocol(deps, _context);

            if (protocol && typeof protocol.saveMetaItem === 'function') {
                try {
                    // [#7018 / the #6190 ruling, Option A] The session's active
                    // organization rides this write ONLY for types the registry
                    // declares `allowOrgOverride: true`. For every other type it
                    // is dropped and the write lands env-wide — byte-identical to
                    // what a no-active-org session already produces today.
                    //
                    // Threading it unconditionally is how the runtime minted rows
                    // boot never reads: `SysMetadataRepository.put` stamps
                    // `organization_id` for EVERY type, while `loadMetaFromDb`
                    // hydrates `organization_id IS NULL` only. See
                    // `@objectstack/metadata-core`'s `meta-write-org-scope.ts`
                    // for why the predicate is the static registry flag and not
                    // `isOverlayAllowed` — and, since #8805, why it lives there:
                    // the REST `/meta` write doors run the same one.
                    //
                    // [#12702] `activeOrganizationId` is the ONE resolution the
                    // capability gate above already made — scope and
                    // authorization read the same value by construction.
                    //
                    // [commit 67ceb9aef] The segment is FOLDED before the scope decision
                    // — the correction commit 26f3588fb landed for the REST `/meta`
                    // doors, arriving on the second transport. This branch read
                    // the RAW `parts[0]`, while `protocol.saveMetaItem` below
                    // folds the same string through `canonicalizeMetaRequestType`
                    // for storage. Two maps that must agree did not: storage
                    // folds through `META_URL_TO_SINGULAR` (every spelling),
                    // while `declaresOrgOverride` tolerates only the MANIFEST
                    // collection spellings. For the two URL-only spellings of
                    // `allowOrgOverride: true` types — `translations` and
                    // `email_templates` — an org-active caller's write therefore
                    // landed ENV-WIDE where the singular twin landed org-scoped:
                    // one item, two partitions, addressed by spelling.
                    //
                    // ⛔ NOT repaired by widening `declaresOrgOverride`'s set —
                    // a predicate below the boundary consuming the URL spelling
                    // contract is what `metadata-url-spelling.ts`'s own header
                    // forbids ("folding happens at the boundary and only
                    // there"), and `meta-write-org-scope.ts`'s
                    // `ORG_OVERRIDABLE_TYPES` header pins that limit.
                    //
                    // Only the scope ARGUMENT is folded. The request `type`
                    // stays the raw segment, exactly as the REST doors leave
                    // it: the protocol boundary folds it itself, and two
                    // pre-folds would hide a drift between them from the
                    // protocol's own tests.
                    const organizationId = organizationIdForMetaWrite(
                        canonicalType, activeOrganizationId,
                    );
                    // [commit d806081dd] Server-stated face: this branch answers through
                    // `deps.errorFromThrown`, which carries the refusal's
                    // `issues[]` in `details` (see the `details.issues` pin in
                    // `http-dispatcher.test.ts`), so `saveMetaItem`'s 422 renders
                    // a headline rather than restating the per-key prose that
                    // already rides the envelope structurally. Not client-settable:
                    // the request object names each field explicitly.
                    //
                    // [#11095] …and the face is this door's OWN, not the REST
                    // doors'. It read `'meta-envelope'` until the two switches
                    // that consume it disagreed for the first time. The 422
                    // answer is unchanged and shares `'meta-envelope'`'s case;
                    // what moved is the `409 DESTRUCTIVE_CHANGE` REMEDY clause,
                    // which used to tell a caller refused HERE to `re-submit
                    // with ?force=true` — advice this transport cannot take. The
                    // two REST `PUT` doors read `?force` off a query string (the
                    // compound-name twin as of this same card, inheriting
                    // #7019's twin-parity ruling); this branch is reached with a
                    // path, a method and a body, so there is no query string for
                    // an acknowledgement to arrive on.
                    //
                    // ⛔ This is the door the ruling deliberately did NOT give a
                    // `force`, and the absence is settled rather than pending:
                    // adding one — as a body key, a request field or anything
                    // else — widens a public surface no ruling has widened, and
                    // turns the clause into a lie in the other direction. The
                    // request below is built field by field for exactly that
                    // reason: `item` is data, never a channel, so a caller
                    // cannot smuggle a `force` (or a `writeFace`) through it.
                    // Pinned both ways in `meta-save-destructive-remedy.test.ts`.
                    const result = await protocol.saveMetaItem({
                        type, name, item, organizationId,
                        writeFace: 'meta-dispatch',
                        ...(packageId ? { packageId } : {}),
                    });
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    // Preserve the 422 + structured spec-validation `issues` so
                    // the Studio can point at the offending field, not just a
                    // generic banner (the old path hardcoded 400 + dropped them).
                    return { handled: true, response: deps.errorFromThrown(e, 400) };
                }
            }

            // Fallback: try MetadataService directly
            const metaSvc = await deps.resolveService(_context, 'metadata', _context.environmentId);
            if (metaSvc && typeof (metaSvc as any).saveItem === 'function') {
                try {
                    const data = await (metaSvc as any).saveItem(type, name, item);
                    return { handled: true, response: deps.success(data) };
                } catch (e: any) {
                    // 501 stays the FALLBACK (this branch is reached only when
                    // the protocol has no `saveMetaItem`, so "unsupported" is
                    // the honest default) — but a save that fails validation is
                    // a 400 the caller can fix, not a capability gap.
                    return { handled: true, response: deps.errorFromThrown(e, 501) };
                }
            }
            return { handled: true, response: deps.error('Save not supported', 501) };
        }

        // [commit 4fc4a3c0b] The read `try` below is this block's default answer, and it
        // used to carry NO method guard at all: every verb that is not `PUT`
        // fell into it and was served the ordinary metadata READ.
        //
        // MEASURED through the real composed host (`createHonoApp`'s
        // `${prefix}/*` catch-all → `dispatch()` → this domain), caller
        // authenticated, path `/api/v1/meta/object/account`:
        //
        //     DELETE → 200, getMetaItem called once, deleteMetaItem never
        //     PATCH  → 200, getMetaItem called once
        //     POST   → 200, getMetaItem called once
        //
        // `DELETE` is the sharpest of the three: a caller asking to delete a
        // metadata item received `200` plus the document, which is
        // indistinguishable from a successful destructive call — and nothing
        // was deleted. No status, header or field separated any of these
        // answers from a real `GET`. Same defect class as #8842's falsy-body
        // `PUT` next door, reached by a different door (AGENTS.md, Route &
        // surface ownership §3 "Absence must be loud", §4 "machine-readable
        // surfaces must not lie").
        //
        // ⚠️ NOT a privilege escalation, and please do not restate it as one:
        // these requests are answered by the READ path, which runs the ADR-0106
        // mask, so the caller gets exactly what `GET` would return and nothing
        // is written. A request that does not write does not escalate by
        // skipping a write gate.
        //
        // Aligning, not inventing: every OTHER route in this file already
        // guards its verb — the `state` and `published` reads above
        // (`!method || method === 'GET'`), `_drafts` and `_migrate-stored`
        // below. This block was the outlier.
        //
        // ⛔ This REFUSES the unsupported verbs; it does not implement them.
        // A real metadata delete exists (`protocol.deleteMetaItem`) and REST
        // already exposes `DELETE /api/v1/meta/:type/:name`, but mounting it on
        // THIS transport would expand the public surface and needs its own card.
        const verb = method?.toUpperCase();
        if (verb && verb !== 'GET' && verb !== 'HEAD') {
            // Hand-rolled rather than `deps.error(...)` for one reason: the
            // `Allow` header, which is how a 405 NAMES what is allowed to a
            // machine rather than only to a human reading the message
            // (`IHttpServer`'s unmatched-request contract in
            // `packages/spec/src/contracts/http-server.ts`; `domains/mcp.ts`
            // hand-rolls its 405 for exactly the same reason — `deps.error`
            // carries no headers). The BODY still goes through the one builder,
            // so this branch cannot drift back to a numeric `code`, and the
            // code itself is DERIVED from the status (`METHOD_NOT_ALLOWED`)
            // rather than spelled here — matching the other 405 sites.
            const allow = METADATA_ITEM_METHODS.join(', ');
            return {
                handled: true,
                response: {
                    status: 405,
                    headers: { Allow: allow },
                    body: {
                        success: false,
                        error: buildApiError({
                            message: `Method not allowed on a metadata item — use ${allow}.`,
                            httpStatus: 405,
                        }),
                    },
                },
            };
        }

        // [#20338 · #20320] The item read's two draft switches, each declared
        // WITH its admission ({@link mayReadPendingDrafts}), once, above every
        // branch below — so no branch can re-derive a switch past the gate. A
        // caller who may not read drafts is answered this read as if neither
        // switch were present: the published item, pruned as the plain read
        // prunes it, or its absence.
        //
        // `?state=draft` is the pending draft ROW (ADR-0033) — a STORED version,
        // parsed exactly as `RestServer`'s plain read parses it. It went unread
        // here, so an admitted builder on a dispatcher-only host was answered
        // the ACTIVE item, never the draft and never `404 NO_DRAFT`.
        const isDraftRead = typeof query?.state === 'string'
            && query.state.toLowerCase() === 'draft'
            && mayReadPendingDrafts(_context.executionContext);
        // ADR-0033 draft-overlay preview: `?preview=draft` makes the detail
        // read prefer a pending draft (falling back to active).
        // [#20408] Parsed exactly as `RestServer`'s plain read parses it —
        // case-insensitively — so `?preview=DRAFT` from a builder is a preview
        // on both transports, not a published read on this one.
        const previewDrafts = typeof query?.preview === 'string'
            && query.preview.toLowerCase() === 'draft'
            && mayReadPendingDrafts(_context.executionContext);

        // [#20408] The caller's VETTED organization (`metaReadOrganizationId`
        // gates it by the folded type): the partition `RestServer`'s plain read
        // reads. The session's claim as stored served a member removed from an
        // organization that organization's overlays here.
        const caller = _context.executionContext as MetaReadGateCaller | undefined;
        const singularType = pluralToSingular(type);

        // [ADR-0106 D2/D3 · #20408] ONE posture for this caller × this item,
        // resolved BEFORE any lookup and applied by the item chain to whichever
        // lookup answers — `RestServer`'s plain read resolves it at the same
        // point, so an unevaluable posture (D6 tier 3) is answered as the
        // field-visibility fault before any read, on both transports. Every
        // type but `object` is the not-applicable passthrough.
        let maskPosture: ObjectSchemaMaskPosture;
        try {
            maskPosture = await (await resolveObjectMasker(deps, _context, singularType))(name);
        } catch (maskError) {
            if (maskError instanceof ObjectSchemaMaskEvaluationError) return fieldVisibilityFault(deps, name);
            throw maskError;
        }

        try {
            // [#5882 · #20478] The DEPRECATED spelling of the layered view,
            // `?layers=<any non-empty value>` — the parse `RestServer`'s item
            // read asks (`wantsMetaItemLayers`), answered FIRST, before either
            // draft switch, as there. Where the protocol has a layered read the
            // flag is the layered view ({@link answerMetaLayered}, the route's
            // own answer), with `Deprecation` and a `Link` to the successor on
            // every answer; where it has none the flag is the plain read, as it
            // always was on `RestServer`. It answered the plain read's
            // `{ type, name, item }` here whatever the protocol could do — a
            // `200` whose `overlay` and `effective` read `undefined`, and an
            // app pruned for its author where ruling 5856774816 serves it whole.
            if (wantsMetaItemLayers(query)) {
                const protocol = await resolveProtocol(deps, _context);
                if (protocol && typeof protocol.getMetaItemLayered === 'function') {
                    return await answerMetaLayered(
                        deps, _context, protocol as MetaLayeredProtocol,
                        { type, name, packageId, maskPosture }, saveVerdict,
                        metaItemLayersDeprecationHeaders(requestedItemPath(_context)),
                    );
                }
            }

            if (isDraftRead) {
                return await readPendingDraft(
                    deps, _context, type, name, packageId, previewDrafts, saveVerdict, { maskPosture, query },
                );
            }

            // [#20408] Every lookup below hands its envelope to THE item chain
            // (`answerMetaItem` → `createMetaItemAnswer`, the one `RestServer`'s
            // plain read runs): the per-caller gate, the doc locale collapse,
            // the mask under the posture resolved above, the translation and
            // `sortability`. It runs OUTSIDE the lookups' own `try`s — those
            // classify a miss, and a gate or mask fault must be answered as
            // itself, never as "not found" and never by falling through to the
            // next lookup, which would answer with the very body the fault
            // exists to withhold.
            const serveItem = (protocol: MetaDomainProtocol | undefined, envelope: any): Promise<HttpDispatcherResult> =>
                answerMetaItem(
                    deps, _context, protocol,
                    { metaType: singularType, name, policy: RENDERED_DOCUMENT_POLICY, maskPosture },
                    query, envelope,
                );

            // Try specific calls based on type
            if (type === 'objects' || type === 'object') {
                // Check whether the kernel is project-scoped. When it is,
                // the process-wide SchemaRegistry is unsafe to query
                // directly — it would return objects that other projects
                // wrote in this same process. Route through the Protocol
                // service (which filters sys_metadata by environment_id) in that
                // case, and fall back to the registry only for the
                // unscoped (single-kernel / control-plane) path.
                const protocol = await resolveProtocol(deps, _context);
                const scopedEnv = typeof protocol?.getProjectId === 'function'
                    ? protocol.getProjectId()
                    : protocol?.environmentId;
                const scoped = scopedEnv !== undefined;

                // [#20408] An ADMITTED `?preview=draft` reads a PENDING draft,
                // which only the protocol knows — the registry holds published
                // schemas — so the protocol answers first, as it always does on a
                // scoped kernel. This branch never read the switch, so a builder
                // previewing an object was answered the ACTIVE schema where
                // `RestServer` answers the draft.
                const protocolFirst = scoped || previewDrafts;

                // The protocol read `RestServer`'s plain read makes: the same
                // `?package=` scope (ADR-0048), the same admitted switch and the
                // same org partition — `organizationIdForMetaRead` never names an
                // organization for `object`, so no phantom org row resurrects.
                const readFromProtocol = async (): Promise<any> => {
                    // [#15238] `protocol &&` spelled out: the `any` cast this
                    // branch used to resolve through let two sibling guards drift
                    // apart in spelling — typing the handle surfaced it (TS18048).
                    if (!protocol || typeof protocol.getMetaItem !== 'function') return undefined;
                    try {
                        const data = await protocol.getMetaItem({
                            type: 'object',
                            name,
                            organizationId: metaReadOrganizationId(type, caller),
                            ...(packageId ? { packageId } : {}),
                            ...(previewDrafts ? { previewDrafts: true } : {}),
                        });
                        // Protocol returns `{ type, name, item }` — only treat the
                        // lookup as a hit when `item` is really there. [#5563] The
                        // test used to be `data.item ?? data`, which is truthy for
                        // ANY truthy `data`: an item-less answer (what a metadata
                        // store outage resolves to) was served as a hit and the
                        // registry fallback below never ran.
                        return data?.item != null ? data : undefined;
                    } catch {
                        return undefined; // fall through to registry / 404
                    }
                };

                let found: any = protocolFirst ? await readFromProtocol() : undefined;
                if (found === undefined) {
                    const qlService = await deps.getObjectQL(_context);
                    const data = qlService?.registry?.getObject(name);
                    // [#5563] The registry hands back the bare ObjectSchema, so this
                    // fallback used to answer a different body shape than the
                    // protocol branch above for the very same request. Wrap it in
                    // the declared `GetMetaItemResponseSchema` envelope — `type` and
                    // `name` come from the request, the same values the protocol
                    // would have echoed back.
                    if (data) found = { type: 'object', name, item: data };
                }
                // Last-ditch protocol attempt for unscoped kernels whose
                // registry missed (e.g. object persisted to DB but not
                // yet hydrated). Skip when we already tried above.
                if (found === undefined && !protocolFirst) found = await readFromProtocol();
                if (found === undefined) return { handled: true, response: deps.error('Not found', 404) };
                return serveItem(protocol, found);
            }

            // Try Protocol Service First (Preferred)
            const protocol = await resolveProtocol(deps, _context);

            let found: any;
            if (protocol && typeof protocol.getMetaItem === 'function') {
                 try {
                    // `previewDrafts` is the ADMITTED switch declared above
                    // this block's branches (#20338).
                    const data = await protocol.getMetaItem({
                        type: singularType, name, packageId, organizationId: metaReadOrganizationId(type, caller), previewDrafts,
                    });
                    // [#18401] The SAME hit test the `object` branch above runs,
                    // asked here for the same reason. `getMetaItem` answers a
                    // miss with the protection envelope around an absent item —
                    // `{ type, name, item: undefined, lock, editable, deletable,
                    // resettable }`, because `resolveLockState(undefined, false)`
                    // is unconditional — never with `undefined`. Returned
                    // straight through, `JSON.stringify` at the transport drops
                    // the `item` member and the caller is handed a 200 whose body
                    // is the declared envelope MINUS its required member: the
                    // route reports a hit for a name with nothing behind it.
                    //
                    // ⭐ What made this a defect rather than a rough edge is that
                    // this function already answered the same question the other
                    // way one branch up: `object` refuses the item-less envelope
                    // and 404s. One function, two opposite answers to "does
                    // absence mean success?", selected by which type you asked
                    // for. `GetMetaItemResponseSchema` declares `item` required,
                    // and the REST twin of this door refuses the identical shape
                    // (#18066) — three declarations agreeing against one branch.
                    //
                    // ⛔ This adds no new refusal dialect. The fall-through ends
                    // at this block's OWN `deps.error('Not found', 404)` below —
                    // the ADR-0112 nested envelope every other refusal in this
                    // file already speaks — so the dialect question #18402 raises
                    // about this route is untouched here, neither answered nor
                    // pre-empted.
                    if (data?.item != null) {
                        found = data;
                    }
                 } catch (e: any) {
                    // Protocol might throw if not found or not supported
                 }
            }
            if (found) return serveItem(protocol, found);

            // Try MetadataService for runtime-registered types
            const metaSvc = await deps.resolveService(_context, 'metadata', _context.environmentId);
            if (metaSvc && typeof (metaSvc as any).getItem === 'function') {
                let data: any;
                try {
                    // ADR-0048 — thread `?package=` so single-item resolution is
                    // package-scoped (prefer-local), matching list resolution.
                    data = await (metaSvc as any).getItem(singularType, name, packageId);
                } catch { /* not found */ }
                // [#5563] Same convergence as the object branch above: the
                // MetadataService hands back the bare document, so wrap it in
                // the declared envelope rather than letting which service
                // answered decide the caller's parse.
                if (data) return serveItem(protocol, { type: singularType, name, item: data });
            }
            return { handled: true, response: deps.error('Not found', 404) };
        } catch (e: any) {
            // Fallback: treat first part as object name if only 1 part (handled below)
            // But here we are deep in 2 parts. Must be an error — 404 remains the
            // default, but an error carrying its own status keeps it.
            return { handled: true, response: deps.errorFromThrown(e, 404) };
        }
    }
    
    // GET /metadata/_drafts?packageId=&type=  (ADR-0033 pending-changes list)
    // Surfaces draft-state metadata the active-only `getMetaItems` list hides,
    // so the console can show what an AI authored but nobody published yet.
    // `_drafts` is intercepted before the generic `:type` handler below so it
    // is never mistaken for a metadata type name.
    if (parts.length === 1 && parts[0] === '_drafts' && (!method || method.toUpperCase() === 'GET')) {
        // [ADR-0106 D5(4) / #6599] The dispatcher face of the same authoring
        // gate the REST `/meta/_drafts` route carries. A pending object draft
        // ships its full `fields` map, so serving `listDrafts()` verbatim leaks
        // every hidden field's definition — the disclosure ADR-0106 closes on
        // every other `/meta` outlet. `_drafts` is authored-metadata, not a
        // general read, so it GATES per caller on the SAME D4 exemption
        // predicate (`isObjectSchemaMaskExempt`) the mask exits use — 403 for a
        // non-author — rather than masking per field. Gate FIRST, before the
        // protocol is resolved, so the 501-vs-200 answer cannot be used to probe
        // (same posture as `_migrate-stored` below). The runtime transport
        // derives the ADR-0112 code from the 403 status (`PERMISSION_DENIED`),
        // matching `_migrate-stored`'s next-door precedent rather than the REST
        // twin's `FORBIDDEN`. [#20338] Asked through {@link mayReadPendingDrafts},
        // the one question this domain's draft doors share.
        const ec: any = _context.executionContext;
        if (!mayReadPendingDrafts(ec)) {
            return {
                handled: true,
                response: deps.error(
                    'Reading pending metadata drafts requires an authoring capability (studio.access, setup.access or manage_metadata).',
                    403,
                ),
            };
        }
        const protocol = await resolveProtocol(deps, _context);
        if (protocol && typeof protocol.listDrafts === 'function') {
            try {
                // [#20408] The caller's VETTED organization, raw — what
                // `RestServer`'s `_drafts` hands down (`ctx.tenantId`). The
                // session's claim as stored listed a removed member the pending
                // drafts of the organization they had left.
                const organizationId = metaCallerOrganizationId(ec);
                const data = await protocol.listDrafts({
                    packageId: query?.packageId || undefined,
                    type: query?.type || undefined,
                    organizationId,
                });
                return { handled: true, response: deps.success(data) };
            } catch (e: any) {
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        }
        return { handled: true, response: deps.error('Draft listing not supported', 501) };
    }

    // POST /metadata/_migrate-stored  (#4327 / #4454 / #4498)
    //
    // The server-side entry point to the same canonicalization pass
    // `os migrate meta --stored` runs. It exists because the CLI form requires
    // shell access to the deployment's database, which a hosted operator does
    // not have — so on a managed deployment ADR-0087's stored-metadata chain
    // had no finish line at all, only the per-read conversion that never ends.
    //
    // Nothing about flows is threaded through here: `migrateStoredMetadata`
    // resolves the automation engine from the services registry (#4498), and a
    // server always has a live one — so this route covers flow rows by simply
    // running in the process that owns them.
    //
    // Body: `{ apply?: boolean, types?: string[] }`. **Preview by default** —
    // the same posture as the CLI: `apply` must be explicitly `true`, and a
    // caller who sends nothing gets a report and no writes.
    if (parts.length === 1 && parts[0] === '_migrate-stored' && method?.toUpperCase() === 'POST') {
        // This rewrites every eligible `sys_metadata` row in the deployment, so
        // unlike the single-item `PUT /metadata/:type/:name` next door it is
        // gated on an explicit capability rather than on being authenticated.
        // `manage_metadata` is the ADR-0066 D1 capability for authoring and
        // publishing metadata, which is exactly what a rewrite is; engine
        // self-invocation (`isSystem`) bypasses, matching `actionPermissionError`.
        //
        // [#12702] Deliberately NOT `metaWriteCapabilityVerdict`: an
        // install-wide stored-metadata rewrite is env-wide by definition, so
        // `manage_org_presentation`'s "org-scoped to the caller's own active
        // organization" condition can never hold here. `manage_metadata`-only,
        // unchanged — do not copy the item doors' acceptance in.
        const ec: any = _context.executionContext;
        if (!ec?.isSystem && !new Set<string>(ec?.systemPermissions ?? []).has('manage_metadata')) {
            return {
                handled: true,
                response: deps.error(
                    'Rewriting stored metadata requires the `manage_metadata` capability.',
                    403,
                ),
            };
        }

        const protocol = await resolveProtocol(deps, _context);
        if (!protocol || typeof protocol.migrateStoredMetadata !== 'function') {
            return { handled: true, response: deps.error('Stored-metadata migration not supported', 501) };
        }
        const types = Array.isArray(body?.types)
            ? body.types.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
            : undefined;
        try {
            const report = await protocol.migrateStoredMetadata({
                apply: body?.apply === true,
                ...(types && types.length > 0 ? { types } : {}),
                // Attributed to the caller, not to the route: this writes
                // history + audit rows, and "who ran the migration" is the
                // question those rows exist to answer.
                actor: ec?.userId ? `${ec.userId} (POST /metadata/_migrate-stored)` : 'POST /metadata/_migrate-stored',
            });
            return { handled: true, response: deps.success(report) };
        } catch (e: any) {
            return { handled: true, response: deps.errorFromThrown(e, 500) };
        }
    }

    // GET /metadata/:type (List items of type) OR /metadata/:objectName (Legacy)
    if (parts.length === 1) {
        const typeOrName = parts[0];
        // Extract optional package filter from query string
        const packageId = query?.package || undefined;

        // Try protocol service first for any type
        const protocol = await resolveProtocol(deps, _context);

        // [#20237] This branch serves a LIST, the same answer `RestServer`'s
        // `GET /meta/:type` serves — so it prunes what that route prunes: the
        // shared per-caller LIST gate (the ADR-0046 §6.7 doc and book audience,
        // the app nav filter, the ADR-0057 D10 dashboard widget gate), then the
        // ADR-0106 object mask. It ran only the mask, and only on the protocol
        // exit, so a member `RestServer` prunes listed a `{ permissionSet }`-
        // gated doc here with its body (`?include=content`), a set-gated book,
        // and every app with its `requiredPermissions`-gated entries — the list
        // twin of the item reads' defect.
        //
        // [#20320] …and it PROJECTS what that route projects: every exit below
        // hands its store's answer to `answerList` — THE list chain
        // `RestServer`'s route runs (`createMetaListAnswer`: the `api`
        // served-set face, the gate, `?id=`, `?object=`, the doc locale collapse
        // and slim, the mask, the translation). This branch ran a doc slim of
        // its own that compared the RAW segment, and none of the rest. Every
        // exit calls it OUTSIDE the lookups' own `try`s: those classify a type
        // the store does not know, and a chain fault must be answered as itself
        // — never fall through to the next store as though the first had not
        // answered.
        const listType = pluralToSingular(typeOrName);

        // [#9488 · #20408] A segment that names no metadata type is REFUSED —
        // `400 INVALID_REQUEST`, the one refusal `RestServer`'s list answers —
        // before any listing work, rather than served as a real-but-empty
        // collection (`200 {items: []}` here, until this card). The rule is the
        // shared one: the static spelling contract UNION the live type set,
        // fail-open when the live listing cannot be read — so a host whose
        // protocol has no `getMetaTypes` keeps reaching the legacy
        // one-segment object-name exit below.
        try {
            await refuseUnknownMetaListType(protocol, typeOrName);
        } catch (e: any) {
            return { handled: true, response: deps.errorFromThrown(e, 400) };
        }

        // ADR-0033 draft-overlay preview: `?preview=draft` overlays pending
        // drafts on the active list so an (admin) reviewer can render the
        // console off drafts before publishing.
        // [#20338] Admitted per caller ({@link mayReadPendingDrafts}), in this
        // declaration: anyone else reads the published list. [#20320] Declared
        // once, at the branch's entry, because the chain reads it too (the `api`
        // face is exempt for an admitted preview). [#20408] Parsed exactly as
        // `RestServer`'s list parses it — case-insensitively.
        const previewDrafts = typeof query?.preview === 'string'
            && query.preview.toLowerCase() === 'draft'
            && mayReadPendingDrafts(_context.executionContext);
        const answerList = (data: any) =>
            answerMetaList(deps, _context, protocol, listType, query, previewDrafts, data);

        let listed: any;
        if (protocol && typeof protocol.getMetaItems === 'function') {
            try {
                // [#20408] The caller's VETTED organization, gated by the folded
                // type — the partition `RestServer`'s list reads.
                const organizationId = metaReadOrganizationId(
                    typeOrName, _context.executionContext as MetaReadGateCaller | undefined,
                );
                const data = await protocol.getMetaItems({ type: typeOrName, packageId, organizationId, previewDrafts });
                // Return any valid response from protocol (including empty items arrays)
                if (data && (data.items !== undefined || Array.isArray(data))) listed = data;
            } catch (e: any) {
                // [#20590] A throw here is a FAULT, answered as itself — never a
                // cue to serve the metadata service's list below, which holds
                // the stored bodies and applies no per-type read-path redaction
                // (a flow's hook secret, a datasource's password). The protocol
                // answers a type it holds nothing for with an empty list — it
                // merges the metadata service's runtime-registered items (agents,
                // tools) into its own answer — so it never signals "unknown
                // type" by throwing. What it throws is a failed store read
                // (503), a metadata app's marked refusal, a redactor failing
                // closed, or a refused spelling (400). `RestServer`'s list route
                // answers the same throw the same way ("prefer failing to
                // falling back", AGENTS.md).
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        }
        // [ADR-0106 D5(2)] The dispatcher's list read is the same outlet as
        // REST's `GET /meta/object`, reached by a different door.
        if (listed !== undefined) return answerList(listed);

        // Try MetadataService directly for runtime-registered metadata (agents, tools, etc.)
        // — reached only by a host whose protocol slot has no list verb, or
        // whose protocol answered no list at all; never on a protocol fault.
        const metadataService = await deps.getService(_context, CoreServiceName.enum.metadata);
        if (metadataService && typeof (metadataService as any).list === 'function') {
            let items: any;
            try {
                items = await (metadataService as any).list(typeOrName);
                // Respect package filter: MetadataService.list() returns ALL items,
                // so filter by _packageId when a specific package is requested.
                if (packageId && items && items.length > 0) {
                    items = items.filter((item: any) => item?._packageId === packageId);
                }
            } catch (e: any) {
                items = undefined;
                // MetadataService doesn't know this type or failed, continue to other fallbacks
                // Sanitize typeOrName to prevent log injection (CodeQL warning)
                const sanitizedType = String(typeOrName).replace(/[\r\n\t]/g, '');
                console.debug(`[HttpDispatcher] MetadataService.list() failed for type:`, sanitizedType, 'error:', e.message);
            }
            if (items && items.length > 0) return answerList({ type: typeOrName, items });
        }

        // Try ObjectQL registry directly for object/type lookups
        const qlService = await deps.getObjectQL(_context);
        if (qlService?.registry) {
            if (typeOrName === 'objects') {
                const objs = qlService.registry.getAllObjects(packageId);
                return answerList({ type: 'object', items: objs });
            }
            // Try listing items of the given type
            const items = qlService.registry.listItems?.(typeOrName, packageId);
            if (items && items.length > 0) return answerList({ type: typeOrName, items });
            // [#20320] The anonymous exemption above grants reachability of the
            // book and doc LISTS, and this exit is not one: a one-segment path
            // that names an object (`/meta/book` where an object is called
            // `book`) serves an object SCHEMA. An anonymous caller never reaches
            // a schema — the deny it skipped is answered here instead.
            if (anonymous) return anonymousDeny();
            // Legacy: treat as object name. [ADR-0106 D5(4)] A schema-bearing
            // exit reached by a one-segment path — masked like every other, so
            // the legacy spelling is not a way around the projection.
            const obj = qlService.registry.getObject(typeOrName);
            if (obj) {
                const masked = await maskObjectSchema(
                    await resolveObjectMasker(deps, _context, 'object'), typeOrName, obj,
                );
                if (!masked.ok) return fieldVisibilityFault(deps, typeOrName);
                // [#20408] ADR-0106 D6 tier 2's `private, no-store`, as every
                // other object exit here serves it.
                return successWithHeaders(deps, masked.document, { 'Cache-Control': masked.cacheControl });
            }
        }
        return { handled: true, response: deps.error('Not found', 404) };
    }

    // GET /metadata — return available metadata types
    if (parts.length === 0) {
        // Prefer protocol service for the rich `entries` array (with
        // JSON Schemas etc); fall back to MetadataService types-only.
        const protocol = await resolveProtocol(deps, _context);
        if (protocol && typeof protocol.getMetaTypes === 'function') {
            try {
                const result = await protocol.getMetaTypes({});
                return { handled: true, response: deps.success(result) };
            } catch { /* fall through */ }
        }
        const metadataService = await deps.resolveService(_context, 'metadata', _context.environmentId);
        if (metadataService && typeof (metadataService as any).getRegisteredTypes === 'function') {
            try {
                const types = await (metadataService as any).getRegisteredTypes();
                return { handled: true, response: deps.success({ types }) };
            } catch { /* fall through */ }
        }
        return { handled: true, response: deps.success({ types: ['object', 'app', 'plugin'] }) };
    }

    // [commit 7986d973f] A LOCATED refusal, not a bare `{ handled: false }`.
    //
    // This tail was unreachable until that commit: the branches above covered
    // zero segments, one segment, and — through the compound fold — every path
    // with two or MORE. Retiring the fold makes it reachable for the first
    // time, and what reaches it is a `/meta` path with no route: three or more
    // segments that is not `/published` or the four-segment FSM `/state/:field`.
    //
    // `{ handled: false }` would leave the answer to the adapter, which turns
    // an unhandled result into a generic `404 'Not Found'` — losing both the
    // path and the ADR-0112 code, on the very shape this retirement newly
    // produces. "Absence must be loud" (AGENTS.md, Route & surface ownership
    // §3): the caller most likely to land here is one still spelling a
    // compound name, and they should be told the route does not exist rather
    // than be handed an anonymous 404. Same shape `domains/ai.ts` and
    // `domains/share-links.ts` already use for their own unmatched sub-paths.
    return { handled: true, response: deps.routeNotFound(`/meta${path.startsWith('/') ? '' : '/'}${path}`) };
}
