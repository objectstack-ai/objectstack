import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cacheDirStats, main, newestSummary, pruneCacheDir, render, summarize } from '../report-turbo-cache.mjs';

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

// Two workflow pins retired with objectstack#25712:
//
//   - `ci.yml — only the full battery writes the type-check cache, pruned first
//     (objectui#12222)`, which held objectui ci.yml's `type-check` job to this
//     script's `--prune` before its push/schedule-only `.turbo/cache` save;
//   - `every workflow turbo cache: its own key, written by main only, pruned
//     and reported (objectui#12276)`, the same rule over every job in
//     objectui's `.github/workflows/`.
//
// Neither population runs under the monorepo: GitHub runs only the root
// `.github/workflows/`. The four root `* UI` jobs that replaced objectui's
// (objectstack#25697, row 7 and row 16 of its workflow roster) carry
// objectstack's own Turbo-cache steps instead, on purpose: a
// `<os>-turbo-<job>-<ref>-<sha>` key that restores from `build-core`'s cache
// when the job has none, a `Save Turbo cache (main only)` on push, and no
// prune or report step. Running this reporter there is a follow-up port; it
// brings these pins back against those jobs (`helpers/root-ci.ts`).
