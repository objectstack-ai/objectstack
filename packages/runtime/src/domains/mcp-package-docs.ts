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
 * rule: this module hands the gate I/O only, as `mcp-authoring.ts` does for
 * the open draft door's reads, and every verdict is the gate's. A page the
 * caller may not read is neither found nor read, and reads as not found.
 *
 * ## The search
 *
 * No server-side doc search exists, so the search is the smallest honest one:
 * a term is found when a page's title, one of its headings or its text
 * contains it, case aside, in the page's base text or one of its
 * translations. Pages rank by how many terms they contain, then by where (the
 * title over a heading over the text), then by title; the answer carries at
 * most `maxResults` and says when more matched. The match rule and the cap
 * are stated in the tool's description (`registerPackageDocTools`).
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

/** A page's title: its label, else its first heading, else its name. */
function titleOf(label: unknown, content: unknown, name: string): string {
    if (typeof label === 'string' && label.trim()) return label.trim();
    const heading = typeof content === 'string' ? /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(content)?.[1] : undefined;
    return heading?.trim() || name;
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
}

function variantsOf(doc: any): PageVariant[] {
    const base: PageVariant = {
        title: titleOf(doc.label, doc.content, doc.name),
        ...(typeof doc.description === 'string' ? { description: doc.description } : {}),
        content: typeof doc.content === 'string' ? doc.content : '',
    };
    const out = [base];
    const translations = doc.translations && typeof doc.translations === 'object' ? doc.translations : {};
    for (const [locale, t] of Object.entries<any>(translations)) {
        if (!t || typeof t.content !== 'string') continue;
        out.push({
            locale,
            title: titleOf(t.label ?? doc.label, t.content, doc.name),
            ...(typeof (t.description ?? doc.description) === 'string' ? { description: t.description ?? doc.description } : {}),
            content: t.content,
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

/** The heading a position in `content` sits under, if any. */
function headingAbove(content: string, at: number): string | undefined {
    let heading: string | undefined;
    const re = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
    for (let m = re.exec(content); m && m.index <= at; m = re.exec(content)) heading = m[1].trim();
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
    const re = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
    for (let m = re.exec(variant.content); m; m = re.exec(variant.content)) {
        if (m[1].toLowerCase().includes(needle)) {
            return { on: 'heading', heading: m[1].trim(), excerpt: excerptAround(variant.content, m.index, m[0].length) };
        }
    }
    const at = lower.indexOf(needle);
    if (at >= 0) {
        const heading = headingAbove(variant.content, at);
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
            const title = titleOf(served.label, served.content, doc.name);
            return {
                ...addressOf(doc, books, corpusOf(docs), title),
                ...(typeof served.description === 'string' ? { description: served.description } : {}),
                ...(servedLocale ? { locale: servedLocale } : {}),
                content: typeof served.content === 'string' ? served.content : '',
            };
        },
    };
}

/** The `/meta` read gates' ports over `protocol`, with `caller` as the caller: I/O only. */
export function packageDocsReadGate(
    protocol: PackageDocsProtocol,
    caller: MetaReadGateCaller | undefined,
    resolveService: (name: string) => Promise<unknown>,
): MetaItemReadGateSources {
    return {
        resolveCaller: async () => caller,
        resolveSecurityService: async () => (await resolveService('security')) as Awaited<ReturnType<MetaItemReadGateSources['resolveSecurityService']>>,
        listMetaItems: (type) => protocol.getMetaItems({ type }),
        // Only the `app` and `dashboard` arms probe services or log nav prunes;
        // the `doc` and `book` arms these members read do neither.
        serviceProbe: () => null,
        navPruneLogged: new Set<string>(),
    };
}
