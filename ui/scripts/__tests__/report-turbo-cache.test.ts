import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cacheDirStats, main, newestSummary, pruneCacheDir, render, summarize } from '../report-turbo-cache.mjs';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'node:url';

/**
 * objectui#12222 — the reader behind `Type Check`'s cache report.
 *
 * The job's verdict does not depend on this script (it runs after the last
 * checking step, bounded and `continue-on-error`); what depends on it is the
 * READING: whether a run replayed the packages its change did not touch is
 * answered by the `::notice` it prints, through the check-runs API. So the
 * cases below hold what that line says to what the run summary says, in both
 * directions: a replayed task is counted as replayed, a re-executed one as
 * missed, and an uncached-by-declaration task is never counted as a miss of
 * the cache (turbo reports it MISS by construction).
 */

const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-turbo-cache-12222-'));
  tmpRoots.push(dir);
  return dir;
}

/** The fields of a turbo 2 run-summary task this reader uses, as turbo writes them. */
function task(
  taskId: string,
  hash: string,
  opts: { status: 'HIT' | 'MISS'; cache?: boolean; deps?: string[]; inputs?: number; ms?: number },
) {
  const [pkg, name] = taskId.split('#');
  return {
    taskId,
    task: name,
    package: pkg,
    hash,
    inputs: Object.fromEntries(Array.from({ length: opts.inputs ?? 1 }, (_, i) => [`f${i}.ts`, 'x'])),
    cache: { local: opts.status === 'HIT', remote: false, status: opts.status, timeSaved: 0 },
    dependencies: opts.deps ?? [],
    resolvedTaskDefinition: { cache: opts.cache ?? true },
    execution: { startTime: 1_000, endTime: 1_000 + (opts.ms ?? 0), exitCode: 0 },
  };
}

const SUMMARY = {
  tasks: [
    task('//#type-check:e2e', 'aaa000', { status: 'MISS', cache: false, inputs: 3, ms: 2_000 }),
    task('@x/a#build', 'bbb111', { status: 'HIT' }),
    task('@x/a#type-check', 'ccc222', { status: 'HIT', deps: ['//#type-check:e2e', '@x/a#build'] }),
    task('@x/b#type-check', 'ddd333', {
      status: 'MISS',
      deps: ['//#type-check:e2e', '@x/a#build'],
      ms: 41_500,
    }),
  ],
};

describe('report-turbo-cache (objectui#12222)', () => {
  it('counts replayed, missed and uncached-by-declaration tasks per task name', () => {
    const stats = summarize(SUMMARY);
    expect(stats.total).toBe(4);
    expect(stats.byTask.get('type-check')).toEqual({ hit: 1, miss: 1, uncached: 0 });
    expect(stats.byTask.get('build')).toEqual({ hit: 1, miss: 0, uncached: 0 });
    // turbo reports an uncached task as MISS; it is not a miss of the cache.
    expect(stats.byTask.get('type-check:e2e')).toEqual({ hit: 0, miss: 0, uncached: 1 });
  });

  it('names what each missed task depends on, with that dependency’s status and input count', () => {
    const [missed] = summarize(SUMMARY).missed;
    expect(missed.taskId).toBe('@x/b#type-check');
    expect(missed.ms).toBe(41_500);
    expect(missed.dependencies).toEqual([
      { taskId: '//#type-check:e2e', status: 'uncached', inputs: 3 },
      { taskId: '@x/a#build', status: 'HIT', inputs: 1 },
    ]);
  });

  it('counts cache entries by archive and tells used from unused by this run’s hashes', () => {
    const dir = tmpDir();
    for (const hash of ['ccc222', 'bbb111', 'eee444']) {
      fs.writeFileSync(path.join(dir, `${hash}.tar.zst`), 'zz');
      fs.writeFileSync(path.join(dir, `${hash}-meta.json`), '{}');
    }
    const stats = cacheDirStats(dir, summarize(SUMMARY).hashes);
    expect(stats).toMatchObject({ present: true, entries: 3, unused: 1, unusedBytes: 2 + 2 });
    expect(stats.bytes).toBe(3 * (2 + 2));
    expect(cacheDirStats(path.join(dir, 'absent'), new Set())).toMatchObject({ present: false, entries: 0 });
  });

  it('puts the counts on ONE notice line, the form the check-runs API serves', () => {
    const { notice, lines } = render({
      summaryFile: 'run.json',
      stats: summarize(SUMMARY),
      cache: { present: true, entries: 3, bytes: 2_097_152, unused: 1, unusedBytes: 1_048_576 },
      restoredKey: 'turbo-Linux-type-check-abc',
    });
    expect(notice.startsWith('::notice title=Turbo cache::')).toBe(true);
    expect(notice).not.toContain('\n');
    expect(notice).toContain('type-check 1/2 replayed');
    expect(notice).toContain('build 1/1 replayed');
    expect(notice).toContain('uncached //#type-check:e2e (3 input files)');
    expect(notice).toContain('cache 3 entries, 2.0 MB, 1 (1.0 MB) not used by this run');
    expect(notice).toContain('restored turbo-Linux-type-check-abc');
    expect(lines.join('\n')).toContain('@x/b#type-check ddd333 41.5s <- //#type-check:e2e uncached (3 inputs), @x/a#build HIT (1 inputs)');
  });

  it('says a cold run is cold, and a run with no task says so instead of a zero ratio', () => {
    const { notice } = render({
      summaryFile: 'run.json',
      stats: summarize({ tasks: [] }),
      cache: { present: false, entries: 0, bytes: 0, unused: 0, unusedBytes: 0 },
      restoredKey: '',
    });
    expect(notice).toContain('no task ran');
    expect(notice).toContain('cache directory absent');
    expect(notice).toContain('restored nothing (cold)');
  });

  it('reads the NEWEST summary, and exits 1 rather than reporting when there is none', () => {
    const dir = tmpDir();
    const older = path.join(dir, 'older.json');
    const newer = path.join(dir, 'newer.json');
    fs.writeFileSync(older, JSON.stringify({ tasks: [] }));
    fs.writeFileSync(newer, JSON.stringify(SUMMARY));
    fs.utimesSync(older, new Date(1_000_000), new Date(1_000_000));
    fs.utimesSync(newer, new Date(2_000_000), new Date(2_000_000));
    expect(newestSummary(dir)).toBe(newer);
    expect(newestSummary(path.join(dir, 'absent'))).toBeNull();

    const out: string[] = [];
    expect(main(['--summary', newer, '--cache-dir', path.join(dir, 'none')], {}, (l: string) => out.push(l))).toBe(0);
    expect(out.at(-1)).toContain('type-check 1/2 replayed');

    const missing: string[] = [];
    expect(main(['--summary', path.join(dir, 'gone.json')], {}, (l: string) => missing.push(l))).toBe(1);
    expect(missing.join('\n')).toContain('::warning');
  });

  it('prunes exactly the entries this run did not use, and leaves foreign files alone', () => {
    const dir = tmpDir();
    for (const hash of ['ccc222', 'bbb111', 'eee444']) {
      fs.writeFileSync(path.join(dir, `${hash}.tar.zst`), 'zz');
      fs.writeFileSync(path.join(dir, `${hash}-meta.json`), '{}');
      fs.writeFileSync(path.join(dir, `${hash}-manifest.json`), '{}');
    }
    fs.writeFileSync(path.join(dir, 'README'), 'not turbo’s');
    const pruned = pruneCacheDir(dir, summarize(SUMMARY).hashes);
    expect(pruned).toEqual({ files: 3, bytes: 2 + 2 + 2 });
    expect(fs.readdirSync(dir).sort()).toEqual([
      'README',
      'bbb111-manifest.json',
      'bbb111-meta.json',
      'bbb111.tar.zst',
      'ccc222-manifest.json',
      'ccc222-meta.json',
      'ccc222.tar.zst',
    ]);
  });

  it('refuses to prune on a summary that lists no task: unknown use is not "unused"', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'aaa000.tar.zst'), 'zz');
    const empty = path.join(dir, 'empty.json');
    fs.writeFileSync(empty, JSON.stringify({ tasks: [] }));
    const out: string[] = [];
    expect(main(['--prune', '--summary', empty, '--cache-dir', dir], {}, (l: string) => out.push(l))).toBe(1);
    expect(fs.existsSync(path.join(dir, 'aaa000.tar.zst'))).toBe(true);
    expect(out.join('\n')).toContain('not pruning');
  });

  it('posts no second annotation when it prunes: the report step already did', () => {
    const dir = tmpDir();
    const summary = path.join(dir, 'run.json');
    fs.writeFileSync(summary, JSON.stringify(SUMMARY));
    fs.writeFileSync(path.join(dir, 'eee444.tar.zst'), 'zz');
    const out: string[] = [];
    expect(main(['--prune', '--summary', summary, '--cache-dir', dir], {}, (l: string) => out.push(l))).toBe(0);
    expect(out.filter((l) => l.startsWith('::notice'))).toEqual([]);
    expect(out.at(-1)).toMatch(/^Pruned 1 file\(s\)/);
    expect(fs.existsSync(path.join(dir, 'eee444.tar.zst'))).toBe(false);
  });

  it('refuses an argument it does not know (exit 2)', () => {
    expect(main(['--sumary', 'x.json'], {}, () => {})).toBe(2);
  });
});

describe('ci.yml — only the full battery writes the type-check cache, pruned first (objectui#12222)', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const workflow = parseYaml(fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8')) as {
    jobs: Record<string, { steps: Array<{ name?: string; uses?: string; run?: string; if?: string; with?: Record<string, string> }> }>;
  };
  const steps = workflow.jobs['type-check'].steps;
  const FULL_BATTERY = "(github.event_name == 'push' || github.event_name == 'schedule')";

  it('saves only on push and schedule, whose run covers every task', () => {
    // By path: the job's other save is the pinned @objectstack build's (objectui#12957).
    const save = steps.find((s) => (s.uses ?? '').startsWith('actions/cache/save@') && s.with?.path === '.turbo/cache');
    expect(save?.if ?? '').toContain(FULL_BATTERY);
  });

  it('prunes before it saves, on the same events, and never on a pull request or a queue build', () => {
    const pruneAt = steps.findIndex((s) => s.run === 'node scripts/report-turbo-cache.mjs --prune');
    const saveAt = steps.findIndex((s) => (s.uses ?? '').startsWith('actions/cache/save@') && s.with?.path === '.turbo/cache');
    expect(pruneAt, 'the prune step is gone').toBeGreaterThan(-1);
    expect(pruneAt).toBeLessThan(saveAt);
    expect(steps[pruneAt].if ?? '').toContain(FULL_BATTERY);
  });
});

/**
 * objectui#12276 — every turbo cache in `.github/workflows/` is its job's own.
 *
 * Until then four of the five jobs that restore `.turbo/cache` ended their
 * restore keys with a bare `turbo-<os>-`, and three of them (`Lint`, `Bundle
 * Analysis`, the release job) saved under one and the same `turbo-<os>-<sha>`
 * key. `actions/cache` takes the newest match on the run's own ref first, so a
 * job restored whichever job's cache had reached that ref -- the measured
 * instance is objectui#12222's, where `Type Check` restored the `docs` job's
 * multi-GB build cache on a pull request -- and saved it again under its own
 * key. The `type-check` job's shape (objectui#12222, the block above) is the
 * rule here, applied to the population rather than to one job: its own key
 * prefix and no other restore key; pull-request and queue runs restore and
 * never save; the saving runs prune to what they used first; and every run
 * reports what it replayed and which key it restored, which is how "no job
 * restores another job's cache" is read after the fact (the notice names the
 * restored key) rather than written down here.
 */
describe('every workflow turbo cache: its own key, written by main only, pruned and reported (objectui#12276)', () => {
  type Step = {
    name?: string;
    id?: string;
    uses?: string;
    run?: string;
    if?: string;
    env?: Record<string, string>;
    with?: Record<string, string>;
  };
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const KEY = /^turbo-\$\{\{ runner\.os \}\}-([a-z][a-z0-9-]*)-\$\{\{ github\.sha \}\}$/;

  const caches = fs
    .readdirSync(workflowDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .flatMap((file) => {
      const wf = parseYaml(fs.readFileSync(path.join(workflowDir, file), 'utf8')) as {
        on?: Record<string, unknown>;
        jobs?: Record<string, { steps?: Step[] }>;
      };
      const triggers = Object.keys(wf.on ?? {});
      return Object.entries(wf.jobs ?? {}).flatMap(([job, def]) => {
        const steps = def.steps ?? [];
        const restoreAt = steps.findIndex(
          (s) => (s.uses ?? '').startsWith('actions/cache/restore@') && s.with?.path === '.turbo/cache',
        );
        if (restoreAt === -1) return [];
        const saveAt = steps.findIndex(
          (s) => (s.uses ?? '').startsWith('actions/cache/save@') && s.with?.path === '.turbo/cache',
        );
        const restore = steps[restoreAt];
        const tag = KEY.exec(restore.with?.key ?? '')?.[1] ?? null;
        return [{ where: `${file} \`${job}\``, triggers, steps, restoreAt, saveAt, restore, tag }];
      });
    });

  /** Whether an `if:` expression names this event. */
  const names = (expr: string | undefined, event: string) => (expr ?? '').includes(`github.event_name == '${event}'`);

  it('reads the population, and the type-check job the rule is taken from is in it', () => {
    expect(caches.length, 'the workflow scan found implausibly few turbo caches').toBeGreaterThan(2);
    expect(caches.map((c) => c.where)).toContain('ci.yml `type-check`');
  });

  it('keys each cache with its own prefix, and restores by that prefix alone', () => {
    const off = caches.flatMap((c) => {
      if (c.tag === null) return [`${c.where}: key \`${c.restore.with?.key}\` is not turbo-<os>-<job>-<sha>`];
      const restoreKeys = (c.restore.with?.['restore-keys'] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
      const own = `turbo-\${{ runner.os }}-${c.tag}-`;
      return restoreKeys.length === 1 && restoreKeys[0] === own
        ? []
        : [`${c.where}: restore-keys ${JSON.stringify(restoreKeys)}, expected exactly ["${own}"]`];
    });
    expect(off, 'a turbo cache restore can reach another job’s cache:\n' + off.map((o) => `  - ${o}`).join('\n')).toEqual([]);
  });

  it('gives no two jobs a prefix that matches the other’s key', () => {
    const tags = caches.map((c) => c.tag).filter((t): t is string => t !== null);
    const clashes = tags.flatMap((a, i) =>
      tags.filter((b, j) => i !== j && `${b}-`.startsWith(`${a}-`)).map((b) => `${a} restores ${b}`),
    );
    expect(clashes, 'one job’s restore prefix is a prefix of another job’s key').toEqual([]);
  });

  it('saves only on runs that are not a pull request or a queue build, after pruning on the same runs', () => {
    const off = caches.flatMap((c) => {
      if (c.saveAt === -1) return [`${c.where}: restores \`.turbo/cache\` and never saves it`];
      const save = c.steps[c.saveAt];
      const pruneAt = c.steps.findIndex((s) => s.run === 'node scripts/report-turbo-cache.mjs --prune');
      const out: string[] = [];
      if (pruneAt === -1 || pruneAt > c.saveAt) out.push(`${c.where}: no prune step before the save`);
      const reviewed = c.triggers.includes('pull_request') || c.triggers.includes('merge_group');
      if (reviewed) {
        if (!names(save.if, 'push')) out.push(`${c.where}: the save runs on pull requests or queue builds`);
        for (const event of ['push', 'schedule', 'pull_request', 'merge_group']) {
          if (pruneAt !== -1 && names(save.if, event) !== names(c.steps[pruneAt].if, event)) {
            out.push(`${c.where}: the prune and the save disagree on \`${event}\``);
          }
        }
      }
      for (const event of ['pull_request', 'merge_group']) {
        if (names(save.if, event)) out.push(`${c.where}: the save names \`${event}\``);
      }
      return out;
    });
    expect(off, off.map((o) => `  - ${o}`).join('\n')).toEqual([]);
  });

  it('reports what it replayed and the key it restored, from a summary its turbo step wrote', () => {
    const off = caches.flatMap((c) => {
      const reportAt = c.steps.findIndex((s) => s.run === 'node scripts/report-turbo-cache.mjs');
      if (reportAt === -1) return [`${c.where}: no \`node scripts/report-turbo-cache.mjs\` step`];
      const report = c.steps[reportAt];
      const out: string[] = [];
      if (c.saveAt !== -1 && reportAt > c.saveAt) out.push(`${c.where}: the report runs after the save`);
      if (!(report.if ?? '').includes('!cancelled()')) {
        out.push(`${c.where}: the report must run on a red run too (\`!cancelled()\`)`);
      }
      const expected = `\${{ steps.${c.restore.id}.outputs.cache-matched-key }}`;
      if (report.env?.RESTORED_CACHE_KEY !== expected) {
        out.push(`${c.where}: the report must read RESTORED_CACHE_KEY from ${expected}`);
      }
      const summarised = c.steps.slice(c.restoreAt + 1, reportAt).some((s) => s.env?.TURBO_RUN_SUMMARY === 'true');
      if (!summarised) out.push(`${c.where}: no step between the restore and the report sets TURBO_RUN_SUMMARY`);
      return out;
    });
    expect(off, off.map((o) => `  - ${o}`).join('\n')).toEqual([]);
  });
});
