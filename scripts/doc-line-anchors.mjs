#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * doc-line-anchors -- the ONE reader for `file:line` anchors written in docs prose.
 *
 * A docs page that cites source by `` `security-plugin.ts:1560` `` has created a
 * two-sided invariant with no owner: the line lives in one tree, the citation in
 * another, and nothing relates them. Measured on
 * `content/docs/permissions/system-context.mdx` over 19 days, **101 of its 111
 * anchors rotted** -- the construct still existed, the line number no longer
 * named it -- while CI stayed green throughout.
 *
 * This module is the parsing half of the fix, kept separate from the gate that
 * uses it because the defect is not specific to one page: any page carrying
 * `file:line` anchors has it, and the second page should cost a ledger rather
 * than a parser.
 *
 * ## The three anchor shapes, all of which are real on the corpus
 *
 * A naive reader finds only the first and undercounts by a third.
 *
 *   FULL          `` `objectql/src/engine.ts:10501` ``   path + line
 *   CONTINUATION  `` `:1409` ``                          line only; the file is
 *                                                        the nearest FULL anchor
 *                                                        to its left, which is
 *                                                        how a row cites four
 *                                                        sites in one file
 *   RANGE_END     `` `2630` ``                           a bare number whose only
 *                                                        separation from the
 *                                                        anchor on its left is a
 *                                                        dash: `:2483`--`2630`
 *
 * The measurement that makes this list non-negotiable: `grep -c` for anchor-shaped
 * text over the previous edition of that page answered **64**, because it counts
 * LINES CARRYING an anchor. The real population was **111**. A gate seeded from
 * the 64 would have reported a confident green over 47 citations it never read.
 *
 * ## Resolution is by unique suffix, and ambiguity is an ERROR
 *
 * An anchor names as little of the path as it can and still be unique --
 * `read-audit.ts:556` where the basename is unique, `objectql/src/engine.ts:10501`
 * where it is not. That is a property a gate can hold: resolve the spelling
 * against the tracked file list by path-suffix and REFUSE when two files match.
 * The previous edition had **41 of 111** anchors whose bare basename matched two
 * files; those are unresolvable mechanically, and the remedy is to lengthen the
 * spelling on the page, never to guess with a heuristic.
 *
 * ## What is deliberately NOT here
 *
 * No knowledge of what a line should CONTAIN. That is the consuming gate's
 * question -- for `system-context.mdx` it is answered by an AST census -- and
 * baking any answer in here would make the module single-use.
 *
 * @module
 */

import { extname } from 'node:path';

/** Extensions an anchor may name. Anything else is prose, not a citation. */
export const ANCHOR_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.jsx'];

/** `path/to/file.ts:1234` -- the whole span, nothing else. */
const FULL_RE = /^([A-Za-z0-9_.\-/]+)\.([a-z]+):(\d+)$/;
/** `path/to/file.ts` -- a cited file with no line. */
const PATH_ONLY_RE = /^([A-Za-z0-9_.\-/]+)\.([a-z]+)$/;
/** `:1409` -- a continuation of the anchor to its left. */
const CONTINUATION_RE = /^:(\d+)$/;
/** `2630` -- a bare number; only an anchor when a dash joins it to one. */
const BARE_NUMBER_RE = /^(\d+)$/;
/** What may sit between a range start and its end: a dash of any width. */
const RANGE_JOIN_RE = /^[\s]*[-‐‑‒–—―][\s]*$/;

/**
 * Blank every fenced code block, preserving line count and byte offsets.
 *
 * Load-bearing: the page this was written for carries a ```bash block whose body
 * is the census command, backticks and all. Reading spans out of a fence
 * fabricates anchors nobody wrote.
 *
 * @param {string} text
 * @returns {string} the same length, with fence bodies replaced by spaces
 */
export function blankFencedBlocks(text) {
  const lines = text.split('\n');
  let inFence = false;
  let fenceMark = '';
  const out = lines.map((line) => {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line);
    if (!inFence && opener) {
      inFence = true;
      fenceMark = opener[1][0].repeat(3);
      return ' '.repeat(line.length);
    }
    if (inFence) {
      const closer = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (closer && closer[1][0].repeat(3) === fenceMark) inFence = false;
      return ' '.repeat(line.length);
    }
    return line;
  });
  return out.join('\n');
}

/**
 * Blank a leading YAML frontmatter block, preserving line count and offsets.
 *
 * @param {string} text
 * @returns {string}
 */
export function blankFrontmatter(text) {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) return text;
  const head = text.slice(0, end + 5);
  return head.replace(/[^\n]/g, ' ') + text.slice(end + 5);
}

/**
 * Every inline code span in document order.
 *
 * Backtick runs are matched by length, as CommonMark does, so a span containing
 * a backtick (`` ` `` inside `` `` ` `` ``) is read whole rather than split.
 *
 * @param {string} text  Fences and frontmatter already blanked.
 * @returns {{ value: string, start: number, end: number, line: number }[]}
 */
export function extractCodeSpans(text) {
  /** @type {{ value: string, start: number, end: number, line: number }[]} */
  const spans = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }
    let run = 0;
    while (text[i + run] === '`') run += 1;
    const fence = '`'.repeat(run);
    const bodyStart = i + run;
    let j = bodyStart;
    let close = -1;
    while (j < text.length) {
      const at = text.indexOf(fence, j);
      if (at === -1) break;
      let after = 0;
      while (text[at + after] === '`') after += 1;
      if (after === run) {
        close = at;
        break;
      }
      j = at + after;
    }
    if (close === -1) {
      i += run;
      continue;
    }
    const raw = text.slice(bodyStart, close);
    spans.push({
      value: raw.trim(),
      start: i,
      end: close + run,
      line: countLines(text, i),
    });
    i = close + run;
  }
  return spans;
}

/** 1-based line number of `offset` in `text`. */
function countLines(text, offset) {
  let n = 1;
  for (let i = 0; i < offset; i += 1) if (text[i] === '\n') n += 1;
  return n;
}

/**
 * Every `file:line` anchor a docs page writes, in document order.
 *
 * @param {string} rawText  The page source, frontmatter and fences included.
 * @returns {{ spelling: string, line: number, kind: 'full'|'continuation'|'range-end',
 *            raw: string, docLine: number }[]}
 */
export function extractLineAnchors(rawText) {
  const text = blankFencedBlocks(blankFrontmatter(rawText));
  const spans = extractCodeSpans(text);
  /** @type {{ spelling: string, line: number, kind: string, raw: string, docLine: number }[]} */
  const anchors = [];
  let currentFile = null;
  let previousSpan = null;
  for (const span of spans) {
    const full = FULL_RE.exec(span.value);
    if (full && ANCHOR_EXTENSIONS.includes(`.${full[2]}`)) {
      currentFile = `${full[1]}.${full[2]}`;
      anchors.push({
        spelling: currentFile,
        line: Number(full[3]),
        kind: 'full',
        raw: span.value,
        docLine: span.line,
      });
      previousSpan = span;
      continue;
    }
    const cont = CONTINUATION_RE.exec(span.value);
    if (cont && currentFile) {
      anchors.push({
        spelling: currentFile,
        line: Number(cont[1]),
        kind: 'continuation',
        raw: span.value,
        docLine: span.line,
      });
      previousSpan = span;
      continue;
    }
    const bare = BARE_NUMBER_RE.exec(span.value);
    if (bare && currentFile && previousSpan && RANGE_JOIN_RE.test(text.slice(previousSpan.end, span.start))) {
      anchors.push({
        spelling: currentFile,
        line: Number(bare[1]),
        kind: 'range-end',
        raw: span.value,
        docLine: span.line,
      });
      previousSpan = span;
      continue;
    }
    // A path with no line resets the inherited file: a following `:N` belongs to
    // the file just named, not to the last one that happened to carry a line.
    const pathOnly = PATH_ONLY_RE.exec(span.value);
    if (pathOnly && ANCHOR_EXTENSIONS.includes(`.${pathOnly[2]}`) && span.value.includes('/')) {
      currentFile = span.value;
    }
    previousSpan = span;
  }
  return anchors;
}

/**
 * Every cited path that carries no line number, in document order.
 *
 * These are not anchors -- there is nothing to hold a line to -- but a rename
 * still breaks them, so a gate can resolve them for existence.
 *
 * @param {string} rawText
 * @returns {{ spelling: string, docLine: number }[]}
 */
export function extractPathCitations(rawText) {
  const text = blankFencedBlocks(blankFrontmatter(rawText));
  const out = [];
  for (const span of extractCodeSpans(text)) {
    const m = PATH_ONLY_RE.exec(span.value);
    if (!m) continue;
    if (!ANCHOR_EXTENSIONS.includes(`.${m[2]}`)) continue;
    if (!span.value.includes('/')) continue;
    out.push({ spelling: span.value, docLine: span.line });
  }
  return out;
}

/**
 * Resolve an anchor spelling against the tracked file list.
 *
 * @param {string} spelling  e.g. `objectql/src/engine.ts` or `read-audit.ts`
 * @param {readonly string[]} trackedFiles  repo-relative paths
 * @returns {{ path: string } | { error: 'unresolved' | 'ambiguous', matches: string[] }}
 */
export function resolveAnchorFile(spelling, trackedFiles) {
  const needle = `/${spelling}`;
  const matches = trackedFiles.filter((f) => f === spelling || f.endsWith(needle));
  if (matches.length === 1) return { path: matches[0] };
  if (matches.length === 0) return { error: 'unresolved', matches: [] };
  return { error: 'ambiguous', matches };
}

/**
 * The shortest suffix of `path` that resolves uniquely -- the spelling a page
 * SHOULD carry. Never a bare basename when the basename is ambiguous.
 *
 * @param {string} path  repo-relative
 * @param {readonly string[]} trackedFiles
 * @returns {string}
 */
export function shortestUniqueSpelling(path, trackedFiles) {
  const parts = path.split('/');
  for (let take = 1; take <= parts.length; take += 1) {
    const candidate = parts.slice(parts.length - take).join('/');
    const resolved = resolveAnchorFile(candidate, trackedFiles);
    if ('path' in resolved && resolved.path === path) return candidate;
  }
  return path;
}

/** True when `p` names a file this module would read an anchor out of. */
export function isAnchorableExtension(p) {
  return ANCHOR_EXTENSIONS.includes(extname(p));
}
