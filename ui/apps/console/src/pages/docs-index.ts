/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  bookSlug,
  homeBook,
  pkgOfBook,
  resolveBookTree,
  type Book,
  type BookCard,
  type ResolverDoc,
} from './book-nav';
import { bookArticles } from './docs-reading';

/**
 * The "All documentation" page's two readings (objectstack#35424): its books
 * grouped by the apps that carry them, and the full-text search over every
 * article. Pure, so the page and its tests read the same answer.
 */

/** The members of an app record the grouping reads (`/meta/app`, as served to this caller). */
export interface DocsIndexApp {
  name: string;
  /** The app's display name, as the launcher shows it. */
  label: string;
  _packageId?: string;
  navigation?: unknown;
  areas?: unknown;
}

/** One group of the page: an app and the books it carries, or the books no app carries. */
export interface DocsIndexGroup {
  /** The app's name; `null` for the books no app carries. */
  app: string | null;
  /** The app's display name; `null` for the books no app carries (the page names that group). */
  label: string | null;
  cards: BookCard[];
}

/**
 * The platform reserves the `com.objectstack.*` package namespace for its
 * code-delivered packages (the Setup app's docs, say); see
 * `isPlatformBuiltinApp` in `@object-ui/app-shell`.
 */
const PLATFORM_PACKAGE_PREFIX = 'com.objectstack.';

function isPlatformPackage(packageId: string | undefined): boolean {
  return typeof packageId === 'string' && packageId.startsWith(PLATFORM_PACKAGE_PREFIX);
}

/** Every `type: 'doc'` navigation entry of an app, in its navigation and in every `areas[].navigation`, at every depth. */
function docEntries(app: DocsIndexApp): Array<{ book?: string; doc?: string }> {
  const out: Array<{ book?: string; doc?: string }> = [];
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items as Array<Record<string, unknown> | null>) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'doc') {
        out.push({
          book: typeof item.book === 'string' ? item.book : undefined,
          doc: typeof item.doc === 'string' ? item.doc : undefined,
        });
      }
      walk(item.children);
    }
  };
  walk(app.navigation);
  if (Array.isArray(app.areas)) {
    for (const area of app.areas as Array<Record<string, unknown> | null>) walk(area?.navigation);
  }
  return out;
}

/**
 * Group the page's book cards by the apps that carry them, in the apps' order.
 *
 * A book belongs to the first app whose navigation links to it (a `doc` entry
 * naming the book, or one of its articles; a module's navigation
 * contributions are part of the app it contributes to, as served), else to the
 * first app of the book's own package. A book no app carries goes to the
 * ungrouped group at the end, except a platform package's book
 * (`com.objectstack.*`): that one is listed only under its app, so it is not
 * listed for a caller whose app list does not include that app (the Setup app
 * is served to administrators only). This is a listing rule, not a read gate:
 * the server's audience gate (ADR-0046 §6.7) is what decides who may read a
 * doc.
 *
 * Platform apps' groups come after the others'. An implicit book (a package's
 * docs with no authored book, ADR-0046 §6.4) is named by its app instead of
 * its package id, and no card carries a package id.
 */
export function groupBooksByApp(
  books: Book[],
  cards: BookCard[],
  docs: ResolverDoc[],
  apps: DocsIndexApp[],
): DocsIndexGroup[] {
  const linked = apps.map((app) => ({ app, entries: docEntries(app) }));
  const byApp = new Map<string, BookCard[]>();
  const ungrouped: BookCard[] = [];
  const bookByName = new Map(books.map((b) => [b.name, b]));

  for (const card of cards) {
    const book = bookByName.get(card.name);
    if (!book) continue;
    const pkg = pkgOfBook(book);
    let articles: Set<string> | null = null;
    const holds = (doc: string) => {
      articles ??= new Set(bookArticles(resolveBookTree(book, docs)).map((a) => a.doc));
      return articles.has(doc);
    };
    const owner =
      linked.find(({ entries }) => entries.some((e) => (e.book ? e.book === book.name : !!e.doc && holds(e.doc))))?.app ??
      apps.find((app) => app._packageId === pkg);
    const { subtitle: _packageIdLine, ...rest } = card;
    if (!owner) {
      if (!isPlatformPackage(pkg)) ungrouped.push(rest);
      continue;
    }
    const named = book.implicit ? { ...rest, label: owner.label } : rest;
    const list = byApp.get(owner.name) ?? [];
    list.push(named);
    byApp.set(owner.name, list);
  }

  const ordered = [
    ...apps.filter((a) => !isPlatformPackage(a._packageId)),
    ...apps.filter((a) => isPlatformPackage(a._packageId)),
  ];
  const groups: DocsIndexGroup[] = [];
  for (const app of ordered) {
    const list = byApp.get(app.name);
    if (list && list.length > 0) groups.push({ app: app.name, label: app.label, cards: list });
  }
  if (ungrouped.length > 0) groups.push({ app: null, label: null, cards: ungrouped });
  return groups;
}

// ── Full-text search ─────────────────────────────────────────────────────────

/** A doc as `GET /meta/doc?include=content` serves it (already in the session language). */
export interface SearchableDoc {
  name: string;
  label?: string;
  description?: string;
  content?: string;
  packageId?: string;
}

/** A run of a snippet, marked when it is a match. */
export interface SnippetPart {
  text: string;
  match: boolean;
}

/** One search hit: the article, the book it reads in, and where the words were found. */
export interface DocSearchHit {
  doc: string;
  label: string;
  /** The reader URL segment of the article's book (`/docs/<bookSlug>/<doc>`). */
  bookSlug: string;
  bookLabel: string;
  /** The text around the first match in the body, or the summary when only the title or summary matched. */
  snippet: SnippetPart[];
}

/** Markdown reduced to the words a reader sees: no diagrams, markup, link targets or tags. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```mermaid[\s\S]*?```/g, ' ')
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The query's words: split on white space, lower-cased; blank words dropped. */
export function searchTerms(query: string): string[] {
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function countOf(hay: string, term: string): number {
  let n = 0;
  for (let at = hay.indexOf(term); at >= 0; at = hay.indexOf(term, at + term.length)) n += 1;
  return n;
}

/** `text` cut to the words around `at`, its matches of `terms` marked. */
function snippetAround(text: string, at: number, terms: string[], radius = 60): SnippetPart[] {
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius * 2);
  const cut = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  return markTerms(cut, terms);
}

/** `text` split into runs, each match of any of `terms` (case-insensitive) its own marked run. */
export function markTerms(text: string, terms: string[]): SnippetPart[] {
  const lower = text.toLocaleLowerCase();
  const parts: SnippetPart[] = [];
  let i = 0;
  let plainFrom = 0;
  while (i < text.length) {
    const term = terms.find((t) => t && lower.startsWith(t, i));
    if (term) {
      if (i > plainFrom) parts.push({ text: text.slice(plainFrom, i), match: false });
      parts.push({ text: text.slice(i, i + term.length), match: true });
      i += term.length;
      plainFrom = i;
    } else {
      i += 1;
    }
  }
  if (plainFrom < text.length) parts.push({ text: text.slice(plainFrom), match: false });
  return parts;
}

/**
 * The articles that contain every word of `query` in their title, summary or
 * body, best first: a title match outranks a summary match, which outranks the
 * body; then the more often the words occur, the higher. Only articles that
 * read in one of `listedBooks` are answered, so the search never offers a doc
 * the page itself does not list; each hit names its book as the page's card
 * does (`listedBooks` maps a listed book's name to its card label, so an
 * implicit book reads as its app, not its package).
 */
export function searchDocs(
  query: string,
  searchable: SearchableDoc[],
  books: Book[],
  docs: ResolverDoc[],
  listedBooks: ReadonlyMap<string, string>,
  limit = 50,
): DocSearchHit[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const scored: Array<{ hit: DocSearchHit; score: number }> = [];
  for (const item of searchable) {
    const label = item.label ?? item.name;
    const title = label.toLocaleLowerCase();
    const summary = (item.description ?? '').toLocaleLowerCase();
    const body = plainText(item.content ?? '');
    const bodyLower = body.toLocaleLowerCase();
    let score = 0;
    let all = true;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inSummary = summary.includes(term);
      const inBody = countOf(bodyLower, term);
      if (!inTitle && !inSummary && inBody === 0) {
        all = false;
        break;
      }
      score += (inTitle ? 100 : 0) + (inSummary ? 10 : 0) + Math.min(inBody, 20);
    }
    if (!all) continue;
    const book = homeBook(item.name, books, docs, item.packageId);
    if (!book || !listedBooks.has(book.name)) continue;
    const first = Math.min(...terms.map((t) => bodyLower.indexOf(t)).filter((at) => at >= 0));
    const snippet = Number.isFinite(first)
      ? snippetAround(body, first, terms)
      : markTerms(item.description ?? '', terms);
    scored.push({
      hit: { doc: item.name, label, bookSlug: bookSlug(book), bookLabel: listedBooks.get(book.name) ?? book.label ?? book.name, snippet },
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label));
  return scored.slice(0, limit).map((s) => s.hit);
}
