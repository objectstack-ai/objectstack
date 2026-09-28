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
 */

import type { AudienceCaller, Book, ResolvedBook, ResolverDoc } from '@objectstack/spec/system';
import { apiExposureDenialReason } from '@objectstack/spec/data';
import { logWarn } from './log.js';

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
