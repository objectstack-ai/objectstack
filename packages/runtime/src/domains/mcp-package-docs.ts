// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35442] The HTTP MCP door's app-docs members — `searchPackageDocs` and
 * `readPackageDoc`, which `@objectstack/mcp` serves as `search_package_docs`
 * and `read_package_doc` — over the installed packages' `doc` items.
 *
 * ## One visibility rule: the `/meta/doc` docs-audience gate
 *
 * Every page either member answers from is read through the gate the `/meta`
 * doors read docs through (`createMetaListReadGate`, ADR-0046 §6.7, in
 * `@objectstack/rest`'s `meta-item-read-gate.ts`), with this request's caller
 * as its caller: the `doc` arm drops a page no book that admits the caller
 * claims, and the `book` arm drops a book the caller may not open, so a page
 * is never addressed through a manual the caller cannot read. ⛔ No second
 * rule: this module hands the gate I/O only, and every verdict is the gate's.
 * A page the caller may not read is neither found nor read, and reads as not
 * found.
 *
 * The caller is the request's execution context as the door received it. Its
 * permission-set holdings, which a `{ permissionSet }` audience reads, are its
 * own, with one exception ({@link packageDocsReadGate}): on a delegated agent
 * envelope (an OAuth grant: `principalKind: 'agent'` acting `onBehalfOf` a
 * person) they are the delegating person's own sets, resolved by grant
 * resolution in the organization the request runs in (ADR-0090 D10: the
 * token's ceiling decides whether the docs tools are reached at all, and the
 * person's holdings decide which manuals open). Never the envelope's
 * scope-derived ceiling sets, and never a union with them. A person who does
 * not exist, who holds no membership in that organization, or whose grants
 * cannot be read holds no set here: permission-set audiences stay closed. An
 * AI service account (an agent acting for nobody) keeps its own sets.
 *
 * ## The search
 *
 * No server-side doc search exists, so the search is the smallest honest one:
 * a term is found when a page's title, one of its headings or its text
 * contains it, case aside, in the page's base text or one of its
 * translations. Pages rank by how many of the terms they contain first, then
 * by the sum of where each contained term is found (title 3, heading 2,
 * text 1), then by title; the answer carries at most `maxResults` and says
 * when more matched. The match rule, the order and the cap are stated in the
 * tool's description (`registerPackageDocTools`). The heading parse is
 * line-based and linear.
 *
 * A page with no package carries no address (`url`), since the Console
 * route needs one.
 *
 * ## The address
 *
 * Each page carries the console address it opens at,
 * `/_console/apps/PACKAGE/docs/BOOK/NAME` (the Console's
 * `/apps/:appName/docs/:slug/:name` route under its `/_console` mount), where
 * BOOK is the slug of the page's home manual as the Console's flat-permalink
 * redirect picks it: among the package's manuals the caller may read, in
 * display order, the first that claims the page, else the first, else the
 * package's implicit manual (ADR-0046 §6.4).
 */

import {
    createMetaListReadGate,
    type MetaItemReadGateSources,
    type MetaReadGateCaller,
} from '@objectstack/rest';
import {
    deriveImplicitPackageBook,
    resolveBookClaimedDocs,
    resolveDocLocale,
    type Book,
    type Doc,
    type ResolverDoc,
} from '@objectstack/spec/system';
import type { ErrorCode } from '@objectstack/spec/api';
import { resolveUserAuthzGrants, vetOrganizationClaim } from '@objectstack/core';

/** The protocol read these members take: the merged `/meta` list read. */
export interface PackageDocsProtocol {
    getMetaItems(request: { type: string }): Promise<unknown>;
}

/** The host I/O {@link createPackageDocMembers} reads, per request. */
export interface PackageDocsSources {
    /** The protocol whose `getMetaItems` serves the `doc` and `book` lists. */
    protocol: PackageDocsProtocol;
    /** The `/meta` read gates' ports with this request's caller. */
    readGate: MetaItemReadGateSources;
    /** This request's locale, the default translation a read serves. */
    locale?: string;
}

/** Where the Console is mounted: its router basename. */
export const CONSOLE_BASE_PATH = '/_console';

/** How long an excerpt runs, in characters. */
const EXCERPT_CHARS = 180;

const RESOURCE_NOT_FOUND: ErrorCode = 'RESOURCE_NOT_FOUND';
const VALIDATION_ERROR: ErrorCode = 'VALIDATION_ERROR';

/** A refusal the MCP tool layer relays with its code and status (`errorResultWithCode`). */
function refusal(code: ErrorCode, message: string, status: number): Error {
    return Object.assign(new Error(message), { code, status });
}

/** The items of a `getMetaItems` answer. */
function itemsOf(raw: unknown): any[] {
    const items = Array.isArray(raw) ? raw : (raw as { items?: unknown } | null | undefined)?.items;
    return Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
}

/** The pages and manuals this caller may read, both through the `/meta` list gate. */
async function readableDocsAndBooks(sources: PackageDocsSources): Promise<{ docs: any[]; books: any[] }> {
    const { protocol, readGate } = sources;
    const docs = await createMetaListReadGate(readGate, 'doc')(itemsOf(await protocol.getMetaItems({ type: 'doc' })));
    const books = await createMetaListReadGate(readGate, 'book')(itemsOf(await protocol.getMetaItems({ type: 'book' })));
    return { docs, books };
}

/** The package an item was installed by, when stamped. */
function packageOf(item: any): string | undefined {
    const id = item?._packageId ?? item?.packageId;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/** The page header the book resolver reads. */
function corpusOf(docs: readonly any[]): ResolverDoc[] {
    return docs.map((d) => ({
        name: d.name,
        label: d.label,
        description: d.description,
        group: d.group,
        tags: d.tags,
        order: d.order,
        packageId: packageOf(d),
    }));
}

/** The Console's display order of manuals: `order`, then title, then as listed. */
function sortBooks(books: readonly any[]): any[] {
    return books
        .map((b, i) => ({ b, i }))
        .sort((x, y) =>
            (x.b.order ?? 0) - (y.b.order ?? 0)
            || String(x.b.label ?? x.b.name).localeCompare(String(y.b.label ?? y.b.name))
            || x.i - y.i)
        .map((x) => x.b);
}

/** The manual a page opens in ({@link CONSOLE_BASE_PATH} header). */
function homeBookOf(doc: any, books: readonly any[], corpus: ResolverDoc[]): Book & { slug?: string } {
    const pkg = packageOf(doc) as string;
    const own = sortBooks(books.filter((b) => packageOf(b) === pkg));
    return own.find((b) => resolveBookClaimedDocs(b as Book, corpus, pkg).has(doc.name))
        ?? own[0]
        ?? deriveImplicitPackageBook(pkg);
}

/** One Markdown heading of a page: its text and the span of its line. */
interface Heading {
    text: string;
    index: number;
    length: number;
}

/**
 * The heading text of one line, or `undefined`: one to six `#`, then a space
 * or tab on the same line, then the text, with a closing run of `#` (one a
 * space precedes) dropped.
 */
function headingTextOf(line: string): string | undefined {
    const trimmed = line.trim();
    let level = 0;
    while (level < trimmed.length && trimmed[level] === '#') level++;
    if (level < 1 || level > 6) return undefined;
    const gap = trimmed[level];
    if (gap !== ' ' && gap !== '\t') return undefined;
    let text = trimmed.slice(level + 1).trim();
    let end = text.length;
    while (end > 0 && text[end - 1] === '#') end--;
    if (end === 0) return undefined;
    if (end < text.length) {
        const before = text[end - 1];
        if (before === ' ' || before === '\t') text = text.slice(0, end).trim();
    }
    return text || undefined;
}

/** A page's headings, in order: one pass over its lines. */
function headingsOf(content: string): Heading[] {
    const out: Heading[] = [];
    for (let index = 0; index <= content.length;) {
        const newline = content.indexOf('\n', index);
        const end = newline < 0 ? content.length : newline;
        const text = headingTextOf(content.slice(index, end));
        if (text !== undefined) out.push({ text, index, length: end - index });
        index = end + 1;
    }
    return out;
}

/** A page's title: its label, else its first heading, else its name. */
function titleOf(label: unknown, headings: readonly Heading[], name: string): string {
    if (typeof label === 'string' && label.trim()) return label.trim();
    return headings[0]?.text || name;
}

/** Where a page lives, for this caller. */
function addressOf(doc: any, books: readonly any[], corpus: ResolverDoc[], title: string) {
    const pkg = packageOf(doc);
    if (!pkg) return { name: doc.name as string, title };
    const book = homeBookOf(doc, books, corpus);
    const slug = (book as { slug?: string }).slug ?? book.name;
    return {
        name: doc.name as string,
        package: pkg,
        title,
        book: { name: book.name, ...(book.label ? { label: book.label } : {}) },
        url: `${CONSOLE_BASE_PATH}/apps/${encodeURIComponent(pkg)}/docs/${encodeURIComponent(slug)}/${encodeURIComponent(doc.name)}`,
    };
}

/** One readable text of a page: its base text, or one translation. */
interface PageVariant {
    locale?: string;
    title: string;
    description?: string;
    content: string;
    headings: Heading[];
}

function variantsOf(doc: any): PageVariant[] {
    const content = typeof doc.content === 'string' ? doc.content : '';
    const headings = headingsOf(content);
    const base: PageVariant = {
        title: titleOf(doc.label, headings, doc.name),
        ...(typeof doc.description === 'string' ? { description: doc.description } : {}),
        content,
        headings,
    };
    const out = [base];
    const translations = doc.translations && typeof doc.translations === 'object' ? doc.translations : {};
    for (const [locale, t] of Object.entries<any>(translations)) {
        if (!t || typeof t.content !== 'string') continue;
        const translated = headingsOf(t.content);
        out.push({
            locale,
            title: titleOf(t.label ?? doc.label, translated, doc.name),
            ...(typeof (t.description ?? doc.description) === 'string' ? { description: t.description ?? doc.description } : {}),
            content: t.content,
            headings: translated,
        });
    }
    return out;
}

/** Collapse a passage to one line of at most {@link EXCERPT_CHARS}, around `at`. */
function excerptAround(text: string, at: number, length: number): string {
    const start = Math.max(0, at - Math.floor((EXCERPT_CHARS - length) / 2));
    const raw = text.slice(start, start + EXCERPT_CHARS);
    const line = raw.replace(/\s+/g, ' ').trim();
    return `${start > 0 ? '…' : ''}${line}${start + EXCERPT_CHARS < text.length ? '…' : ''}`;
}

/** The heading a position sits under, if any. */
function headingAbove(headings: readonly Heading[], at: number): string | undefined {
    let heading: string | undefined;
    for (const h of headings) {
        if (h.index > at) break;
        heading = h.text;
    }
    return heading;
}

const RANK = { title: 3, heading: 2, text: 1 } as const;
type MatchedOn = keyof typeof RANK;

interface TermMatch {
    on: MatchedOn;
    heading?: string;
    excerpt: string;
}

/** Where `term` is best found in one variant, or `undefined`. */
function matchIn(variant: PageVariant, term: string): TermMatch | undefined {
    const needle = term.toLowerCase();
    const lead = variant.description?.trim() || variant.content;
    if (variant.title.toLowerCase().includes(needle)) {
        return { on: 'title', excerpt: excerptAround(lead, 0, 0) };
    }
    const lower = variant.content.toLowerCase();
    for (const h of variant.headings) {
        if (h.text.toLowerCase().includes(needle)) {
            return { on: 'heading', heading: h.text, excerpt: excerptAround(variant.content, h.index, h.length) };
        }
    }
    const at = lower.indexOf(needle);
    if (at >= 0) {
        const heading = headingAbove(variant.headings, at);
        return { on: 'text', ...(heading ? { heading } : {}), excerpt: excerptAround(variant.content, at, needle.length) };
    }
    const description = variant.description ?? '';
    const inDescription = description.toLowerCase().indexOf(needle);
    if (inDescription >= 0) return { on: 'text', excerpt: excerptAround(description, inDescription, needle.length) };
    return undefined;
}

/** The terms as sent, trimmed, empty and repeated ones dropped. */
function cleanTerms(terms: unknown): string[] {
    const out: string[] = [];
    for (const term of Array.isArray(terms) ? terms : []) {
        const t = typeof term === 'string' ? term.trim() : '';
        if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    }
    return out;
}

/**
 * The two doc members over one request's sources. `getSources` is read per
 * call, so each call reads the pages as they are at that moment.
 */
export function createPackageDocMembers(getSources: () => Promise<PackageDocsSources>) {
    return {
        async searchPackageDocs(input: { terms: string[]; package?: string }, opts: { maxResults: number }) {
            const terms = cleanTerms(input?.terms);
            if (terms.length === 0) throw refusal(VALIDATION_ERROR, 'Send at least one business word as `terms`.', 400);
            const sources = await getSources();
            const { docs, books } = await readableDocsAndBooks(sources);
            const corpus = corpusOf(docs);
            const scoped = input.package ? docs.filter((d) => packageOf(d) === input.package) : docs;
            const hits: Array<{ score: number; hit: any }> = [];
            for (const doc of scoped) {
                let best: { variant: PageVariant; matched: string[]; first: TermMatch; score: number } | undefined;
                for (const variant of variantsOf(doc)) {
                    const matched: string[] = [];
                    let first: TermMatch | undefined;
                    let rank = 0;
                    for (const term of terms) {
                        const m = matchIn(variant, term);
                        if (!m) continue;
                        matched.push(term);
                        rank += RANK[m.on];
                        if (!first || RANK[m.on] > RANK[first.on]) first = m;
                    }
                    if (!first) continue;
                    const score = matched.length * 10 + rank;
                    if (!best || score > best.score) best = { variant, matched, first, score };
                }
                if (!best) continue;
                hits.push({
                    score: best.score,
                    hit: {
                        ...addressOf(doc, books, corpus, best.variant.title),
                        matchedOn: best.first.on,
                        matchedTerms: best.matched,
                        ...(best.first.heading ? { heading: best.first.heading } : {}),
                        excerpt: best.first.excerpt,
                        ...(best.variant.locale ? { locale: best.variant.locale } : {}),
                    },
                });
            }
            hits.sort((a, b) => b.score - a.score || String(a.hit.title).localeCompare(String(b.hit.title)));
            return {
                terms,
                results: hits.slice(0, opts.maxResults).map((h) => h.hit),
                truncated: hits.length > opts.maxResults,
            };
        },

        async readPackageDoc(input: { name: string; package?: string; locale?: string }) {
            const sources = await getSources();
            const { docs, books } = await readableDocsAndBooks(sources);
            const named = docs.filter((d) => d.name === input.name && (!input.package || packageOf(d) === input.package));
            if (named.length === 0) {
                throw refusal(
                    RESOURCE_NOT_FOUND,
                    `No manual page named '${input.name}'${input.package ? ` in app '${input.package}'` : ''} that you can read. `
                        + 'Find pages with search_package_docs.',
                    404,
                );
            }
            if (named.length > 1) {
                const packages = named.map((d) => packageOf(d) ?? '(none)').join(', ');
                throw refusal(
                    VALIDATION_ERROR,
                    `Several apps ship a manual page named '${input.name}' (${packages}). Send package to name one.`,
                    400,
                );
            }
            const doc = named[0];
            const locale = input.locale ?? sources.locale;
            const served = resolveDocLocale(doc as Doc, locale);
            // The translation key `resolveDocLocale` served, when it served one.
            const servedLocale = locale && doc.translations
                ? [locale, locale.split('-')[0]].find((key) => typeof doc.translations[key]?.content === 'string')
                : undefined;
            const title = titleOf(served.label, typeof served.content === 'string' ? headingsOf(served.content) : [], doc.name);
            return {
                ...addressOf(doc, books, corpusOf(docs), title),
                ...(typeof served.description === 'string' ? { description: served.description } : {}),
                ...(servedLocale ? { locale: servedLocale } : {}),
                content: typeof served.content === 'string' ? served.content : '',
            };
        },
    };
}

/**
 * The `/meta` read gates' ports over `protocol`, with `caller` as the caller:
 * I/O only. On a delegated agent envelope ({@link delegatingPersonOf}) the
 * holdings the audience reads are the person's ({@link delegatorHoldingsCaller}),
 * resolved once per gate and only when a `{ permissionSet }` audience is in
 * play; `resolveEngine` is the data engine their grants are read through.
 */
export function packageDocsReadGate(
    protocol: PackageDocsProtocol,
    caller: MetaReadGateCaller | undefined,
    resolveService: (name: string) => Promise<unknown>,
    resolveEngine: () => Promise<unknown> = async () => undefined,
): MetaItemReadGateSources {
    type Security = Awaited<ReturnType<MetaItemReadGateSources['resolveSecurityService']>>;
    const security = async () => (await resolveService('security')) as Security;
    const personId = delegatingPersonOf(caller);
    let holdings: Promise<MetaReadGateCaller> | undefined;
    return {
        resolveCaller: async () => caller,
        resolveSecurityService: personId === undefined
            ? security
            : async () => {
                const svc = await security();
                const names = svc?.resolvePermissionSetNames?.bind(svc);
                if (!names) return undefined;
                // A throw here (no such person, no membership, an unreadable
                // grant) is read by the gate as unresolved holdings: closed.
                return {
                    resolvePermissionSetNames: async () =>
                        names(await (holdings ??= delegatorHoldingsCaller(resolveEngine, personId, caller?.tenantId))),
                };
            },
        listMetaItems: (type) => protocol.getMetaItems({ type }),
        // Only the `app` and `dashboard` arms probe services or log nav prunes;
        // the `doc` and `book` arms these members read do neither.
        serviceProbe: () => null,
        navPruneLogged: new Set<string>(),
    };
}

/**
 * The person a delegated agent envelope acts for (ADR-0090 D10): its
 * `onBehalfOf.userId` when the caller is an agent principal, else `undefined`.
 * An AI service account is an agent acting for nobody, so it keeps its own sets.
 */
export function delegatingPersonOf(caller: MetaReadGateCaller | undefined): string | undefined {
    if (caller?.principalKind !== 'agent') return undefined;
    const id = (caller.onBehalfOf as { userId?: unknown } | undefined)?.userId;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * The delegating person as the audience reads a caller: their own grants
 * (`resolveUserAuthzGrants`, as the open draft door's reader resolves them,
 * with no capability asked of them) in the organization the request runs in.
 * Fails closed as the security plugin's delegator resolution does: it throws
 * when no `sys_user` row has the id (the resolver synthesises a baseline for
 * any id), and when the person holds no current membership in that
 * organization (`vetOrganizationClaim`, the one membership rule).
 */
async function delegatorHoldingsCaller(
    resolveEngine: () => Promise<unknown>,
    userId: string,
    organization: unknown,
): Promise<MetaReadGateCaller> {
    const ql = (await resolveEngine()) as { findOne(object: string, query: unknown): Promise<unknown> } | undefined;
    if (!ql) throw new Error('no data engine to resolve the delegating person\'s grants from');
    const tenantId = typeof organization === 'string' && organization.length > 0 ? organization : undefined;
    if (!(await ql.findOne('sys_user', { where: { id: userId }, context: { isSystem: true } }))) {
        throw new Error('the delegating person does not exist');
    }
    const grants = await resolveUserAuthzGrants(ql as never, userId, tenantId ? { tenantId } : {});
    if (tenantId && vetOrganizationClaim(tenantId, grants.accessible_org_ids) === undefined) {
        throw new Error('the delegating person holds no membership in the request\'s organization');
    }
    return {
        userId,
        ...(tenantId ? { tenantId } : {}),
        positions: grants.positions,
        permissions: grants.permissions,
        ...(grants.permissionSetAddresses ? { permissionSetAddresses: grants.permissionSetAddresses } : {}),
        systemPermissions: grants.systemPermissions,
        principalKind: grants.principalKind ?? 'human',
        isSystem: false,
    };
}
