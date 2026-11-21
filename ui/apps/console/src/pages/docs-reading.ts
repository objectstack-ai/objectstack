/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ResolvedBook, ResolvedEntry, ResolvedGroup } from './book-nav';

/**
 * Reading-order helpers for the docs reader (objectstack#35424): the previous
 * and next article of a book, and the docs column's title filter. Pure, so the
 * reader and its tests read the same answer.
 */

/** One article of a book, in reading order. */
export interface BookArticle {
  doc: string;
  label: string;
}

/**
 * The book's articles in reading order: every doc entry of every group, a doc
 * placed twice counted once (its first place). External links and separators
 * are not articles.
 */
export function bookArticles(book: ResolvedBook): BookArticle[] {
  const seen = new Set<string>();
  const out: BookArticle[] = [];
  for (const group of book.groups) {
    for (const entry of group.entries) {
      if (!entry.doc || entry.separator || seen.has(entry.doc)) continue;
      seen.add(entry.doc);
      out.push({ doc: entry.doc, label: entry.label ?? entry.doc });
    }
  }
  return out;
}

/** The articles before and after `doc` in its book; `null` at either end, or when the book does not hold it. */
export function articleNeighbours(
  book: ResolvedBook,
  doc: string | undefined,
): { previous: BookArticle | null; next: BookArticle | null } {
  const articles = bookArticles(book);
  const at = doc ? articles.findIndex((a) => a.doc === doc) : -1;
  if (at < 0) return { previous: null, next: null };
  return { previous: articles[at - 1] ?? null, next: articles[at + 1] ?? null };
}

/** Does `entry` match the docs column's filter (its title or summary, case-insensitive)? */
function entryMatches(entry: ResolvedEntry, needle: string): boolean {
  if (!entry.doc || entry.separator) return false;
  const hay = `${entry.label ?? entry.doc} ${entry.description ?? ''}`.toLocaleLowerCase();
  return hay.includes(needle);
}

/**
 * The book narrowed to the articles whose title or summary contains `query`:
 * groups left empty are dropped, separators and external links go. A blank
 * query answers the book unchanged.
 */
export function filterBookArticles(book: ResolvedBook, query: string): ResolvedBook {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return book;
  const groups: ResolvedGroup[] = [];
  for (const group of book.groups) {
    const entries = group.entries.filter((e) => entryMatches(e, needle));
    if (entries.length > 0) groups.push({ ...group, entries });
  }
  return { ...book, groups };
}
