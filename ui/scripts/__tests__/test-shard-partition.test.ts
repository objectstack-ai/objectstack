import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper; its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  MIN_WEIGHT_MS,
  TIMINGS_SCHEMA,
  datasetWeights,
  describePlan,
  medianWeight,
  partition,
  pathKey,
  planShards,
} from '../test-shard-partition.mjs';
import { execFileSync } from 'node:child_process';

/**
 * The duration-balanced shard split (objectui#12208, ruling 6121816480,
 * letter B). What has to hold, and why each one is load-bearing:
 *
 *   - every leg of a matrix computes the WHOLE plan on its own and keeps its
 *     bin, so the plan must be a pure function of its inputs (a leg that
 *     disagreed by one file would run it twice or not at all) and the bins
 *     must partition the files exactly -- nothing twice, nothing dropped;
 *   - the plan must actually balance by the measured weight, or the card's
 *     defect (one lucky-heavy leg against the cap) is untouched;
 *   - a file the dataset does not name is weighed, not dropped;
 *   - the committed dataset parses, and the root vitest config actually wires
 *     the sequencer -- a split nobody calls is the hash split with extra steps.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A deterministic pseudo-random sequence, so a property test is a fixed reading. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A dataset over PATHS, keyed the way the committed one is: by `pathKey()`. */
function dataset(byPath: Record<string, number>) {
  const files = Object.fromEntries(Object.entries(byPath).map(([p, ms]) => [pathKey(p), ms]));
  return { schema: TIMINGS_SCHEMA, measured: { at: '2026-10-12T00:00:00Z', runs: [] }, files };
}

describe('partition: longest-processing-time first', () => {
  it('places every item exactly once, across many shapes and widths', () => {
    const rand = lcg(12208);
    for (let round = 0; round < 40; round += 1) {
      const n = 1 + Math.floor(rand() * 300);
      const count = 1 + Math.floor(rand() * 16);
      const items = Array.from({ length: n }, (_, i) => ({ key: `f${i}`, weight: Math.floor(rand() * 5000) + 1 }));
      const { bins } = partition(items, count);
      expect(bins).toHaveLength(count);
      const placed = bins.flat().sort((a, b) => a - b);
      expect(placed).toEqual(items.map((_, i) => i));
    }
  });

  it('answers the same plan for the same input, whatever order the input arrives in', () => {
    const rand = lcg(7);
    const items = Array.from({ length: 200 }, (_, i) => ({ key: `p/${i}.test.ts`, tie: 'unit', weight: Math.floor(rand() * 100) * 10 }));
    const keysOf = (bins: number[][], list: typeof items) => bins.map((bin) => bin.map((i) => list[i].key).sort());
    const forward = keysOf(partition(items, 12).bins, items);
    const shuffled = [...items].reverse();
    expect(keysOf(partition(shuffled, 12).bins, shuffled)).toEqual(forward);
  });

  it('balances: no leg exceeds the mean by more than the heaviest single item (the LPT bound)', () => {
    const rand = lcg(42);
    for (let round = 0; round < 20; round += 1) {
      const items = Array.from({ length: 2000 }, (_, i) => ({
        key: `f${i}`,
        // Heavy-tailed, the shape that made the hash split uneven: most files
        // cheap, a few an order of magnitude dearer.
        weight: rand() < 0.05 ? 20_000 + Math.floor(rand() * 40_000) : 500 + Math.floor(rand() * 3000),
      }));
      const { loads } = partition(items, 12);
      const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
      const heaviest = Math.max(...items.map((i) => i.weight));
      expect(Math.max(...loads)).toBeLessThanOrEqual(mean + heaviest);
    }
  });

  it('beats an equal-count split on a heavy-tailed population', () => {
    const rand = lcg(99);
    const items = Array.from({ length: 1200 }, (_, i) => ({
      key: `f${i}`,
      weight: rand() < 0.05 ? 30_000 : 1_000,
    }));
    // Equal file counts by index order: the hash split's shape, with the
    // heavy files wherever they happen to fall.
    const per = items.length / 12;
    const equalCount = Array.from({ length: 12 }, (_, b) =>
      items.slice(b * per, (b + 1) * per).reduce((s, i) => s + i.weight, 0),
    );
    const { loads } = partition(items, 12);
    expect(Math.max(...loads)).toBeLessThan(Math.max(...equalCount));
  });

  it('gives every leg at least one file when there are at least as many files as legs', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ key: `f${i}`, weight: i === 0 ? 1_000_000 : MIN_WEIGHT_MS }));
    expect(partition(items, 12).bins.every((bin) => bin.length === 1)).toBe(true);
  });

  it('refuses a width that is not a positive integer', () => {
    expect(() => partition([], 0)).toThrow(/positive integer/);
    expect(() => partition([], 1.5)).toThrow(/positive integer/);
  });
});

describe('planShards: the dataset decides the weights', () => {
  const specs = [
    { path: 'a.test.ts', project: 'unit' },
    { path: 'b.test.tsx', project: 'dom' },
    { path: 'c.test.tsx', project: 'dom-heavy' },
    { path: 'new.test.ts', project: 'unit' },
  ];

  it('weighs a measured file by its measurement and an unmeasured one at the median', () => {
    const plan = planShards(specs, dataset({ 'a.test.ts': 100, 'b.test.tsx': 300, 'c.test.tsx': 9000 }), 2);
    expect(plan.unknown).toEqual(['new.test.ts']);
    expect(plan.median).toBe(300);
    expect(plan.total).toBe(100 + 300 + 9000 + 300);
    // The heavy file sits alone; the rest share the other leg.
    const heavyLeg = plan.bins.findIndex((bin) => bin.includes(2));
    expect(plan.bins[heavyLeg]).toEqual([2]);
    expect(plan.bins[1 - heavyLeg].sort()).toEqual([0, 1, 3]);
  });

  it('splits a file that is a specification of two projects between them, rather than counting it twice', () => {
    const twice = [
      { path: 'shared.test.ts', project: 'unit' },
      { path: 'shared.test.ts', project: 'dom' },
    ];
    const plan = planShards(twice, dataset({ 'shared.test.ts': 1000 }), 2);
    expect(plan.loads).toEqual([500, 500]);
  });

  it('names its own share in one line', () => {
    const data = dataset({ 'a.test.ts': 100, 'b.test.tsx': 300, 'c.test.tsx': 9000 });
    const line = describePlan(planShards(specs, data, 2), 1, data);
    expect(line).toMatch(/^test-shard-sequencer: shard 1\/2 runs \d+ of 4 files/);
    expect(line).toContain('measured 2026-10-12T00:00:00Z');
    expect(line).toContain('1 file(s) not in the timings');
  });
});

describe('datasetWeights: a dataset this reader cannot read is refused, never guessed at', () => {
  it('refuses another schema, a missing `files`, a non-number weight, and a key that is a path', () => {
    expect(() => datasetWeights({ schema: 'something/else', files: {} })).toThrow(/schema/);
    expect(() => datasetWeights({ schema: TIMINGS_SCHEMA })).toThrow(/files/);
    expect(() => datasetWeights(dataset({ 'a.test.ts': -1 }))).toThrow(/non-negative/);
    expect(() => datasetWeights(dataset({ 'a.test.ts': Number.NaN }))).toThrow(/non-negative/);
    expect(() => datasetWeights({ schema: TIMINGS_SCHEMA, files: { 'a.test.ts': 1 } })).toThrow(/never a path/);
  });

  it('reads the floor as the median of an empty dataset', () => {
    expect(medianWeight(datasetWeights(dataset({})))).toBe(MIN_WEIGHT_MS);
  });
});

describe('the committed wiring', () => {
  const datasetText = fs.readFileSync(path.join(repoRoot, 'scripts/test-shard-timings.json'), 'utf8');
  const trackedTests = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0')
    .filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));

  it('commits a dataset the reader accepts, whose keys name tracked test files', () => {
    const weights = datasetWeights(JSON.parse(datasetText));
    if (weights.size === 0) return; // the pre-measurement shape: the sequencer keeps vitest's own split
    const live = trackedTests.filter((f) => weights.has(pathKey(f)));
    // A live control, not a staleness gate: a dataset whose keys resolve to no
    // tracked test at all is keyed some other way than `pathKey()`.
    expect(live.length, 'no key of the committed dataset is pathKey() of a tracked test file').toBeGreaterThan(0);
  });

  it('carries no test file path, so no retired-spelling sweep of the tree can meet one in it (run 38271639400)', () => {
    expect(trackedTests.length, 'a zero is a broken `git ls-files`, not an empty repository').toBeGreaterThan(100);
    const found = trackedTests.filter((f) => datasetText.includes(path.posix.basename(f)));
    expect(found).toEqual([]);
  });

  it('wires the sequencer into the root vitest config, which is the only config vitest reads it from', () => {
    const config = fs.readFileSync(path.join(repoRoot, 'vitest.config.mts'), 'utf8');
    expect(config).toMatch(/^import TestShardSequencer from '\.\/scripts\/test-shard-sequencer\.mjs';$/m);
    expect(config).toMatch(/^ {4}sequence: \{ sequencer: TestShardSequencer \},$/m);
  });

  it('imports the dataset, so a change to it is inside the root config\'s import closure (a full run)', () => {
    const sequencer = fs.readFileSync(path.join(repoRoot, 'scripts/test-shard-sequencer.mjs'), 'utf8');
    expect(sequencer).toContain("from './test-shard-timings.json' with { type: 'json' }");
  });
});

describe('the vitest adapter keeps exactly its own bin', async () => {
  // Imported here rather than at the top: it pulls `vitest/node` in, which
  // only this block needs.
  const { default: TestShardSequencer } = await import('../test-shard-sequencer.mjs');

  const root = '/repo';
  const specs = ['a.test.ts', 'b.test.ts', 'c.test.tsx', 'd.test.tsx', 'e.test.ts'].map((p, i) => ({
    moduleId: `${root}/${p}`,
    project: { name: i % 2 ? 'dom' : 'unit' },
  }));
  const fakeCtx = (index: number, count: number, logged: string[]) => ({
    config: { root, shard: { index, count } },
    logger: { log: (line: string) => logged.push(line) },
  });

  it('hands back each leg its bin of the plan, and the legs together cover every file once', async () => {
    const seen: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      const logged: string[] = [];
      const sequencer = new TestShardSequencer(fakeCtx(index, 3, logged) as never);
      const mine = (await sequencer.shard(specs as never)) as unknown as typeof specs;
      seen.push(...mine.map((s) => s.moduleId));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatch(new RegExp(`^test-shard-sequencer: shard ${index}/3`));
    }
    expect(seen.sort()).toEqual(specs.map((s) => s.moduleId).sort());
  });
});
