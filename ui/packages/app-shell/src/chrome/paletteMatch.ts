/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Whether a ⌘K palette entry answers the query (objectui#11812).
 *
 * The palette's navigation entries (objects, dashboards, pages, reports, apps)
 * and its built-in commands used to be matched by cmdk's default scorer, a
 * subsequence matcher: `ingest` found "In-Progress Tasks" from letters
 * scattered across the entry, and `zzzz` found "Field Zoo" because the scorer
 * may skip a repeated query letter, so a nonsense query seldom reached
 * "No results".
 *
 * An entry now matches when the query, case-insensitive, is
 *  - the start of a word of one of the entry's terms (`field` → "Field Zoo",
 *    `zoo` → `showcase_field_zoo`), or
 *  - a contiguous substring of one of its terms, once the query is at least
 *    {@link MIN_INNER_SUBSTRING} characters long (`view` → "Task Overview").
 * Anything else scores below the minimum and is not shown. There is no typo
 * tolerance.
 *
 * Han, Hiragana and Katakana are written without spaces between words, so
 * every such character starts a word: a query of one or two Han characters
 * finds a label that holds them anywhere, not only at its start.
 *
 * Text is normalized the way cmdk normalizes it (lower case; whitespace and
 * hyphens read as a space). The palette renders only the entries this accepts,
 * and each carries its terms in its cmdk `value`, so the trimmed query is a
 * contiguous run of that value: cmdk's subsequence scorer, which still ranks
 * what is rendered and decides when "No results" shows, accepts it too.
 */

/** A substring that does not start a word counts from this many characters on. */
const MIN_INNER_SUBSTRING = 3;

/** Scripts written without spaces between words: each of their characters starts a word. */
const UNSPACED_SCRIPT = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u;

/** Letters, combining marks and digits of any script; every other character separates words. */
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s-]/g, ' ');
}

/** Whether a word starts at `index`, read by code point so a surrogate pair stays one character. */
function startsWord(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = Array.from(text.slice(0, index)).pop() ?? '';
  const current = String.fromCodePoint(text.codePointAt(index) ?? 0);
  return !WORD_CHAR.test(previous) || UNSPACED_SCRIPT.test(current);
}

function termMatches(term: string, query: string): boolean {
  if (query.length >= MIN_INNER_SUBSTRING) return term.includes(query);
  for (let at = term.indexOf(query); at !== -1; at = term.indexOf(query, at + 1)) {
    if (startsWord(term, at)) return true;
  }
  return false;
}

/**
 * True when `query` matches one of `terms` (an entry's label and its machine
 * name, say). An empty or blank query matches every entry, as cmdk shows every
 * entry before anything is typed; a missing term matches nothing.
 */
export function matchesPaletteQuery(
  query: string,
  terms: ReadonlyArray<string | null | undefined>,
): boolean {
  const q = normalize(query).trim();
  if (q === '') return true;
  return terms.some((term) => typeof term === 'string' && termMatches(normalize(term), q));
}
