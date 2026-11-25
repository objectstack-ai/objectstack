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

// Every reader below is a forward scan: one pass over the text, no pattern
// that can backtrack. A body is author-written, so its shape is not ours to
// trust, and the outline is read before the body's length is judged.

const isBlank = (c: string): boolean => c === ' ' || c === '\t';
const isWordChar = (c: string): boolean => /^[A-Za-z0-9_]$/.test(c);
const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

/** Whether `line` opens or closes a fenced code block (``` or ~~~ after optional blanks). */
function isFence(line: string): boolean {
  let i = 0;
  while (i < line.length && isBlank(line[i])) i++;
  return line.startsWith('```', i) || line.startsWith('~~~', i);
}

/** An ATX heading's level and text, or `undefined` for any other line. */
function markdownHeadingOf(line: string): { level: number; heading: string } | undefined {
  let level = 0;
  while (level < line.length && line[level] === '#') level++;
  if (level < 1 || level > 6 || !isBlank(line[level] ?? '')) return undefined;
  let start = level;
  while (start < line.length && isBlank(line[start])) start++;
  let end = line.length;
  while (end > start && isBlank(line[end - 1])) end--;
  while (end > start && line[end - 1] === '#') end--;
  while (end > start && isBlank(line[end - 1])) end--;
  const heading = line.slice(start, end).trim();
  return heading ? { level, heading } : undefined;
}

/** `text` with every `<…>` tag removed; a `<` with no `>` after it is kept as text. */
function stripTags(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('<', i);
    if (open < 0) break;
    const close = text.indexOf('>', open + 1);
    if (close < 0) break;
    out += text.slice(i, open);
    i = close + 1;
  }
  return out + text.slice(i);
}

/**
 * The `<h1>`…`<h6>` elements of `html`, in order. Each search for a `>` or a
 * closing tag remembers where it landed, and every later search starts at or
 * after an earlier one, so the scan stays linear however many openers are
 * left unclosed.
 */
function htmlHeadingsOf(html: string): Array<{ level: number; inner: string; start: number }> {
  const lower = html.toLowerCase();
  const out: Array<{ level: number; inner: string; start: number }> = [];
  let gt = -2;
  const nextGt = (from: number): number => {
    if (gt === -1 || gt >= from) return gt;
    gt = lower.indexOf('>', from);
    return gt;
  };
  const closers = new Map<number, number>();
  const nextCloser = (level: number, from: number): { at: number; end: number } | undefined => {
    let at = closers.get(level) ?? -2;
    if (at !== -1 && at < from) {
      at = from;
      for (;;) {
        at = lower.indexOf(`</h${level}`, at);
        if (at < 0) break;
        let k = at + 4;
        while (k < lower.length && isSpace(lower[k])) k++;
        if (lower[k] === '>') break;
        at = k;
      }
      closers.set(level, at < 0 ? -1 : at);
    }
    if (at < 0) return undefined;
    let end = at + 4;
    while (end < lower.length && isSpace(lower[end])) end++;
    return { at, end: end + 1 };
  };
  let pos = 0;
  for (;;) {
    const open = lower.indexOf('<h', pos);
    if (open < 0) break;
    const level = Number(lower[open + 2]);
    const after = lower[open + 3] ?? '';
    if (!(level >= 1 && level <= 6) || isWordChar(after)) {
      pos = open + 1;
      continue;
    }
    const tagEnd = nextGt(open + 3);
    if (tagEnd < 0) break;
    const closer = nextCloser(level, tagEnd + 1);
    if (!closer) {
      pos = open + 1;
      continue;
    }
    out.push({ level, inner: html.slice(tagEnd + 1, closer.at), start: open });
    pos = closer.end;
  }
  return out;
}

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
    for (const h of htmlHeadingsOf(text)) {
      const heading = decodeEntities(stripTags(h.inner)).replace(/\s+/g, ' ').trim();
      if (heading) raw.push({ heading, level: h.level, start: h.start });
    }
  } else {
    let inFence = false;
    let offset = 0;
    for (const line of text.split('\n')) {
      if (isFence(line)) inFence = !inFence;
      else if (!inFence) {
        const m = markdownHeadingOf(line.endsWith('\r') ? line.slice(0, -1) : line);
        if (m) raw.push({ heading: m.heading, level: m.level, start: offset });
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
