// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D3, "The body"] A record's body, whole, as an outline, or one
 * section of it.
 *
 * A body within {@link RECORD_CONTEXT_BODY_MAX_CHARS} is carried whole. A
 * longer one is carried as an outline: its headings in order, each with an
 * `anchor`, and one section is read by calling the tool again with that
 * anchor. A long body with no headings is carried up to the bound and marked
 * truncated.
 *
 * An outline lists at most {@link RECORD_CONTEXT_OUTLINE_MAX_ENTRIES} headings,
 * and its listing serialized stays within {@link RECORD_CONTEXT_BODY_MAX_CHARS},
 * whatever the body holds; a cut is stated. The cap bounds one answer, not which
 * headings are listed: an outline past it comes in pages, the next one listed
 * by calling the tool again with the `outlineFrom` the cut answer gave, so every
 * heading is listed, with its anchor, on exactly one page however many the body
 * holds. Every heading's anchor reads its section, listed on this page or not.
 *
 * Which lines and elements are headings, and the anchor each one is read by,
 * are the spec's `headingsOf` (`@objectstack/spec/ai`, `record-body-anchor.ts`):
 * a citation's `anchor` names the same heading a surface opens (ADR-0160 D9).
 */

import { headingsOf, type BodyHeading } from '@objectstack/spec/ai';

/**
 * The most characters of body text one answer carries (whole body, section, or
 * truncated prefix). An outline's listing, serialized, is held to it too.
 */
export const RECORD_CONTEXT_BODY_MAX_CHARS = 8000;

/**
 * The most headings one outline page lists. A body with more is listed in
 * pages, shallowest level first, each page saying how many it left out and
 * where the next starts ({@link boundedOutline}).
 *
 * Chosen by measurement: an entry serializes to about 95 characters on average
 * (the 543 Markdown documents of this repository past the body bound that have
 * headings), so 80 entries is about 7,600 characters — an outline answer the
 * size of the body bound. Under both bounds, 527 of those 543 are listed uncut.
 */
export const RECORD_CONTEXT_OUTLINE_MAX_ENTRIES = 80;

// The headings and their anchors are the spec's (`@objectstack/spec/ai`,
// `record-body-anchor.ts`), so this service and a surface that opens a record
// at a cited anchor derive one anchor from one body (ADR-0160 D9).
export { headingsOf };
export type { BodyHeading };

/** Whether a field type writes HTML (its headings are elements). */
export function isHtmlBodyType(type: unknown): boolean {
  return type === 'html' || type === 'richtext';
}

/** One section's text: from its heading to the next heading of the same or a higher level. */
export function sectionOf(text: string, headings: readonly BodyHeading[], anchor: string): string | undefined {
  const at = headings.findIndex((h) => h.anchor === anchor);
  if (at < 0) return undefined;
  const { level, start } = headings[at];
  const next = headings.slice(at + 1).find((h) => h.level <= level);
  return text.slice(start, next ? next.start : text.length);
}

/** One outline entry, as the answer carries it. */
export interface BodyOutlineEntry {
  anchor: string;
  heading: string;
  level: number;
}

/** One page of an outline, and where the next page starts. */
export interface BoundedOutline {
  /** This page's headings, in body order. */
  outline: BodyOutlineEntry[];
  /** How many of the body's headings this page does not list (on earlier pages or later ones). */
  omitted: number;
  /** Where the next page starts, as `outlineFrom`: present only when headings remain past this page. */
  next?: number;
}

/**
 * One page of the outline of `headings`, held to
 * {@link RECORD_CONTEXT_OUTLINE_MAX_ENTRIES} entries and to
 * {@link RECORD_CONTEXT_BODY_MAX_CHARS} serialized characters.
 *
 * The pages run through every heading in one order: shallowest level first,
 * in body order within a level. A page takes that order from position `from`
 * (0, the first page, by default) until the next heading would pass either
 * bound, and lists what it took in body order. So the first page of a nested
 * body is its top levels, and a cut leaves out the deepest headings first; a
 * flat body's pages are runs of it in body order. Each heading is on exactly
 * one page, so following `next` from the first page lists every heading.
 * Every anchor is the one {@link headingsOf} gave, so a listed anchor is the
 * same on whichever page and whether or not the outline was cut.
 *
 * A heading too long to list on a page by itself ends the pages there: the
 * page that would start with it lists nothing and gives no `next`.
 */
export function boundedOutline(headings: readonly BodyHeading[], from = 0): BoundedOutline {
  const byLevel = headings.map((h, index) => ({ h, index })).sort((a, b) => a.h.level - b.h.level || a.index - b.index);
  const admitted: Array<{ entry: BodyOutlineEntry; index: number }> = [];
  // `[` and `]`, then one `,` between entries.
  let chars = 2;
  for (const { h, index } of byLevel.slice(from)) {
    if (admitted.length >= RECORD_CONTEXT_OUTLINE_MAX_ENTRIES) break;
    const entry = { anchor: h.anchor, heading: h.heading, level: h.level };
    const cost = JSON.stringify(entry).length + (admitted.length > 0 ? 1 : 0);
    if (chars + cost > RECORD_CONTEXT_BODY_MAX_CHARS) break;
    chars += cost;
    admitted.push({ entry, index });
  }
  const end = from + admitted.length;
  admitted.sort((a, b) => a.index - b.index);
  return {
    outline: admitted.map((a) => a.entry),
    omitted: headings.length - admitted.length,
    ...(admitted.length > 0 && end < headings.length ? { next: end } : {}),
  };
}

/** `text` held to the bound: the text, and whether it was cut. */
export function boundedText(text: string): { text: string; truncated: boolean } {
  return text.length <= RECORD_CONTEXT_BODY_MAX_CHARS
    ? { text, truncated: false }
    : { text: text.slice(0, RECORD_CONTEXT_BODY_MAX_CHARS), truncated: true };
}
