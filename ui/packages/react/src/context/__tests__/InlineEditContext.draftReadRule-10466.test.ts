/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10466 — the `draft` member's doc comment on the published
 * `InlineEditContextValue` must teach a live-value read in which an OWN draft
 * key wins even when its value is empty.
 *
 * ## The defect
 *
 * The doc comment prescribed a read that falls back to the saved value
 * whenever the draft value is nullish. A field the user emptied, or a cascade
 * clear emptied (it stages `null` since objectui#10291), is exactly an own
 * draft key with an empty value. A host that copied the published sentence
 * therefore showed, and handed its widgets, the value the user had just
 * removed; on the record page's highlights strip that read looped an option
 * widget's prune forever (objectui#7190). No in-tree host followed the
 * sentence. The trap was for the next host author, human or AI, who copies it
 * from the `.d.ts` hover.
 *
 * ## Why a source-text pin
 *
 * A doc comment is erased before anything runs, so no behavioural test can
 * reach it. This takes the same narrow exception the sibling doc pins in this
 * package take for prescriptive doc text (`LazyPluginLoader.jsdocExample`,
 * `useNavigationOverlay.docExampleRecordSource-7638`).
 *
 * ## What it asserts, kept deliberately loose
 *
 * Only the READ RULE taught by the doc comment's code spans, never its prose,
 * wording or ordering:
 *  1. no code span reads the draft and then falls back through a nullish or
 *     falsy operator;
 *  2. at least one code span names a read that keeps an own draft key.
 *
 * Both matchers are proven able to fire on synthetic spellings before any
 * verdict on the real doc comment is believed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The context under test, by SOURCE path: the doc comment lives here and ships in `dist` typings. */
const SOURCE = readFileSync(join(HERE, '..', 'InlineEditContext.tsx'), 'utf8');

/**
 * The doc comment directly above the `draft:` member of
 * `InlineEditContextValue`, with its `*` gutters removed. Anchored on the
 * interface so a `draft` member of any other type in the file is never read.
 */
function draftDocComment(): string {
  const iface = SOURCE.indexOf('export interface InlineEditContextValue');
  if (iface === -1) throw new Error('`export interface InlineEditContextValue` not found; re-anchor this pin.');
  const ifaceEnd = SOURCE.indexOf('\n}', iface);
  const member = SOURCE.indexOf('\n  draft:', iface);
  if (member === -1 || member > ifaceEnd) {
    throw new Error('`draft:` member not found in `InlineEditContextValue`; re-anchor this pin.');
  }
  const open = SOURCE.lastIndexOf('/**', member);
  const close = SOURCE.indexOf('*/', open);
  if (open < iface || close === -1 || close > member || SOURCE.slice(close + 2, member).trim() !== '') {
    throw new Error('no doc comment directly above `draft:`; re-anchor this pin.');
  }
  return SOURCE.slice(open + 3, close)
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .join('\n');
}

/** The backtick code spans of a block of prose, whitespace collapsed (a span may wrap a line). */
function codeSpans(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
}

/** A draft read followed by a fallback operator: it returns the saved value for an emptied field. */
const FALLBACK_READ = /\bdraft\b.*(?:\?\?|\|\|)/;

/** Reads that keep an own draft key even when its value is empty. */
const OWN_KEY_READS: readonly RegExp[] = [
  // the staged-record spread, draft LAST so its own keys win
  /\{\s*\.\.\.(?!draft\b)[\w.?]+\s*,\s*\.\.\.draft\s*\}/,
  // an explicit own-key test
  /\bin\s+draft\b/,
  /\bhasOwn(?:Property\.call)?\(\s*draft\b/,
];
const keepsOwnKey = (span: string): boolean => OWN_KEY_READS.some((re) => re.test(span));

describe('InlineEditContextValue.draft doc comment teaches the own-key read (objectui#10466)', () => {
  const doc = draftDocComment();
  const spans = codeSpans(doc);

  it('LIT CONTROL: the doc comment was read and carries code spans', () => {
    // Every verdict below is about these spans. An empty list would make
    // "no fallback read" vacuously true.
    expect(doc.trim().length).toBeGreaterThan(0);
    expect(spans.length).toBeGreaterThan(0);
  });

  it('CONTROL: the fallback matcher fires on the read objectui#10466 removed, and only on fallbacks', () => {
    expect(FALLBACK_READ.test('draft[name] ?? data[name]')).toBe(true);
    expect(FALLBACK_READ.test('draft[name] || data[name]')).toBe(true);
    expect(FALLBACK_READ.test('{ ...data, ...draft }')).toBe(false);
    expect(FALLBACK_READ.test('name in draft ? draft[name] : data[name]')).toBe(false);
  });

  it('CONTROL: the own-key recogniser accepts own-key reads and refuses the rest', () => {
    expect(keepsOwnKey('{ ...data, ...draft }')).toBe(true);
    expect(keepsOwnKey('name in draft ? draft[name] : data[name]')).toBe(true);
    expect(keepsOwnKey('Object.hasOwn(draft, name) ? draft[name] : data[name]')).toBe(true);
    expect(keepsOwnKey('Object.prototype.hasOwnProperty.call(draft, name)')).toBe(true);
    // the saved record spread last: the draft never wins
    expect(keepsOwnKey('{ ...draft, ...data }')).toBe(false);
    expect(keepsOwnKey('draft[name] ?? data[name]')).toBe(false);
  });

  it('teaches no read that falls back to the saved value on an empty draft value', () => {
    expect(
      spans.filter((span) => FALLBACK_READ.test(span)),
      'A host author copies this read. A fallback on an empty draft value returns the saved ' +
        'value for a field the user or a cascade clear emptied (objectui#7190, objectui#10466).',
    ).toEqual([]);
  });

  it('names a read in which an own draft key wins', () => {
    expect(spans.some(keepsOwnKey), `code spans read: ${JSON.stringify(spans)}`).toBe(true);
  });
});
