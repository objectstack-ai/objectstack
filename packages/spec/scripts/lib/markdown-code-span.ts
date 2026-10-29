// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A Markdown code span that holds ANY one-line text, backticks included.
 *
 * CommonMark §6.1: a code span opens with a backtick string and closes at the
 * next backtick string of the SAME length. So a single-backtick span closes at
 * the first backtick inside it — which is what broke the protocol upgrade
 * guide: a `surface` the entry author wrote with its own inline code
 * (`` `globalFilters` on a view ``) was wrapped in one more single-backtick
 * span and rendered as alternating code and prose fragments. The fix is the
 * rule the spec gives for exactly this: fence the text with a backtick string
 * one longer than the longest run inside it, and pad with one space when the
 * text starts or ends with a backtick or a space (the renderer strips one
 * space from each end when both are present, so the pad is what it strips).
 *
 * `readCodeSpan` is the READING half of the same rule, kept here so the pin
 * over the real registries can decode what the generator wrote without
 * repeating the generator's format: a span is unbroken when the reader gets
 * the author's text back.
 */

/** Longest run of backticks in `text` (0 when it has none). */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * `text` as one code span, whatever backticks it carries. Byte-identical to
 * `` `${text}` `` for a text with no backtick and no leading or trailing space,
 * so the common case does not move. Refuses a blank or multi-line text, naming
 * `subject` (the entry, for the generator) in the refusal: a code span cannot
 * say nothing, and a line ending renders as a space inside the span and, in a
 * table row, ends the row.
 */
export function codeSpan(text: string, subject = 'codeSpan'): string {
  if (text.trim() === '') throw new Error(`${subject}: a code span cannot hold a blank text.`);
  if (/[\r\n]/.test(text)) throw new Error(`${subject}: a code span holds one line; got ${JSON.stringify(text)}.`);
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  const pad = /^[` ]|[` ]$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** A backtick string: one or more backticks neither preceded nor followed by a backtick. */
function backtickStringLengthAt(markdown: string, at: number): number {
  if (markdown[at] !== '`' || (at > 0 && markdown[at - 1] === '`')) return 0;
  let end = at;
  while (markdown[end] === '`') end++;
  return end - at;
}

/**
 * The code span that opens at `at` in `markdown`, read by CommonMark's rule:
 * its content (line endings as spaces; one space stripped from each end when
 * both ends are spaces and the content is not spaces only), and the index just
 * past its closing backtick string. `null` when no backtick string of the
 * opening length follows — the opener is then literal backticks, not a span.
 */
export function readCodeSpan(markdown: string, at: number): { content: string; end: number } | null {
  const open = backtickStringLengthAt(markdown, at);
  if (open === 0) return null;
  let i = at + open;
  while (i < markdown.length) {
    if (markdown[i] !== '`') {
      i++;
      continue;
    }
    const run = backtickStringLengthAt(markdown, i);
    if (run === open) {
      let content = markdown.slice(at + open, i).replace(/\r\n?|\n/g, ' ');
      if (content.startsWith(' ') && content.endsWith(' ') && !/^ +$/.test(content)) content = content.slice(1, -1);
      return { content, end: i + run };
    }
    i += run;
  }
  return null;
}
