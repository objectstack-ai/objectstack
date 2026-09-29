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

import { readTextShardDir } from './lib/sharded-artifacts';
import { analyzeTree } from './lib/strictness-ledger';
import {
  BUCKETS,
  COUNTS_DIR,
  LEDGER_PATH,
  LEGACY_COUNTS_PATH,
  VERDICTS,
  bucketize,
  countsShardName,
  formatGlobalCounts,
  loadLedger,
  parseClassCell,
  renderCountShards,
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
    // A readiness flag, not a class — counted in the published `view` 6 +
    // `app` 1 = 7 from the start. #5249 moved its one instance to `covered` and
    // deliberately left this mapping alone: the word still means "held pending a
    // check" and the next site that needs holding must count the same way.
    const parsed = parseClassCell('verify');
    expect(parsed).not.toBeNull();
    expect(bucketize(parsed!, 1)).toEqual({ buckets: { ...zero(), authorable: 1 } });
  });
});

describe('`covered` — the ninth verdict (#5249)', () => {
  it('parses, and lands in a bucket of its own', () => {
    const parsed = parseClassCell('covered');
    expect(parsed).toMatchObject({ verdict: 'covered', provisional: false, breakdown: null });
    expect(bucketize(parsed!, 1)).toEqual({ buckets: { ...zero(), covered: 1 } });
  });

  it('does NOT merge into `no door`, which is the whole reason it exists', () => {
    // Both are carrier-absent + parse-absent, so an arithmetic merge would look
    // harmless. It is not: the subtotal is a worklist readout and the two rows
    // prescribe OPPOSITE work — `no door` sends the next agent to ADR-0049
    // retirement, `covered` sends them nowhere because every consumer already
    // gates the keys. Retiring `ui/app.zod.ts`'s `BaseNavItemSchema` on a
    // `no door` reading would delete nine live nav branches' shared keys.
    const covered = bucketize(parseClassCell('covered')!, 3);
    const noDoor = bucketize(parseClassCell('no door')!, 3);
    expect(covered).not.toEqual(noDoor);
    expect('buckets' in covered && covered.buckets['no door']).toBe(0);
    expect('buckets' in noDoor && noDoor.buckets.covered).toBe(0);
  });

  it('is a single class, so a split may be declared in terms of it', () => {
    // The ledger's `ui/i18n.zod.ts` row is `split · 5 no door`; a file that ever
    // mixes a covered fragment with live sites must be able to say so, and
    // `bucketize` rejects breakdown parts that name no single class.
    const parsed = parseClassCell('split · 2 covered, 1 authorable')!;
    expect(bucketize(parsed, 3)).toEqual({ buckets: { ...zero(), covered: 2, authorable: 1 } });
  });

  it('is reported under a label that names the measurement, not just the word', () => {
    // The counts artifact is read by people who never open this file, so the
    // bucket label has to carry the three-part test (`no carrier, no parse,
    // guarded at every consumer`) rather than a bare `covered`.
    const { shards } = loadLedger(REPO, SRC);
    expect(shards.get('ui.md')).toContain('covered — no carrier, no parse, guarded at every consumer');
  });

  it('has exactly one instance in the tree, and it is `ui/app.zod.ts`', () => {
    // The re-review #5249's ruling required, pinned rather than narrated: the
    // verdict was created for one measured site, and a second row appearing
    // without a measurement is the drift this asserts against. `covered`
    // requires the keys to reach consumers by `...X.shape` SPREAD — `.extend()`
    // INHERITS posture, which makes the base a real door (`FormFieldBaseSchema`,
    // `BaseQuerySchema`) rather than an inert fragment.
    const { parsed, model } = loadLedger(REPO, SRC);
    const rows = parsed.strip.filter((r) => parseClassCell(r.classCell)?.verdict === 'covered');
    expect(rows.map((r) => `${r.dir}/${r.file}`)).toEqual(['ui/app.zod.ts']);
    expect(model.global.buckets.covered).toBe(1);
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

  it('is checked in current — every shard on disk equals a fresh render, and nothing else is there', () => {
    // The same comparison `check:strictness-ledger` makes. Duplicated here on
    // purpose: a stale artifact should be visible from `pnpm test` too, because
    // the failure it stands for ("a schema moved under a verdict nobody
    // re-examined") is a code change, and code changes run the suite.
    const { shards } = loaded();
    expect(readTextShardDir(path.join(REPO, COUNTS_DIR))).toEqual(shards);
  });

  // The transition hazard (#20361): a branch cut before the split meets the
  // single file's deletion as a modify/delete, and keeping it would publish
  // stale totals beside the shards.
  it('the retired single-file artifact is gone', () => {
    expect(fs.existsSync(path.join(REPO, LEGACY_COUNTS_PATH))).toBe(false);
  });

  it('renders deterministically', () => {
    const { model } = loaded();
    expect(renderCountShards(model)).toEqual(renderCountShards(model));
  });

  it('shards every triaged and every untriaged directory with sites, one file each', () => {
    const { model, shards } = loaded();
    expect([...shards.keys()].sort()).toEqual(
      [...model.triaged.map((t) => t.dir), ...model.other.map((o) => o.dir)].map(countsShardName).sort(),
    );
    expect(() => countsShardName('../x')).toThrow(/not a plain directory name/);
  });

  // THE LOCALITY CLAIM (#20361), asserted on the bytes. A shard that named a
  // sibling directory or carried a cross-directory total would carry a line two
  // PRs touching different directories both rewrite — the exact conflict the
  // split removes. So every backticked `dir/` a shard names is its own.
  it('each shard names only its own directory — no sibling, no cross-directory total', () => {
    const { shards } = loaded();
    for (const [name, text] of shards) {
      const own = `${name.slice(0, -'.md'.length)}/`;
      const named = new Set([...text.matchAll(/`([a-z][a-z0-9-]*\/)`/g)].map((m) => m[1]));
      expect([...named], name).toEqual([own]);
    }
  });

  // PARITY, the pin the split owes: the totals the single file COMMITTED are now
  // summed at read time, and they must be the sums of what the shards on disk
  // actually say — read back here row by row, not a second copy of the model's
  // arithmetic. `formatGlobalCounts` is what gen: and check: print.
  it('the read-time totals equal the sums of the shards\' own rows', () => {
    const { model } = loaded();
    const onDisk = readTextShardDir(path.join(REPO, COUNTS_DIR))!;
    const posture = [0, 0, 0, 0, 0];
    let untriaged = 0;
    for (const text of onDisk.values()) {
      const row = text.split('\n').find((l) => /^\| `[a-z][a-z0-9-]*\/` \| \d+ \| \d+ \| \d+ \| \d+ \| \d+ \|$/.test(l));
      if (row) {
        row.split('|').slice(2, -1).forEach((c, i) => (posture[i] += Number(c.trim())));
        continue;
      }
      const site = text.split('\n').find((l) => /^\| `[a-z][a-z0-9-]*\/` \| \d+ \|$/.test(l));
      expect(site, 'every shard carries a posture row or a site-total row').toBeDefined();
      untriaged += Number(site!.split('|')[2].trim());
    }
    const g = model.global;
    expect(posture).toEqual([g.sites, g.posture.strict, g.posture.passthrough, g.posture.catchall, g.posture.strip]);
    const [first, , third] = formatGlobalCounts(model);
    expect(first).toContain(`${g.sites} object site(s): strict ${posture[1]} · passthrough ${posture[2]}`);
    expect(third).toBe(`untriaged: ${untriaged} object site(s) across ${model.other.length} director(ies)`);
  });

  it('writes headers that carry no numbers, so links into it cannot rot', () => {
    // The ledger links into these files by anchor. Number-bearing headings
    // (`### \`ui/\` — 76 strip of 198`) change their anchor on every batch, i.e.
    // exactly when someone follows the link.
    const { shards } = loaded();
    const headings = [...shards.values()].flatMap((t) => t.split('\n').filter((l) => /^#{1,3} /.test(l)));
    expect(headings.length).toBeGreaterThan(shards.size);
    for (const h of headings) expect(h, `${h} must not carry a count`).not.toMatch(/\d/);
  });
});

describe('the ledger documents the grammar the parser enforces', () => {
  it('names every verdict the parser accepts, and no others', () => {
    // Two copies of a vocabulary drift, and the direction they drift in is the
    // one where an author writes what the doc says and the gate rejects it.
    //
    // The alternation is built FROM `VERDICTS` rather than transcribed. It used
    // to be a third hand-written copy of the list, which meant adding a verdict
    // (#5249's `covered`) failed here for the one reason this test is not about:
    // a word missing from the regex is reported as a word missing from the doc.
    const md = fs.readFileSync(path.join(REPO, LEDGER_PATH), 'utf-8');
    const block = md.split('## Classification rule')[0];
    const alternation = VERDICTS.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const documented = new Set([...block.matchAll(new RegExp(`\`(${alternation})\``, 'g'))].map((m) => m[1]));
    expect([...documented].sort()).toEqual([...VERDICTS].sort());
  });

  it('tells the reader the artifact is generated and how to regenerate it', () => {
    const md = fs.readFileSync(path.join(REPO, LEDGER_PATH), 'utf-8');
    expect(md).toContain('gen:strictness-ledger');
    expect(md).toContain(path.basename(COUNTS_DIR));
  });
});

function zero(): Record<string, number> {
  return {
    authorable: 0,
    unresolved: 0,
    'wire/open': 0,
    'no door': 0,
    'no gate': 0,
    covered: 0,
    unclassified: 0,
  };
}
