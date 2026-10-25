import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// Plain-JS CI helpers; their types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import FileTimingsReporter, {
  OUT_ENV,
  REPORT_SCHEMA,
  ROUND_MS,
  artifactName,
  buildDataset,
  fileRecord,
  judgeRun,
  medianDurations,
  summarize,
  readRunReports,
  runDurations,
  shardJobName,
} from '../test-file-timings.mjs';
import { TIMINGS_SCHEMA, datasetWeights, pathKey } from '../test-shard-partition.mjs';

/**
 * The per-file timing pipeline (objectui#12208): the reporter that measures on
 * the full battery, the selector that picks which runs feed the dataset, and
 * the generator that writes `scripts/test-shard-timings.json`. Plus the pins
 * that hold `ci.yml` to the names and flags this file spells.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ciYaml = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

/** A TestModule-shaped object, as vitest 4 hands one to `onTestRunEnd`. */
function testModule(file: string, d: Record<string, number>, project = 'unit') {
  return {
    moduleId: path.join('/repo', file),
    project: { name: project },
    state: () => 'passed',
    diagnostic: () => d,
  };
}

describe('the writer', () => {
  let dir: string;
  let saved: string | undefined;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-timings-'));
    saved = process.env[OUT_ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[OUT_ENV];
    else process.env[OUT_ENV] = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records a module's whole time on its worker, not only its tests' span", () => {
    const record = fileRecord(
      testModule('packages/x/a.test.tsx', {
        environmentSetupDuration: 40,
        prepareDuration: 10,
        setupDuration: 900,
        collectDuration: 300,
        duration: 50,
      }),
      '/repo',
    );
    expect(record).toEqual({ file: 'packages/x/a.test.tsx', project: 'unit', ms: 1300, state: 'passed' });
  });

  it('reads a module whose diagnostic throws as zero, never throwing itself', () => {
    const broken = { moduleId: '/repo/b.test.ts', project: { name: 'unit' }, state: () => 'failed', diagnostic: () => { throw new Error('no'); } };
    expect(fileRecord(broken, '/repo').ms).toBe(0);
  });

  it('writes one report to the named file, with the shard it ran as', () => {
    const out = path.join(dir, 'nested', 'shard-3.json');
    process.env[OUT_ENV] = out;
    const reporter = new FileTimingsReporter();
    reporter.onInit({ config: { root: '/repo', shard: { index: 3, count: 12 }, coverage: { enabled: false } } });
    reporter.onTestRunEnd([testModule('a.test.ts', { duration: 5 })]);
    const report = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(report).toMatchObject({ schema: REPORT_SCHEMA, shard: '3/12', coverage: false });
    expect(report.files).toEqual([{ file: 'a.test.ts', project: 'unit', ms: 5, state: 'passed' }]);
  });

  it('writes nothing, and throws nothing, when no output is named', () => {
    delete process.env[OUT_ENV];
    const reporter = new FileTimingsReporter();
    reporter.onInit({ config: { root: '/repo' } });
    expect(() => reporter.onTestRunEnd([testModule('a.test.ts', { duration: 5 })])).not.toThrow();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('the generator', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-timings-merge-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const report = (files: Array<[string, number]>, shard = '1/2') => ({
    schema: REPORT_SCHEMA,
    shard,
    coverage: false,
    files: files.map(([file, ms]) => ({ file, project: 'unit', ms, state: 'passed' })),
  });

  it("reads every report under a run's directory, artifact subdirectories included", () => {
    const run = path.join(dir, '101');
    fs.mkdirSync(path.join(run, 'test-file-timings-1'), { recursive: true });
    fs.mkdirSync(path.join(run, 'test-file-timings-2'), { recursive: true });
    fs.writeFileSync(path.join(run, 'test-file-timings-1', 'shard-1.json'), JSON.stringify(report([['a.test.ts', 100]])));
    fs.writeFileSync(path.join(run, 'test-file-timings-2', 'shard-2.json'), JSON.stringify(report([['b.test.ts', 200]], '2/2')));
    expect([...runDurations(readRunReports(run))]).toEqual([
      ['a.test.ts', 100],
      ['b.test.ts', 200],
    ]);
  });

  it('refuses a file that is not a writer report, rather than reading it as empty', () => {
    const run = path.join(dir, '102');
    fs.mkdirSync(run);
    fs.writeFileSync(path.join(run, 'x.json'), JSON.stringify({ schema: 'other', files: [] }));
    expect(() => readRunReports(run)).toThrow(/is not a/);
  });

  it('keeps the median across runs, rounds it, and writes the same bytes for the same inputs', () => {
    const runs = [
      { meta: { id: 1 }, durations: new Map([['a.test.ts', 1000], ['b.test.ts', 10]]) },
      { meta: { id: 2 }, durations: new Map([['a.test.ts', 1004], ['c.test.ts', 55]]) },
      { meta: { id: 3 }, durations: new Map([['a.test.ts', 9999]]) },
    ];
    const one = buildDataset({ runs, measuredAt: '2026-10-12T00:00:00Z' });
    const two = buildDataset({ runs: [...runs].reverse(), measuredAt: '2026-10-12T00:00:00Z' });
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    expect(one.schema).toBe(TIMINGS_SCHEMA);
    expect([...medianDurations(runs)]).toEqual([
      ['a.test.ts', 1000],
      ['b.test.ts', 10],
      ['c.test.ts', 60],
    ]);
    // Keyed by pathKey(), never by the path (the sweep collision on run 38271639400).
    expect(one.files).toEqual({ [pathKey('a.test.ts')]: 1000, [pathKey('b.test.ts')]: 10, [pathKey('c.test.ts')]: 60 });
    expect(JSON.stringify(one)).not.toContain('a.test.ts');
    expect(Object.keys(one.files)).toEqual([...Object.keys(one.files)].sort());
    expect(Object.values(one.files).every((v) => v % ROUND_MS === 0)).toBe(true);
    expect(one.measured.runs).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(() => datasetWeights(one)).not.toThrow();
  });

  it('refuses to build a dataset from no run at all', () => {
    expect(() => buildDataset({ runs: [], measuredAt: 'x' })).toThrow(/no run/);
  });

  it("names the refresh's new files by path in its summary, from the runs' own reports", () => {
    const runs = [{ meta: { id: 9, event: 'schedule', head_sha: 'abcdef1234567' }, durations: new Map([['old.test.ts', 100], ['new.test.ts', 9000]]) }];
    const dataset = buildDataset({ runs, measuredAt: '2026-10-19T00:00:00Z' });
    const previous = { files: { [pathKey('old.test.ts')]: 90, [pathKey('gone.test.ts')]: 5 } };
    const text = summarize(medianDurations(runs), dataset, previous);
    expect(text).toContain('**Measured for the first time (1):**\n- `new.test.ts`');
    expect(text).toContain('**No longer measured: 1.**');
    expect(text).toContain('- 9.0 s `new.test.ts`');
    expect(text).not.toMatch(/[<>]/);
  });
});

describe('the selector', () => {
  const jobs = (conclusions: string[]) => conclusions.map((c, i) => ({ name: shardJobName(i + 1, conclusions.length), conclusion: c }));
  const artifacts = (n: number) => Array.from({ length: n }, (_, i) => ({ name: artifactName(i + 1), expired: false }));

  it('takes a run whose every shard succeeded and whose every artifact is there', () => {
    expect(judgeRun({ jobs: jobs(['success', 'success']), artifacts: artifacts(2), shards: 2 }).eligible).toBe(true);
  });

  it('skips a run with a red, cancelled or missing shard, or a missing or expired artifact', () => {
    expect(judgeRun({ jobs: jobs(['success', 'failure']), artifacts: artifacts(2), shards: 2 })).toMatchObject({ eligible: false, why: expect.stringMatching(/failure/) });
    expect(judgeRun({ jobs: jobs(['cancelled', 'success']), artifacts: artifacts(2), shards: 2 }).eligible).toBe(false);
    expect(judgeRun({ jobs: jobs(['success']), artifacts: artifacts(2), shards: 2 }).eligible).toBe(false);
    expect(judgeRun({ jobs: jobs(['success', 'success']), artifacts: artifacts(1), shards: 2 }).eligible).toBe(false);
    expect(judgeRun({ jobs: jobs(['success', 'success']), artifacts: [{ name: artifactName(1) }, { name: artifactName(2), expired: true }], shards: 2 }).eligible).toBe(false);
  });
});

describe("ci.yml spells what this file spells (objectui#12208)", () => {
  interface Step { name?: string; run?: unknown; uses?: string; with?: Record<string, unknown>; env?: Record<string, unknown>; if?: string }
  const workflow = parseYaml(ciYaml) as { jobs: Record<string, { name?: string; steps?: Step[]; strategy?: { matrix?: { shard?: unknown[] } } }> };
  const test = workflow.jobs.test;
  const width = (test.strategy?.matrix?.shard ?? []).length;

  it('names the test shards the way the selector looks for them', () => {
    expect(test.name).toBe(shardJobName(Number.NaN, width).replace('NaN', '${{ matrix.shard }}'));
  });

  it('runs the full battery with the timing reporter AND the two reporters it would otherwise displace', () => {
    const run = test.steps?.find((s) => typeof s.run === 'string' && s.run.includes('pnpm test --shard='));
    expect(run, "the `test` job no longer runs `pnpm test --shard=`").toBeDefined();
    const full = (run!.run as string).split('\n').find((l) => l.includes('pnpm test --shard=')) ?? '';
    // A CLI `--reporter` REPLACES vitest's default set, so naming only the
    // timing reporter would silently drop the log and the per-test
    // annotations a red leg is read by (the objectui#9177 shape).
    for (const flag of ['--reporter=default', '--reporter=github-actions', '--reporter=./scripts/test-file-timings.mjs']) {
      expect(full, `the full-battery invocation lacks ${flag}`).toContain(flag);
    }
    expect(run!.env?.[OUT_ENV], `the run step must name ${OUT_ENV}`).toMatch(/test-file-timings\/shard-\$\{\{ matrix\.shard \}\}\.json$/);
  });

  it('has the weekly refresh select runs at the width the `test` matrix runs (objectui#12384)', () => {
    // The selector judges a run by the leg NAMES of one width, so a refresh
    // left on an old width after the matrix moves takes no run, ever -- and
    // that ends in its NOT MEASURED warning, a green job, and a dataset that
    // silently stops being refreshed. Held here, locally and loudly, the way
    // `test-aggregate`'s `--shards` is held in `check-test-shard-results.test.ts`.
    const refresh = fs.readFileSync(path.join(repoRoot, '.github/workflows/test-shard-timings-refresh.yml'), 'utf8');
    const selects = [...refresh.matchAll(/test-file-timings\.mjs select --shards (\d+)\b/g)].map((m) => Number(m[1]));
    expect(selects, 'the refresh must run the selector exactly once').toHaveLength(1);
    expect(width, 'ci.yml must still declare a `shard:` matrix on `test`').toBeGreaterThan(0);
    expect(selects[0], "the refresh's --shards and ci.yml's `test` matrix have drifted apart").toBe(width);
  });

  it('uploads each shard under the artifact name the selector requires, on the full battery only', () => {
    const upload = test.steps?.find((s) => s.uses?.startsWith('actions/upload-artifact@') && String(s.with?.name).startsWith('test-file-timings-'));
    expect(upload, "the `test` job no longer uploads its per-file timings").toBeDefined();
    expect(upload!.with?.name).toBe(artifactName(Number.NaN).replace('NaN', '${{ matrix.shard }}'));
    expect(upload!.if).toContain("github.event_name == 'push'");
    expect(upload!.if).toContain("github.event_name == 'schedule'");
    expect(upload!.with?.['if-no-files-found'], 'a missing reading must not turn a green leg red').toBe('warn');
  });
});
