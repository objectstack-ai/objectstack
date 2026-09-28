// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20193] THE per-caller read gate of one `/meta/:type/:name` document — one
 * implementation, called by both transports that serve that read.
 *
 * ## Why this module exists
 *
 * Two transports answer `GET /meta/:type/:name` (and its `/published` twin):
 * `RestServer`, and the runtime dispatcher's `/meta` domain, which is the ONLY
 * answer on a host that mounts just the `${prefix}/*` catch-all —
 * `@objectstack/hono`'s `createHonoApp`, the documented embed shape, and any
 * adapter written on the public `HttpDispatcher` API. Neither can mount the
 * other: `RestServer` needs an `IHttpServer`, and that catch-all is terminal
 * by design (ADR-0076 OQ#9), so the dispatcher's `/meta` branches stay the
 * fallback fabric ADR-0076 item 9 records. The per-caller gate lived inside
 * `RestServer` (#20156), so the dispatcher applied none of it: a member
 * `RestServer` refuses a `{ permissionSet }`-gated doc read its body there, and
 * an app's `requiredPermissions` entries reached every member.
 *
 * Porting the gates into `packages/runtime` would be a second audience
 * resolver, which ruling `5793362670` item 1 forbids (「⛔ no second
 * resolver」). So the gate moved here, unchanged, out of `RestServer`: every
 * decision below is the one `RestServer` made, and each transport hands in
 * only its own I/O — how it knows the caller, how it reads a metadata list,
 * where the security service is, how it probes a deployment's services
 * ({@link MetaItemReadGateSources}). The verdict is DATA
 * ({@link MetaItemReadVerdict}); each transport writes a refusal on its own
 * wire, the way it writes every other refusal.
 *
 * ⛔ Do not add a decision to a transport's adapter. A gate added HERE reaches
 * both transports; a gate added in one of them is the defect this module
 * closed, reopened one layer over.
 *
 * `RestServer` keeps its private helper names (`filterAppForUser`,
 * `resolveDocsAudience`, `resolveNavServability`, …) as one-line delegates to
 * the functions below, so its other docs and app reads — the book tree, the
 * alternate doors — ask this same implementation.
 *
 * [#20237] The LIST read had the same two transports and the same split:
 * `RestServer`'s `GET /meta/:type` pruned inline, and the dispatcher's list
 * branch pruned nothing. Its gate lives here too
 * ({@link createMetaListReadGate}), built from the same functions over the
 * same ports.
 *
 * [#20320 · #20408] …and so does every other step those reads take after the
 * store read: the list chain ({@link createMetaListAnswer}), the item read's
 * ({@link createMetaItemAnswer}), the book tree ({@link createMetaBookTreeAnswer}),
 * the list's unknown-type refusal ({@link refuseUnknownMetaListType}), the
 * object mask's cache posture ({@link projectMetaObjectSchema}) and the
 * organization a caller's read is scoped to ({@link metaReadOrganizationId}).
 * [#20478] So does the layered view, on both of its spellings
 * ({@link createMetaLayeredAnswer}, {@link wantsMetaItemLayers},
 * {@link metaItemLayersDeprecationHeaders}).
 * `meta-list-projection-parity.test.ts` and `meta-read-org-scope-parity.test.ts`
 * in `@objectstack/runtime` drive both transports over the same fixtures and
 * hold the answers equal.
 */

import type { AudienceCaller, Book, ResolvedBook, ResolverDoc } from '@objectstack/spec/system';
import { preferredLocaleFromHeader } from '@objectstack/spec/system';
import { apiExposureDenialReason } from '@objectstack/spec/data';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { canonicalMetaUrlType, pluralToSingular, unrecognisedMetaTypeRefusal } from '@objectstack/spec/shared';
import {
    ObjectSchemaMaskEvaluationError,
    applyObjectSchemaMask,
    organizationIdForMetaRead,
    type ObjectSchemaMaskPosture,
} from '@objectstack/metadata-core';
import { isEndpointMatchAuthority, selectServedEndpoints } from './served-endpoints.js';
import { logError, logWarn } from './log.js';

// ── The ports each transport supplies ─────────────────────────────────────────

/**
 * The slice of a request's execution context the gate reads: who the caller is
 * (`userId`), what they may do (`systemPermissions`), and — internal to
 * `RestServer`'s resolution — the per-request kernel a service probe prefers.
 */
export interface MetaReadGateCaller {
    userId?: unknown;
    systemPermissions?: unknown;
    /**
     * [#20156] May this caller WRITE the item being read? The transport's own
     * answer, asked exactly as its save door asks it (REST: the admission of
     * `PUT /meta/:type/:name`, `metaWriteCapabilityVerdict` for `save`) — a
     * CALLER property, in ADR-0106 D4's shape, never a route property.
     *
     * Read only where the door's policy honours the author exemption
     * ({@link MetaReadGatePolicy.app} `author-exempt`); a transport supplies it
     * only there. Absent reads as `false`: no exemption.
     */
    mayWriteItem?: boolean;
    [key: string]: unknown;
}

/** The one security-service verb the docs audience reads. */
export interface MetaReadGatePermissionSetResolver {
    resolvePermissionSetNames?(context: any): Promise<unknown> | unknown;
}

/** How a transport reads the caller (the audience half of the ports). */
export interface MetaReadGateAudienceSources {
    /**
     * This request's caller as the transport resolved it, or `undefined` for an
     * anonymous one. A REJECTION is an authorization-store outage and must
     * propagate — ⛔ never answer `undefined` for a caller that could not be
     * resolved, which would read the outage as "anonymous".
     */
    resolveCaller(): Promise<MetaReadGateCaller | undefined>;
    /**
     * The security service holdings are resolved through, or `undefined` when
     * the deployment has none. A throw is read as "holdings unresolvable", so
     * gated audiences DENY (ADR-0049).
     */
    resolveSecurityService(): Promise<MetaReadGatePermissionSetResolver | undefined>;
}

/** How a transport reads a whole metadata type (the list half of the ports). */
export interface MetaReadGateListSource {
    /**
     * One `getMetaItems` LIST read of `type`, env-wide — or `undefined` when
     * this transport's protocol has no list read at all. A THROW is a fault,
     * ⛔ never an empty list: an empty book list is "no gated book anywhere" and
     * an empty doc corpus is "every doc unclaimed, so `org`" — both GRANT.
     */
    listMetaItems(type: 'book' | 'doc' | 'object'): Promise<unknown> | undefined;
}

/** Everything {@link createMetaItemReadGate} reads, supplied by the transport. */
export interface MetaItemReadGateSources extends MetaReadGateAudienceSources, MetaReadGateListSource {
    /**
     * The ADR-0057 D10 service probe for this caller's deployment, or `null`
     * when nothing can be probed — the service gates then fail OPEN, as they
     * always have.
     */
    serviceProbe(caller: MetaReadGateCaller | undefined): ((name: string) => Promise<boolean>) | null;
    /** Where the nav-servability prune log records what it has already said (one line per key). */
    readonly navPruneLogged: Set<string>;
}

// ── The caller's organization ─────────────────────────────────────────────────

/**
 * [#20408] The active organization a `/meta` request is scoped to: the
 * `tenantId` the identity resolver VETTED onto the caller's execution context
 * — ⛔ never the session's `activeOrganizationId` as stored.
 *
 * `resolveAuthzContext` (`@objectstack/core`) vets that claim: under a
 * wall-enforcing tenancy posture, a claim naming an organization the caller no
 * longer belongs to is DROPPED, and the request resolves with no active
 * organization at all (the fail-closed state every other layer reads). The
 * runtime dispatcher's `/meta` doors used to read the claim straight off the
 * auth service, so a member removed from an organization kept its metadata
 * partition there for the rest of the session: its org-scoped overlays were
 * served to them by the item read, the list, `/published` and `?state=draft`,
 * `GET /meta/_drafts` listed its pending drafts, and `PUT` wrote into it —
 * while `RestServer`, which reads `ctx.tenantId`, answered the same caller the
 * env-wide rows. One source, both transports.
 *
 * `undefined` for an anonymous caller, a caller with no active organization,
 * and one whose claim was dropped — which are one fact to every consumer.
 */
export function metaCallerOrganizationId(caller: unknown): string | undefined {
    const tenantId = caller && typeof caller === 'object' ? (caller as { tenantId?: unknown }).tenantId : undefined;
    return typeof tenantId === 'string' ? tenantId : undefined;
}

/**
 * [#9454 · #20408] The organization a `/meta` READ of `type` carries:
 * `organizationIdForMetaRead` over the FOLDED segment (folded-type commit
 * 26f3588fb, whose card no longer resolves: the raw plural would miss the
 * registry's override flag) and the caller's vetted
 * organization ({@link metaCallerOrganizationId}). An organization reaches the
 * read only for a type the registry declares `allowOrgOverride`, so a
 * non-overridable type never resurrects a pre-#6190 phantom org row.
 *
 * `RestServer`'s list and item reads and the runtime dispatcher's ask this, so
 * the partition a caller reads cannot differ by transport.
 */
export function metaReadOrganizationId(type: unknown, caller: unknown): string | undefined {
    return organizationIdForMetaRead(
        canonicalMetaUrlType(typeof type === 'string' ? type : ''),
        metaCallerOrganizationId(caller),
    );
}

// ── The verdict ───────────────────────────────────────────────────────────────

/**
 * Why a document is not served — DATA, written on each transport's own wire.
 *
 *  - `absent` — the transport's own "nothing behind this name" answer, byte for
 *    byte (ADR-0045 §3: an unpublished app is externally unobservable, and an
 *    absent optional service is a deployment fact, not a denial).
 *  - `app-permission` — `403 PERMISSION_DENIED`, the one withheld reason the
 *    #8013 ruling lets an app report as itself.
 *  - `docs-audience` — ADR-0046 §6.7: `401 UNAUTHENTICATED` to an anonymous
 *    caller, `403 PERMISSION_DENIED` otherwise.
 */
export type MetaItemReadRefusal =
    | { reason: 'absent' }
    | { reason: 'app-permission'; status: 403; code: 'PERMISSION_DENIED'; message: string }
    | { reason: 'docs-audience'; status: 401; code: 'UNAUTHENTICATED'; message: string }
    | { reason: 'docs-audience'; status: 403; code: 'PERMISSION_DENIED'; message: string };

/**
 * What the gate answers for ONE document.
 *
 *  - `serve` — send `document`: the input, or the input minus what this
 *    caller may not read (the app nav filter, the dashboard widget gate).
 *  - `refuse` — send nothing of the document; `refusal` says what the
 *    transport writes instead.
 */
export type MetaItemReadVerdict =
    | { kind: 'serve'; document: any }
    | { kind: 'refuse'; refusal: MetaItemReadRefusal };

/**
 * [#20156] How a door runs {@link createMetaItemReadGate}.
 */
export interface MetaReadGatePolicy {
    /**
     * `all` — every gate the plain read runs, the ones that answer per
     * DEPLOYMENT included (ADR-0057 D10 `requiresService` on an app, its nav
     * entries and a dashboard's widgets; #7912 object servability). The
     * doors that serve the document a client RENDERS: the plain read (its
     * `?preview=draft` included) and `/published`.
     *
     * `per-caller` — only the gates whose verdict depends on who asks. The
     * doors that serve STORED versions — the layered view, `/diff`,
     * `/history`, `/audit`, and [#20290] the plain read's `?state=draft`
     * branch (the pending draft row). A per-deployment gate withholds nothing
     * from the caller, and applied to a stored version it reports the store wrongly (a
     * widget whose service is merely off here reads as never authored — and
     * Studio's designer, which loads the layered view and saves what it
     * loaded, would delete it).
     */
    arms: 'all' | 'per-caller';
    /**
     * The `app` arm (the unpublished gate, `requiredPermissions`, the
     * docs-audience entry arm).
     *
     * `gate` — the plain read's app answer: its refusal, or the pruned app,
     * for EVERY caller, authors included: read-to-display is per user.
     *
     * `author-exempt` — [#20156] ruling 5856774816 (letter B, confirmed
     * 5856866273), ADR-0106 D4's shape carried from object schemas to apps:
     * read-to-edit is whole for whoever may edit. A caller the door hands in
     * with {@link MetaReadGateCaller.mayWriteItem} `true` — one the item's
     * save door admits — is served the STORED app, unpruned; every other
     * caller is served exactly `gate`'s answer, pruned. An app the plain read
     * refuses WHOLE (an app-level `requiredPermissions` the caller lacks →
     * `403`; an unpublished app to a non-builder → the absence answer,
     * ADR-0045 §3) is refused either way, author or not.
     *
     * Why the save door's answer, and not "platform administrator" (ruling
     * item 1): Studio's designer loads a stored version and saves back what
     * it loaded, so whoever may save an app must see all of it — pruned, the
     * save would delete the withheld entries silently. That makes "whoever
     * may write it sees it whole" true by construction, the same invariant
     * ADR-0106 D4 holds for object schemas.
     *
     * The exemption is a CALLER property: this member says only whether a
     * door honours it, and ⛔ no route test stands here. The doors that
     * serve STORED versions for authoring (the layered view, `/diff`, and
     * [#20290] the plain read's `?state=draft` branch — Studio's designers
     * merge the draft over the layered view and save it back) honour it; the
     * doors that serve the document a client renders (the plain read,
     * `/published`) and the event doors (`/history`, `/audit`) do not.
     * The census in `meta-alternate-door-read-gates.test.ts` pins both halves
     * on every door, and that the exemption reaches no other cell.
     */
    app: 'gate' | 'author-exempt';
}

/**
 * [#20156] The policy of the doors that serve STORED versions for authoring
 * — the layered view (`/layers`, `?layers=`), `/diff` and [#20290] the
 * plain read's `?state=draft` branch (the pending draft row, which Studio's
 * designers merge over the layered view and save back). One constant, so
 * they cannot come to disagree about the `app` row.
 *
 * `app: 'author-exempt'` — ruling 5856774816 (letter B, confirmed
 * 5856866273): a caller who may write the app (the door's own save
 * admission, carried on the caller as {@link MetaReadGateCaller.mayWriteItem})
 * reads the full stored version, and every other caller who may open the app
 * reads exactly what the plain read gives them, pruned. See
 * {@link MetaReadGatePolicy.app}.
 *
 * [#20320] Moved here from `RestServer`, unchanged, so the runtime
 * dispatcher's `?state=draft` item read runs the SAME constant instead of a
 * copy of it.
 */
export const STORED_VERSION_DOOR_POLICY: MetaReadGatePolicy = Object.freeze({
    arms: 'per-caller',
    app: 'author-exempt',
});

// ── The gates' types ──────────────────────────────────────────────────────────

/**
 * [#7912] The nav-servability gate handed to `filterAppForUser`: given the
 * `objectName` a `type: 'object'` entry targets (and the entry itself, for the
 * diagnostic), answer whether the destination can serve a `list`.
 *
 * `true` = serve the entry. That includes every case this layer cannot judge —
 * an object absent from metadata, or metadata that could not be read at all —
 * because the gate is a SURFACE-AREA control, not an authorization boundary,
 * and the same fail-open reasoning `loadObjectItems` records applies here.
 *
 * `appName` is passed in rather than captured because ONE gate serves the whole
 * app list: the list route resolves object metadata once and gates every app
 * with the same closure, so the app being filtered is a per-call fact.
 */
export type NavServabilityGate = (objectName: string, entry: any, appName: string) => boolean;

/**
 * [ADR-0046 §6.7] One request's docs-audience view of one caller — THE
 * resolution behind every audience-gated docs answer this server gives: the
 * `/meta/doc` list, the `/meta/doc/:name` read, the `/meta/book/:name/tree`
 * read and the app-nav `doc` arm ({@link NavDocAudienceGate}). Built by
 * `resolveDocsAudience` from the environment's books; every verdict below is a
 * `@objectstack/spec/system` helper asked with this caller, so the four answers
 * cannot drift apart — there is no second resolver to drift.
 */
export interface DocsAudience {
    /** The caller as the audience helpers see it (holdings resolved only when a `{ permissionSet }` book exists). */
    readonly caller: AudienceCaller;
    /**
     * The fast path: an authenticated caller and no `{ permissionSet }` book
     * anywhere, so every doc's effective audience (`org` / `public`) admits
     * them and no doc corpus is needed to say so.
     */
    readonly allReadable: boolean;
    /** The book `name` names: a declared book, else the implicit per-package book (§6.4). */
    bookNamed(name: string): Book & { _packageId?: string };
    /** Whether the book's OWN audience admits this caller — the gate on the whole tree. */
    admitsBook(book: Book): boolean;
    /**
     * The per-doc predicate over `corpus`: the doc's effective audience (the
     * union over the books claiming it; unclaimed or absent from the corpus →
     * `org`) admits this caller. Build it once per corpus and ask it per doc —
     * building it resolves every book against the whole corpus.
     */
    docReader(corpus: ResolverDoc[]): (docName: unknown) => boolean;
    /**
     * `book` resolved over `docs`, narrowed to the entries this caller may read
     * — exactly the body `GET /meta/book/:name/tree` serves once the book's own
     * audience has admitted the caller. `canRead` is a {@link docReader} over
     * the same `docs` when the caller already holds one.
     */
    readableTree(
        book: Book & { _packageId?: string },
        docs: ResolverDoc[],
        canRead?: (docName: unknown) => boolean,
    ): ResolvedBook;
    /**
     * The book's PAGES this caller may read: the docs `book` claims over
     * `docs` (`resolveBookClaimedDocs` — the membership `resolveDocAudiences`
     * itself uses) that pass the per-doc predicate. The tree's synthetic
     * *Uncategorized* group is not among them: the spec defines those orphans
     * as a rendering convenience, "not an authored membership claim".
     */
    readablePages(
        book: Book & { _packageId?: string },
        docs: ResolverDoc[],
        canRead?: (docName: unknown) => boolean,
    ): string[];
}

/**
 * [#19790] The docs-audience gate handed to `filterAppForUser`: given a
 * `type: 'doc'` nav entry, answer whether the caller may read what it opens.
 * `true` = serve the entry. Built once per request from ONE
 * {@link DocsAudience}, so it serves the whole app list the way
 * {@link NavServabilityGate} does.
 *
 * Unlike that gate and the ADR-0057 D10 service gate, the arm it feeds FAILS
 * CLOSED: this is an authorization boundary (the entry names a book or doc the
 * caller may not read), so an absent gate prunes every `doc` entry rather than
 * serving it.
 */
export type NavDocAudienceGate = (entry: any) => boolean;

// ── The metadata reads the gates take as input ────────────────────────────────

/**
 * Load the object metadata items for the current protocol/environment,
 * coerced to a plain array. Returns `[]` when metadata is unavailable so
 * callers fail OPEN (the data call itself needs the same metadata and will
 * surface any real error). Shared by `enforceApiAccess` (one object), the
 * cross-object batch route (all ops, fetched once) and the nav-servability
 * gate.
 */
export async function loadObjectItems(source: MetaReadGateListSource): Promise<any[]> {
    try {
        const r: any = await source.listMetaItems('object');
        return Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
    } catch (err) {
        // [#3545] The API-exposure gate fails OPEN when object metadata can't
        // be read: the exposure whitelist is a SURFACE-AREA control, not the
        // authorization boundary (auth + CRUD/FLS/RLS still enforce on the
        // data call, which needs the same metadata and surfaces the real
        // error), and failing closed here would 405 every request during the
        // normal cold-start window. But a THROWN read is a real fault
        // (metadata store down / corrupt schema doc), NOT a legitimately-empty
        // registry (a `[]` return, e.g. a fresh deployment) — so LOG it. Left
        // silent, a persistent metadata outage, during which the gate allows
        // every operation unchecked, is indistinguishable from healthy
        // operation. Still returns `[]` (fail-open preserved). See #3545.
        logWarn(
            '[REST] api-exposure gate: object metadata read failed — failing open ' +
                '(auth + CRUD/FLS/RLS still enforce on the data call)',
            (err as Error)?.message ?? err,
        );
        return [];
    }
}

/** Whether any of these books carries a `{ permissionSet }` audience. */
export function anyPermissionSetAudience(books: readonly any[]): boolean {
    return books.some(
        (b) => b && typeof b === 'object' && b.audience && typeof b.audience === 'object'
            && typeof b.audience.permissionSet === 'string',
    );
}

/** Coerce a getMetaItems result (array | {items}) into an array. */
export function metaItemsArray(raw: unknown): any[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && Array.isArray((raw as any).items)) return (raw as any).items;
    return [];
}

/** Shape a book list for the audience resolver: `_packageId` provenance also as `packageId`. */
export function audienceBooksOf(raw: unknown): any[] {
    return metaItemsArray(raw).map((b: any) =>
        b && typeof b === 'object' ? { ...b, packageId: b._packageId } : b,
    );
}

/**
 * The doc header the audience resolver reads — name, the placement keys a
 * book rule matches on, and provenance. Nothing rendered: a doc's label
 * orders a group, but never decides which book claims it.
 */
export function docCorpusOf(list: readonly any[]): ResolverDoc[] {
    return list
        .filter((d: any) => d && typeof d === 'object')
        .map((d: any) => ({
            name: d.name,
            group: d.group,
            tags: d.tags,
            order: d.order,
            packageId: d._packageId,
        }));
}

/**
 * A `getMetaItems` list read that REPORTS a thrown read as `{ fault }`
 * rather than swallowing it. The two docs-audience reads below go through
 * here so each caller chooses HOW an unreadable gate input fails closed —
 * never whether: the doc reads hand the fault to the caller
 * ({@link fetchAudienceBooks}, the `/meta/doc/:name` corpus read), and the
 * app-nav gate prunes every `doc` entry of one response
 * ({@link resolveNavDocAudience}). ⛔ No caller reads a fault as an empty
 * list: an empty book list is "no gated book anywhere" and an empty corpus
 * is "every doc unclaimed, so `org`" — both GRANT.
 *
 * A transport whose protocol has no list read at all REJECTS here (it is
 * `async`, so the throw below becomes the rejection) rather than answering an
 * empty list — the same fail-closed direction as a thrown read.
 */
async function readMetaList(
    source: MetaReadGateListSource,
    type: 'book' | 'doc',
): Promise<{ items: any[] } | { fault: unknown }> {
    const pending = source.listMetaItems(type);
    if (pending === undefined) {
        throw new TypeError(`No metadata list read is available to resolve the '${type}' audience input.`);
    }
    return pending.then(
        (raw: unknown) => ({ items: metaItemsArray(raw) }),
        (fault: unknown) => ({ fault }),
    );
}

/** Every book of the environment, audience-shaped; `{ fault }` when the read throws. */
export async function readAudienceBooks(
    source: MetaReadGateListSource,
): Promise<{ items: any[] } | { fault: unknown }> {
    const read = await readMetaList(source, 'book');
    return 'fault' in read ? read : { items: audienceBooksOf(read.items) };
}

/** Every doc of the environment as the resolver's corpus; `{ fault }` when the read throws. */
export async function readDocCorpus(
    source: MetaReadGateListSource,
): Promise<{ items: ResolverDoc[] } | { fault: unknown }> {
    const read = await readMetaList(source, 'doc');
    return 'fault' in read ? read : { items: docCorpusOf(read.items) };
}

/**
 * Fetch every book of the environment, shaped for the audience resolver,
 * for the `/meta/doc` list and `/meta/doc/:name` reads. A read that throws
 * THROWS its own fault (ADR-0046 §6.7, fail closed per ADR-0049).
 *
 * It used to answer `[]`, and `[]` is not "unknown" to the resolver — it
 * is "no `{ permissionSet }` book anywhere", which puts an authenticated
 * caller on the fast path where every doc is readable. So a store fault
 * on this read served a set-gated doc, body and all, to a non-holder and
 * listed it for them. The books are an input to the audience decision; a
 * decision whose input could not be read is not made.
 *
 * Rethrown, not mapped to a deny: the fault reaches the route's
 * `handleRouteError`, so these reads answer a book-read fault exactly as
 * `GET /meta/book/:name/tree` — whose book read has always propagated —
 * and as the `/meta/doc` list's own doc read do (`503
 * SERVICE_UNAVAILABLE` for `metadata-protocol`'s store fault). One fault,
 * one answer across the docs doors, and an outage never reads as an
 * authorization verdict (a 403 would tell a holder they hold nothing) nor
 * as an empty list (every doc pruned is "this environment has no docs").
 * The app-nav gate reads {@link readAudienceBooks} directly because a nav
 * response is a composite: it drops the `doc` entries and serves the rest.
 */
export async function fetchAudienceBooks(source: MetaReadGateListSource): Promise<any[]> {
    const read = await readAudienceBooks(source);
    if ('fault' in read) throw read.fault;
    return read.items;
}

// ── The docs audience ─────────────────────────────────────────────────────────

/**
 * [ADR-0046 §6.7] The audience-evaluation view of the caller for book/doc
 * gating. `permissionSets` resolves through the security service's
 * `resolvePermissionSetNames` — the SAME resolution as data-plane
 * enforcement (positions expanded, additive baseline), so the docs gate
 * can never drift from it. `permissionSets` stays undefined when the
 * service is absent or resolution fails; `audienceAllows` then DENIES
 * permission-set-gated audiences (fail closed, ADR-0049). Resolution is
 * skipped unless `needPermissionSets` — callers pass true only when a
 * `{ permissionSet }` audience is actually in play.
 */
export async function resolveAudienceCaller(
    sources: MetaReadGateAudienceSources,
    opts: { needPermissionSets: boolean },
): Promise<{ authenticated: boolean; permissionSets?: string[] }> {
    const ctx = await sources.resolveCaller();
    const authenticated = !!ctx?.userId;
    if (!authenticated || !opts.needPermissionSets) {
        return { authenticated };
    }
    try {
        const svc = await sources.resolveSecurityService();
        if (!svc || typeof svc.resolvePermissionSetNames !== 'function') return { authenticated };
        const names = await svc.resolvePermissionSetNames(ctx);
        return { authenticated, permissionSets: Array.isArray(names) ? names : [] };
    } catch {
        return { authenticated }; // unresolved holdings → gated audiences deny
    }
}

/**
 * [ADR-0046 §6.7] Build THE {@link DocsAudience} for this request's caller
 * over `books` (audience-shaped, {@link audienceBooksOf}).
 *
 * Every audience-gated docs answer goes through here — the `/meta/doc`
 * list, `/meta/doc/:name`, `/meta/book/:name/tree` and the app-nav `doc`
 * arm, on both transports — so "may this caller read it" has one
 * implementation, spelled in the spec's own helpers (`audienceAllows`,
 * `resolveDocAudiences`, `docAudienceAllows`, `resolveBookTree`,
 * `deriveImplicitPackageBook`).
 *
 * Holdings are resolved only when a `{ permissionSet }` book exists, and
 * unresolvable holdings deny those audiences ({@link resolveAudienceCaller},
 * fail closed per ADR-0049). The fast path is the doc list's own: with no
 * such book, an authenticated caller reads every doc, so `docReader` needs
 * no corpus and `readableTree` filters nothing.
 */
export async function resolveDocsAudience(
    sources: MetaReadGateAudienceSources,
    books: readonly any[],
): Promise<DocsAudience> {
    const {
        audienceAllows, docAudienceAllows, resolveDocAudiences, resolveBookTree, resolveBookClaimedDocs,
        deriveImplicitPackageBook,
    } = await import('@objectstack/spec/system');
    const gated = anyPermissionSetAudience(books);
    const caller = await resolveAudienceCaller(sources, { needPermissionSets: gated });
    const allReadable = caller.authenticated && !gated;
    const docReader = (corpus: ResolverDoc[]): ((docName: unknown) => boolean) => {
        if (allReadable) return () => true;
        const audiences = resolveDocAudiences(books as any, corpus);
        return (docName: unknown) => docAudienceAllows(audiences.get(docName as string), caller);
    };
    return {
        caller,
        allReadable,
        bookNamed: (name: string) =>
            books.find((b: any) => b && b.name === name) ?? deriveImplicitPackageBook(name, name),
        admitsBook: (book: Book) => audienceAllows(book?.audience, caller),
        docReader,
        readableTree: (book, docs, canRead) => {
            const tree = resolveBookTree(book, docs, book._packageId);
            // The fast path serves the tree whole — no entry can fail an
            // audience every doc passes, and the empty-group drop below is
            // part of the narrowing, not of the tree.
            if (allReadable) return tree;
            const read = canRead ?? docReader(docs);
            tree.groups = tree.groups
                .map((g) => ({
                    ...g,
                    entries: g.entries.filter((e) => !e.doc || read(e.doc)),
                }))
                .filter((g) => g.entries.some((e) => e.doc || e.href));
            return tree;
        },
        readablePages: (book, docs, canRead) => {
            const read = canRead ?? docReader(docs);
            return [...resolveBookClaimedDocs(book, docs, book._packageId)].filter((name) => read(name));
        },
    };
}

// ── The app and dashboard filters ─────────────────────────────────────────────

/**
 * {@link filterAppForUser}, plus WHICH gate withheld the app.
 *
 * `filterAppForUser` filters an `App` metadata item by the current user's
 * `systemPermissions`:
 *
 * - Drops the app entirely when it is UNPUBLISHED (`_unpublished: true`,
 *   ADR-0045 §3) and the caller is not a builder. Note the key: `hidden` is
 *   navigation presentation and is deliberately NOT consulted (#4829).
 * - Drops the app entirely if its top-level `requiredPermissions` are not
 *   a subset of the user's system permissions.
 * - Recursively strips child navigation entries (groups, items) whose
 *   `requiredPermissions` are not satisfied. Empty groups collapse so
 *   the sidebar doesn't render a label with no children — [#7380] a
 *   `type: 'group'` with no SURVIVING children is dropped whether it was
 *   emptied by the gate or authored `children: []`. Only `group` collapses;
 *   an `object` entry is its own target and is served however many children
 *   it has. See the rule at the `filterNav` branch for the measurement.
 * - [#4722] Applies the SAME item gate to every `areas[].navigation` tree.
 *   Both trees are the same shape and the keys mean the same thing in both,
 *   so `filterNav` is reused — there is deliberately no second
 *   implementation to drift. Before this, an item gated inside an area was
 *   enforced by the shell alone: the entry (with its `objectName` /
 *   `pageName` / `componentRef` target) still shipped in the `/meta` body,
 *   so reading the JSON defeated it.
 * - [#7912] SERVABILITY: drops a `type: 'object'` entry whose destination
 *   object could not answer a `list` for anyone — see `servabilityGate`.
 * - [#19790] DOCS AUDIENCE (ADR-0046 §6.7): drops a `type: 'doc'` entry the
 *   caller may not read — see `docAudienceGate`. Fails CLOSED, unlike the
 *   two gates above: no gate means every `doc` entry is dropped.
 *
 * NOT gated here: `visible` (CEL) at any level, and `requiresObject` — both
 * are still evaluated client-side only. That asymmetry is deliberate and
 * pinned in `rest.test.ts`: server-side CEL needs a bound `user` context
 * that this layer does not have, and is its own change.
 *
 * ⚠️ [#7912] `requiresObject` STAYS on that list, and the servability gate
 * is not it wearing a new hat. `requiresObject` asks whether the named
 * object is REGISTERED — a question about deployment composition, whose
 * answer this filter deliberately leaves to the client (the maintainer
 * ruling of 2026-08-12 rejected re-meaning the key server-side precisely
 * because the docblock calls that asymmetry deliberate). The servability
 * gate asks a different question of an object that IS registered: does its
 * own `enable` block let the destination answer at all? An entry whose
 * object this layer cannot find is therefore SERVED, not pruned — the
 * `requiresObject` pin and #3770's "no declared policy ⇒ nothing to
 * enforce" both survive unchanged.
 *
 * `app` is `null` when the app should be withheld from the user entirely, and
 * a shallow copy with filtered `navigation` / `areas` otherwise — the original
 * is never mutated so cached metadata stays clean.
 *
 * Takes the **app document itself**, never the `getMetaItem` envelope
 * (#5563). Every caller hands it a document: the list path always did, and
 * the single-item read unwraps `.item` once, gates the document, and rebuilds
 * the envelope around the result. Filtering an envelope would be a silent
 * no-op (its `.navigation` is undefined), bypassing BOTH
 * `requiredPermissions` and the ADR-0057 D10 `requiresService` gate — which
 * is why this used to sniff the shape. There is one shape now.
 *
 * ## Why the caller needs the reason
 *
 * The gate collapses three different refusals into one `null`, and for
 * the LIST route that is exactly right — every one of them means "not in
 * your list". The by-name route is where they stop being the same answer
 * (#8013).
 *
 * `GET /meta/app/<name>` answered a 404-equivalent for all three, so an
 * app the session may never use and an app that does not exist were
 * BYTE-IDENTICAL on the wire. The console has nothing to branch on, so it
 * renders its only copy for an absent app — "it may still be publishing" —
 * over a permanent authorization denial. Measured cost (objectui#4252): two
 * acceptance-test batches spent chasing a "platform defect" that was a
 * missing permission-set binding.
 *
 * ## Only ONE of the three converts, and that is the whole design
 *
 * The maintainer ruling (2026-08-12) licenses an explicit denial for
 * `permission` alone. The other two keep answering absence, for reasons
 * that are not stylistic:
 *
 *  - `unpublished` — ADR-0045 §3 says an unpublished app is *externally
 *    unobservable*, not merely unlisted. A 403 confirms existence, which is
 *    precisely what that contract withholds; `meta-app-publish-gate.test.ts`
 *    has pinned the 404-over-403 choice since #4829 and it stands.
 *  - `service` — an absent optional kernel service (ADR-0057 D10) is a
 *    deployment fact about the platform, not a statement about this caller.
 *    Nothing is denied TO the session, so there is no denial to report.
 *
 * That partition is the security boundary of #8013, and it cuts one way
 * only: a denial for `permission` makes an app the caller may not use
 * observable BY NAME, which the ruling accepts because a by-name probe
 * already implies the name. Widening it to a name that resolves to nothing
 * would make every app name on the platform enumerable — a different and
 * unruled change. Hence `withheld` is set from the branch that fired, never
 * inferred from `app == null` at the call site.
 *
 * Ordering is load-bearing for the same reason: `unpublished` is judged
 * FIRST, so an app that is both unpublished and permission-gated reports
 * `unpublished` and stays absent. ADR-0045 §3 wins over the disclosure.
 */
export function filterAppForUserWithReason(
    item: any,
    sysPerms: Set<string>,
    serviceGate?: (name: string) => boolean,
    servabilityGate?: NavServabilityGate,
    docAudienceGate?: NavDocAudienceGate,
): { app: any | null; withheld?: 'unpublished' | 'permission' | 'service' } {
    if (!item || typeof item !== 'object') return { app: item };
    // ADR-0045 §3 (as revised 2026-08, #4829) — the publish gate. An
    // UNPUBLISHED app is externally unobservable, not merely unlisted: only
    // builders (studio/setup access) receive it at all, for direct-URL
    // preview. THIS is the visibility gate; the launcher's client-side
    // filtering is a listing courtesy.
    //
    // ⛔ It judges `_unpublished`, the machine-managed key, and NOT `hidden`.
    // `hidden` is navigation presentation — "not in the App Switcher, reach
    // it from the avatar menu" — and reading it here made those two
    // contracts one boolean. #4829 measured the cost: `account`, the
    // platform's own personal-settings app, is authored `hidden: true` for
    // exactly the reason its spec docblock gives, so this branch erased it
    // from `GET /meta/app` for every user without builder access — password,
    // avatar, sessions, inbox all 404 — while any admin saw a healthy
    // system. A hidden app is fully routable and permission-checked here;
    // only `_unpublished` withholds it.
    if (item._unpublished === true && !sysPerms.has('studio.access') && !sysPerms.has('setup.access')) {
        return { app: null, withheld: 'unpublished' };
    }
    const reqApp = Array.isArray(item.requiredPermissions) ? item.requiredPermissions : [];
    if (reqApp.length > 0 && !reqApp.every((p: string) => sysPerms.has(p))) {
        return { app: null, withheld: 'permission' };
    }
    // ADR-0057 D10 — capability gate: hide when the named kernel service is
    // absent. Fail-open when the gate can't be probed (serviceGate undefined).
    if (typeof item.requiresService === 'string' && serviceGate && serviceGate(item.requiresService) === false) {
        return { app: null, withheld: 'service' };
    }
    const nav = Array.isArray(item.navigation) ? item.navigation : null;
    const areas = Array.isArray(item.areas) ? item.areas : null;
    if (!nav && !areas) return { app: item };

    const filterNav = (entries: any[]): any[] => {
        const out: any[] = [];
        for (const e of entries) {
            if (!e || typeof e !== 'object') continue;
            const req = Array.isArray(e.requiredPermissions) ? e.requiredPermissions : [];
            if (req.length > 0 && !req.every((p: string) => sysPerms.has(p))) continue;
            if (typeof e.requiresService === 'string' && serviceGate && serviceGate(e.requiresService) === false) continue;
            // [#19790] DOCS AUDIENCE — the rule `DocNavItemSchema` declares
            // and, until this arm, only a renderer honoured: a `doc` entry
            // naming a doc the caller may not read, or a book with no page
            // they may read, is not served. Left in the body, the entry's
            // label and its book / doc names reached every member of the
            // app however the book was gated, and reading the JSON
            // defeated whatever the shell pruned (the #4722 lesson again).
            //
            // The verdict is the docs reads' own — `docAudienceGate` is one
            // `DocsAudience` built by the caller, the same resolution
            // `/meta/doc` and `/meta/book/:name/tree` answer from — and the
            // arm FAILS CLOSED where its neighbours fail open: no gate, no
            // `doc` entry. Like every entry-level arm here it is a bare
            // `continue` with no reason attached; `withheld` reports only
            // why a whole APP was withheld, and an app this arm empties is
            // still served, exactly as one emptied by `requiredPermissions`.
            if (e.type === 'doc' && (!docAudienceGate || !docAudienceGate(e))) continue;
            // [#7912] SERVABILITY — the gate this filter had no vocabulary
            // for. A `type: 'object'` entry names its destination in
            // `objectName`; the object's own `enable` block decides whether
            // a `list` can be answered there, and that decision takes no
            // user, no permissions and no context. So an entry whose
            // destination is API-disabled (404 `OBJECT_API_DISABLED`) or
            // whose whitelist omits `list` (405
            // `OBJECT_API_METHOD_NOT_ALLOWED`) is dead for EVERY persona,
            // platform admin included — which is why no combination of
            // `requiredPermissions` on the entry could ever prune it
            // (#7544 shipped exactly that combination for a year).
            //
            // The verdict comes from the same derivation the data route
            // enforces (`apiExposureDenialReason`, #3391), reached through
            // the gate the caller built — never a second reading of
            // `enable` here.
            if (servabilityGate && e.type === 'object' && typeof e.objectName === 'string') {
                const appName = typeof item.name === 'string' ? item.name : '(unnamed)';
                if (servabilityGate(e.objectName, e, appName) === false) continue;
            }
            // [#7380] A `group` is judged on what SURVIVES, never on how it
            // got there. Both childless shapes render the same dead sidebar
            // label, so both are dropped:
            //   - BECAME empty — authored with children, all gated away;
            //   - STARTED empty — authored `children: []`.
            // The old guard (`children.length > 0`) sent the second shape
            // down the else branch, which never reaches the drop rule, so a
            // declared-empty group shipped as a bare label the docblock
            // above already promised it would not. That shape is not a
            // corner case: `setup.app.ts` is authored entirely out of it —
            // nine `children: []` contribution slots (ADR-0029 D7) that
            // `Registry.applyNavContributions` fills on read, BEFORE this
            // filter runs. So a slot a capability plugin filled arrives here
            // with children and survives; a slot left empty because its
            // capability is disabled arrives `[]` and is now dropped, which
            // is exactly the "a disabled capability contributes nothing and
            // its slot stays empty" case `setup.app.ts` documents.
            //
            // The rule is `type === 'group'` ONLY, and stays that way. The
            // union nests on two branches (`NAV_VARIANTS_ACCEPTING_CHILDREN`
            // = `object` | `group`), and an `object` entry is its own
            // navigation target — `{ type: 'object', objectName: 'lead',
            // children: [] }` is a live link to the lead list, not a label,
            // so emptiness says nothing about whether to serve it. A group
            // cannot be a target: `GroupNavItemSchema` is a `strictObject`
            // over the base keys plus `expanded`/`children` and declares no
            // `objectName` / `pageName` / `componentRef` / `url` — it
            // REJECTS them — and its docblock reads "Does not perform
            // navigation itself." Measured against that before the change
            // (#7380): 41 `type: 'group'` entries across the shipped apps
            // (`account`, `setup`, `studio`), the examples (`app-crm`,
            // `app-showcase`, `app-todo`) and the spec's nav type-assertion
            // fixtures. 16 are childless — the 9 `setup` slots and 7 spec
            // fixtures; the three example apps have none — and ZERO of the
            // 41 carry `objectName` / `pageName` / `componentRef` / `url` or
            // any other target. So the drop is unconditional: there is no
            // standalone childless-group shape in the tree to spare.
            //
            // A group with NO `children` key is covered by the same rule for
            // the same reason — same dead label. It is unreachable through
            // the spec (`children` is required on both the input and output
            // group branches; `app.nav-type-assertions.ts` pins that with a
            // `@ts-expect-error`), but this filter reads untyped documents
            // off the metadata store, so leaving it out would just reopen
            // the bypass one keyword over.
            if (Array.isArray(e.children)) {
                const kids = filterNav(e.children);
                if (e.type === 'group' && kids.length === 0) continue;
                out.push({ ...e, children: kids });
            } else {
                if (e.type === 'group') continue;
                out.push(e);
            }
        }
        return out;
    };

    // [#4722] `areas[]` carries no gate of its own — the area-level `visible`
    // / `requiredPermissions` keys were retired in 17.0.0 (#4651, ADR-0049)
    // and are NOT revived here. What is enforced is the gate on the items
    // INSIDE an area, through the very same `filterNav` the top-level tree
    // uses, so the two trees can never disagree about what a key means.
    //
    // Collapse rule: an area whose authored tree is emptied BY the gate is
    // dropped (a bare area label with nothing reachable under it is not a
    // useful response), while an area authored `navigation: []` is passed
    // through untouched — filtering reports what the caller may not see, it
    // does not tidy the metadata.
    //
    // [#7380] That second half is where an area and a `group` now DIVERGE,
    // deliberately: `filterNav` drops a childless group however it got that
    // way, an area authored empty still ships. The reason is what the two
    // shapes are. A group is a sidebar label and nothing else, so childless
    // it renders dead — and the shipped `setup` app authors nine of them as
    // contribution SLOTS, which makes "declared empty" the normal steady
    // state of an unfilled one rather than an authoring slip. An area is a
    // top-level workspace the shell can select and route to on its own; an
    // author who ships `navigation: []` has declared an area that is not
    // populated yet, and this filter is not the layer that judges that.
    // What is NOT divergent is the walk: an area whose entries are all
    // childless groups empties through the very same `filterNav` and is
    // dropped by the rule above — one implementation, as everywhere else.
    const filterAreas = (list: any[]): any[] => {
        const out: any[] = [];
        for (const a of list) {
            if (!a || typeof a !== 'object') continue;
            const anav = Array.isArray(a.navigation) ? a.navigation : null;
            if (!anav || anav.length === 0) { out.push(a); continue; }
            const kids = filterNav(anav);
            if (kids.length === 0) continue;
            out.push({ ...a, navigation: kids });
        }
        return out;
    };

    return {
        app: {
            ...item,
            ...(nav ? { navigation: filterNav(nav) } : {}),
            ...(areas ? { areas: filterAreas(areas) } : {}),
        },
    };
}

/**
 * Filter an `App` metadata item by the current user's `systemPermissions` —
 * {@link filterAppForUserWithReason} without the reason. `null` when the app
 * is withheld from the user entirely.
 */
export function filterAppForUser(
    item: any,
    sysPerms: Set<string>,
    serviceGate?: (name: string) => boolean,
    servabilityGate?: NavServabilityGate,
    docAudienceGate?: NavDocAudienceGate,
): any | null {
    return filterAppForUserWithReason(item, sysPerms, serviceGate, servabilityGate, docAudienceGate).app;
}

/**
 * ADR-0057 D10 (dashboards): strip dashboard widgets whose `requiresService`
 * capability gate names a kernel service that isn't registered — the same
 * "server is the authoritative visibility gate" rule already applied to app
 * nav entries (see {@link filterAppForUser}). Without this, a widget bound to
 * an optional service renders a dead tile in deployments where the service is
 * off (e.g. the Organizations KPI under multi-tenant `org-scoping`, which is
 * absent in a single-tenant runtime while its nav entry is correctly hidden).
 *
 * Fail-open when the gate can't be probed (serviceGate undefined). Never
 * mutates the original — returns a shallow copy only when a widget is dropped.
 *
 * Takes the **dashboard document**, never the `getMetaItem` envelope — see
 * {@link filterAppForUser} for why that distinction stopped being a runtime
 * question in #5563.
 */
export function filterDashboardForUser(item: any, serviceGate?: (name: string) => boolean): any {
    if (!item || typeof item !== 'object' || !serviceGate) return item;
    if (!Array.isArray(item.widgets)) return item;
    const widgets = item.widgets.filter(
        (w: any) => !(w && typeof w.requiresService === 'string' && serviceGate(w.requiresService) === false),
    );
    return widgets.length === item.widgets.length ? item : { ...item, widgets };
}

// ── The per-request gate inputs ───────────────────────────────────────────────

/**
 * Probe which `requiresService` capability gates referenced anywhere in
 * `items` are actually registered in the runtime kernel. Returns `null`
 * when the kernel can't be probed (`probe` is `null`) — callers then SKIP
 * service gating (fail-open, matching the prior "send everything, let the
 * client hide" behaviour). ADR-0057 addendum D10.
 *
 * `items` are metadata **documents** (#5563) — the single-item route
 * unwraps the envelope before probing, exactly as it does before gating.
 */
export async function resolveRegisteredServices(
    probe: ((name: string) => Promise<boolean>) | null,
    items: any[],
): Promise<Set<string> | null> {
    if (!probe) return null;
    const wanted = new Set<string>();
    const walk = (e: any): void => {
        if (!e || typeof e !== 'object') return;
        if (typeof e.requiresService === 'string') wanted.add(e.requiresService);
        // [#4722] EVERY child list, not the first one that happens to be an
        // array. An app may carry `navigation` AND `areas` at once, and now
        // that `filterAppForUser` gates the trees under `areas[]` too, a
        // service named only in there must be probed — an unprobed name is
        // absent from `registered`, and the gate would read that as "service
        // missing" and strip a live entry. Fail-closed by omission is still
        // wrong; the probe set must cover exactly what the gate walks.
        for (const key of ['navigation', 'areas', 'children', 'widgets'] as const) {
            const kids = (e as any)[key];
            if (Array.isArray(kids)) for (const k of kids) walk(k);
        }
    };
    for (const it of items) walk(it);
    if (wanted.size === 0) return new Set();
    const registered = new Set<string>();
    for (const name of wanted) { if (await probe(name)) registered.add(name); }
    return registered;
}

/**
 * [#7912] Build the nav-servability gate for one request: which objects can
 * actually answer a `list` on the external REST surface.
 *
 * ## Shape, and why it mirrors `resolveRegisteredServices`
 *
 * Same contract as the ADR-0057 D10 service gate one function up: resolve the
 * facts ONCE per request, hand `filterAppForUser` a closure, and return
 * `null` when the facts cannot be established so the caller skips the gate
 * entirely. Nav filtering already runs over a whole app list; re-reading
 * object metadata per entry would turn one read into dozens.
 *
 * ## Fail-open, in three distinct cases — each deliberate
 *
 *  1. **Metadata unreadable** — `loadObjectItems` answers `[]` and logs.
 *     This function then answers `null` (no gate), so nothing is pruned. The
 *     alternative fails CLOSED during every cold start, emptying the
 *     sidebar of a healthy deployment; #3545 already settled that trade for
 *     the data-route twin and the same reasoning binds harder here, where
 *     the consequence is a user staring at an app with no navigation.
 *  2. **Object not in metadata** — served. There is no declared exposure
 *     policy to enforce (#3770), and "is this object registered at all?" is
 *     `requiresObject`'s question, which this layer deliberately does not
 *     answer (see {@link filterAppForUser}).
 *  3. **No `enable` block** — served, by `apiExposureDenialReason`'s own
 *     default-open contract. An object that declares nothing restricts
 *     nothing.
 *
 * Only case (3)'s opposite — a declared `enable` that refuses `list` — ever
 * prunes.
 *
 * ## The prune is LOGGED, never silent
 *
 * The maintainer ruling of 2026-08-12 makes the author-visible diagnostic a
 * mandatory companion, not an optional one: "a prune the author cannot see
 * is the same failure one layer over — no silent dead rows, and no silent
 * repairs." The authoring-time half of that is
 * `validate-nav-object-servability` in `@objectstack/lint`, which refuses
 * the stack at `os validate` / `os build` / `os lint` before it can ever be
 * served. This log is the serving-side half, for an entry that reached a
 * running deployment anyway (a `sys_metadata` overlay row, or a stack built
 * before the lint existed): it names the app, the entry id, the object AND
 * the condition, so the pruned row is discoverable from the server log
 * rather than being an unexplained gap in a menu.
 *
 * One line per `app|entry|object|reason` per `navPruneLogged` set — a console
 * session re-fetches `/meta/app` on every navigation, and an unthrottled log
 * would bury the first occurrence under thousands of repeats.
 */
export async function resolveNavServability(
    sources: MetaReadGateListSource & Pick<MetaItemReadGateSources, 'navPruneLogged'>,
): Promise<NavServabilityGate | null> {
    const items = await loadObjectItems(sources);
    // Case (1): nothing to judge with. `loadObjectItems` has already logged
    // a THROWN read; a legitimately empty registry is silent and equally
    // ungated, which is correct — an empty registry declares no policy.
    if (items.length === 0) return null;
    const enableByName = new Map<string, any>();
    for (const o of items) {
        if (o && typeof o.name === 'string') enableByName.set(o.name, o.enable);
    }
    return (objectName: string, entry: any, appName: string): boolean => {
        // Case (2): unknown object → no declared policy to enforce here.
        if (!enableByName.has(objectName)) return true;
        const reason = apiExposureDenialReason(enableByName.get(objectName), 'list');
        if (!reason) return true;
        const entryId = (entry && (entry.id ?? entry.label)) ?? '(unnamed)';
        const key = `${appName}|${entryId}|${objectName}|${reason}`;
        if (!sources.navPruneLogged.has(key)) {
            sources.navPruneLogged.add(key);
            // [#7912] The serving-side half of the prune diagnostic — the tracker
            // id lives here, never in the logged text an operator reads.
            logWarn(
                `[REST] nav entry '${entryId}' pruned from app '${appName}': its destination ` +
                    `object '${objectName}' cannot serve a list — ` +
                    (reason === 'api-disabled'
                        ? `\`enable.apiEnabled: false\` (the list answers 404 OBJECT_API_DISABLED for every user).`
                        : `\`enable.apiMethods\` does not grant \`list\` (the list answers 405 ` +
                          `OBJECT_API_METHOD_NOT_ALLOWED for every user).`) +
                    ` Remove the entry, or expose the object — \`os validate\` refuses this stack ` +
                    `(nav-object-unservable).`,
            );
        }
        return false;
    };
}

/**
 * [#19790] Build the docs-audience nav gate for one request: may THIS
 * caller read what a `type: 'doc'` nav entry opens (ADR-0046 §6.7, the rule
 * `DocNavItemSchema` declares).
 *
 * ## One resolution, not a second one
 *
 * Every verdict comes from the {@link DocsAudience} that `/meta/doc`,
 * `/meta/doc/:name` and `/meta/book/:name/tree` answer from, built over the
 * same env-wide books the doc reads use and a doc corpus read the way
 * `/meta/doc/:name` reads it. Per entry shape:
 *
 *  - **`doc` alone** — served iff the doc's effective audience admits the
 *    caller: `docAudienceAllows` over `resolveDocAudiences`, the answer
 *    `/meta/doc/:name` gives.
 *  - **`book` alone** — the book the name names (a declared book, else the
 *    implicit per-package book, §6.4 — the tree read's own lookup) must
 *    admit the caller by its own audience (the tree read's 401/403), and at
 *    least one of its PAGES must be readable: a doc the book claims
 *    (`resolveBookClaimedDocs`, the membership `resolveDocAudiences` uses)
 *    whose effective audience admits the caller. Not "any entry of the
 *    tree": `resolveBookTree` appends every doc the book does NOT claim as
 *    a synthetic *Uncategorized* group, so over an env-wide corpus nearly
 *    every book's tree holds some readable doc, and the rule would never
 *    fire. The spec calls those orphans "not an authored membership
 *    claim"; external `href` links are not pages either.
 *  - **`book` + `doc`** — served iff BOTH hold: the book's own audience
 *    admits the caller AND the doc is readable. A doc can be readable while
 *    the book is not (its effective audience is the UNION over every book
 *    claiming it, `docAudienceAllows`), but the entry opens that page in
 *    that book's context, whose tree read answers 401/403 — and the entry
 *    itself names the gated book. So it is dropped; it does not fall back
 *    to the page alone.
 *  - **neither** — dropped. The spec refuses the shape; this filter reads
 *    untyped stored documents, and an entry with no target has nothing a
 *    caller could read.
 *
 * Existence is `docs/nav-target`'s question, answered at `os build`, and
 * this gate asks only the resolver's. So a `doc` naming a doc absent from
 * the corpus is SERVED — the resolver's own default for a doc it has no
 * entry for is `org` (`docAudienceAllows`), so an authenticated caller may
 * read it, and there is no gated audience behind a name that resolves to
 * nothing. A `book` naming no declared book is judged as the implicit book
 * of a package by that name — what the tree read serves for it — so when no
 * doc resolves into it, it has no readable page and is NOT served: "no
 * readable page" is the book rule's own wording.
 *
 * ## Fails CLOSED, and says so
 *
 * The arm this feeds treats an absent gate as "drop every `doc` entry", and
 * so does this builder when a read it needs THROWS: the books read (an
 * empty list there reads as "no gated book anywhere") or the doc corpus
 * read (an empty corpus reads every doc as unclaimed, i.e. `org`). Either
 * empty would serve a `{ permissionSet }`-gated entry to every member, so
 * here a thrown read drops the `doc` entries of this one response and logs
 * the fault — the rest of the navigation is served. The doc reads close
 * the same two faults by handing them to their caller instead
 * ({@link fetchAudienceBooks}): each serves one doc or one doc list, so
 * there is no rest to serve. Unresolvable permission-set HOLDINGS
 * already deny inside {@link resolveAudienceCaller} (ADR-0049).
 *
 * ## Cost, per `/meta/app` request (measured by this card's tests)
 *
 * Nothing, when no app in `apps` carries a `doc` entry: a walk over the nav
 * trees, and no read at all. Otherwise, ONCE per request whatever the app
 * count — the same shape as {@link resolveNavServability}:
 *
 *  - one `book` list read;
 *  - one permission-set resolution, only when some book is set-gated
 *    (the execution context itself is memoised per request);
 *  - one `doc` list read, only when the fast path does not decide (a
 *    set-gated book exists) or some entry is `book` alone (its page count
 *    needs the corpus);
 *  - off the fast path, one `resolveDocAudiences` pass (a `resolveBookTree`
 *    per book over the whole corpus) shared by every entry.
 *
 * Per entry: a `doc` is one map lookup; a `book` alone is one
 * `resolveBookClaimedDocs` of that book over the corpus (one
 * `resolveBookTree`: every doc visited once per group rule) plus one
 * lookup per claimed page. ⛔ No cache — nothing outlives the request.
 */
export async function resolveNavDocAudience(
    sources: MetaReadGateAudienceSources & MetaReadGateListSource,
    apps: readonly any[],
): Promise<NavDocAudienceGate | undefined> {
    const entries = docNavEntries(apps);
    // Nothing to judge — and the arm drops a `doc` entry this walk missed,
    // so a walk that ever falls behind `filterNav` fails closed, not open.
    if (entries.length === 0) return undefined;

    const failClosed = (what: string, fault: unknown): NavDocAudienceGate => {
        logWarn(
            `[REST] app-nav docs-audience gate: the ${what} read failed — failing CLOSED: every ` +
                "`type: 'doc'` navigation entry is left out of this response, because whether the " +
                'caller may read what it names could not be established. The rest of the navigation ' +
                'is served.',
            (fault as Error)?.message ?? fault,
        );
        return () => false;
    };

    const books = await readAudienceBooks(sources);
    if ('fault' in books) return failClosed('book', books.fault);
    const audience = await resolveDocsAudience(sources, books.items);

    const bookAlone = (e: any): boolean =>
        navTarget(e.book) !== undefined && navTarget(e.doc) === undefined;
    let corpus: ResolverDoc[] = [];
    if (!audience.allReadable || entries.some(bookAlone)) {
        const read = await readDocCorpus(sources);
        if ('fault' in read) return failClosed('doc', read.fault);
        corpus = read.items;
    }
    // Built ONCE for every entry of every app in this response.
    const canRead = audience.docReader(corpus);

    return (entry: any): boolean => {
        const bookName = navTarget(entry?.book);
        const docName = navTarget(entry?.doc);
        if (bookName === undefined && docName === undefined) return false;
        if (bookName !== undefined) {
            const book = audience.bookNamed(bookName);
            if (!audience.admitsBook(book)) return false;
            if (docName === undefined) return audience.readablePages(book, corpus, canRead).length > 0;
        }
        return canRead(docName);
    };
}

/** A `doc` nav entry's `book` / `doc` target, when it names one. */
export function navTarget(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Every `type: 'doc'` entry in these apps, in every tree `filterNav` walks —
 * top-level `navigation`, `areas[].navigation`, and `children` at any depth.
 */
export function docNavEntries(apps: readonly any[]): any[] {
    const found: any[] = [];
    const walk = (entries: unknown): void => {
        if (!Array.isArray(entries)) return;
        for (const e of entries) {
            if (!e || typeof e !== 'object') continue;
            if (e.type === 'doc') found.push(e);
            walk(e.children);
        }
    };
    for (const app of apps) {
        if (!app || typeof app !== 'object') continue;
        walk(app.navigation);
        if (Array.isArray(app.areas)) {
            for (const area of app.areas) {
                if (area && typeof area === 'object') walk(area.navigation);
            }
        }
    }
    return found;
}

// ── THE gate ──────────────────────────────────────────────────────────────────

const DOCS_SIGN_IN_MESSAGE = 'This documentation requires sign-in';
const DOCS_HOLDER_MESSAGE = 'This documentation is limited to holders of a permission set you do not have';

/**
 * [#20156 · #20193] THE read gate of one `/meta/:type/:name` document, for the
 * plain read and every door beside it, on both transports.
 *
 * ## Why one spelling
 *
 * The plain read ran these gates inline, and the doors that serve the same
 * document — the layered view (`/layers` and the deprecated `?layers=`),
 * `/published`, `/history`, `/audit`, `/diff` — ran none of them. So a
 * member the plain read refuses `403` read a `{ permissionSet }`-gated doc's
 * body from three of those doors, an anonymous caller read any doc or book
 * through `?layers=true`, and an app's `requiredPermissions` entries reached
 * every member. The by-name app route's own rule — it "must not serve a nav
 * entry the list route prunes, or reading the single-app JSON defeats the
 * filter" — held for one door out of seven. Each door asks THIS function, so a
 * gate added here reaches all of them, and the census in
 * `meta-alternate-door-read-gates.test.ts` — its door list read off the
 * route table — fails a door that does not ask.
 *
 * [#20193] And the SECOND TRANSPORT asks it too. The runtime dispatcher's
 * `/meta` item read and its `/published` twin — the only answer on a host
 * that mounts just the `${prefix}/*` catch-all — ran no gate at all;
 * `meta-item-read-gate-parity.test.ts` in `@objectstack/runtime` drives the
 * same fixtures through both transports and holds the answers equal.
 *
 * ## The gates, per type (unchanged from the plain read they came out of)
 *
 *  - `app` — {@link filterAppForUserWithReason}, for an authenticated
 *    caller. `permission` → `403 PERMISSION_DENIED` (#8013, the one
 *    withheld reason the ruling lets report itself); `unpublished` and
 *    `service` → the absence answer (ADR-0045 §3: an unpublished app is
 *    externally unobservable). [#7912] The servability gate and [#19790] the
 *    docs-audience entry arm ride along.
 *    [ruling 5856774816] Under `app: 'author-exempt'` — the layered view,
 *    `/diff` and [#20290] the plain read's `?state=draft` — a caller who
 *    may write the app is served it as stored, unpruned, and every other
 *    caller the pruned app; an app the plain read
 *    refuses WHOLE is refused either way. See `MetaReadGatePolicy.app`.
 *  - `dashboard` — ADR-0057 D10 {@link filterDashboardForUser}. A
 *    per-DEPLOYMENT gate (which optional services are registered), never
 *    per-caller, so `arms: 'per-caller'` skips it.
 *  - `book` — ADR-0046 §6.7, the book's own audience.
 *  - `doc` — ADR-0046 §6.7, the EFFECTIVE audience (union over the books
 *    that claim it, unclaimed → `org`). [#20129] Both gate inputs fail
 *    CLOSED by throwing: a book-read fault throws in
 *    {@link fetchAudienceBooks}, a corpus-read fault below — read as `[]`
 *    it made the doc unclaimed, i.e. `org`, and served it to every member.
 *    Refused `401 UNAUTHENTICATED` anonymous, `403 PERMISSION_DENIED`
 *    otherwise; holdings that cannot be resolved deny (ADR-0049).
 *
 * One audience resolution, the docs reads' own ({@link resolveDocsAudience}),
 * for every door — ⛔ no second resolver. NOT here: the ADR-0106 object mask,
 * which each exit already threads as a posture resolved before its fetch
 * (D2/D3's `fetch → mask → send`), and which the doors apply too.
 *
 * ## Shape
 *
 * `metaType` is the SINGULAR type (`/meta/books/:name` is the canonical plural
 * spelling, Prime Directive #3 — the caller folds it once, at its boundary).
 * Returns a judge for this request, and resolves each type's inputs ONCE,
 * on the first document judged — the layered view judges three, `/diff`
 * up to three, and they share one books read, one corpus read, one
 * holdings resolution. `documents` is every document the answer may judge,
 * so the app arm's nav probes see all of them at once. `null`/`undefined`
 * is served as given: absence is each door's own answer. A gate input that
 * cannot be read REJECTS the judge: the transport answers that fault, ⛔
 * never the document.
 */
export function createMetaItemReadGate(
    sources: MetaItemReadGateSources,
    metaType: string,
    name: string,
    documents: readonly any[],
    policy: MetaReadGatePolicy,
): (document: any) => Promise<MetaItemReadVerdict> {
    const serve = (document: any): MetaItemReadVerdict => ({ kind: 'serve', document });
    const refuse = (refusal: MetaItemReadRefusal): MetaItemReadVerdict => ({ kind: 'refuse', refusal });
    const docsAudienceRefusal = (caller: AudienceCaller): MetaItemReadRefusal => (
        caller.authenticated
            ? { reason: 'docs-audience', status: 403, code: 'PERMISSION_DENIED', message: DOCS_HOLDER_MESSAGE }
            : { reason: 'docs-audience', status: 401, code: 'UNAUTHENTICATED', message: DOCS_SIGN_IN_MESSAGE }
    );

    if (metaType === 'app') {
        type AppGateInputs = {
            sysPerms: Set<string>;
            serviceGate?: (n: string) => boolean;
            servabilityGate?: NavServabilityGate;
            docAudienceGate?: NavDocAudienceGate;
            /** [ruling 5856774816] Serve the stored app unpruned — see `MetaReadGatePolicy.app`. */
            authorExempt: boolean;
        };
        let inputs: Promise<AppGateInputs | null> | undefined;
        const resolveInputs = (): Promise<AppGateInputs | null> => (inputs ??= (async () => {
            const ctx = await sources.resolveCaller();
            if (!ctx?.userId) return null;
            const sysPerms = new Set<string>(
                Array.isArray(ctx.systemPermissions) ? ctx.systemPermissions : [],
            );
            let serviceGate: ((n: string) => boolean) | undefined;
            let servabilityGate: NavServabilityGate | undefined;
            if (policy.arms === 'all') {
                const registered = await resolveRegisteredServices(sources.serviceProbe(ctx), [...documents]);
                serviceGate = registered ? (n: string) => registered.has(n) : undefined;
                // [#7912] Same gate as the list route — the by-name route
                // must not serve a nav entry the list route prunes, or
                // reading the single-app JSON defeats the filter (the
                // #4722 lesson, one gate over).
                servabilityGate = await resolveNavServability(sources) ?? undefined;
            }
            // [#20156] Ruling 5856774816: on a door that honours the author
            // exemption, a caller who may write the app reads it whole. The
            // door answers `mayWriteItem` from its own save door's admission,
            // so this is the caller's property, never the route's.
            const authorExempt = policy.app === 'author-exempt' && ctx.mayWriteItem === true;
            // [#19790] And the same docs-audience gate, for the same reason:
            // a `doc` entry the list route prunes must not come back here.
            // Not resolved for an exempt author: it only prunes ENTRIES, and
            // an exempt author is served the stored app unpruned (see below),
            // so its reads would decide nothing.
            const docAudienceGate = authorExempt
                ? undefined
                : await resolveNavDocAudience(sources, documents);
            return { sysPerms, serviceGate, servabilityGate, docAudienceGate, authorExempt };
        })());
        return async (document) => {
            if (document == null) return serve(document);
            const gateInputs = await resolveInputs();
            if (!gateInputs) return serve(document);
            const gated = filterAppForUserWithReason(
                document, gateInputs.sysPerms, gateInputs.serviceGate,
                gateInputs.servabilityGate, gateInputs.docAudienceGate);
            if (gated.app == null) {
                // [#8013] A PERMISSION denial is reported as one —
                // everything else keeps answering absence. See
                // {@link filterAppForUserWithReason} for why only this one
                // of the three gates converts, and why the reason comes
                // from the branch that fired rather than from `null`.
                //
                // The ADR-0112 STANDARD catalog code; the console reads
                // `body.error.code` (objectui#4252 branches on exactly this
                // `code`).
                if (gated.withheld === 'permission') {
                    return refuse({
                        reason: 'app-permission', status: 403, code: 'PERMISSION_DENIED',
                        message: `You do not have permission to open the '${name}' app.`,
                    });
                }
                // [#18066] The transport's own absence answer, so this arm
                // and the nothing-behind-the-name arm are byte-identical by
                // construction (ADR-0045 §3).
                return refuse({ reason: 'absent' });
            }
            // [#20156] Ruling 5856774816 — see `MetaReadGatePolicy.app`. An
            // app the plain read refuses WHOLE was refused above, author or
            // not. Otherwise an exempt author reads the STORED app (whoever
            // may save it must see all of it, or the save deletes what was
            // withheld), and every other caller the plain read's pruned app.
            return serve(gateInputs.authorExempt ? document : gated.app);
        };
    }

    if (metaType === 'dashboard') {
        if (policy.arms !== 'all') return async (document) => serve(document);
        // ADR-0057 D10: gate dashboard widgets by `requiresService` (mirrors
        // the app-nav gate above) so the console never renders a tile bound
        // to an absent optional service. [#5881] On the DEFAULT path since
        // the plain read's cache exclusion — see the `isDashboardType`
        // comment in `RestServer`'s plain read.
        return async (document) => {
            if (document == null) return serve(document);
            const ctx = await sources.resolveCaller();
            const registered = await resolveRegisteredServices(sources.serviceProbe(ctx), [document]);
            const serviceGate = registered ? (n: string) => registered.has(n) : undefined;
            return serve(serviceGate ? filterDashboardForUser(document, serviceGate) : document);
        };
    }

    if (metaType === 'book') {
        // The book's own audience — holdings resolved only when THIS book
        // is set-gated, so one resolution per document judged.
        return async (document) => {
            if (document == null) return serve(document);
            const audience = await resolveDocsAudience(sources, [document]);
            return audience.admitsBook(document) ? serve(document) : refuse(docsAudienceRefusal(audience.caller));
        };
    }

    if (metaType === 'doc') {
        // A doc's effective audience reads its NAME against the books that
        // claim it — never its body — so the verdict is the same for every
        // version of it, and the inputs are resolved once.
        let reader: Promise<{ caller: AudienceCaller; canRead: (docName: unknown) => boolean }> | undefined;
        const resolveReader = () => (reader ??= (async () => {
            const books = await fetchAudienceBooks(sources);
            const audience = await resolveDocsAudience(sources, books);
            // No gated book anywhere → org suffices.
            if (audience.allReadable) return { caller: audience.caller, canRead: () => true };
            const read = await readDocCorpus(sources);
            if ('fault' in read) throw read.fault;
            return { caller: audience.caller, canRead: audience.docReader(read.items) };
        })());
        return async (document) => {
            if (document == null) return serve(document);
            // [#5563] `audience` is read off the DOCUMENT, never an
            // envelope — an envelope's name-less shape would grant everyone.
            const { caller, canRead } = await resolveReader();
            return canRead(document?.name) ? serve(document) : refuse(docsAudienceRefusal(caller));
        };
    }

    return async (document) => serve(document);
}

// ── THE list gate ─────────────────────────────────────────────────────────────

/**
 * [#20237] THE per-caller gate of one `/meta/:type` LIST answer — the list
 * twin of {@link createMetaItemReadGate}, called by both transports that serve
 * that read.
 *
 * ## Why one spelling
 *
 * `RestServer`'s `GET /meta/:type` ran these filters inline, and the runtime
 * dispatcher's `/meta` list branch — the only answer on a host that mounts
 * just the `${prefix}/*` catch-all — ran none of them. So a member `RestServer`
 * prunes listed a `{ permissionSet }`-gated doc there WITH its body
 * (`?include=content`), a set-gated book, an app whose `requiredPermissions`
 * they lack, and an ungated app with its gated nav entries — the item gate's
 * defect, one door over: the by-name reads refused what the list served.
 * Each transport now hands its list to THIS function, so a list gate added
 * here reaches both, and `meta-list-read-gate-parity.test.ts` in
 * `@objectstack/runtime` drives the same fixtures through both and holds the
 * answers equal.
 *
 * ## The gates, per type (unchanged from `RestServer`'s list route)
 *
 *  - `app` — for an authenticated caller, {@link filterAppForUser} over every
 *    app, all of them judged with ONE set of per-request inputs: the ADR-0057
 *    D10 service probe, [#7912] the nav-servability gate and [#19790] the
 *    docs-audience entry arm. An app withheld for ANY reason is left out — on
 *    a list, unpublished, `requiredPermissions` and an absent service all
 *    mean "not in your list" (the by-name read is where they differ, #8013).
 *    An anonymous caller's list is returned untouched, as it always was: the
 *    anonymous-deny floor answers it before this gate, on both transports.
 *  - `dashboard` — ADR-0057 D10 {@link filterDashboardForUser} over every
 *    dashboard, when the deployment can be probed (fail OPEN otherwise). A
 *    per-DEPLOYMENT gate, not a per-caller one; it rides here because the
 *    list answers what the by-name read answers.
 *  - `book` — ADR-0046 §6.7, each book's OWN audience, resolved over the
 *    listed books ({@link DocsAudience.admitsBook}).
 *  - `doc` — ADR-0046 §6.7, each doc's EFFECTIVE audience: the env's books
 *    ({@link fetchAudienceBooks} — a book-read fault THROWS, [#20129], so the
 *    list is not served rather than filtered against no books), with the
 *    listed docs as the corpus. The fast path (no set-gated book anywhere)
 *    serves an authenticated caller every doc.
 *
 * Every other type is returned as given. One audience resolution, the docs
 * reads' own ({@link resolveDocsAudience}) — ⛔ no second resolver.
 *
 * NOT here, for the item gate's reasons: the ADR-0106 object mask, which each
 * transport threads through its own `fetch → mask → send` exit; and the list
 * route's PROJECTIONS, which withhold nothing from anyone — `?id=`,
 * `?object=`, the doc locale collapse and content slim, translation.
 *
 * ## Shape
 *
 * `metaType` is the SINGULAR type (the caller folds `/meta/docs` once, at its
 * boundary). The judge takes the list's ITEMS — each transport unwraps and
 * rewraps its own list envelope — and answers the SAME array when nothing
 * applies (an ungated type, an empty book or doc list, an anonymous caller's
 * app list, a deployment that cannot be probed), a new one otherwise; the
 * input is never mutated. A gate input that cannot be read REJECTS the judge:
 * the transport answers that fault, ⛔ never the unfiltered list.
 */
export function createMetaListReadGate(
    sources: MetaItemReadGateSources,
    metaType: string,
): (items: any[]) => Promise<any[]> {
    if (metaType === 'app') {
        return async (items) => {
            const ctx = await sources.resolveCaller();
            if (!ctx?.userId) return items;
            const sysPerms = new Set<string>(
                Array.isArray(ctx.systemPermissions) ? ctx.systemPermissions : [],
            );
            const registered = await resolveRegisteredServices(sources.serviceProbe(ctx), items);
            const serviceGate = registered ? (n: string) => registered.has(n) : undefined;
            // [#7912] Resolved ONCE for the whole list — object metadata is a
            // per-request fact, not a per-app one.
            const servabilityGate = await resolveNavServability(sources) ?? undefined;
            // [#19790] Likewise once for the whole list: books, holdings and
            // the doc corpus are per-request facts about this caller.
            const docAudienceGate = await resolveNavDocAudience(sources, items);
            return items
                .map((it: any) => filterAppForUser(it, sysPerms, serviceGate, servabilityGate, docAudienceGate))
                .filter((it: any) => it != null);
        };
    }

    if (metaType === 'dashboard') {
        return async (items) => {
            const ctx = await sources.resolveCaller();
            const registered = await resolveRegisteredServices(sources.serviceProbe(ctx), items);
            if (!registered) return items;
            const serviceGate = (n: string) => registered.has(n);
            return items.map((it: any) => filterDashboardForUser(it, serviceGate));
        };
    }

    if (metaType === 'book') {
        return async (items) => {
            if (items.length === 0) return items;
            const audience = await resolveDocsAudience(sources, items);
            return items.filter((b: any) => b && typeof b === 'object' && audience.admitsBook(b));
        };
    }

    if (metaType === 'doc') {
        return async (items) => {
            if (items.length === 0) return items;
            const books = await fetchAudienceBooks(sources);
            const audience = await resolveDocsAudience(sources, books);
            // Fast path: with no gated book anywhere, every effective audience
            // admits an authenticated caller.
            if (audience.allReadable) return items;
            // The corpus is the listed docs themselves.
            const canRead = audience.docReader(docCorpusOf(items));
            return items.filter((d: any) => !!d && typeof d === 'object' && canRead(d.name));
        };
    }

    return async (items) => items;
}

// ── Anonymous reachability of the `public` audience ───────────────────────────

/**
 * [#20320] The `/meta` READ route a transport is about to serve, named by its
 * SHAPE in that transport's own route table — never by string-matching a
 * request path, so a route added later cannot fall inside the exemption by
 * accident, and a plural spelling cannot fall outside it (#3984).
 *
 *  - `list` — `GET /meta/:type`;
 *  - `item` — `GET /meta/:type/:name`;
 *  - `book-tree` — `GET /meta/book/:name/tree` (the type segment is literal).
 *
 * A transport names only the shapes it serves: `RestServer` all three, the
 * runtime dispatcher `list` and `item` (it has no book-tree route).
 */
export type MetaPublicReadRoute = 'list' | 'item' | 'book-tree';

/**
 * [#3963 · #20320] Is this request a READ of the audience-gated book/doc
 * surface — the one metadata surface whose own declaration (`book.audience`)
 * can authorize an anonymous caller?
 *
 * Both transports' anonymous gates ask it, to grant an anonymous caller
 * REACHABILITY of these reads, so `audience: 'public'` works on a
 * secure-by-default deployment instead of only on one that opened its whole
 * data plane (ADR-0046 §6.7). Authorization stays with the reads' own §6.7
 * gate ({@link createMetaItemReadGate}, {@link createMetaListReadGate}), which
 * admits `'public'` only: `org` and `{ permissionSet }` audiences still refuse
 * an anonymous caller. Reads only — never a write or a publish — and book and
 * doc only: every other type (object, field, view, flow, …) keeps the
 * anonymous deny.
 *
 * Moved here from `RestServer` (#20320): the runtime dispatcher's `/meta`
 * domain opened with an unconditional anonymous deny, so a `public` book
 * answered `401` there while `RestServer` served it. One predicate, two
 * transports — each passes its own method, route shape and raw `:type`
 * segment, and the type is folded HERE, once.
 */
export function isPublicAudienceRead(
    method: unknown,
    route: MetaPublicReadRoute | undefined,
    type: unknown,
): boolean {
    if (String(method ?? '').toUpperCase() !== 'GET') return false;
    if (route === 'book-tree') return true;
    if (route !== 'list' && route !== 'item') return false;
    const folded = typeof type === 'string' ? pluralToSingular(type) : '';
    return folded === 'book' || folded === 'doc';
}

// ── The list route's unknown-type refusal ─────────────────────────────────────

/**
 * [#9488] Refuse a `GET /meta/:type` LIST whose `:type` segment names no
 * metadata type — the read half of the verdict the WRITE door has enforced
 * since #8421.
 *
 * ## The disagreement this closes
 *
 * `PUT /api/v1/meta/totally_invented_type/x` answers `400` /
 * `INVALID_REQUEST` / *"'totally_invented_type' is not a metadata type"*
 * (`refuseUnmintableMetaType` in `@objectstack/metadata-protocol`), while
 * `GET /api/v1/meta/totally_invented_type` answered `200
 * {"items":[]}` — so the two doors disagreed about which type names exist.
 * A 200-with-an-empty-collection is indistinguishable from "this type
 * exists and holds nothing", which is the same trap
 * `GET /meta/app?id=<unknown>` was filed for: a typo'd or renamed type
 * reads as an empty surface rather than as a mistake.
 *
 * ## Why the static verdict alone is NOT the rule here
 *
 * #8421 considered and REJECTED raising `unrecognisedMetaTypeRefusal` on
 * the read entries, for a reason that is still true: the live type set
 * legitimately holds keys the static contract does not. An ordinary
 * `registerApp` puts `data`, `kind`, `package` and `policy` into
 * `SchemaRegistry`, `GET /api/v1/meta/types` enumerates exactly that set,
 * and a plugin's own type enters the live set as a side effect of
 * registering items of it (`content/docs/plugins/adding-a-metadata-type.mdx`:
 * *"A third-party package's type instead enters the live set as a side
 * effect of registering items of that type"*). Refusing on the static
 * verdict alone would answer `400` for types this same service advertises
 * — trading one declared-≠-served gap for another, which is the objection
 * verbatim.
 *
 * So the rule is the UNION of the two authorities the platform already
 * has, and neither is restated here: the static spelling contract
 * (`unrecognisedMetaTypeRefusal`, the predicate the write door consults)
 * and the live listing (`getMetaTypes`, the one `GET /meta/types` serves).
 * A name in neither is a name nothing can serve, which is exactly the
 * population this card is about. ⛔ Do not hand-write a list of type names
 * here — both halves are derived (Prime Directive #8).
 *
 * ## Order, cost, and the failure mode
 *
 * The static verdict runs FIRST and is silent for all 68 accepted
 * spellings, so an ordinary list request pays nothing at all; the live
 * probe is reached only by a request already headed for a refusal. That is
 * the same shape the write door uses (static verdict, then
 * `metaTypeNamespaceExists`), for the same reason.
 *
 * It fails OPEN. A host whose protocol carries no `getMetaTypes`, or whose
 * listing cannot be read, keeps today's answer rather than earning a
 * refusal — inventing "no such type" from an unreachable authority would
 * be an existence claim stated while the authority was unreachable, the
 * very thing `metaTypeNamespaceExists` refuses to do in the write door.
 * The cost is that the defect survives an outage; the alternative is
 * refusing a type that does exist.
 *
 * ## Scope — deliberately the LIST door only
 *
 * ⛔ Not the compound arity. `/meta/lead/views/all_leads` carries an OBJECT
 * name in the `:type` segment, which no static contract can enumerate;
 * that is exemption 1 of the write door and it is honoured here by simply
 * not being this route. ⛔ Not the single-item doors: measured on this
 * branch, `GET /meta/<invented>/x` already answers `404
 * RESOURCE_NOT_FOUND` and the `/references`, `/layers`, `/history`,
 * `/audit`, `/diff`, `/published` limbs already answer `501
 * NOT_IMPLEMENTED` — all distinguishable from a served answer, so none of
 * them carries this defect.
 *
 * ## Both transports
 *
 * [#20408] Moved here, unchanged, out of `RestServer`: the runtime
 * dispatcher's `/meta` list branch asks it too, at the same point — before any
 * listing work — so a dispatcher-only host refuses the segments `RestServer`
 * refuses instead of answering `200 {"items":[]}`. A dispatcher host whose
 * protocol has no `getMetaTypes` keeps its answer (fail-open, above).
 *
 * @returns nothing; THROWS the refusal, so each transport's own `catch`
 *          shapes it (`RestServer`'s `handleRouteError`, the dispatcher's
 *          `errorFromThrown`) and the wire body is byte-identical to the
 *          write door's for the same condition. A hand-built body would
 *          author a second dialect for one condition and would tick
 *          `rest-server.ts`'s `check:route-envelope` dialect ratchets UP.
 */
export async function refuseUnknownMetaListType(p: unknown, urlType: unknown): Promise<void> {
    if (typeof urlType !== 'string' || urlType.length === 0) return;
    const unrecognised = unrecognisedMetaTypeRefusal(urlType);
    if (!unrecognised) return;
    if (await metaTypeIsLive(p, urlType)) return;
    const err: any = new Error(
        `[invalid_request] '${unrecognised.type}' is not a metadata type. The platform declares `
        + `no such type and this deployment has registered no items under it, so an empty `
        + `collection here would be indistinguishable from a type that exists and holds `
        + `nothing. GET /api/v1/meta/types lists the types this deployment carries.`,
    );
    err.code = 'INVALID_REQUEST';
    err.status = 400;
    throw err;
}

/**
 * [#9488] Does this deployment's LIVE type set carry this `/meta/:type`
 * segment? The second half of {@link refuseUnknownMetaListType}'s union.
 *
 * Reads the same accessor `GET /meta/types` serves, and tolerates both
 * shapes it is known to arrive in — the protocol's `{ types, entries }`
 * and the bare `string[]` older hosts and stubs return. Both sides of the
 * comparison are folded through `canonicalMetaUrlType`, the platform's own
 * spelling fold, so a registry storing the plural and a URL carrying the
 * singular still meet; nothing about spelling is re-derived here.
 *
 * `getMetaTypes` is called optionally on purpose: `RestServer`'s own
 * `getMetaItems` call sites are too, because a host may occupy the protocol
 * slot with an object that does not implement the whole surface.
 *
 * Returns `true` — "cannot disprove, so do not refuse" — for every
 * unreadable outcome: no accessor, a rejected call, or a listing in a
 * shape this cannot read. See the caller's doc for why that direction.
 */
async function metaTypeIsLive(p: unknown, urlType: string): Promise<boolean> {
    let listing: unknown;
    try {
        listing = await (p as any)?.getMetaTypes?.();
    } catch {
        return true;
    }
    const types: unknown = Array.isArray(listing)
        ? listing
        : (listing && typeof listing === 'object' && Array.isArray((listing as any).types))
            ? (listing as any).types
            : null;
    if (!Array.isArray(types)) return true;
    const wanted = canonicalMetaUrlType(urlType);
    return types.some((t: unknown) => typeof t === 'string'
        && (t === urlType || canonicalMetaUrlType(t) === wanted));
}

// ── The list route's locale and translation ───────────────────────────────────

/** The two request members a locale is read from — each transport hands in its own. */
export interface MetaRequestHttp {
    /** A `Headers`-like (`get`) or a plain header record. */
    readonly headers?: unknown;
    readonly query?: Readonly<Record<string, unknown>>;
}

/**
 * [#20320] The request's locale, as every `/meta` answer reads it: the
 * highest-priority `Accept-Language` tag, then a `?locale=` query parameter,
 * then — when an i18n service is handed in — that service's default locale.
 * `undefined` when no preference is expressed (the caller then serves
 * untranslated metadata).
 *
 * Moved here, unchanged, from `RestServer.extractLocale` (which now
 * delegates), so the runtime dispatcher reads the same locale from the same
 * request instead of a second parse.
 */
export function metaRequestLocale(http: MetaRequestHttp | undefined, i18n?: unknown): string | undefined {
    const headers: any = http?.headers;
    let header: string | undefined;
    if (headers) {
        header = typeof headers.get === 'function'
            ? headers.get('accept-language') ?? undefined
            : headers['accept-language'] ?? headers['Accept-Language'];
    }
    // Shared parse — the dispatcher's execution context resolves the same
    // header the same way, so a message and the labels around it can't
    // disagree (#3957).
    const preferred = preferredLocaleFromHeader(header);
    if (preferred) return preferred;
    // [#6877] The `typeof` guard sends a repeated `?locale=` to the i18n
    // default rather than into the array arm. A guard, not the refusal gate:
    // this helper is shared by ~10 routes and has no `res`, and the
    // parameter's worst case is falling back to the default locale.
    const queryLocale = http?.query?.locale;
    if (typeof queryLocale === 'string' && queryLocale.length > 0) return queryLocale;
    const service: any = i18n;
    if (service && typeof service.getDefaultLocale === 'function') {
        const def = service.getDefaultLocale();
        if (typeof def === 'string' && def.length > 0) return def;
    }
    return undefined;
}

/**
 * [#3786] Is `type` (the canonical singular) one `translateMetadataDocument`
 * localizes? Derived from `TRANSLATABLE_METADATA_TYPES` in
 * `@objectstack/spec/system`, the set that is itself derived from the
 * translator table — so there is no second list to forget.
 *
 * Resolved lazily and memoised, so `@objectstack/spec/system`'s translators
 * stay off the module-init path: the same `await import` the translate
 * helpers perform, and a module-cache hit after the first call.
 */
let translatableMetaTypes: ReadonlySet<string> | undefined;
export async function isTranslatableMetaType(type: string): Promise<boolean> {
    if (!translatableMetaTypes) {
        ({ TRANSLATABLE_METADATA_TYPES: translatableMetaTypes } = await import('@objectstack/spec/system'));
    }
    return translatableMetaTypes.has(type);
}

/**
 * Build a `TranslationBundle` (`Record<locale, TranslationData>`) from an
 * `II18nService` instance. `undefined` when no locales are registered, so
 * callers can avoid translation work. (`RestServer.buildTranslationBundle`
 * delegates here.)
 */
export function translationBundleOf(i18n: unknown): any | undefined {
    const service: any = i18n;
    if (!service || typeof service.getLocales !== 'function' || typeof service.getTranslations !== 'function') {
        return undefined;
    }
    const locales: string[] = service.getLocales();
    if (!locales.length) return undefined;
    const bundle: Record<string, any> = {};
    for (const locale of locales) {
        const data = service.getTranslations(locale);
        if (data && typeof data === 'object') bundle[locale] = data;
    }
    return Object.keys(bundle).length ? bundle : undefined;
}

/**
 * [#14882 · #15711] The `ResolveOptions` every metadata-document translation
 * hands `@objectstack/spec/system`: the request's locale, the deployment's
 * DECLARED fallback chain (`getFallbackLocale()`) and its DEFAULT locale
 * (`getDefaultLocale()`). Both are feature-detected (optional on
 * `II18nService`): a service that declares neither gets neither — the
 * serving layer threads a declaration, it never invents one.
 * `RestServer.translateOptionsFor`, whose docblock carries the history,
 * delegates here.
 */
export function metaTranslateOptions(
    i18n: unknown,
    locale: string,
): { locale: string; fallbackChain?: string[]; defaultLocale?: string } {
    const service: any = i18n;
    const fallback = service && typeof service.getFallbackLocale === 'function' ? service.getFallbackLocale() : undefined;
    const def = service && typeof service.getDefaultLocale === 'function' ? service.getDefaultLocale() : undefined;
    const opts: { locale: string; fallbackChain?: string[]; defaultLocale?: string } = { locale };
    if (typeof fallback === 'string' && fallback.length > 0) opts.fallbackChain = [fallback];
    if (typeof def === 'string' && def.length > 0) opts.defaultLocale = def;
    return opts;
}

/**
 * [#8284] The packaged (code-layer) base declaration of an OBJECT, for
 * `translateObject`'s `packagedBase` — `undefined` on every uncertainty, which
 * the spec-side rule reads as "no baseline known". Feature-detected on the
 * protocol (`getPackagedObjectBase` is a server-only extension).
 * `RestServer.packagedObjectBase`, whose docblock carries the rule, delegates
 * here.
 */
export function packagedObjectBaseOf(protocol: unknown, type: string, name: unknown): unknown {
    if (type !== 'object') return undefined;
    if (typeof name !== 'string' || name === '') return undefined;
    const p: any = protocol;
    if (!p || typeof p.getPackagedObjectBase !== 'function') return undefined;
    try {
        return p.getPackagedObjectBase(name);
    } catch {
        return undefined;
    }
}

/** How a transport reaches what the list translation reads. */
export interface MetaListTranslationSources {
    /** This request's i18n service, or `undefined` when the deployment has none. */
    resolveI18nService(): Promise<unknown>;
    /** This request's protocol, for the packaged object base; `undefined` when unreachable. */
    resolveProtocol(): Promise<unknown>;
    /**
     * This request's locale ({@link metaRequestLocale} over the transport's own
     * request) — with the i18n service handed in, its default locale is the
     * last fallback; without it, only the request's own preference counts.
     */
    requestLocale(i18n?: unknown): string | undefined;
}

/**
 * [#20320] Translate a metadata LIST — a bare array or the
 * `{ type, items }` envelope, answered in the shape it came in — for the
 * request's locale. `metaType` is the canonical singular (the caller folds its
 * URL segment once): `TRANSLATABLE_METADATA_TYPES` is singular-only, so a
 * plural spelling that reached it unfolded would skip the whole localization.
 *
 * A missing bundle is NOT a bail-out: `translateMetadataDocument` still
 * applies built-in fallbacks (the injected system-field labels on custom
 * objects). No locale is: nothing is translated then.
 *
 * `RestServer.translateMetaItems` delegates here, and the list chain
 * ({@link createMetaListAnswer}) runs it as its last step on both transports.
 */
export async function translateMetaList(
    sources: MetaListTranslationSources,
    metaType: string,
    items: unknown,
): Promise<unknown> {
    if (!(await isTranslatableMetaType(metaType))) return items;
    const raw: any = items;
    const arr: any[] | null = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && Array.isArray(raw.items) ? raw.items : null);
    if (!arr) return items;
    const i18n = await sources.resolveI18nService();
    const bundle = translationBundleOf(i18n);
    const locale = sources.requestLocale(i18n);
    if (!locale) return items;
    const { translateMetadataDocument } = await import('@objectstack/spec/system');
    // [#8284] One protocol resolution for the whole page; the lookup itself is
    // a synchronous in-memory registry read per element.
    const p = metaType === 'object' ? await sources.resolveProtocol() : undefined;
    // `getMetaItems` elements are metadata documents (the list envelope is the
    // OUTER `{ type, items }`), so every element translates directly (#5563).
    const translated = arr.map((item) => translateMetadataDocument(metaType, item, bundle, {
        ...metaTranslateOptions(i18n, locale),
        packagedBase: packagedObjectBaseOf(p, metaType, item?.name),
    }));
    return Array.isArray(raw) ? translated : { ...raw, items: translated };
}

/**
 * [#20408] Translate ONE metadata document for the request's locale — the item
 * twin of {@link translateMetaList}. `metaType` is the canonical singular (the
 * caller folds its URL segment once — plural-spelling commit 2443bb4c4e, whose
 * card no longer resolves: the translatable set is singular-only, so an
 * unfolded plural would skip the whole localization).
 *
 * Takes the DOCUMENT, never the `getMetaItem` envelope (#5563): nav and field
 * labels live on the document. A missing bundle is not a bail-out (the
 * built-in fallbacks still apply); no locale is. The i18n service is resolved
 * only for a translatable type, and the protocol only for an `object` (#8284,
 * the packaged base).
 *
 * Moved here, unchanged, from `RestServer.translateMetaItem` (which now
 * delegates), so the runtime dispatcher's item read translates with the same
 * function instead of serving the authored labels.
 */
export async function translateMetaDocument(
    sources: MetaListTranslationSources,
    metaType: string,
    document: unknown,
): Promise<unknown> {
    if (!document || typeof document !== 'object') return document;
    if (!(await isTranslatableMetaType(metaType))) return document;
    const i18n = await sources.resolveI18nService();
    const bundle = translationBundleOf(i18n);
    const locale = sources.requestLocale(i18n);
    if (!locale) return document;
    const { translateMetadataDocument } = await import('@objectstack/spec/system');
    const packagedBase = metaType === 'object'
        ? packagedObjectBaseOf(await sources.resolveProtocol(), metaType, (document as any)?.name)
        : undefined;
    return translateMetadataDocument(metaType, document as any, bundle, {
        ...metaTranslateOptions(i18n, locale),
        packagedBase,
    });
}

/**
 * [#5563 · #10235 · #20408] The one place a single-item read rebuilds its
 * response body around the document it serves: `envelope` supplies the
 * identity and the ADR-0008 OCC carriers (`lock`, `provenance`, …), `document`
 * is the (gated, locale-collapsed, masked) document that belongs under `item`,
 * translated ({@link translateMetaDocument}).
 *
 * Beside an OBJECT schema it serves the per-column `sortability` projection
 * (#10235), computed from the FINAL document — post ADR-0106 mask — so its
 * domain is exactly the field set this caller is served, and never inside
 * `item` (`FieldSchema` is strict; the key must stay un-authorable).
 *
 * Moved here, unchanged, from `RestServer.translateMetaEnvelope` (which now
 * delegates), so the runtime dispatcher's item read answers the same body —
 * it served neither the translation nor `sortability`.
 */
export async function translateMetaEnvelope(
    sources: MetaListTranslationSources,
    metaType: string,
    envelope: Readonly<Record<string, unknown>> | undefined,
    document: unknown,
): Promise<Record<string, unknown>> {
    const sortability = metaType === 'object'
        && document && typeof document === 'object' && !Array.isArray(document)
        ? { sortability: resolveObjectSortability(document) }
        : {};
    return {
        ...envelope,
        ...sortability,
        item: await translateMetaDocument(sources, metaType, document),
    };
}

// ── The object mask's answer ──────────────────────────────────────────────────

/** [ADR-0106 D6 tier 2] The cache posture a schema served under an UNDETERMINED field visibility carries. */
export const META_UNDETERMINED_CACHE_CONTROL = 'private, no-store';

/**
 * [#20408] Project ONE object schema through the caller's ADR-0106 posture —
 * the decision every schema-serving `/meta` exit makes, on both transports:
 *
 *  - `project` — the readable fields only (D1). A projection that leaves NO
 *    field is a fault (`ok: false`), never an empty-fields `200` (D6: "silently
 *    wrong UI **and** cacheable poison");
 *  - `undetermined` (D6 tier 2) — the schema UNMASKED, and so served
 *    {@link META_UNDETERMINED_CACHE_CONTROL}: no shared cache may store or
 *    revalidate a body no mask touched;
 *  - `passthrough` — as given.
 *
 * The runtime dispatcher masked without the second half: an undetermined
 * posture's schema went out with no `Cache-Control` at all, where `RestServer`
 * answers `private, no-store` — the header the ADR (and the posture's own
 * `warn` line) promises.
 */
export function projectMetaObjectSchema(
    posture: ObjectSchemaMaskPosture,
    document: unknown,
): { ok: true; document: any; cacheControl?: typeof META_UNDETERMINED_CACHE_CONTROL } | { ok: false } {
    const masked = applyObjectSchemaMask(document, posture);
    if (masked.emptied) return { ok: false };
    return posture.kind === 'undetermined'
        ? { ok: true, document: masked.document, cacheControl: META_UNDETERMINED_CACHE_CONTROL }
        : { ok: true, document: masked.document };
}

/**
 * [ADR-0106 D5(2)] Project every object schema of a listed `object` page. One
 * unevaluable object fails the whole list (`ok: false`, naming it) — serving the
 * rest would leave a hole in the projection no client can see — whether its
 * posture threw (D6 tier 3, {@link ObjectSchemaMaskEvaluationError}) or its
 * projection emptied it; any other throw propagates. The page is served
 * `private, no-store` when ANY object's posture was undetermined.
 */
async function maskMetaObjectList(
    masker: (objectName: string) => Promise<ObjectSchemaMaskPosture>,
    items: readonly any[],
): Promise<{ ok: true; items: any[]; cacheControl?: typeof META_UNDETERMINED_CACHE_CONTROL } | { ok: false; object: string }> {
    const projected: any[] = [];
    let cacheControl: typeof META_UNDETERMINED_CACHE_CONTROL | undefined;
    for (const item of items) {
        const objectName = String(item?.name ?? '');
        let posture: ObjectSchemaMaskPosture;
        try {
            posture = await masker(objectName);
        } catch (maskError) {
            if (maskError instanceof ObjectSchemaMaskEvaluationError) return { ok: false, object: objectName };
            throw maskError;
        }
        const masked = projectMetaObjectSchema(posture, item);
        if (!masked.ok) return { ok: false, object: objectName };
        cacheControl ??= masked.cacheControl;
        projected.push(masked.document);
    }
    return cacheControl ? { ok: true, items: projected, cacheControl } : { ok: true, items: projected };
}

// ── THE list answer ───────────────────────────────────────────────────────────

/** Everything {@link createMetaListAnswer} reads, supplied by the transport. */
export interface MetaListAnswerSources extends MetaItemReadGateSources {
    /**
     * This request's locale, as {@link MetaListTranslationSources.requestLocale}
     * reads it — the doc locale collapse asks it with no i18n service, so only
     * the request's own preference counts there.
     */
    requestLocale(i18n?: unknown): string | undefined;
    /**
     * The translation step: {@link translateMetaList} over this transport's
     * I/O, handed the folded `metaType`. A port rather than a call so each
     * transport keeps ONE entry into it (`RestServer.translateMetaItems`).
     */
    translateList(metaType: string, items: unknown): Promise<unknown>;
    /**
     * [#5224] The endpoint matcher this request's `api` face asks — the
     * `metadata` service occupying the slot, or `undefined`. It is PROBED here
     * (`matchEndpoint` is optional on `IMetadataService`), so a transport hands
     * in the occupant, not a verdict.
     */
    resolveEndpointMatcher(): Promise<unknown>;
    /**
     * [#5224] Say — once, in the transport's own words and naming its own
     * remedy — that no matcher is reachable, so the `api` face lists what is
     * STORED (Route & surface ownership rule 3: absence must be loud).
     */
    notifyMissingEndpointMatcher(surface: string): void;
    /**
     * [ADR-0106 D2 · #20408] This request's object-schema masker — the
     * transport's own posture resolver (its caller, its security service, its
     * enablement switch), resolved ONCE per page and asked per object name. It
     * REJECTS with `ObjectSchemaMaskEvaluationError` on D6 tier 3. Asked only
     * for a non-empty `object` list.
     *
     * What the chain does with each posture — the projection, the tier-3 and
     * emptied faults, and the `private, no-store` an undetermined posture owes
     * — is the chain's ({@link projectMetaObjectSchema}), so both transports
     * answer it alike. It used to be a whole-mask port, and the dispatcher's
     * took the projection without the cache header.
     */
    resolveObjectMasker(): Promise<(objectName: string) => Promise<ObjectSchemaMaskPosture>>;
}

/** The request facts the list chain reads — no transport shape. */
export interface MetaListRequest {
    /** The SINGULAR type (the caller folds `/meta/docs` once, at its boundary). */
    readonly metaType: string;
    /** The list route's query. The chain reads `id`, `object` and `include` off it (and `locale`, through `requestLocale`). */
    readonly query: Readonly<Record<string, unknown>> | undefined;
    /**
     * `?preview=draft`, ADMITTED — the transport's own declaration, made with
     * its admission at the list entry (#20338) and ⛔ never re-read here. The
     * `api` face is exempt for it.
     */
    readonly previewDrafts: boolean;
}

/**
 * What the chain answers: the list to send (the input's shape — a bare array
 * or the `{ type, items }` envelope), or the object whose mask could not be
 * evaluated, which the transport answers as its D6 tier-3 fault.
 *
 * [#20408] `cacheControl` — the `Cache-Control` the list must be served under,
 * when it owes one: {@link META_UNDETERMINED_CACHE_CONTROL} when any listed
 * object schema was served under an undetermined field visibility (ADR-0106
 * D6 tier 2). Absent otherwise; the transport then sets none.
 */
export type MetaListAnswer =
    | { ok: true; data: unknown; cacheControl?: typeof META_UNDETERMINED_CACHE_CONTROL }
    | { ok: false; object: string };

/** The items of a list shape this chain serves, or `null` for anything else (left alone, never replaced). */
function listItemsOf(raw: unknown): any[] | null {
    if (Array.isArray(raw)) return raw;
    return raw && typeof raw === 'object' && Array.isArray((raw as any).items) ? (raw as any).items : null;
}

/** `raw`'s shape around new items. */
function withItems(raw: unknown, items: any[]): unknown {
    return Array.isArray(raw) ? items : { ...(raw as any), items };
}

/**
 * [#20320] THE answer of one `/meta/:type` LIST read, after the store read —
 * one chain, called by both transports that serve that read.
 *
 * ## Why one chain
 *
 * `RestServer`'s `GET /meta/:type` ran every step below inline, and the runtime
 * dispatcher's `/meta` list branch — the only answer on a host that mounts just
 * the `${prefix}/*` catch-all — ran the per-caller gate (#20237), the object
 * mask and the doc slim, the slim comparing the RAW segment. So the dispatcher
 * listed every app for `?id=crm`, every view for `?object=lead`, doc bodies for
 * `/meta/docs`, docs with their `translations` maps and in no locale, labels
 * untranslated, and `api` declarations the runtime does not serve. Each
 * transport now hands its store's answer to THIS function: a step added here
 * reaches both, and `meta-list-projection-parity.test.ts` in
 * `@objectstack/runtime` drives every type × query parameter × caller through
 * both and holds the answers equal. ⛔ A list step is added HERE, never in a
 * transport — one added in one of them is the defect this closed, reopened.
 *
 * ## The steps, in `RestServer`'s order (unchanged)
 *
 *  1. `api` — the served-set face (#5224): only the declarations the endpoint
 *     matcher will serve, asked of the matcher itself. Exempt for an admitted
 *     `?preview=draft` (that surface answers what is PENDING). A matcher throw
 *     propagates: an unreadable store is never "nothing declared".
 *  2. THE per-caller list gate ({@link createMetaListReadGate}) — before `?id=`
 *     narrows (permission decides what exists for this caller; the filter
 *     narrows within it, never the reverse, ADR-0045 §3), and on the raw doc
 *     items, before the locale collapse (`_packageId` scopes membership).
 *  3. `app` — `?id=<app>` narrows to the app of that `name` (#7566); empty
 *     and absent spellings mean no filter; no match is an EMPTY list, never a
 *     404.
 *  4. `view` — `?object=<object>` keeps the independent views bound to that
 *     object, sorted by `order` then `name` (the switcher).
 *  5. `doc` — the ADR-0046 locale collapse (the request's own preference; the
 *     `translations` map is dropped whatever the locale).
 *  6. `doc` — the ADR-0046 content slim, unless `?include=content`.
 *  7. `object` — the ADR-0106 mask ({@link projectMetaObjectSchema} over the
 *     transport's {@link MetaListAnswerSources.resolveObjectMasker}), and the
 *     `private, no-store` an undetermined posture owes (D6 tier 2).
 *  8. The translation step ({@link translateMetaList}, reached through
 *     {@link MetaListAnswerSources.translateList}).
 *
 * Every step keys on the FOLDED `metaType`, and a step leaves a shape it does
 * not serve untouched. The input is never mutated. A gate or matcher input
 * that cannot be read REJECTS: the transport answers that fault, ⛔ never the
 * unfiltered list.
 */
export function createMetaListAnswer(
    sources: MetaListAnswerSources,
    request: MetaListRequest,
): (raw: unknown) => Promise<MetaListAnswer> {
    const { metaType, query } = request;
    return async (raw) => {
        let visible: unknown = raw;

        // 1. [#5224] The `api` served-set face.
        if (metaType === 'api' && !request.previewDrafts) {
            const list = metaItemsArray(visible);
            if (list.length > 0) {
                const candidate = await sources.resolveEndpointMatcher();
                if (!isEndpointMatchAuthority(candidate)) {
                    sources.notifyMissingEndpointMatcher('GET /meta/api');
                } else {
                    const served = await selectServedEndpoints(list, candidate, {
                        error: (message: string, meta?: unknown) =>
                            meta === undefined ? logError(message) : logError(message, meta),
                    });
                    // The STORED item is what this face answers with — its
                    // `_packageId` / `_provenance` / `_diagnostics` decorations
                    // are what the Studio list reads.
                    visible = withItems(visible, served.map((s) => s.item));
                }
            }
        }

        // 2. [#20237] THE per-caller list gate.
        {
            const list = listItemsOf(visible);
            if (list) {
                const judged = await createMetaListReadGate(sources, metaType)(list);
                if (judged !== list) visible = withItems(visible, judged);
            }
        }

        // 3. [#7566] `?id=<app>`.
        const appIdFilter = metaType === 'app' ? query?.id : undefined;
        if (typeof appIdFilter === 'string' && appIdFilter !== '') {
            const list = listItemsOf(visible);
            if (list) {
                visible = withItems(visible, list.filter(
                    (a: any) => a && typeof a === 'object' && a.name === appIdFilter,
                ));
            }
        }

        // 4. `?object=<object>` — the view switcher.
        if (metaType === 'view' && query?.object) {
            const obj = String(query.object);
            const list = listItemsOf(visible);
            if (list) {
                visible = withItems(visible, list
                    .filter((v: any) => v && typeof v === 'object' && v.viewKind && v.object === obj)
                    .sort((a: any, b: any) =>
                        ((a.order ?? 0) as number) - ((b.order ?? 0) as number) ||
                        String(a.name).localeCompare(String(b.name))));
            }
        }

        // 5. ADR-0046 i18n: collapse each doc to the request locale.
        if (metaType === 'doc') {
            const locale = sources.requestLocale();
            const { resolveDocLocale } = await import('@objectstack/spec/system');
            const list = listItemsOf(visible);
            if (list) {
                visible = withItems(visible, list.map((it: any) =>
                    it && typeof it === 'object' ? resolveDocLocale(it as any, locale) : it));
            }
        }

        // 6. ADR-0046: the doc list omits `content` unless `?include=content`.
        if (metaType === 'doc' && query?.include !== 'content') {
            const list = listItemsOf(visible);
            if (list) {
                visible = withItems(visible, list.map((it: any) => {
                    if (!it || typeof it !== 'object') return it;
                    const { content: _content, ...rest } = it;
                    return rest;
                }));
            }
        }

        // 7. [ADR-0106 D5(2)] The object mask, over the transport's posture resolver.
        let cacheControl: typeof META_UNDETERMINED_CACHE_CONTROL | undefined;
        if (metaType === 'object') {
            const list = metaItemsArray(visible);
            if (list.length > 0) {
                const masked = await maskMetaObjectList(await sources.resolveObjectMasker(), list);
                if (!masked.ok) return masked;
                visible = withItems(visible, masked.items);
                cacheControl = masked.cacheControl;
            }
        }

        // 8. The translation step ({@link translateMetaList}, through the transport's entry).
        const data = await sources.translateList(metaType, visible);
        return cacheControl ? { ok: true, data, cacheControl } : { ok: true, data };
    };
}

// ── THE item answer ───────────────────────────────────────────────────────────

/** Everything {@link createMetaItemAnswer} reads, supplied by the transport. */
export interface MetaItemAnswerSources extends MetaItemReadGateSources {
    /**
     * This request's locale ({@link metaRequestLocale} over the transport's own
     * request). The doc locale collapse asks it with no i18n service, so only
     * the request's own preference counts there.
     */
    requestLocale(i18n?: unknown): string | undefined;
    /**
     * The body step: {@link translateMetaEnvelope} over this transport's I/O,
     * handed the store's envelope and the served document. A port rather than a
     * call so each transport keeps ONE entry into it
     * (`RestServer.translateMetaEnvelope`).
     */
    translateEnvelope(envelope: Readonly<Record<string, unknown>>, document: unknown): Promise<unknown>;
}

/** The request facts the item chain reads — no transport shape. */
export interface MetaItemRequest {
    /** The SINGULAR type (the caller folds `/meta/books/:name` once, at its boundary). */
    readonly metaType: string;
    readonly name: string;
    /**
     * The door's gate policy: `{ arms: 'all', app: 'gate' }` for the rendered
     * read (its `?preview=draft` included), {@link STORED_VERSION_DOOR_POLICY}
     * for the ADMITTED `?state=draft` read — the transport's own declaration,
     * made with its admission, ⛔ never re-read here.
     */
    readonly policy: MetaReadGatePolicy;
    /**
     * [ADR-0106 D2/D3] The caller's field-visibility posture for this item,
     * resolved by the transport BEFORE the fetch (`fetch → mask → send`), the
     * not-applicable passthrough for every type but `object`. A tier-3 fault is
     * the transport's to answer before it gets here.
     */
    readonly maskPosture: ObjectSchemaMaskPosture;
}

/**
 * What the item chain answers:
 *
 *  - `serve` — send `envelope`, under `cacheControl` when it owes one
 *    ({@link META_UNDETERMINED_CACHE_CONTROL}, ADR-0106 D6 tier 2), and under
 *    `Vary: Accept-Language` always (the body is translated per request);
 *  - `refuse` — the gate's {@link MetaItemReadRefusal} (`absent` included:
 *    nothing behind the name is the transport's own absence answer);
 *  - `mask-fault` — the projection left the schema with no field (D6), which
 *    the transport answers as its field-visibility fault for `object`.
 */
export type MetaItemAnswer =
    | { kind: 'serve'; envelope: unknown; cacheControl?: typeof META_UNDETERMINED_CACHE_CONTROL }
    | { kind: 'refuse'; refusal: MetaItemReadRefusal }
    | { kind: 'mask-fault'; object: string };

/**
 * [#20408] THE answer of one `/meta/:type/:name` read, after the store read —
 * one chain, called by both transports that serve that read.
 *
 * ## Why one chain
 *
 * `RestServer`'s plain read ran every step below inline, and the runtime
 * dispatcher's `/meta` item read — the only answer on a host that mounts just
 * the `${prefix}/*` catch-all — ran the per-caller gate (#20193) and the mask,
 * and nothing else. So the dispatcher served an item untranslated whatever
 * `Accept-Language` asked for, a doc with its whole `translations` map and in
 * no locale, an object schema with no `sortability`, no `Vary` header, and an
 * undetermined posture's schema with no `Cache-Control`. Each transport now
 * hands its store's envelope to THIS function: a step added here reaches both,
 * and `meta-list-projection-parity.test.ts` in `@objectstack/runtime` drives
 * every cell × query parameter × caller through both and holds the answers
 * equal. ⛔ An item step is added HERE, never in a transport.
 *
 * ## The steps, in `RestServer`'s order (unchanged)
 *
 *  1. Absence — an envelope with no `item` is `absent` (#18066), judged BEFORE
 *     the gate, so a name with nothing behind it can never be converted into
 *     the `403` #8013 reserves for an app the caller may not open.
 *  2. THE per-caller gate ({@link createMetaItemReadGate}) under the door's
 *     policy.
 *  3. `doc` — the ADR-0046 locale collapse (the request's own preference; the
 *     `translations` map is dropped whatever the locale).
 *  4. `object` — the ADR-0106 mask ({@link projectMetaObjectSchema}) under the
 *     posture resolved before the fetch.
 *  5. The body ({@link translateMetaEnvelope}, through the transport's entry):
 *     the translation, and `sortability` beside an object schema.
 *
 * The envelope is never mutated. A gate input that cannot be read REJECTS:
 * the transport answers that fault, ⛔ never the document.
 */
export function createMetaItemAnswer(
    sources: MetaItemAnswerSources,
    request: MetaItemRequest,
): (envelope: Readonly<Record<string, any>> | null | undefined) => Promise<MetaItemAnswer> {
    const { metaType, name, policy, maskPosture } = request;
    return async (envelope) => {
        // 1. [#18066] Absence.
        let visible: any = envelope?.item;
        if (visible == null) return { kind: 'refuse', refusal: { reason: 'absent' } };

        // 2. [#20156 · #20193] THE per-caller gate.
        const verdict = await createMetaItemReadGate(sources, metaType, name, [visible], policy)(visible);
        if (verdict.kind === 'refuse') return verdict;
        visible = verdict.document;

        // 3. ADR-0046 i18n: collapse the doc to the request locale.
        if (metaType === 'doc' && visible) {
            const { resolveDocLocale } = await import('@objectstack/spec/system');
            visible = resolveDocLocale(visible as any, sources.requestLocale());
        }

        // 4. [ADR-0106 D1/D5(1)] The mask, under the posture resolved before the fetch.
        const masked = projectMetaObjectSchema(maskPosture, visible);
        if (!masked.ok) return { kind: 'mask-fault', object: name };
        visible = masked.document;

        // 5. The body — translation, and `sortability` beside an object schema.
        const served = await sources.translateEnvelope(envelope ?? {}, visible);
        return masked.cacheControl
            ? { kind: 'serve', envelope: served, cacheControl: masked.cacheControl }
            : { kind: 'serve', envelope: served };
    };
}

// ── THE layered answer ────────────────────────────────────────────────────────

/**
 * [#5882 · #20478] Does this query ask for the layered view through its
 * DEPRECATED spelling, `GET /meta/:type/:name?layers=<value>`? Any value but
 * the empty string does (`?layers=true`, `?layers=1`, `?layers=false` alike);
 * `?layers=` alone, and no `layers` at all, are the plain read.
 *
 * The one parse both transports ask, so a value cannot be the layered view on
 * one and the plain read on the other. A caller that asks is served the layered
 * view only where the protocol has one (`getMetaItemLayered`); elsewhere the
 * flag is the plain read, as it always was on `RestServer`.
 */
export function wantsMetaItemLayers(query: Readonly<Record<string, unknown>> | undefined): boolean {
    return query?.layers !== undefined && query?.layers !== '';
}

/**
 * [#5882 · #20478] The headers every answer of the deprecated
 * `?layers=` spelling carries: RFC 9745 `Deprecation`, and RFC 8288 `Link`
 * naming the successor `GET /meta/:type/:name/layers` — the pairing
 * `versioning.zod.ts` describes for retiring API versions, applied to a
 * retiring query flag. No `Sunset` date: the hard cut-off is a maintainer call,
 * and an invented date is worse than none.
 *
 * `itemPath` is the path the transport serves this item read at — the successor
 * is that path plus `/layers`. A transport that cannot say where it is mounted
 * passes `undefined` and advertises the deprecation alone: a `Link` naming a
 * path this host may not serve is a machine-readable surface that lies (AGENTS.md
 * 〈Route & surface ownership〉 rule 4).
 */
export function metaItemLayersDeprecationHeaders(
    itemPath: string | undefined,
): { Deprecation: 'true'; Link?: string } {
    return itemPath === undefined
        ? { Deprecation: 'true' }
        : { Deprecation: 'true', Link: `<${itemPath}/layers>; rel="successor-version"` };
}

/** The layers a layered answer carries, in the order the gate judges them: `effective` first — it is what the plain read serves, so its refusal is the plain read's own. */
const META_ITEM_LAYERS = ['effective', 'code', 'overlay'] as const;

/** The layers in the order the ADR-0106 mask projects them. */
const META_ITEM_MASKED_LAYERS = ['code', 'overlay', 'effective'] as const;

/** The request facts the layered chain reads — no transport shape. */
export interface MetaLayeredRequest {
    /** The SINGULAR type (the caller folds `/meta/apps/:name` once, at its boundary). */
    readonly metaType: string;
    readonly name: string;
    /**
     * [ADR-0106 D2/D3] The caller's field-visibility posture for this item,
     * resolved by the transport BEFORE the read, the not-applicable passthrough
     * for every type but `object`. A tier-3 fault is the transport's to answer
     * before it gets here.
     */
    readonly maskPosture: ObjectSchemaMaskPosture;
}

/**
 * What the layered chain answers:
 *
 *  - `serve` — send `layered`, under `cacheControl` when it owes one
 *    ({@link META_UNDETERMINED_CACHE_CONTROL}, ADR-0106 D6 tier 2). No `Vary`:
 *    the layered view is not translated;
 *  - `refuse` — the gate's {@link MetaItemReadRefusal} for a layer the caller
 *    may not read (`absent` included: an unpublished app to a non-builder);
 *  - `mask-fault` — a layer's projection left the schema with no field (D6),
 *    which the transport answers as its field-visibility fault.
 */
export type MetaLayeredAnswer =
    | { kind: 'serve'; layered: unknown; cacheControl?: typeof META_UNDETERMINED_CACHE_CONTROL }
    | { kind: 'refuse'; refusal: MetaItemReadRefusal }
    | { kind: 'mask-fault'; object: string };

/**
 * [#5882 · #20156 · #20478] THE answer of the layered view — the three-layer
 * diagnostic projection (`code` / `overlay` / `effective`) declared by
 * `GetMetaItemLayeredResponseSchema` — after the store read, on both of its
 * spellings (`GET /meta/:type/:name/layers`, and the deprecated `?layers=` flag
 * on the item read), on both transports.
 *
 * ## Why one chain
 *
 * `RestServer` served both spellings through one private helper, and the
 * runtime dispatcher — the only answer on a host that mounts just the
 * `${prefix}/*` catch-all — served neither: the route answered a located
 * `404 ROUTE_NOT_FOUND`, and the flag answered the PLAIN read's
 * `{ type, name, item }` with a `200`, so a client reading `overlay` or
 * `effective` there read `undefined`, and an author was served the app pruned
 * where ruling 5856774816 serves it whole. Everything the helper did after the
 * read moved here, unchanged, and each transport hands its read's answer to
 * THIS function. ⛔ A step is added HERE, never in a transport — one added in
 * one of them is the defect this closed, reopened.
 * `meta-list-projection-parity.test.ts` in `@objectstack/runtime` drives both
 * spellings through both transports.
 *
 * The read stays each transport's, in the caller's VETTED partition
 * ({@link metaReadOrganizationId} over the folded type — the partition the plain
 * read reads, [#9454] so an author who has just saved an org overlay is not
 * shown `overlay: null`) and its `?package=` scope (ADR-0048), exactly as the
 * item read's does ({@link createMetaItemAnswer}).
 *
 * Not translated and not cached, both deliberately: this is a diagnostic view of
 * what is STORED at each layer, so locale-collapsing it (or serving it from the
 * published-value cache) would misreport the thing being diagnosed.
 *
 * ## The steps, in `RestServer`'s order (unchanged)
 *
 *  1. [#20156] THE per-caller gate on EVERY present layer, `effective` first
 *     (it is what the plain read serves, so its refusal is the plain read's
 *     own), under {@link STORED_VERSION_DOOR_POLICY}: per-caller arms only
 *     (these are STORED versions, which Studio's designer loads and saves
 *     back), and ruling 5856774816 — a caller who may write the item reads
 *     every layer whole, and any other caller who may open it reads each layer
 *     pruned, exactly as the plain read prunes it. ⚠️ So the transport's
 *     {@link MetaReadGateAudienceSources.resolveCaller} MUST carry
 *     {@link MetaReadGateCaller.mayWriteItem} — its own save door's admission;
 *     absent reads as `false` (every caller pruned). Every layer is judged
 *     before any is served, so a refusal sends nothing of the others.
 *  2. [ADR-0106 D5(4)] The mask on every layer — each is a full object schema —
 *     through {@link projectMetaObjectSchema} under the posture resolved before
 *     the read, and the `private, no-store` an undetermined posture owes.
 *
 * The protocol's answer is never mutated. A layer the gate or the mask leaves as
 * it was is served as it was, and every other key of the answer
 * (`overlayScope`, `_diagnostics`, the ADR-0010 protection envelope) rides
 * through untouched. With nothing behind the name the protocol answers every
 * layer `null`, and so does this chain: no layer is present to judge. A gate
 * input that cannot be read REJECTS: the transport answers that fault, ⛔ never
 * a layered view with a layer missing.
 */
export function createMetaLayeredAnswer(
    sources: MetaItemReadGateSources,
    request: MetaLayeredRequest,
): (layered: unknown) => Promise<MetaLayeredAnswer> {
    const { metaType, name, maskPosture } = request;
    return async (raw) => {
        const layered = raw as Record<string, unknown> | null | undefined;

        // 1. [#20156] THE per-caller gate, on every present layer.
        const served = new Map<string, unknown>();
        {
            const present = META_ITEM_LAYERS.filter((layer) => layered?.[layer] != null);
            const judge = createMetaItemReadGate(
                sources, metaType, name, present.map((layer) => layered![layer]), STORED_VERSION_DOOR_POLICY,
            );
            for (const layer of present) {
                const verdict = await judge(layered![layer]);
                if (verdict.kind === 'refuse') return verdict;
                served.set(layer, verdict.document);
            }
        }

        // 2. [ADR-0106 D5(4)] The mask, on every layer.
        let cacheControl: typeof META_UNDETERMINED_CACHE_CONTROL | undefined;
        for (const layer of META_ITEM_MASKED_LAYERS) {
            const document = served.has(layer) ? served.get(layer) : layered?.[layer];
            const masked = projectMetaObjectSchema(maskPosture, document);
            if (!masked.ok) return { kind: 'mask-fault', object: name };
            cacheControl ??= masked.cacheControl;
            if (masked.document !== document) served.set(layer, masked.document);
        }

        let answer: unknown = raw;
        if (layered && typeof layered === 'object') {
            const replaced: Record<string, unknown> = { ...layered };
            for (const [layer, document] of served) replaced[layer] = document;
            answer = replaced;
        }
        return cacheControl ? { kind: 'serve', layered: answer, cacheControl } : { kind: 'serve', layered: answer };
    };
}

// ── THE book tree ─────────────────────────────────────────────────────────────

/** Everything {@link createMetaBookTreeAnswer} reads, supplied by the transport. */
export interface MetaBookTreeSources extends MetaReadGateAudienceSources {
    /**
     * One list read of `type` for the tree, env-wide, scoped to `packageId` when
     * the request names one (`?package=`, ADR-0048). A THROW propagates: an
     * unreadable book list is never "no book", nor an unreadable doc list "no
     * page".
     */
    listTreeInput(type: 'book' | 'doc', packageId: string | undefined): Promise<unknown>;
    /** This request's locale, as {@link MetaItemAnswerSources.requestLocale} reads it. */
    requestLocale(i18n?: unknown): string | undefined;
}

/**
 * What the tree route answers: the tree to send, or the ADR-0046 §6.7 refusal —
 * `401 UNAUTHENTICATED` to an anonymous caller, `403 PERMISSION_DENIED`
 * otherwise — each transport writes on its own wire.
 */
export type MetaBookTreeAnswer =
    | { ok: true; tree: ResolvedBook }
    | { ok: false; refusal: Extract<MetaItemReadRefusal, { reason: 'docs-audience' }> };

/**
 * [ADR-0046 §6 · #20408] THE answer of `GET /meta/book/:name/tree` — a book
 * spine resolved against the docs that exist NOW into a rendered tree
 * (membership is DERIVED, never stored — §6.2.1), on both transports.
 *
 * ## Why here
 *
 * `RestServer` served the route; the runtime dispatcher had no such route at
 * all, so a dispatcher-only host answered `404 ROUTE_NOT_FOUND` to a signed-in
 * caller and `401` to an anonymous reader of a `public` book — the reader the
 * route exists for. It is a ROUTE, not a projection, but everything it does is
 * a read and a pure resolution, so the whole handler moved here, unchanged, and
 * each transport supplies only its I/O.
 *
 * ## The steps (unchanged from `RestServer`'s handler)
 *
 *  1. Every book (`?package=` scopes the list), audience-shaped, and THE
 *     {@link DocsAudience} over them — one resolution, the docs reads' own.
 *  2. The book the name names: a declared book, else the implicit per-package
 *     book (§6.4).
 *  3. §6.7 — the book's OWN audience gates the whole tree: anonymous →
 *     `public` only; `{ permissionSet }` → the caller must hold the named set
 *     (fail closed when holdings cannot be resolved, ADR-0049).
 *  4. Every doc (the same package scope), collapsed to the request's locale and
 *     reduced to the header the tree renders.
 *  5. The tree, its ENTRIES narrowed by each doc's effective audience, so a
 *     reader never sees an entry that would refuse them on fetch.
 */
export async function createMetaBookTreeAnswer(
    sources: MetaBookTreeSources,
    request: { readonly name: string; readonly packageId?: string },
): Promise<MetaBookTreeAnswer> {
    const { resolveDocLocale } = await import('@objectstack/spec/system');
    const locale = sources.requestLocale();
    const books = metaItemsArray(await sources.listTreeInput('book', request.packageId));
    const audience = await resolveDocsAudience(sources, audienceBooksOf(books));
    const book = audience.bookNamed(request.name);
    if (!audience.admitsBook(book)) {
        return {
            ok: false,
            refusal: audience.caller.authenticated
                ? { reason: 'docs-audience', status: 403, code: 'PERMISSION_DENIED', message: DOCS_HOLDER_MESSAGE }
                : { reason: 'docs-audience', status: 401, code: 'UNAUTHENTICATED', message: DOCS_SIGN_IN_MESSAGE },
        };
    }
    const docs = metaItemsArray(await sources.listTreeInput('doc', request.packageId))
        .map((d: any) => (d && typeof d === 'object' ? resolveDocLocale(d, locale) : d))
        .map((d: any) => ({
            name: d.name,
            label: d.label,
            description: d.description,
            order: d.order,
            group: d.group,
            tags: d.tags,
            packageId: d._packageId,
        }));
    return { ok: true, tree: audience.readableTree(book, docs) };
}
