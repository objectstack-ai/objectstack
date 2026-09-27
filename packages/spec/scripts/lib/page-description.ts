// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The frontmatter `description` of a generated reference page — the one line
 * a search result shows under the page title.
 *
 * ## Why this is a rule and not a template
 *
 * `build-docs.ts` used to write every module page as `<Title> protocol schemas`
 * and every category overview as `Complete reference for all <title> schemas`.
 * Both land far under the 70 characters a search engine keeps: measured on
 * `main`, 210 of the 211 generated pages were below it, with a median of 28.
 * A description that thin is discarded and the engine writes its own snippet
 * from body text, so the one line the page controls was wasted (#12238).
 *
 * The prose to say more already exists: the module's leading doc block, which
 * `lib/file-description.ts` selects and renders as the page's opening. This
 * module reads the SAME block (`findModuleDocBlock`) and condenses its lead
 * paragraph into one plain-text sentence group of 70–160 characters. No
 * `packages/spec/src/**` text is edited to make that possible — the source is
 * read, never rewritten.
 *
 * ## The rule, in order
 *
 * 1. **Lead** — the prose paragraphs of the doc block before its first list,
 *    table, fence or block tag, after an optional title line (a heading, or a
 *    lone line with no closing punctuation). Inline Markdown is flattened to
 *    its text; citation-only parentheticals (`(#12038)`, `[ADR-0090 D6]`), bare
 *    URLs, one-word run-in labels and the `Implements P0 requirement …`
 *    boilerplate are dropped; a sentence that only introduced a list keeps the
 *    clause before its last comma or dash, or goes.
 * 2. **Fit** — whole sentences are kept while the total stays within 160; the
 *    next paragraph joins only while the text is still under 70, and a text
 *    still under 70 is prefixed with the block's title line when that fits. A
 *    first sentence over 160 is cut at the longest clause boundary that keeps
 *    at least 70 characters and leaves no bracket open, and only when there is
 *    none, at a word boundary with an ellipsis — never mid-word.
 * 3. **Complete** — a lead that still lands under 70 is followed by the schema
 *    names the page documents (`Reference for A, B and 3 more: …`).
 * 4. **Fallback** — a module with no doc block (or a block with neither prose
 *    nor title) gets a sentence built from the module title, its category and
 *    its schema names.
 *
 * Every branch is a pure function of its inputs, so `check:docs` stays a plain
 * regenerate-and-compare.
 */

import { findModuleDocBlock } from './file-description';

/** The shortest description a search result keeps rather than rewrites. */
export const DESCRIPTION_MIN = 70;
/** The longest description a search result shows before truncating it. */
export const DESCRIPTION_MAX = 160;

const ELLIPSIS = '…';

/** A line that ends the lead search: a list item, table row, fence or block tag. */
const STRUCTURAL = /^(?:[-*+]\s|\d+[.)]\s|\||```|~~~|@\w|<)/;
const HEADING = /^#{1,6}\s+/;

/** The doc block's lines with the ` * ` gutter removed, trimmed. */
function stripGutter(block: string): string[] {
  return block
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, '').trim())
    // Selector machinery (`@module`, `@category`, the skill-example marker) is
    // not content — the same lines `lib/file-description.ts` drops from the page.
    .filter(line => !/^@(?:module|category)\b/.test(line) && line !== '<!-- os:check -->');
}

/** Split lines into blank-separated paragraphs. */
function paragraphs(lines: readonly string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (line === '') {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Inline Markdown / JSDoc flattened to the text a reader sees, with
 * tracker-only parentheticals removed. A description is plain text: the
 * search result shows backticks and asterisks literally.
 */
export function flattenInline(text: string): string {
  return (
    text
      // {@link Target} / {@link Target | label} / {@link Target label}
      .replace(/\{@link(?:code|plain)?\s+([^}|\s]+)(?:\s*\|\s*|\s+)?([^}]*)\}/g, (_m, target: string, label: string) =>
        label.trim() || target,
      )
      // [label](url) → label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // **bold** / __bold__ → bold
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      // *em* → em (only when it wraps a word, never a lone multiplication sign)
      .replace(/(^|[\s(])\*(\S[^*]*?\S|\S)\*(?=[\s).,;:!?]|$)/g, '$1$2')
      // `code` → code
      .replace(/`([^`]*)`/g, '$1')
      // (#123), (cloud#2172 ruling A), (ADR-0112 D3), [#10235] — citations, not content
      .replace(/\s*\((?=[^()]*(?:#\d|ADR-\d))[^()]*\)/g, '')
      .replace(/\s*\[(?=[^\][]*(?:#\d|ADR-\d))[^\][]*\]/g, '')
      // (https://…) — a bare URL is not something a search result can use
      .replace(/\s*\(https?:\/\/[^()\s]*\)/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim()
  );
}

/**
 * Whether a paragraph is a label rather than prose: a heading, or a lone line
 * with no closing punctuation (`Studio Plugin Protocol`, `Shared by: Connector`).
 */
function isLabelParagraph(para: readonly string[]): boolean {
  if (HEADING.test(para[0])) return true;
  return para.length === 1 && !/[.!?:;]$/.test(para[0]) && para[0].length <= 90;
}

/**
 * Sentences that describe the repo's planning, not the page — `Implements P0
 * requirement for ObjectStack kernel.` sits in a dozen module headers and
 * tells a reader nothing.
 */
const PLANNING_SENTENCE = /^Implements P\d(?:\/P\d)? requirements?\b/;

export interface DocBlockLead {
  /** The block's first label line, flattened, when it has one. */
  title: string | null;
  /**
   * The prose paragraphs before the first list, table, fence or tag,
   * flattened, in order. Empty when the block opens straight into structure.
   */
  paragraphs: string[];
}

/** A flattened paragraph without the sentence that introduced a list below it. */
function withoutListIntro(prose: string, ranIntoList: boolean): string {
  // A one-word sentence (`Background.`) is a run-in label, not content.
  const kept = sentences(prose).filter(s => !PLANNING_SENTENCE.test(s) && /\s/.test(s));
  const last = kept[kept.length - 1] ?? '';
  if (ranIntoList || /:$/.test(last)) {
    // The sentence that ran into the list ends mid-thought once the list is
    // gone. Its clause before the last comma or dash usually still stands
    // (`…for the plugin marketplace ecosystem, covering:`); otherwise it goes.
    kept.pop();
    const clause = /^(.*\S)(?:,\s|\s[—–]\s)[^,—–]*$/.exec(last);
    if (clause && balanced(clause[1])) kept.push(`${clause[1]}.`);
  }
  return kept.join(' ');
}

/** The label line and lead prose of a module doc block's inner text. */
export function docBlockLead(inner: string): DocBlockLead {
  const paras = paragraphs(stripGutter(inner));
  let title: string | null = null;
  const prose: string[] = [];
  for (const para of paras) {
    if (STRUCTURAL.test(para[0])) break;
    if (isLabelParagraph(para)) {
      if (title === null && prose.length === 0) title = flattenInline(para[0].replace(HEADING, '')) || null;
      if (HEADING.test(para[0]) && prose.length > 0) break; // a new section starts
      continue;
    }
    // A paragraph that runs into a list keeps only its lines above the list.
    const cut = para.findIndex(line => STRUCTURAL.test(line));
    const text = withoutListIntro(flattenInline((cut === -1 ? para : para.slice(0, cut)).join(' ')), cut !== -1);
    if (text) prose.push(text);
    if (cut !== -1) break;
  }
  return { title, paragraphs: prose };
}

/** Sentences of a flattened paragraph, each keeping its closing punctuation. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Whether every bracket and quote opened in `text` is closed again. */
function balanced(text: string): boolean {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return count(/\(/g) === count(/\)/g) && count(/\[/g) === count(/\]/g) && count(/"/g) % 2 === 0;
}

/**
 * An over-long sentence shortened. First choice: the longest prefix ending at
 * a clause boundary (a dash, semicolon, colon, comma or opening parenthesis)
 * that is still at least the minimum and leaves nothing open — a clause is
 * still a sentence. Only when no clause fits is it cut at a word boundary, with
 * an ellipsis so the cut is visible.
 */
function shorten(text: string, max: number): string {
  const boundary = /\s[—–]\s|;\s|:\s|,\s|\s\(/g;
  let best: string | null = null;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
    const head = text.slice(0, m.index).replace(/[\s,;:]+$/, '');
    if (head.length + 1 > max) break;
    if (head.length + 1 >= DESCRIPTION_MIN && balanced(head)) best = `${head}.`;
  }
  if (best) return best;
  const room = text.slice(0, max - ELLIPSIS.length + 1);
  const space = room.lastIndexOf(' ');
  const head = (space > 0 ? room.slice(0, space) : room.slice(0, max - ELLIPSIS.length))
    .replace(/[\s,;:—–-]+$/, '');
  return head + ELLIPSIS;
}

/** A sentence ends in terminal punctuation; a trailing colon introduced a list the page shows. */
function asSentence(text: string): string {
  const t = text.replace(/[\s:;,—–-]+$/, '');
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * Whole sentences of `lead` within `max`, or — when even the first one is
 * longer — that sentence cut at a word boundary.
 */
export function fitSentences(lead: string, max = DESCRIPTION_MAX): string {
  const all = sentences(lead);
  let out = '';
  for (const s of all) {
    const next = out ? `${out} ${asSentence(s)}` : asSentence(s);
    if (next.length > max) break;
    out = next;
  }
  return out || shorten(asSentence(all[0] ?? lead), max);
}

/** Whether a description is inside the searchable range. */
export function inRange(description: string): boolean {
  return description.length >= DESCRIPTION_MIN && description.length <= DESCRIPTION_MAX;
}

/**
 * The description a module doc block yields on its own — in range, or SHORT
 * when the block says too little — or `null` when it holds no prose and no
 * title at all.
 */
export function describeFromDocBlock(inner: string): string | null {
  const { title, paragraphs: prose } = docBlockLead(inner);
  if (prose.length === 0) return title ? asSentence(title) : null;
  // The first paragraph alone, unless it is too thin — then the next ones join.
  let text = fitSentences(prose[0]);
  for (let i = 1; text.length < DESCRIPTION_MIN && i < prose.length; i++) {
    text = fitSentences(prose.slice(0, i + 1).join(' '));
  }
  if (text.length < DESCRIPTION_MIN && title && !text.toLowerCase().startsWith(title.toLowerCase())) {
    const titled = `${title} — ${text}`;
    if (titled.length <= DESCRIPTION_MAX) text = titled;
  }
  return text;
}

export interface ModulePage {
  /** The page title, e.g. `Object` for `object.zod.ts`. */
  title: string;
  /** The category's display title, e.g. `Data Protocol`. */
  categoryTitle: string;
  /** The schema names the page documents, in page order. */
  schemaNames: readonly string[];
}

/**
 * The longest `build(shown, more)` within the maximum: schema names are the
 * words a reader searches for, so as many are listed as fit, the rest counted.
 */
function withNames(names: readonly string[], build: (list: string | null) => string): string {
  for (let n = names.length; n > 0; n--) {
    const more = names.length - n;
    const list = more > 0 ? `${names.slice(0, n).join(', ')} and ${more} more` : names.slice(0, n).join(', ');
    const text = build(list);
    if (text.length <= DESCRIPTION_MAX) return text;
  }
  return build(null);
}

/** The fallback for a module with no usable doc block: what the page documents, named. */
export function describeFromSchemas(page: ModulePage): string {
  const head = `${page.title} schemas of the ObjectStack ${page.categoryTitle}`;
  const tail = ' — each property with its type, default and a TypeScript example.';
  const text = withNames(page.schemaNames, list => (list ? `${head}: ${list}${tail}` : `${head}${tail}`));
  return text.length <= DESCRIPTION_MAX ? text : shorten(text, DESCRIPTION_MAX);
}

/** A doc-block sentence too short to stand alone, completed with what the page documents. */
export function completeWithSchemas(lead: string, page: ModulePage): string {
  const text = withNames(page.schemaNames, list =>
    list
      ? `${lead} Reference for ${list}: every property with its type and default.`
      : `${lead} Reference for every ${page.title} property with its type and default.`,
  );
  return text.length <= DESCRIPTION_MAX ? text : shorten(text, DESCRIPTION_MAX);
}

export type DescriptionSource = 'docblock' | 'docblock+schemas' | 'schemas';

/**
 * A module page's description: its doc block when that yields one in range, the
 * doc block's short lead completed with the schema names when it is too thin,
 * and the schema-name fallback when there is no doc block to read.
 */
export function modulePageDescription(
  source: string | null,
  page: ModulePage,
): { text: string; from: DescriptionSource } {
  const block = source === null ? null : findModuleDocBlock(source);
  const lead = block === null ? null : describeFromDocBlock(block);
  if (lead && inRange(lead)) return { text: lead, from: 'docblock' };
  if (lead) return { text: completeWithSchemas(lead, page), from: 'docblock+schemas' };
  return { text: describeFromSchemas(page), from: 'schemas' };
}

/** A category overview's description. */
export function categoryIndexDescription(categoryTitle: string, pageCount: number): string {
  const pages = pageCount === 1 ? '1 reference page' : `${pageCount} reference pages`;
  return `The ObjectStack ${categoryTitle} in ${pages}: every schema in @objectstack/spec with its properties, types, defaults and a TypeScript example.`;
}

/**
 * A description as a YAML scalar. Always double-quoted: the text comes from
 * prose that may contain `: `, ` #` or a leading quote, each of which changes
 * what a plain scalar means. JSON's string syntax is a subset of YAML's
 * double-quoted style.
 */
export function yamlDescription(text: string): string {
  return JSON.stringify(text);
}
