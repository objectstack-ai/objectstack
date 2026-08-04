// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression cover for the ledger's numbers/prose split (#5107).
 *
 * The split exists because the ledger's NUMBERS merged clean and wrong seven
 * times in one day while its PROSE merged fine. Moving the numbers into a
 * generated artifact fixes that — and introduces exactly one new way to be
 * quietly wrong: the per-class subtotals are arithmetic over a hand-written
 * `Class` cell, so a tolerant parser would put the campaign's numbers straight
 * back where they were, in a green file.
 *
 * So the parser's REFUSALS are the load-bearing cases here, not its acceptances.
 * Each one is a shape that would otherwise be published as a confident subtotal.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { describe, expect, it } from 'vitest';

import { analyzeTree } from './lib/strictness-ledger';
import {
  BUCKETS,
  COUNTS_PATH,
  LEDGER_PATH,
  VERDICTS,
  bucketize,
  loadLedger,
  parseClassCell,
  renderCounts,
} from './lib/strictness-ledger-doc';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
const REPO = path.resolve(SPEC, '../..');
const SRC = path.join(SPEC, 'src');

describe('Class cell grammar', () => {
  it('reads a bare verdict through the markdown the ledger writes it in', () => {
    // Every one of these spellings exists in the file today.
    expect(parseClassCell('wire')).toMatchObject({ verdict: 'wire', provisional: false, breakdown: null });
    expect(parseClassCell('**no door**')).toMatchObject({ verdict: 'no door', provisional: false });
    expect(parseClassCell('wire (p)')).toMatchObject({ verdict: 'wire', provisional: true });
    expect(parseClassCell('**split** · 5 no door')).toMatchObject({
      verdict: 'split',
      breakdown: [{ n: 5, verdict: 'no door' }],
    });
  });

  it('refuses a verdict outside the vocabulary rather than bucketing it as "other"', () => {
    // `no door` and `no gate` imply OPPOSITE follow-ups — retiring a `no gate`
    // shape deletes something authors use. A parser that shrugged at an unknown
    // word would silently drop a row out of every subtotal.
    expect(parseClassCell('probably fine')).toBeNull();
    expect(parseClassCell('')).toBeNull();
    expect(parseClassCell('mixed · six authorable')).toBeNull();
  });

  it('maps `verify` to authorable, because that is what the ledger has always counted', () => {
    // `ui/app.zod.ts`'s single site: held pending the finding-16 `.extend()`
    // check, and counted in the published `view` 6 + `app` 1 = 7 all the same.
    // A readiness flag, not a class.
    const parsed = parseClassCell('verify');
    expect(parsed).not.toBeNull();
    expect(bucketize(parsed!, 1)).toEqual({ buckets: { ...zero(), authorable: 1 } });
  });
});

describe('bucketize refuses to guess', () => {
  it('rejects a resolved mixed/split row that states no split', () => {
    const parsed = parseClassCell('mixed')!;
    const res = bucketize(parsed, 6);
    expect('error' in res).toBe(true);
    expect('error' in res && res.error).toMatch(/state the split/);
  });

  it('accepts the same row once it carries `(p)`, and calls it unresolved', () => {
    // This is the honest answer, and it is what `data/`'s "needs a per-schema
    // verdict" bucket is made of. Not the same as zero authorable.
    const parsed = parseClassCell('mixed (p)')!;
    expect(bucketize(parsed, 12)).toEqual({ buckets: { ...zero(), unresolved: 12 } });
  });

  it('rejects a declared split that does not add up to the row', () => {
    // The failure this prevents is arithmetic that looks deliberate: a batch
    // closes two sites, updates the prose, and leaves the split naming a total
    // that no longer exists.
    const parsed = parseClassCell('mixed · 6 authorable')!;
    const res = bucketize(parsed, 8);
    expect('error' in res).toBe(true);
    expect('error' in res && res.error).toMatch(/sums to 6 but the file has 8/);
  });

  it('rejects a split whose parts are themselves not single classes', () => {
    const parsed = parseClassCell('mixed · 3 mixed, 3 authorable')!;
    expect('error' in bucketize(parsed, 6)).toBe(true);
  });
});

describe('the ledger and the generated counts agree', () => {
  const loaded = () => loadLedger(REPO, SRC);

  it('has no unresolved Class cells — every row buckets', () => {
    const { problems, model } = loaded();
    expect(problems).toEqual([]);
    expect(model.global.buckets.unclassified).toBe(0);
  });

  it('buckets partition the strip sites exactly, per directory and globally', () => {
    // Internal consistency rather than golden numbers: the totals move with every
    // batch, but a bucket split that does not partition its own total is a defect
    // in any tree. This is the property the hand-written subtotals could not have
    // — they were sums nobody re-derived.
    const { model } = loaded();
    for (const t of model.triaged) {
      const sum = BUCKETS.reduce((a, b) => a + t.buckets[b], 0);
      expect(sum, `${t.dir}/ buckets must sum to its strip count`).toBe(t.strip);
      expect(t.strip).toBe(t.openFiles.reduce((a, f) => a + f.strip, 0));
    }
    expect(BUCKETS.reduce((a, b) => a + model.global.buckets[b], 0)).toBe(model.global.strip);
  });

  it('measures the same tree the AST counter does', () => {
    const { model } = loaded();
    for (const t of model.triaged) {
      const sites = analyzeTree(path.join(SRC, t.dir));
      expect(t.sites, `${t.dir}/ site total`).toBe(sites.length);
      expect(t.strip, `${t.dir}/ strip total`).toBe(sites.filter((s) => s.posture === 'strip').length);
    }
  });

  it('is checked in current — the artifact on disk equals a fresh render', () => {
    // The same comparison `check:strictness-ledger` makes. Duplicated here on
    // purpose: a stale artifact should be visible from `pnpm test` too, because
    // the failure it stands for ("a schema moved under a verdict nobody
    // re-examined") is a code change, and code changes run the suite.
    const { rendered } = loaded();
    expect(fs.readFileSync(path.join(REPO, COUNTS_PATH), 'utf-8')).toBe(rendered);
  });

  it('renders deterministically', () => {
    const { model } = loaded();
    expect(renderCounts(model)).toBe(renderCounts(model));
  });

  it('writes headers that carry no numbers, so links into it cannot rot', () => {
    // The ledger links into this file by anchor. Number-bearing headings
    // (`### \`ui/\` — 76 strip of 198`) change their anchor on every batch, i.e.
    // exactly when someone follows the link.
    const headings = fs
      .readFileSync(path.join(REPO, COUNTS_PATH), 'utf-8')
      .split('\n')
      .filter((l) => /^#{2,3} /.test(l));
    expect(headings.length).toBeGreaterThan(4);
    for (const h of headings) expect(h, `${h} must not carry a count`).not.toMatch(/\d/);
  });
});

describe('the ledger documents the grammar the parser enforces', () => {
  it('names every verdict the parser accepts, and no others', () => {
    // Two copies of a vocabulary drift, and the direction they drift in is the
    // one where an author writes what the doc says and the gate rejects it.
    const md = fs.readFileSync(path.join(REPO, LEDGER_PATH), 'utf-8');
    const block = md.split('## Classification rule')[0];
    const documented = new Set(
      [...block.matchAll(/`(authorable|verify|mixed|split|wire|open|no door|no gate)`/g)].map((m) => m[1]),
    );
    expect([...documented].sort()).toEqual([...VERDICTS].sort());
  });

  it('tells the reader the artifact is generated and how to regenerate it', () => {
    const md = fs.readFileSync(path.join(REPO, LEDGER_PATH), 'utf-8');
    expect(md).toContain('gen:strictness-ledger');
    expect(md).toContain(path.basename(COUNTS_PATH));
  });
});

function zero(): Record<string, number> {
  return { authorable: 0, unresolved: 0, 'wire/open': 0, 'no door': 0, 'no gate': 0, unclassified: 0 };
}
