// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A record body's headings and the `anchor` each one is read by (ADR-0160 D3,
 * "The body"; D9, `anchor`).
 *
 * An anchor is issued by the `get_record_context` executor's body outline and
 * named again by a citation's `anchor` (`record-citation.zod.ts`). The server
 * that answers a section and a surface that opens the root record at a cited
 * anchor must derive the same anchor from the same body, so the derivation is
 * declared here once and read by both
 * (`@objectstack/service-record-context`'s `body-outline.ts` re-imports it).
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

/**
 * `text` with every tag removed; a less-than sign with no greater-than sign
 * after it is kept as text. It is how a heading element's text is read, and
 * how the citation verifier reads an `html` or `richtext` body
 * (`@objectstack/service-record-context`'s `verifyRecordCitations`), so the
 * two never disagree on what a tag is.
 *
 * It is not a sanitizer: it reads text out of markup for matching and never
 * makes markup safe to render. Entities are left encoded, and the text on
 * either side of a removed tag is joined with nothing between.
 */
export function stripBodyTags(text: string): string {
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

/** The headings of `text`, in order, each with its anchor. `html` is whether the body's field type writes HTML. */
export function headingsOf(text: string, html: boolean): BodyHeading[] {
  const raw: Array<{ heading: string; level: number; start: number }> = [];
  if (html) {
    for (const h of htmlHeadingsOf(text)) {
      const heading = decodeEntities(stripBodyTags(h.inner)).replace(/\s+/g, ' ').trim();
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
