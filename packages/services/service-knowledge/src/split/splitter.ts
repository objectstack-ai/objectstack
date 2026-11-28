// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The knowledge service's ONE splitter (ADR-0161 K1, "Structural split"; the
 * strategies are #37098's). The service cuts a document into passages here,
 * once, and hands the same passages to every adapter that declares
 * `capabilities.chunks` — so one source gives the same passages on each of
 * them.
 *
 * Three strategies, chosen by the object source's `split.strategy`:
 *
 * - `whole` — one passage per document. A document whose token estimate is
 *   over the budget is NOT cut or truncated: {@link splitDocument} answers a
 *   failure and the service removes the document from the index and reports it.
 * - `recursive` — blank line → line break → sentence end → semicolon →
 *   character, the next level only for a piece the level above left too long.
 *   A Markdown table or list item is one unit while it fits. Adjacent pieces
 *   are merged while the merged piece is shorter than `minChars`.
 * - `markdown` — one section per ATX heading (outside code fences); each
 *   section is cut as `recursive` cuts, and every passage begins with its
 *   heading path, which counts toward its length and is embedded with it.
 *
 * ## The sentence end (the Chinese-aware part)
 *
 * `。？！` end a sentence wherever they stand. `. ? !` end one only before
 * whitespace or the end of the text, so 「3.2 条」 and 「400.50 元」 stay whole.
 * A run of end marks ends one sentence (`？！`, `...`). An end mark followed by
 * a closing quote or bracket ends nothing — the split never falls right after
 * a closing quote or bracket, so quoted speech stays inside its sentence.
 * `；` ends a clause wherever it stands, `;` only before whitespace or the end.
 *
 * ## Bounds
 *
 * Every passage is at most `maxChars` characters (UTF-16 code units, trimmed),
 * and, when the embedder's limit is known, its `estimateTokens` is at most
 * `maxTokens` (80% of the limit — {@link resolveSplit}). A unit that fits no
 * other way is cut by characters, on code-point boundaries, so the bound
 * holds for every passage the splitter returns. A table that does not fit is
 * cut between rows, each piece repeating the header row (and its separator
 * row); a list item that does not fit is cut as a paragraph.
 *
 * Pure: reads nothing but its arguments.
 */

import { estimateTokens } from '@objectstack/spec/shared';
import type { KnowledgeChunk, KnowledgeSplit, KnowledgeSplitStrategy } from '@objectstack/spec/ai';

/** `maxChars` when neither the source nor the settings page sets one. */
export const DEFAULT_SPLIT_MAX_CHARS = 800;

/** `minChars` when the source sets none. */
export const DEFAULT_SPLIT_MIN_CHARS = 200;

/** The share of the embedder's input limit a passage may fill, by `estimateTokens`. */
export const SPLIT_TOKEN_BUDGET_SHARE = 0.8;

/**
 * The version of this splitter's algorithm — one of the index fingerprint's
 * components (ADR-0161 K7). Bump it in the change that makes the splitter
 * give different passages for the same text and the same resolved split:
 * every index built by an adapter that takes chunks then reads as built under
 * another fingerprint, and is rebuilt as a new generation rather than mixing
 * old passages with new ones.
 */
export const SPLIT_ALGORITHM_VERSION = 1;

/** The split a source resolves to: what {@link splitDocument} cuts by. */
export interface ResolvedSplit {
  strategy: KnowledgeSplitStrategy;
  /** Longest passage, in characters. Not read by `whole`. */
  maxChars: number;
  /** Adjacent pieces shorter than this are merged. Never above `maxChars`. */
  minChars: number;
  /** Largest `estimateTokens` of a passage; absent when no limit is known. */
  maxTokens?: number;
}

/** Inputs of {@link resolveSplit}, highest precedence first for `maxChars`. */
export interface ResolveSplitInput {
  /** The object source's own `split` key. */
  split?: KnowledgeSplit;
  /** The settings page's `knowledge.chunk_target`. */
  chunkTarget?: number;
  /** The adapter's `embedding.maxInputTokens`. */
  maxInputTokens?: number;
}

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/**
 * Resolve the split: `maxChars` is the source's `split.maxChars`, else the
 * settings page's `chunk_target`, else {@link DEFAULT_SPLIT_MAX_CHARS}; the
 * token budget is {@link SPLIT_TOKEN_BUDGET_SHARE} of the embedder's limit, by
 * the shared estimate, and absent when no limit is known. A passage keeps both
 * bounds, so the effective length is the smaller of the two. An omitted
 * strategy is `recursive`.
 */
export function resolveSplit(input: ResolveSplitInput): ResolvedSplit {
  const maxChars = isPositiveInt(input.split?.maxChars)
    ? input.split.maxChars
    : isPositiveInt(input.chunkTarget) ? input.chunkTarget : DEFAULT_SPLIT_MAX_CHARS;
  const requestedMin = typeof input.split?.minChars === 'number' && input.split.minChars >= 0
    ? Math.floor(input.split.minChars)
    : DEFAULT_SPLIT_MIN_CHARS;
  const resolved: ResolvedSplit = {
    strategy: input.split?.strategy ?? 'recursive',
    maxChars,
    minChars: Math.min(requestedMin, maxChars),
  };
  if (isPositiveInt(input.maxInputTokens)) {
    resolved.maxTokens = Math.max(1, Math.floor(input.maxInputTokens * SPLIT_TOKEN_BUDGET_SHARE));
  }
  return resolved;
}

/** What {@link splitDocument} answers. */
export type SplitOutcome =
  | { ok: true; chunks: KnowledgeChunk[] }
  | {
    ok: false;
    /** Why the document cannot be indexed under its split, for the reindex result and the log. */
    reason: string;
    /** The document's token estimate. */
    estimate: number;
    /** The budget it is over ({@link ResolvedSplit.maxTokens}). */
    budget: number;
  };

/**
 * Cut one document into passages. Each passage's `id` is
 * `${documentId}#${index}`. A document with no text but whitespace has no
 * passage. Only `whole` can fail: over the token budget.
 */
export function splitDocument(doc: { id: string; content: string }, split: ResolvedSplit): SplitOutcome {
  const bounds: Bounds = { maxChars: split.maxChars, maxTokens: split.maxTokens };
  let pieces: Array<{ content: string; headingPath?: string[] }>;
  if (split.strategy === 'whole') {
    const content = doc.content.trim();
    if (content === '') return { ok: true, chunks: [] };
    if (split.maxTokens !== undefined) {
      const estimate = estimateTokens(content);
      if (estimate > split.maxTokens) {
        return {
          ok: false,
          estimate,
          budget: split.maxTokens,
          reason:
            `the whole document estimates ${estimate} tokens, over the embedder's input budget of ${split.maxTokens} ` +
            `(${Math.round(SPLIT_TOKEN_BUDGET_SHARE * 100)}% of its limit); split 'whole' does not truncate. ` +
            "Choose split strategy 'recursive' or 'markdown' for this source, or shorten the document.",
        };
      }
    }
    pieces = [{ content }];
  } else if (split.strategy === 'markdown') {
    pieces = splitMarkdown(doc.content, bounds, split.minChars);
  } else {
    pieces = splitRecursive(doc.content, bounds, split.minChars).map((content) => ({ content }));
  }
  return {
    ok: true,
    chunks: pieces.map((p, index) => ({
      id: `${doc.id}#${index}`,
      documentId: doc.id,
      index,
      content: p.content,
      ...(p.headingPath && p.headingPath.length > 0 ? { headingPath: p.headingPath } : {}),
    })),
  };
}

// ── Bounds ───────────────────────────────────────────────────────────

interface Bounds {
  maxChars: number;
  maxTokens?: number;
}

function fits(text: string, b: Bounds): boolean {
  const t = text.trim();
  if (t.length > b.maxChars) return false;
  return b.maxTokens === undefined || estimateTokens(t) <= b.maxTokens;
}

// ── recursive ────────────────────────────────────────────────────────

/**
 * The `recursive` strategy over `text`: trimmed passages, none empty, each
 * within `b`. Pieces are slices of `text` (a cut table's pieces repeat its
 * header), so the passages read in order give back the text.
 */
export function splitRecursive(text: string, b: Bounds, minChars: number): string[] {
  const pieces: Piece[] = [];
  toBlocks(text).forEach((block, n) => {
    const parts = fits(block.text, b)
      ? [block.text]
      : block.kind === 'table' ? splitTable(block.text, b) : splitDown(block.text, b, 0);
    for (const part of parts) pieces.push({ text: part, block: n, whole: parts.length === 1 });
  });
  return mergeShort(pieces, b, minChars);
}

/** A piece and the block it came from; `whole` when the block was not cut. */
interface Piece {
  text: string;
  block: number;
  whole: boolean;
}

type Level = (text: string) => string[];

/** Below the block level: line → sentence → semicolon → character. */
const LEVELS: Level[] = [splitLines, splitSentences, splitClauses];

function splitDown(text: string, b: Bounds, level: number): string[] {
  if (fits(text, b)) return [text];
  if (level >= LEVELS.length) return cutByCharacters(text, b);
  const parts = LEVELS[level](text);
  if (parts.length <= 1) return splitDown(text, b, level + 1);
  const out: string[] = [];
  for (const part of parts) out.push(...(fits(part, b) ? [part] : splitDown(part, b, level + 1)));
  return out;
}

/**
 * Adjacent pieces merged while the merged piece is shorter than `minChars`
 * and still fits; a short last piece joins the one before when it fits.
 * Pieces of one block always may merge. Across blocks, a piece joins only a
 * run made of whole blocks: a short title block leads the text after it,
 * and the tail of a cut block never takes the next block (a chapter title
 * stays with its own chapter). Every passage is trimmed; none is empty.
 */
function mergeShort(pieces: Piece[], b: Bounds, minChars: number): string[] {
  interface Run { text: string; lastBlock: number; allWhole: boolean }
  const out: Run[] = [];
  let run: Run | undefined;
  const joinable = (into: Run, p: Piece): boolean =>
    (p.block === into.lastBlock || into.allWhole)
    && into.text.trim().length < minChars
    && fits(into.text + p.text, b);
  for (const p of pieces) {
    if (run === undefined || run.text.trim() === '') {
      run = run === undefined
        ? { text: p.text, lastBlock: p.block, allWhole: p.whole }
        : { text: run.text + p.text, lastBlock: p.block, allWhole: p.whole };
      continue;
    }
    if (p.text.trim() === '') {
      run.text += p.text;
      continue;
    }
    if (joinable(run, p)) {
      run = { text: run.text + p.text, lastBlock: p.block, allWhole: run.allWhole && p.whole };
    } else {
      out.push(run);
      run = { text: p.text, lastBlock: p.block, allWhole: p.whole };
    }
  }
  if (run !== undefined && run.text.trim() !== '') {
    const prev = out[out.length - 1];
    const tailJoins = prev !== undefined
      && run.text.trim().length < minChars
      && (prev.lastBlock === run.lastBlock || (prev.allWhole && run.allWhole))
      && fits(prev.text + run.text, b);
    if (tailJoins) prev.text += run.text;
    else out.push(run);
  }
  return out.map((r) => r.text.trim()).filter((t) => t !== '');
}

// ── Blocks: paragraphs, tables, list items ───────────────────────────

interface Block {
  kind: 'paragraph' | 'table' | 'list-item';
  text: string;
}

const TABLE_LINE = /^[ \t]*\|/;
const LIST_ITEM_START = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/;
const BLANK = /^[ \t]*$/;

/**
 * Cut `text` into blocks at blank lines, and around Markdown tables (a run of
 * lines starting `|`) and list items (a marker line and the indented lines
 * under it), which are never cut at a blank line or a line break. A blank line
 * stays with the block before it, so the blocks concatenate to `text`.
 */
function toBlocks(text: string): Block[] {
  const lines = splitKeepingNewlines(text);
  const blocks: Block[] = [];
  let i = 0;
  const appendToLast = (line: string): void => {
    if (blocks.length === 0) blocks.push({ kind: 'paragraph', text: line });
    else blocks[blocks.length - 1].text += line;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (BLANK.test(stripNewline(line))) {
      appendToLast(line);
      i++;
    } else if (TABLE_LINE.test(line)) {
      let t = '';
      while (i < lines.length && TABLE_LINE.test(lines[i])) t += lines[i++];
      blocks.push({ kind: 'table', text: t });
    } else if (LIST_ITEM_START.test(line)) {
      let t = lines[i++];
      while (
        i < lines.length
        && !BLANK.test(stripNewline(lines[i]))
        && /^[ \t]+\S/.test(lines[i])
        && !LIST_ITEM_START.test(lines[i])
      ) t += lines[i++];
      blocks.push({ kind: 'list-item', text: t });
    } else {
      let t = '';
      while (
        i < lines.length
        && !BLANK.test(stripNewline(lines[i]))
        && !TABLE_LINE.test(lines[i])
        && !LIST_ITEM_START.test(lines[i])
      ) t += lines[i++];
      blocks.push({ kind: 'paragraph', text: t });
    }
  }
  return blocks;
}

function splitKeepingNewlines(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

function stripNewline(line: string): string {
  return line.endsWith('\n') ? line.slice(0, -1).replace(/\r$/, '') : line;
}

/**
 * A table that does not fit, cut between rows: the header row (and its
 * `| --- |` separator row, when the second line is one) leads every piece;
 * the body rows are packed into each piece while it fits. A row that does
 * not fit even under the header alone is cut by characters.
 */
function splitTable(text: string, b: Bounds): string[] {
  const rows = splitKeepingNewlines(text);
  let headerRows = 1;
  if (rows.length > 1 && /^[ \t]*\|?[ \t]*:?-{3,}/.test(rows[1])) headerRows = 2;
  const header = rows.slice(0, headerRows).join('');
  const body = rows.slice(headerRows);
  if (body.length === 0 || !fits(header, b)) return splitDown(text, b, 0);
  const out: string[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf !== '') out.push(ensureNewline(header) + buf);
    buf = '';
  };
  for (const row of body) {
    if (fits(ensureNewline(header) + buf + row, b)) {
      buf += row;
      continue;
    }
    flush();
    if (fits(ensureNewline(header) + row, b)) buf = row;
    else out.push(...cutByCharacters(row, b));
  }
  flush();
  return out;
}

function ensureNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

// ── Lines, sentences, clauses, characters ────────────────────────────

function splitLines(text: string): string[] {
  return splitKeepingNewlines(text);
}

/** Always end a sentence. */
const CJK_SENTENCE_END = new Set(['。', '？', '！']);
/** End a sentence only before whitespace or the end of the text. */
const ASCII_SENTENCE_END = new Set(['.', '?', '!']);
/** Closing quotes and brackets: an end mark right before one ends nothing. */
const CLOSERS = new Set(['”', '’', '」', '』', '）', ')', ']', '】', '》', '〉', '"', '\'', '}']);

function splitSentences(text: string): string[] {
  return splitAt(text, (t, i) => {
    const c = t[i];
    if (!CJK_SENTENCE_END.has(c) && !ASCII_SENTENCE_END.has(c)) return -1;
    let j = i + 1;
    while (j < t.length && (CJK_SENTENCE_END.has(t[j]) || ASCII_SENTENCE_END.has(t[j]) || t[j] === '…')) j++;
    if (j < t.length && CLOSERS.has(t[j])) return -1;
    const asciiOnly = [...t.slice(i, j)].every((ch) => ASCII_SENTENCE_END.has(ch));
    if (asciiOnly && j < t.length && !/\s/.test(t[j])) return -1;
    return j;
  });
}

function splitClauses(text: string): string[] {
  return splitAt(text, (t, i) => {
    const c = t[i];
    if (c !== '；' && c !== ';') return -1;
    const j = i + 1;
    if (j < t.length && CLOSERS.has(t[j])) return -1;
    if (c === ';' && j < t.length && !/\s/.test(t[j])) return -1;
    return j;
  });
}

/**
 * Cut `text` after every position `endAt` accepts (it answers the index the
 * piece ends at, or -1). The whitespace after a cut stays with the piece
 * before it, so the pieces concatenate to `text`.
 */
function splitAt(text: string, endAt: (t: string, i: number) => number): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    let end = endAt(text, i);
    if (end < 0) continue;
    while (end < text.length && /\s/.test(text[end])) end++;
    out.push(text.slice(start, end));
    start = end;
    i = end - 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * The last level: cut by characters, on code-point boundaries. First the
 * longest prefixes that fit, found by halving (both bounds grow with the
 * prefix) — that gives the fewest pieces; then, when that many pieces of
 * EVEN length all fit, those instead, so no piece is a sliver. At least one
 * code point per piece, so the cut always ends.
 */
function cutByCharacters(text: string, b: Bounds): string[] {
  const cps = Array.from(text);
  const greedy: string[] = [];
  let start = 0;
  while (start < cps.length) {
    let lo = start + 1;
    let hi = Math.min(cps.length, start + b.maxChars + countLeadingSpace(cps, start));
    if (fits(cps.slice(start, lo).join(''), b)) {
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(cps.slice(start, mid).join(''), b)) lo = mid;
        else hi = mid - 1;
      }
    }
    greedy.push(cps.slice(start, lo).join(''));
    start = lo;
  }
  if (greedy.length < 2) return greedy;
  const even: string[] = [];
  const size = Math.ceil(cps.length / greedy.length);
  for (let at = 0; at < cps.length; at += size) even.push(cps.slice(at, at + size).join(''));
  return even.length === greedy.length && even.every((piece) => fits(piece, b)) ? even : greedy;
}

function countLeadingSpace(cps: string[], from: number): number {
  let n = 0;
  while (from + n < cps.length && /\s/.test(cps[from + n])) n++;
  return n;
}

// ── markdown ─────────────────────────────────────────────────────────

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * The `markdown` strategy: one section per ATX heading outside a code fence;
 * text before the first heading is a section with no path. A heading whose
 * section has no text joins the next section: as part of its path when it is
 * an ancestor, as a leading line otherwise (a trailing one is a passage of
 * its own). Each section is cut by {@link splitRecursive} within the bounds
 * left after its heading path, and every passage begins with that path.
 */
export function splitMarkdown(
  text: string,
  b: Bounds,
  minChars: number,
): Array<{ content: string; headingPath: string[] }> {
  const sections: Array<{ path: string[]; body: string }> = [];
  const stack: Array<{ level: number; text: string }> = [];
  let body = '';
  let inFence = false;
  const flush = (): void => {
    sections.push({ path: stack.map((h) => h.text), body });
    body = '';
  };
  for (const line of splitKeepingNewlines(text)) {
    const bare = stripNewline(line);
    if (FENCE.test(bare)) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(bare);
    if (!m) {
      body += line;
      continue;
    }
    flush();
    const level = m[1].length;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, text: m[2] });
  }
  flush();

  const out: Array<{ content: string; headingPath: string[] }> = [];
  let carried: string[] = [];
  for (let s = 0; s < sections.length; s++) {
    const { path } = sections[s];
    let sectionBody = sections[s].body;
    if (sectionBody.trim() === '') {
      // An empty section's heading joins the next section — unless it is the
      // next one's ancestor, whose path already names it.
      const next = sections[s + 1];
      const own = path[path.length - 1];
      if (own === undefined) continue;
      const isAncestor = next !== undefined && next.path.length > path.length
        && path.every((h, k) => next.path[k] === h);
      if (next !== undefined && !isAncestor) carried.push(own);
      if (next === undefined) out.push(...withPrefix(path, '', b, minChars));
      continue;
    }
    if (carried.length > 0) {
      sectionBody = `${carried.join('\n')}\n\n${sectionBody.replace(/^\s+/, '')}`;
      carried = [];
    }
    out.push(...withPrefix(path, sectionBody, b, minChars));
  }
  return out;
}

function withPrefix(
  path: string[],
  body: string,
  b: Bounds,
  minChars: number,
): Array<{ content: string; headingPath: string[] }> {
  if (path.length === 0) return splitRecursive(body, b, minChars).map((content) => ({ content, headingPath: [] }));
  // The heading path counts toward the passage's length; a path too long to
  // leave half the bounds for text shortens to its innermost heading, then to
  // none (the passage still records the whole path).
  for (const prefix of [path.join(' > '), path[path.length - 1], '']) {
    const lead = prefix === '' ? '' : `${prefix}\n\n`;
    const left: Bounds = {
      maxChars: b.maxChars - lead.length,
      maxTokens: b.maxTokens === undefined ? undefined : b.maxTokens - estimateTokens(lead),
    };
    const roomy = left.maxChars >= b.maxChars / 2 && (left.maxTokens === undefined || left.maxTokens >= (b.maxTokens ?? 0) / 2);
    if (!roomy && prefix !== '') continue;
    if (body.trim() === '') return prefix === '' ? [] : [{ content: prefix, headingPath: path }];
    return splitRecursive(body, left, Math.min(minChars, left.maxChars))
      .map((piece) => ({ content: `${lead}${piece}`.trim(), headingPath: path }));
  }
  return [];
}
