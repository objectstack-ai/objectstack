import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { parse as parseYaml } from 'yaml';
import { shardTotal } from '../../../scripts/ci-shard-matrix.mjs';
import { UI_JOBS, rootCi, rootWorkflow, rootWorkflowsDir } from './helpers/root-ci';
import { childVitestEnv } from './helpers/child-vitest-env';

/**
 * The per-file timing pipeline (objectui#12208): the reporter that measures on
 * the full battery, the selector that picks which runs feed the dataset, and
 * the generator that writes `scripts/test-shard-timings.json`. The last
 * describe holds the monorepo root's `ci.yml` (`test-ui`) and its weekly
 * refresh workflow to the names and flags this file spells.
 */

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

/**
 * The writer as the real vitest CLI loads it: by ABSOLUTE path, the spelling
 * the root `ci.yml` passes. A pull request runs Test UI at the affected speed,
 * which passes no reporter, so nothing else on a PR proves the load; a load
 * failure would red every full-battery Test UI shard on `main`. One fixture
 * test in a scratch root with its own empty config (never this tree's, whose
 * projects and invocation guard are not what is under test).
 */
describe('the writer, loaded by the vitest CLI from an absolute path', () => {
  const reporterPath = fileURLToPath(new URL('../test-file-timings.mjs', import.meta.url));
  const vitestCli = (() => {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('vitest/package.json');
    const bin = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { bin: { vitest: string } }).bin.vitest;
    return path.resolve(path.dirname(pkgPath), bin);
  })();
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-timings-load-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('exits 0 and writes a schema-tagged report naming the fixture file', () => {
    fs.writeFileSync(path.join(dir, 'vitest.config.mjs'), 'export default {};\n');
    fs.writeFileSync(path.join(dir, 'smoke.test.mjs'), "test('runs', () => { expect(1).toBe(1); });\n");
    const out = path.join(dir, 'report', 'shard-1.json');
    const child = spawnSync(
      process.execPath,
      [vitestCli, 'run', '--root', dir, '--config', path.join(dir, 'vitest.config.mjs'), '--globals', '--reporter=default', `--reporter=${reporterPath}`],
      { cwd: dir, encoding: 'utf8', env: childVitestEnv({ [OUT_ENV]: out }), timeout: 120_000 },
    );
    expect(child.status, `${child.stdout ?? ''}${child.stderr ?? ''}`).toBe(0);
    const report = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(report.schema).toBe(REPORT_SCHEMA);
    expect(report.files.map((f: { file: string }) => f.file)).toEqual(['smoke.test.mjs']);
  }, 180_000);
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

/** The weekly refresh that drives `select` and `merge`, at the monorepo root. */
const REFRESH_WORKFLOW = 'ui-test-timings-refresh.yml';

type Step = { name?: string; run?: string; uses?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown>; 'continue-on-error'?: boolean };
type Job = { name?: string; env?: Record<string, string>; steps: Step[] };

/** `${{ matrix.shard }}` rendered as shard `n`, the way the runner names one leg. */
const asShard = (text: string, n: number) => text.replaceAll('${{ matrix.shard }}', String(n));

/**
 * The root `ci.yml` and the refresh spell what this file spells
 * (objectstack#29517, which brought back the pins objectui#12208 held against
 * objectui's own `ci.yml` and which retired with objectstack#25712). Each pin
 * reads the workflow GitHub runs, parsed, so prose in a comment cannot satisfy
 * it; a renamed job or step throws instead of matching nothing.
 */
describe('the root ci.yml and the refresh spell what this file spells (objectstack#29517)', () => {
  const ci = rootCi();
  const SHARDS = shardTotal(ci, UI_JOBS.test);
  const job = (parseYaml(ci) as { jobs: Record<string, Job> }).jobs[UI_JOBS.test];
  const step = (prefix: string): Step => {
    const found = job.steps.filter((s) => typeof s.name === 'string' && s.name.startsWith(prefix));
    if (found.length !== 1) throw new Error(`${UI_JOBS.test} has ${found.length} steps named ${JSON.stringify(prefix)}…`);
    return found[0];
  };
  const runStep = step('Run the ui tests');
  const uploadStep = step("Publish this shard's per-file test timings");

  it('names every Test UI shard the way the selector looks it up', () => {
    expect(SHARDS).toBeGreaterThan(1);
    for (let n = 1; n <= SHARDS; n += 1) expect(asShard(String(job.name), n)).toBe(shardJobName(n, SHARDS));
  });

  it('passes the reporter beside the two it would displace on the whole suite, and on the affected speed not at all', () => {
    const lines = String(runStep.run).split('\n').map((line) => line.trim());
    const whole = lines.filter((line) => line.startsWith('pnpm --dir ui run test '));
    const affected = lines.filter((line) => line.startsWith('pnpm --dir ui exec vitest run '));
    expect(whole).toHaveLength(1);
    expect(affected).toHaveLength(1);
    const argv = whole[0].split(/\s+/);
    // From the workspace root: a `./scripts/` spelling is read as the ROOT `scripts/` by the root's workflow readers.
    for (const reporter of ['--reporter=default', '--reporter=github-actions', '--reporter="${GITHUB_WORKSPACE}/ui/scripts/test-file-timings.mjs"']) {
      expect(argv).toContain(reporter);
    }
    expect(affected[0]).not.toContain('test-file-timings');
    expect(runStep.env?.[OUT_ENV]).toBeTruthy();
  });

  it("uploads each shard's report, from where the reporter writes it, as the artifact the selector requires, never failing the shard", () => {
    const out = String(runStep.env?.[OUT_ENV]);
    expect(uploadStep.uses).toMatch(/^actions\/upload-artifact@/);
    expect(String(uploadStep.with?.path).replace(/\/$/, '')).toBe(path.posix.dirname(out));
    for (let n = 1; n <= SHARDS; n += 1) expect(asShard(String(uploadStep.with?.name), n)).toBe(artifactName(n));
    // Report-only, by ruling: the upload cannot red a shard, and a missing report is not an error.
    expect(uploadStep['continue-on-error']).toBe(true);
    expect(uploadStep.with?.['if-no-files-found']).not.toBe('error');
    // The full battery's events only, the deny-list of the two per-PR events.
    expect(uploadStep.if).toContain("github.event_name != 'pull_request'");
    expect(uploadStep.if).toContain("github.event_name != 'merge_group'");
  });

  it('runs the refresh with the matrix width, downloads the artifacts by their name, and is the workflow the dataset names', () => {
    expect(fs.existsSync(path.join(rootWorkflowsDir, REFRESH_WORKFLOW))).toBe(true);
    const refresh = parseYaml(rootWorkflow(REFRESH_WORKFLOW)) as { jobs: Record<string, Job> };
    const jobs = Object.values(refresh.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].env?.UI_TEST_SHARDS).toBe(String(SHARDS));
    const runs = jobs[0].steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toContain('node ui/scripts/test-file-timings.mjs select --shards "$UI_TEST_SHARDS"');
    expect(runs).toContain('node ui/scripts/test-file-timings.mjs merge');
    expect(runs).toContain('--out ui/scripts/test-shard-timings.json');
    expect(runs).toContain(`--pattern '${artifactName(1).replace(/1$/, '*')}'`);
    const dataset = buildDataset({ runs: [{ meta: { id: 1 }, durations: new Map([['a.test.ts', 10]]) }], measuredAt: 'x' });
    expect(dataset.generated_by).toContain(`.github/workflows/${REFRESH_WORKFLOW}`);
  });
});
