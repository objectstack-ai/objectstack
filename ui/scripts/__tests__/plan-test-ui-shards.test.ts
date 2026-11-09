import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helpers; their types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  assertPartition,
  compareRan,
  filterUnits,
  PLAN_SCHEMA,
  planRun,
  readPlan,
  readSpecs,
  slotBin,
  slotFilters,
  UI_ROOT,
} from '../plan-test-ui-shards.mjs';
import { pathKey, planShards, TIMINGS_SCHEMA } from '../test-shard-partition.mjs';
import { liveShardTotal } from '../../../scripts/ci-shard-matrix.mjs';

/**
 * objectstack#31914 -- the Test UI plan: which `Test UI (k/16)` slots a run
 * starts and which files each one runs. What has to hold, and why each one is
 * load-bearing:
 *
 *   - the bins PARTITION what vitest collected: every specification in
 *     exactly one bin, nothing invented. With every leg proving it ran exactly
 *     its bin (`compareRan`), that is "every selected file ran in exactly one
 *     slot";
 *   - the full plan is the sequencer's own split (`planShards()` over the whole
 *     suite at the roster), so a full leg's check compares with what
 *     `--shard=k/16` really runs;
 *   - the count rule: N = clamp(ceil(P / D), 1, min(roster, files)), D the
 *     whole suite's predicted ms over the roster, from the dataset, per run;
 *   - the digest names the plan, so a leg that derived another one refuses;
 *   - the always-on LANE (the selector's `--lane-out`) is slot 1 of an
 *     affected plan, and only of one; the rest packs into slots 2..N+1;
 *   - paths that are vitest filters of each other share a slot, and the leg
 *     hands vitest only the shortest (the invocation guard's rule).
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../plan-test-ui-shards.mjs');
const DATASET = JSON.parse(fs.readFileSync(path.resolve(HERE, '../test-shard-timings.json'), 'utf8'));

type Spec = { path: string; project: string };

/** A dataset of exactly these path weights, in ms. */
function dataset(weights: Record<string, number>) {
  return { schema: TIMINGS_SCHEMA, files: Object.fromEntries(Object.entries(weights).map(([p, ms]) => [pathKey(p), ms])) };
}

/** A deterministic pseudo-random sequence, so a property test is a fixed reading. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A synthetic suite: `files` paths, a fifth of them collected by two projects. */
function suite(files: number, seed = 1) {
  const rand = lcg(seed);
  const weights: Record<string, number> = {};
  const specs: Spec[] = [];
  for (let i = 0; i < files; i += 1) {
    const p = `packages/p${i % 7}/src/f${i}.test.ts`;
    if (rand() < 0.9) weights[p] = Math.round(50 + rand() * 20_000); // a tenth is unmeasured: the median
    specs.push({ path: p, project: `@object-ui/p${i % 7}` });
    if (i % 5 === 0) specs.push({ path: p, project: 'dom-heavy' });
  }
  return { specs, data: dataset(weights) };
}

const ids = (bins: Spec[][]) => bins.flat().map((s) => `${s.path} ${s.project}`).sort();

describe('the bins partition what vitest collected', () => {
  it('a full plan is the sequencer split: planShards() over the whole suite at the roster, slot k = bin k', () => {
    const { specs, data } = suite(300);
    const plan = planRun({ all: specs, dataset: data, slots: 16 });
    expect(plan.mode).toBe('full');
    expect(plan.split).toBe('sequencer');
    expect(plan.shards).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    const sequencer = planShards(specs, data, 16);
    expect(plan.bins).toEqual(sequencer.bins.map((bin) => bin.map((i) => specs[i])));
  });

  it('an affected plan holds every selected specification once, and nothing else, across many selections', () => {
    const { specs, data } = suite(400, 7);
    const rand = lcg(42);
    for (let round = 0; round < 40; round += 1) {
      const keep = new Set(specs.filter(() => rand() < rand()).map((s) => s.path));
      const selected = specs.filter((s) => keep.has(s.path));
      const plan = planRun({ all: specs, selected, dataset: data, slots: 16 });
      expect(ids(plan.bins)).toEqual(ids([selected]));
      expect(plan.bins.every((bin) => bin.length > 0)).toBe(true);
    }
  });

  it('a file two projects collect runs in both, on one leg, never split across two', () => {
    const { specs, data } = suite(200, 3);
    const plan = planRun({ all: specs, selected: specs, dataset: data, slots: 16 });
    const slotOf = new Map<string, Set<number>>();
    plan.bins.forEach((bin, i) => bin.forEach((s) => slotOf.set(s.path, (slotOf.get(s.path) ?? new Set()).add(i))));
    expect([...slotOf.values()].every((slots) => slots.size === 1)).toBe(true);
    expect(plan.bins.flat().filter((s) => s.project === 'dom-heavy').length).toBe(specs.filter((s) => s.project === 'dom-heavy').length);
  });

  it('assertPartition refuses a dropped, a doubled and an invented specification', () => {
    const specs: Spec[] = [
      { path: 'a.test.ts', project: 'x' },
      { path: 'b.test.ts', project: 'x' },
      { path: 'b.test.ts', project: 'y' },
    ];
    expect(() => assertPartition(specs, [[specs[0]], [specs[1], specs[2]]])).not.toThrow();
    expect(() => assertPartition(specs, [[specs[0]], [specs[1]]])).toThrow(/not a partition/);
    expect(() => assertPartition(specs, [[specs[0], specs[0]], [specs[1], specs[2]]])).toThrow(/not a partition/);
    expect(() => assertPartition(specs, [[specs[0], { path: 'c.test.ts', project: 'x' }], [specs[1], specs[2]]])).toThrow(/not a partition/);
  });
});

describe('the count rule: N = clamp(ceil(P / D), 1, min(roster, files))', () => {
  // Sixteen files of 1,000 ms: the suite is 16,000 ms, so D = 1,000 ms at 16 slots.
  const files = Array.from({ length: 16 }, (_, i) => `f${String(i).padStart(2, '0')}.test.ts`);
  const all = files.map((p) => ({ path: p, project: 'x' }));
  const data = dataset(Object.fromEntries(files.map((p) => [p, 1_000])));
  const pick = (n: number) => all.slice(0, n);

  it('D is the whole suite over the roster, read off the dataset', () => {
    const plan = planRun({ all, selected: pick(3), dataset: data, slots: 16 });
    expect(plan.suiteMs).toBe(16_000);
    expect(plan.densityMs).toBe(1_000);
    expect(plan.selectedMs).toBe(3_000);
    expect(plan.shards).toEqual([1, 2, 3]);
    // The same selection against a suite twice as heavy packs twice as dense.
    const heavier = dataset(Object.fromEntries(files.map((p, i) => [p, i < 8 ? 1_000 : 3_000])));
    expect(planRun({ all, selected: pick(3), dataset: heavier, slots: 16 }).shards).toEqual([1, 2]);
  });

  it('at least one leg for any selection, none for an empty one, never more than the roster or the files', () => {
    const light = dataset(Object.fromEntries(files.map((p, i) => [p, i === 0 ? 1 : 1_000])));
    expect(planRun({ all, selected: pick(1), dataset: light, slots: 16 }).shards).toEqual([1]);
    expect(planRun({ all, selected: [], dataset: data, slots: 16 }).shards).toEqual([]);
    expect(planRun({ all, selected: all, dataset: data, slots: 16 }).shards).toHaveLength(16);
    expect(planRun({ all, selected: all, dataset: data, slots: 4 }).shards).toHaveLength(4);
    const heavyOne = dataset({ ...Object.fromEntries(files.map((p) => [p, 1])), [files[0]]: 100_000 });
    expect(planRun({ all, selected: pick(2), dataset: heavyOne, slots: 16 }).shards).toEqual([1, 2]);
  });

  it('N follows the count rule on the committed dataset, so the bins average at most D', () => {
    const paths = Object.keys(DATASET.files).length;
    expect(paths).toBeGreaterThan(0);
    const { specs } = suite(600, 11);
    const rand = lcg(5);
    for (let round = 0; round < 20; round += 1) {
      const keep = new Set(specs.filter(() => rand() < 0.4).map((s) => s.path));
      const selected = specs.filter((s) => keep.has(s.path));
      const plan = planRun({ all: specs, selected, dataset: DATASET, slots: 16 });
      expect(plan.shards.length).toBe(Math.max(1, Math.min(16, keep.size, Math.ceil(plan.selectedMs / plan.densityMs - 1e-9))));
    }
  });
});

describe('the always-on lane is slot 1 of an affected plan (ruling 6739581615)', () => {
  // Twenty files of 1,000 ms: D = 20,000 / 16 = 1,250 ms.
  const files = Array.from({ length: 20 }, (_, i) => `packages/q/src/g${String(i).padStart(2, '0')}.test.ts`);
  const all: Spec[] = files.map((p) => ({ path: p, project: 'x' }));
  const data = dataset(Object.fromEntries(files.map((p) => [p, 1_000])));
  const lane = files.slice(0, 4);

  it('runs the lane alone on slot 1 and packs the rest into slots 2..N+1 by the count rule', () => {
    const selected = all.slice(0, 9); // four lane files and five others: 5,000 ms over D = 1,250 ms
    const plan = planRun({ all, selected, lane, dataset: data, slots: 16 });
    expect(plan.lane).toBe(true);
    expect(plan.laneMs).toBe(4_000);
    expect(plan.bins[0].map((s) => s.path)).toEqual(lane);
    expect(plan.shards).toEqual([1, 2, 3, 4, 5]);
    expect(ids(plan.bins)).toEqual(ids([selected]));
    expect(plan.bins.slice(1).flat().some((s) => lane.includes(s.path))).toBe(false);
  });

  it('a selection of only always-on files is the lane alone; a lane path the selection lacks is not invented', () => {
    const plan = planRun({ all, selected: all.slice(0, 2), lane, dataset: data, slots: 16 });
    expect(plan.shards).toEqual([1]);
    expect(plan.bins[0].map((s) => s.path)).toEqual(lane.slice(0, 2));
  });

  it('never more than the roster: the lane takes one slot, the rest at most the others', () => {
    // The rest is 16,000 ms against D = 1,250 ms: 13 more slots.
    expect(planRun({ all, selected: all, lane, dataset: data, slots: 16 }).shards).toHaveLength(14);
    // Light lane files make D ~1,000 ms, so the rest asks for 16 slots and gets the 15 left.
    const light = dataset(Object.fromEntries(files.map((p, i) => [p, i < 4 ? 1 : 1_000])));
    const plan = planRun({ all, selected: all, lane, dataset: light, slots: 16 });
    expect(Math.ceil((plan.selectedMs - plan.laneMs) / plan.densityMs)).toBe(16);
    expect(plan.shards).toHaveLength(16);
    expect(ids(plan.bins)).toEqual(ids([all]));
    const one = planRun({ all, selected: all, lane, dataset: data, slots: 1 });
    expect(one.shards).toEqual([1]);
    expect(ids(one.bins)).toEqual(ids([all]));
  });

  it('no lane given, or none of it selected, plans as before; a full plan refuses one', () => {
    const selected = all.slice(10, 14);
    const without = planRun({ all, selected, dataset: data, slots: 16 });
    expect(without.lane).toBe(false);
    expect(planRun({ all, selected, lane, dataset: data, slots: 16 })).toEqual(without);
    expect(planRun({ all, selected, lane: [], dataset: data, slots: 16 }).digest).toBe(without.digest);
    expect(planRun({ all, selected: all.slice(0, 6), lane, dataset: data, slots: 16 }).digest).not.toBe(
      planRun({ all, selected: all.slice(0, 6), dataset: data, slots: 16 }).digest,
    );
    expect(() => planRun({ all, lane, dataset: data, slots: 16 })).toThrow(/a full plan has none/);
  });

  it('holds the partition with a lane across many selections', () => {
    const { specs, data: weights } = suite(400, 13);
    const rand = lcg(77);
    const always = [...new Set(specs.map((s) => s.path))].filter(() => rand() < 0.15);
    for (let round = 0; round < 30; round += 1) {
      const keep = new Set(specs.filter(() => rand() < rand()).map((s) => s.path));
      const selected = specs.filter((s) => keep.has(s.path));
      const plan = planRun({ all: specs, selected, lane: always, dataset: weights, slots: 16 });
      expect(ids(plan.bins)).toEqual(ids([selected]));
      expect(plan.shards.length).toBeLessThanOrEqual(16);
      if (plan.lane) expect(new Set(plan.bins[0].map((s) => s.path))).toEqual(new Set(always.filter((p) => keep.has(p))));
      expect(plan.bins.slice(plan.lane ? 1 : 0).flat().some((s) => always.includes(s.path))).toBe(false);
    }
  });
});

describe('paths that are vitest filters of each other share a slot (contract review 6742203717, F1)', () => {
  const pair = ['packages/r/src/x.test.ts', 'packages/r/src/X.test.tsx'];
  const others = Array.from({ length: 30 }, (_, i) => `packages/r/src/o${String(i).padStart(2, '0')}.test.ts`);
  const all: Spec[] = [...pair, ...others].map((p) => ({ path: p, project: 'x' }));
  const data = dataset(Object.fromEntries([...pair, ...others].map((p) => [p, 1_000])));

  it('groups a pair case-insensitively, as vitest matches, and refuses a selection that lacks the longer one', () => {
    expect(filterUnits([...pair, others[0]], [...pair, ...others])).toEqual([pair, [others[0]]]);
    expect(() => filterUnits([pair[0]], [...pair, ...others])).toThrow(/also matches packages\/r\/src\/X\.test\.tsx/);
    expect(filterUnits([pair[1]], [...pair, ...others])).toEqual([[pair[1]]]);
  });

  it('packs the pair on one slot, or the lane when either is always-on, and the leg hands vitest only the shorter', () => {
    for (let n = 0; n < 8; n += 1) {
      const plan = planRun({ all, selected: all.slice(0, 2 + n * 4), dataset: data, slots: 16 });
      expect(plan.bins.filter((bin) => bin.some((s) => pair.includes(s.path)))).toHaveLength(1);
    }
    const laned = planRun({ all, selected: all, lane: [pair[1]], dataset: data, slots: 16 });
    expect(laned.lane).toBe(true);
    expect(laned.laneMs).toBe(2_000);
    expect(laned.bins[0].map((s) => s.path).sort()).toEqual([...pair].sort());
    expect(slotFilters(laned.bins[0].map((s) => s.path))).toEqual([pair[0]]);
    expect(slotFilters([others[1], pair[1], pair[0], others[1]])).toEqual([others[1], pair[0]]);
  });
});

describe('the digest names the plan', () => {
  const { specs, data } = suite(120, 9);
  const selected = specs.filter((_, i) => i % 3 === 0);

  it('is the same however vitest ordered its list, and differs when any bin differs', () => {
    const a = planRun({ all: specs, selected, dataset: data, slots: 16 });
    const b = planRun({ all: [...specs].reverse(), selected: [...selected].reverse(), dataset: data, slots: 16 });
    expect(b.digest).toBe(a.digest);
    expect(planRun({ all: specs, selected: selected.slice(1), dataset: data, slots: 16 }).digest).not.toBe(a.digest);
    expect(planRun({ all: specs, dataset: data, slots: 16 }).digest).not.toBe(a.digest);
  });
});

describe('a leg checks what vitest ran against its bin', () => {
  const { specs, data } = suite(80, 4);
  const plan = planRun({ all: specs, selected: specs, dataset: data, slots: 16 });
  const slot = plan.shards[0];
  const bin = slotBin(plan, slot);
  const report = (names: string[]) => ({ testResults: names.map((name) => ({ name: path.join(UI_ROOT, name) })) });
  const exact = bin.map((s) => s.path);

  it('passes only on exactly the bin, as a multiset of paths', () => {
    expect(compareRan(plan, slot, report(exact))).toMatchObject({ missing: [], extra: [], unchecked: false });
    expect(compareRan(plan, slot, report([...exact].reverse())).missing).toEqual([]);
  });

  it('names a missing, an extra and a repeated file', () => {
    expect(compareRan(plan, slot, report(exact.slice(1))).missing).toHaveLength(1);
    expect(compareRan(plan, slot, report([...exact, 'packages/elsewhere/x.test.ts'])).extra).toEqual([
      'packages/elsewhere/x.test.ts (ran 1, planned 0)',
    ]);
    expect(compareRan(plan, slot, report([...exact, exact[0]])).extra).toHaveLength(1);
  });

  it('refuses a slot the plan did not start, and a report it cannot read', () => {
    expect(() => compareRan(plan, 17, report(exact))).toThrow(/not one this affected plan started/);
    expect(() => compareRan(plan, slot, {})).toThrow(/no `testResults`/);
  });

  it('a full plan over a dataset with nothing measured is vitest’s own hash split, the sequencer’s fallback: unchecked, never red', () => {
    const empty = planRun({ all: specs, dataset: { schema: TIMINGS_SCHEMA, files: {} }, slots: 16 });
    expect(empty.split).toBe('vitest-hash');
    expect(empty.shards).toHaveLength(16);
    expect(compareRan(empty, 3, report(exact))).toMatchObject({ unchecked: true, missing: [], extra: [] });
  });
});

describe('readSpecs reads `vitest list --filesOnly --json` and nothing it cannot', () => {
  it('turns absolute paths into paths relative to the vitest root', () => {
    expect(readSpecs([{ file: path.join(UI_ROOT, 'apps/console/src/a.test.tsx'), projectName: '@object-ui/console' }])).toEqual([
      { path: 'apps/console/src/a.test.tsx', project: '@object-ui/console' },
    ]);
  });

  it('refuses a list that is not one, an entry without a file, and a file outside the root', () => {
    expect(() => readSpecs({})).toThrow(/not a JSON array/);
    expect(() => readSpecs([{ projectName: 'x' }])).toThrow(/carries no `file`/);
    expect(() => readSpecs([{ file: path.join(UI_ROOT, '..', 'packages/core/a.test.ts') }])).toThrow(/outside the ui root/);
  });
});

/* ── the command line, as the workflow calls it ─────────────────────────── */

let scratch: string;
beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-test-ui-shards-31914-'));
});
afterAll(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

function cli(...args: string[]) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: run.status, out: run.stdout, err: run.stderr };
}

describe('the command line', () => {
  /** Paths the committed dataset does not name: the CLI weighs each at its median. */
  const list = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ file: path.join(UI_ROOT, `packages/cli-${i}/src/x.test.ts`), projectName: 'unit' }));

  it('plans on the roster ci.yml declares, writes the outputs the matrix reads, and refuses a digest it did not derive', () => {
    const all = path.join(scratch, 'all.json');
    const sel = path.join(scratch, 'sel.json');
    fs.writeFileSync(all, JSON.stringify(list(40)));
    fs.writeFileSync(sel, JSON.stringify(list(40).slice(0, 5)));
    const out = path.join(scratch, 'plan.json');
    const gho = path.join(scratch, 'gho');
    fs.writeFileSync(gho, '');
    const first = cli('plan', '--all', all, '--selected', sel, '--out', out, '--github-output', gho);
    expect(first.status, first.err).toBe(0);
    const plan = readPlan(out);
    expect(plan.schema).toBe(PLAN_SCHEMA);
    expect(plan.slots).toBe(liveShardTotal('test-ui'));
    expect(fs.readFileSync(gho, 'utf8')).toBe(`shards=${JSON.stringify(plan.shards)}\ndigest=${plan.digest}\nmode=affected\n`);

    const again = cli('plan', '--all', all, '--selected', sel, '--out', path.join(scratch, 'again.json'), '--expect-digest', plan.digest);
    expect(again.status, again.err).toBe(0);
    const other = cli('plan', '--all', all, '--out', path.join(scratch, 'other.json'), '--expect-digest', plan.digest);
    expect(other.status).toBe(1);
    expect(other.err).toContain('is not the plan the matrix was built from');
    expect(fs.existsSync(path.join(scratch, 'other.json'))).toBe(false);

    const files = cli('files', '--plan', out, '--slot', String(plan.shards[0]));
    expect(files.status, files.err).toBe(0);
    expect(files.out.split('\n').filter(Boolean)).toEqual([...new Set(slotBin(plan, plan.shards[0]).map((s) => s.path))]);
  });

  it('warns, never refuses, when the always-on lane predicts more than D (contract review 6745712800, F1)', () => {
    // Forty unmeasured files weigh the median m each, so D = 40m / 16 = 2.5m:
    // a lane of two is under D, a lane of three is over it.
    const all = path.join(scratch, 'all.json');
    const sel = path.join(scratch, 'sel-warn.json');
    fs.writeFileSync(all, JSON.stringify(list(40)));
    fs.writeFileSync(sel, JSON.stringify(list(40).slice(0, 8)));
    const laneOf = (n: number) => {
      const file = path.join(scratch, `lane-${n}.txt`);
      fs.writeFileSync(file, list(40).slice(0, n).map((e) => `${path.relative(UI_ROOT, e.file)}\n`).join(''));
      return file;
    };
    const under = cli('plan', '--all', all, '--selected', sel, '--lane', laneOf(2), '--out', path.join(scratch, 'under.json'));
    expect(under.status, under.err).toBe(0);
    expect(under.out).not.toContain('::warning');
    const over = cli('plan', '--all', all, '--selected', sel, '--lane', laneOf(3), '--out', path.join(scratch, 'over.json'));
    expect(over.status, over.err).toBe(0);
    const plan = readPlan(path.join(scratch, 'over.json'));
    expect(plan.laneMs).toBeGreaterThan(plan.densityMs);
    expect(over.out).toMatch(/^::warning title=Test UI always-on lane::the always-on lane on slot 1 predicts \d+ s, more than the \d+ s a full-battery leg averages/m);
    expect(slotBin(plan, 1)).toHaveLength(3);
  });

  it('plans the lane from --lane, names it, and `files` gives slot 1 the lane', () => {
    const all = path.join(scratch, 'all.json');
    const sel = path.join(scratch, 'sel.json');
    const lane = path.join(scratch, 'lane.txt');
    const always = list(40).slice(0, 2).map((e) => path.relative(UI_ROOT, e.file));
    fs.writeFileSync(lane, always.map((p) => `${p}\n`).join(''));
    const out = path.join(scratch, 'lane-plan.json');
    const run = cli('plan', '--all', all, '--selected', sel, '--lane', lane, '--out', out);
    expect(run.status, run.err).toBe(0);
    expect(run.out).toMatch(/slot 1: 2 file\(s\), the always-on lane/);
    const plan = readPlan(out);
    expect(plan.lane).toBe(true);
    expect(cli('files', '--plan', out, '--slot', '1').out.split('\n').filter(Boolean).sort()).toEqual([...always].sort());
    expect(cli('plan', '--all', all, '--lane', lane, '--out', path.join(scratch, 'full-lane.json')).err).toContain('a full plan has none');
  });

  it('verify-ran exits 1 naming the difference, 0 on exactly the bin', () => {
    const out = path.join(scratch, 'plan.json');
    const plan = readPlan(out);
    const bin = slotBin(plan, 1).map((s) => path.join(UI_ROOT, s.path));
    const good = path.join(scratch, 'good.json');
    const bad = path.join(scratch, 'bad.json');
    fs.writeFileSync(good, JSON.stringify({ testResults: bin.map((name) => ({ name })) }));
    fs.writeFileSync(bad, JSON.stringify({ testResults: bin.slice(1).map((name) => ({ name })) }));
    const ok = cli('verify-ran', '--plan', out, '--slot', '1', '--report', good);
    expect(ok.status, ok.err).toBe(0);
    expect(ok.out).toContain('ran exactly its');
    const red = cli('verify-ran', '--plan', out, '--slot', '1', '--report', bad);
    expect(red.status).toBe(1);
    expect(red.err).toContain('1 missing, 0 extra');
  });

  it('readPlan refuses a plan whose bins were edited after it was written', () => {
    const out = path.join(scratch, 'plan.json');
    const plan = JSON.parse(fs.readFileSync(out, 'utf8'));
    plan.bins[0].pop();
    const edited = path.join(scratch, 'edited.json');
    fs.writeFileSync(edited, JSON.stringify(plan));
    expect(() => readPlan(edited)).toThrow(/do not hash to its digest/);
  });
});
