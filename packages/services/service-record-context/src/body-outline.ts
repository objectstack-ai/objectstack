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
 * Headings are read the way the field type writes them: Markdown ATX headings
 * (`#` to `######` at the start of a line, outside a fenced code block) for
 * `textarea` and `markdown`, and `<h1>` to `<h6>` elements for `html` and
 * `richtext`.
 *
 * An anchor is the heading's text, lowercased, every run of characters that is
 * not a letter or a digit made one `-`, with `-2`, `-3`, … added to a repeated
 * one. It is derived from the heading alone, so an edit that renames or
 * removes a heading leaves the old anchor unresolved — refused, never answered
 * with another section.
 */

/** The most characters of body text one answer carries (whole body, section, or truncated prefix). */
export const RECORD_CONTEXT_BODY_MAX_CHARS = 8000;

/** One heading of a body. */
export interface BodyHeading {
  anchor: string;
  heading: string;
  level: number;
  /** Where the heading starts in the body text. */
  start: number;
}

const MARKDOWN_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;
const HTML_HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
const HTML_TAG = /<[^>]*>/g;

/** `heading text` → `heading-text`; letters and digits of every script kept. */
function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Whether a field type writes HTML (its headings are elements). */
export function isHtmlBodyType(type: unknown): boolean {
  return type === 'html' || type === 'richtext';
}

/** The headings of `text`, in order, each with its anchor. */
export function headingsOf(text: string, html: boolean): BodyHeading[] {
  const raw: Array<{ heading: string; level: number; start: number }> = [];
  if (html) {
    for (const m of text.matchAll(HTML_HEADING)) {
      const heading = decodeEntities(m[2].replace(HTML_TAG, '')).replace(/\s+/g, ' ').trim();
      if (heading) raw.push({ heading, level: Number(m[1]), start: m.index ?? 0 });
    }
  } else {
    let inFence = false;
    let offset = 0;
    for (const line of text.split('\n')) {
      if (FENCE.test(line)) inFence = !inFence;
      else if (!inFence) {
        const m = MARKDOWN_HEADING.exec(line.replace(/\r$/, ''));
        if (m && m[2].trim()) raw.push({ heading: m[2].trim(), level: m[1].length, start: offset });
      }
      offset += line.length + 1;
    }
  }
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = slugOf(h.heading) || `section-${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...h, anchor: n === 1 ? base : `${base}-${n}` };
  });
}

/** One section's text: from its heading to the next heading of the same or a higher level. */
export function sectionOf(text: string, headings: readonly BodyHeading[], anchor: string): string | undefined {
  const at = headings.findIndex((h) => h.anchor === anchor);
  if (at < 0) return undefined;
  const { level, start } = headings[at];
  const next = headings.slice(at + 1).find((h) => h.level <= level);
  return text.slice(start, next ? next.start : text.length);
}

/** `text` held to the bound: the text, and whether it was cut. */
export function boundedText(text: string): { text: string; truncated: boolean } {
  return text.length <= RECORD_CONTEXT_BODY_MAX_CHARS
    ? { text, truncated: false }
    : { text: text.slice(0, RECORD_CONTEXT_BODY_MAX_CHARS), truncated: true };
}
