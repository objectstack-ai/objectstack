// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The splitter (#37098): golden files for the shapes the card names — a
 * Chinese regulation cut by chapter and article, a Markdown table, a long run
 * with no punctuation, mixed Chinese and English, 「3.2 条」 and 「400.50 元」, and
 * a Markdown heading tree — plus a seeded property test that no passage's
 * token estimate is over the budget.
 *
 * A golden file is the splitter's output for one fixture and one resolved
 * split. When the splitter is changed ON PURPOSE, regenerate them with
 * `OS_TEST_UPDATE_SPLIT_GOLDEN=1` and read the diff: every changed passage is
 * a changed passage in every index built after the change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimateTokens } from '@objectstack/spec/shared';
import type { KnowledgeSplit } from '@objectstack/spec/ai';
import {
  DEFAULT_SPLIT_MAX_CHARS,
  DEFAULT_SPLIT_MIN_CHARS,
  resolveSplit,
  splitDocument,
  type ResolvedSplit,
} from '../split/index.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/split/${name}`, import.meta.url), 'utf8');

function chunksOf(content: string, split: ResolvedSplit) {
  const out = splitDocument({ id: 'doc', content }, split);
  if (!out.ok) throw new Error(`unexpected split failure: ${out.reason}`);
  return out.chunks;
}

const GOLDEN: Array<{ name: string; input: string; split: KnowledgeSplit; maxInputTokens?: number }> = [
  { name: 'regulation-zh.default', input: 'regulation-zh.txt', split: { strategy: 'recursive' } },
  { name: 'regulation-zh.tight', input: 'regulation-zh.txt', split: { strategy: 'recursive', maxChars: 120, minChars: 40 }, maxInputTokens: 100 },
  { name: 'table.recursive', input: 'table.md', split: { strategy: 'recursive', maxChars: 300, minChars: 100 } },
  { name: 'long-run-zh.bge-512', input: 'long-run-zh.txt', split: { strategy: 'recursive' }, maxInputTokens: 512 },
  { name: 'mixed-zh-en.tight', input: 'mixed-zh-en.txt', split: { strategy: 'recursive', maxChars: 120, minChars: 40 } },
  { name: 'headings.markdown', input: 'headings.md', split: { strategy: 'markdown', maxChars: 120, minChars: 40 } },
];

describe('splitter — golden files', () => {
  it.each(GOLDEN)('$name', ({ name, input, split, maxInputTokens }) => {
    const chunks = chunksOf(fixture(input), resolveSplit({ split, maxInputTokens }));
    const goldenUrl = new URL(`./fixtures/split/${name}.golden.json`, import.meta.url);
    if (process.env.OS_TEST_UPDATE_SPLIT_GOLDEN === '1') {
      writeFileSync(goldenUrl, `${JSON.stringify(chunks, null, 2)}\n`);
    }
    expect(chunks).toEqual(JSON.parse(readFileSync(goldenUrl, 'utf8')));
  });
});

describe('splitter — the rules the golden files pin, asserted directly', () => {
  const tight = resolveSplit({ split: { strategy: 'recursive', maxChars: 120, minChars: 40 }, maxInputTokens: 100 });

  it('keeps 「3.2 条」 and 「400.50 元」 whole: an English period ends a sentence only before whitespace', () => {
    const chunks = chunksOf(fixture('regulation-zh.txt'), tight);
    expect(chunks.some((c) => c.content.includes('第3.2 条'))).toBe(true);
    expect(chunks.some((c) => c.content.includes('400.50 元'))).toBe(true);
    for (const c of chunks) {
      expect(c.content.endsWith('3.')).toBe(false);
      expect(c.content.endsWith('400.')).toBe(false);
    }
  });

  it('cuts a regulation by article, and a chapter title leads its own chapter', () => {
    const chunks = chunksOf(fixture('regulation-zh.txt'), tight);
    for (const title of ['第一章　总则', '第二章　交通费', '第三章　住宿费']) {
      const holder = chunks.find((c) => c.content.includes(title));
      expect(holder?.content.startsWith(title)).toBe(true);
    }
    for (const article of ['第二条', '第三条', '第五条', '第六条', '第八条']) {
      expect(chunks.some((c) => c.content.startsWith(article))).toBe(true);
    }
  });

  it('never splits right after a closing quote or bracket, nor after an end mark before one', () => {
    const chunks = chunksOf(fixture('mixed-zh-en.txt'), resolveSplit({ split: { strategy: 'recursive', maxChars: 120, minChars: 40 } }));
    expect(chunks.some((c) => c.content.includes('他说：“这个限制不会截断文档。”然后'))).toBe(true);
    expect(chunks.some((c) => c.content.includes('(see the doc page.) for every adapter.'))).toBe(true);
    expect(chunks.some((c) => c.content.includes('（版本 v3.2）'))).toBe(true);
  });

  it('a table that fits is one unit; one that does not is cut between rows, each piece under the header', () => {
    const md = fixture('table.md');
    const roomy = chunksOf(md, resolveSplit({ split: { strategy: 'recursive', maxChars: 800, minChars: 0 } }));
    expect(roomy.filter((c) => c.content.includes('| City tier |'))).toHaveLength(1);
    const tightTable = chunksOf(md, resolveSplit({ split: { strategy: 'recursive', maxChars: 300, minChars: 100 } }));
    const pieces = tightTable.filter((c) => c.content.includes('| Tier') || c.content.includes('| Overseas'));
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.content.startsWith('| City tier | Lodging per night | Meals per day | Notes |\n| --- |')).toBe(true);
    // No row is cut: every body row appears whole in exactly one piece.
    for (const row of md.split('\n').filter((l) => /^\| (Tier|Overseas)/.test(l))) {
      expect(pieces.filter((p) => p.content.includes(row))).toHaveLength(1);
    }
  });

  it('a list item is never cut at a line break; an item that fits stays whole', () => {
    const text = '- first item line one\n  continues here.\n- second item\n\nAfter the list.';
    const chunks = chunksOf(text, resolveSplit({ split: { strategy: 'recursive', maxChars: 40, minChars: 0 } }));
    expect(chunks.map((c) => c.content)).toEqual([
      '- first item line one\n  continues here.',
      '- second item',
      'After the list.',
    ]);
  });

  it('a long run with no punctuation is cut by characters into even pieces within the budget', () => {
    const run = fixture('long-run-zh.txt').trim();
    const split = resolveSplit({ split: { strategy: 'recursive' }, maxInputTokens: 512 });
    const chunks = chunksOf(run, split);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.content).join('')).toBe(run);
    const lengths = chunks.map((c) => c.content.length);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(chunks.length);
    for (const c of chunks) expect(estimateTokens(c.content)).toBeLessThanOrEqual(split.maxTokens!);
  });

  it('markdown: each passage carries its heading path, embedded at its start; a fenced # is no heading', () => {
    const chunks = chunksOf(fixture('headings.md'), resolveSplit({ split: { strategy: 'markdown', maxChars: 120, minChars: 40 } }));
    const air = chunks.find((c) => c.content.includes('Economy class'));
    expect(air?.headingPath).toEqual(['Travel policy', 'Transport', 'Air']);
    expect(air?.content.startsWith('Travel policy > Transport > Air\n\n')).toBe(true);
    expect(chunks.some((c) => c.headingPath?.includes('# not a heading inside a code fence'))).toBe(false);
  });

  it('markdown: a heading with no body joins the next passage', () => {
    const chunks = chunksOf(fixture('headings.md'), resolveSplit({ split: { strategy: 'markdown', maxChars: 120, minChars: 40 } }));
    // "## Lodging" has no text; it is carried into the "## Meals" passage.
    const meals = chunks.find((c) => c.content.includes('daily allowance'));
    expect(meals?.content).toContain('Lodging');
    expect(chunks.some((c) => c.headingPath?.[c.headingPath.length - 1] === 'Lodging')).toBe(false);
    // "## Transport" has no text of its own, and is its children's ancestor.
    expect(chunks.filter((c) => c.headingPath?.join('/') === 'Travel policy/Transport')).toEqual([]);
  });

  it('ids are documentId#index, in order', () => {
    const chunks = chunksOf(fixture('table.md'), resolveSplit({ split: { strategy: 'recursive', maxChars: 300, minChars: 100 } }));
    chunks.forEach((c, i) => {
      expect(c).toMatchObject({ id: `doc#${i}`, documentId: 'doc', index: i });
    });
  });
});

describe('splitter — whole', () => {
  it('one passage per document', () => {
    const text = fixture('regulation-zh.txt');
    const chunks = chunksOf(text, resolveSplit({ split: { strategy: 'whole' }, maxInputTokens: 8192 }));
    expect(chunks).toEqual([{ id: 'doc#0', documentId: 'doc', index: 0, content: text.trim() }]);
  });

  it('over the budget: a failure naming the estimate and the budget, never a truncated passage', () => {
    const text = fixture('regulation-zh.txt');
    const out = splitDocument({ id: 'doc', content: text }, resolveSplit({ split: { strategy: 'whole' }, maxInputTokens: 512 }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.budget).toBe(409);
    expect(out.estimate).toBe(estimateTokens(text.trim()));
    expect(out.estimate).toBeGreaterThan(409);
  });

  it('with no limit known, nothing is checked', () => {
    const text = fixture('long-run-zh.txt');
    expect(splitDocument({ id: 'doc', content: text }, resolveSplit({ split: { strategy: 'whole' } }))).toMatchObject({ ok: true });
  });

  it('an empty document has no passage, under every strategy', () => {
    for (const strategy of ['whole', 'recursive', 'markdown'] as const) {
      expect(chunksOf(' \n\n ', resolveSplit({ split: { strategy } }))).toEqual([]);
    }
  });
});

describe('resolveSplit', () => {
  it('800 / 200 / recursive when nothing is configured and no limit is known', () => {
    expect(resolveSplit({})).toEqual({ strategy: 'recursive', maxChars: DEFAULT_SPLIT_MAX_CHARS, minChars: DEFAULT_SPLIT_MIN_CHARS });
    expect(DEFAULT_SPLIT_MAX_CHARS).toBe(800);
    expect(DEFAULT_SPLIT_MIN_CHARS).toBe(200);
  });

  it("the source's maxChars wins over the settings page's chunk_target, which wins over 800", () => {
    expect(resolveSplit({ split: { strategy: 'recursive', maxChars: 300 }, chunkTarget: 500 }).maxChars).toBe(300);
    expect(resolveSplit({ split: { strategy: 'markdown' }, chunkTarget: 500 }).maxChars).toBe(500);
    expect(resolveSplit({ chunkTarget: 500 }).maxChars).toBe(500);
  });

  it('the token budget is 80% of the embedder limit, floored', () => {
    expect(resolveSplit({ maxInputTokens: 8192 }).maxTokens).toBe(6553);
    expect(resolveSplit({ maxInputTokens: 512 }).maxTokens).toBe(409);
    expect(resolveSplit({ maxInputTokens: 0 }).maxTokens).toBeUndefined();
  });

  it('a minChars above the effective maxChars reads as maxChars', () => {
    expect(resolveSplit({ split: { strategy: 'recursive', maxChars: 100, minChars: 500 } }).minChars).toBe(100);
    expect(resolveSplit({ split: { strategy: 'recursive', minChars: 900 } }).minChars).toBe(800);
  });
});

// ── Property: no passage is over the budget ───────────────────────────

/** mulberry32: a small seeded PRNG, so a failing case reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ATOMS = [
  '第七条', '纳税人', '应当', '按照规定', '。', '，', '；', '？', '！', '“', '”', '「3.2 条」', '400.50 元', '（', '）',
  'the', 'embedding', 'limit', 'is', '8192', 'v3.2', 'e.g.', '.', ' ', ' ', ' ', '?', '!', ';', '(', ')', 'a1b2c3d4e5f6',
  '\n', '\n\n', '- ', '| a | b |\n', '| --- | --- |\n', '| 1 | 2 |\n', '## Heading ', '# Top\n', '```\n', 'https://example.com/a?b=c',
  '员工在出差期间应当遵守公司的各项规章制度',
];

function randomDoc(next: () => number): string {
  const n = Math.floor(next() * 400);
  let s = '';
  for (let i = 0; i < n; i++) s += ATOMS[Math.floor(next() * ATOMS.length)];
  // Now and then a long run with no break at all.
  if (next() < 0.2) s += '规章制度'.repeat(Math.floor(next() * 300));
  return s;
}

describe('splitter — property: no passage is over the budget', () => {
  it('500 seeded documents × random bounds, every strategy', () => {
    const next = rng(37098);
    for (let i = 0; i < 500; i++) {
      const content = randomDoc(next);
      const maxInputTokens = 16 + Math.floor(next() * 2000);
      const maxChars = 20 + Math.floor(next() * 900);
      const minChars = Math.floor(next() * maxChars);
      const strategy = (['recursive', 'markdown'] as const)[i % 2];
      const split = resolveSplit({ split: { strategy, maxChars, minChars }, maxInputTokens });
      const out = splitDocument({ id: `d${i}`, content }, split);
      expect(out.ok, `case ${i}`).toBe(true);
      if (!out.ok) continue;
      for (const c of out.chunks) {
        const where = `case ${i} (${strategy}, maxChars ${maxChars}, limit ${maxInputTokens}) chunk ${c.index}`;
        expect(c.content.trim(), where).not.toBe('');
        expect(estimateTokens(c.content), where).toBeLessThanOrEqual(split.maxTokens!);
        expect(estimateTokens(c.content), where).toBeLessThanOrEqual(maxInputTokens);
        expect(c.content.length, where).toBeLessThanOrEqual(maxChars);
      }
      if (strategy === 'recursive' && !content.includes('|')) {
        // Nothing is lost or invented: the passages, read in order, give back the text.
        const squash = (t: string) => t.replace(/\s+/g, '');
        expect(squash(out.chunks.map((c) => c.content).join('')), `case ${i}`).toBe(squash(content));
      }
    }
  });

  it('whole: a document is either one passage within the budget or a failure, never a cut', () => {
    const next = rng(4242);
    for (let i = 0; i < 200; i++) {
      const content = randomDoc(next);
      const maxInputTokens = 16 + Math.floor(next() * 2000);
      const split = resolveSplit({ split: { strategy: 'whole' }, maxInputTokens });
      const out = splitDocument({ id: `w${i}`, content }, split);
      if (out.ok) {
        expect(out.chunks.length).toBeLessThanOrEqual(1);
        for (const c of out.chunks) expect(estimateTokens(c.content)).toBeLessThanOrEqual(split.maxTokens!);
      } else {
        expect(out.estimate).toBeGreaterThan(split.maxTokens!);
      }
    }
  });
});
