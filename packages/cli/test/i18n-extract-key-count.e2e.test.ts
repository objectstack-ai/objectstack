// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every key count `os i18n extract` prints is a leaf count of the bytes that
 * run actually emitted (#16121).
 *
 * ## What was wrong
 *
 * `ExtractResult.counts[locale]` was a WALK counter — `count += 1` once per
 * expected entry, unconditionally — and the command used it as the number of
 * keys in the file it had just written. Under the default `--objects-only` the
 * module holds only the `objects` sub-tree, so on the fixture below the command
 * announced:
 *
 *     Skeleton summary
 *       zh-CN      776 key(s)  (of 776 expected)  + 773 metadataForms key(s)
 *     Wrote OUT/zh-CN.objects.generated.ts (776 keys)
 *
 * against a file holding **2** leaves. The summary's `+ 773` was the same 773
 * already inside the 776, so the line read as 1549 out of 776, and an operator
 * could not derive the true split (2 objects + 1 app + 773 baseline) from it.
 * Driven on `f5aec38a6af`, the commit this branch forked from — i.e. AFTER
 * #14894 / #16120 moved which keys are emitted.
 *
 * ## Why this shape
 *
 * The defect's whole nature is that the printed number was never compared with
 * the file: a walk counter cannot disagree with the walk, so no unit assertion
 * over `ExtractResult` could have failed. Every case here therefore takes its
 * second number off the BYTES — the emitted module parsed back — and drives the
 * real CLI to get them. A pin that re-implemented the emit rule would inherit
 * exactly the blind spot being closed.
 *
 * Each case names the observation that would have made it come out the other
 * way; that is the property the case buys.
 *
 * ## Fixture placement
 *
 * The stack config goes under this package's git-ignored `tmp/` and the `--out`
 * root in the system temp dir. Only one of the two has to RESOLVE anything: the
 * config calls `defineStack`, and `bundle-require` writes its bundled module
 * next to the config, so Node resolves the bare `@objectstack/spec` specifier
 * from THAT directory — under `packages/cli/tmp/` the lookup walks up into this
 * package's real `node_modules`, from the system temp dir it does not. It is
 * `tmp/` specifically, not a directory named for this test: `dispatch-gates
 * --self-test` requires a tracked ignore rule, and `git check-ignore -v
 * packages/cli/tmp/x` answers `.gitignore:55:tmp/`. `afterAll` removes only
 * this suite's own `mkdtemp` directories — five suites share that root and run
 * concurrently.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const CLI_PACKAGE_ROOT = resolve(HERE, '..');

/** One object (2 leaves) + one app (1 leaf); the registry baseline rides along. */
const STACK_CONFIG = [
  "import { defineStack } from '@objectstack/spec';",
  '',
  'export default defineStack({',
  "  i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN'] },",
  "  objects: [{ name: 'kpi_metric', label: 'Metric', fields: { name: { type: 'text', label: 'Name' } } }],",
  "  apps: [{ name: 'kpi', label: 'KPI Console' }],",
  '});',
  '',
].join('\n');

/** No `objects` at all — the stack module's sub-tree is empty under the default. */
const APPS_ONLY_CONFIG = [
  "import { defineStack } from '@objectstack/spec';",
  '',
  'export default defineStack({',
  "  i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN'] },",
  "  apps: [{ name: 'kpi', label: 'KPI Console' }],",
  '});',
  '',
].join('\n');

let fixtureRoot: string;
let outRoot: string;
let CONFIG: string;
let APPS_ONLY: string;

beforeAll(() => {
  const sharedRoot = join(CLI_PACKAGE_ROOT, 'tmp');
  mkdirSync(sharedRoot, { recursive: true });
  fixtureRoot = mkdtempSync(join(sharedRoot, 'os-i18n-16121-fixture-'));
  CONFIG = join(fixtureRoot, 'stack.config.ts');
  APPS_ONLY = join(fixtureRoot, 'apps-only.config.ts');
  writeFileSync(CONFIG, STACK_CONFIG, 'utf8');
  writeFileSync(APPS_ONLY, APPS_ONLY_CONFIG, 'utf8');
  outRoot = mkdtempSync(join(tmpdir(), 'os-i18n-16121-'));
});

afterAll(() => {
  // This suite's own directories only. Never the shared `tmp/` root.
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(outRoot, { recursive: true, force: true });
});

/** stdout with SGR sequences removed — chalk is off through a pipe, belt and braces. */
function plain(text: string): string {
  // The escape byte is SPELLED, never embedded: a raw control byte in a source
  // file renders as nothing and is findable by neither spelling.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function runExtract(name: string, config: string, flags: readonly string[]): { stdout: string; dir: string; files: string[] } {
  const dir = join(outRoot, name);
  const stdout = execFileSync(TSX, [CLI, 'i18n', 'extract', config, '--locales=zh-CN', ...flags, `--out=${dir}`], {
    encoding: 'utf8',
    env: childEnv(),
    timeout: 180_000,
  });
  return { stdout: plain(stdout), dir, files: readdirSync(dir).sort() };
}

/**
 * Leaves in an emitted module, counted off its BYTES.
 *
 * `stringifyTs` writes one key per line, so a leaf is a line whose own start is
 * a key followed by a string literal. Anchoring at the line start is what makes
 * this a measurement rather than a substring search: a `: "` occurring INSIDE a
 * translated value cannot begin a line.
 */
function leavesOnDisk(dir: string, file: string): number {
  const src = readFileSync(join(dir, file), 'utf8');
  return [...src.matchAll(/^[ \t]+(?:"[^"]*"|[A-Za-z_$][\w$]*): "/gm)].length;
}

/** The `Wrote <path> (N keys)` lines, as basename to the count the command printed. */
function printedFileCounts(stdout: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of stdout.matchAll(/Wrote\s+(\S+)\s+\((\d+) keys\)/g)) out[basename(m[1])] = Number(m[2]);
  return out;
}

/** The one summary row: locale, emitted, skeleton, and the per-module breakdown. */
function summaryRow(stdout: string): { locale: string; emitted: number; skeleton: number; breakdown: string } {
  const m = stdout.match(/^ {4}(\S+) +(\d+) of (\d+) key\(s\) emitted(.*)$/m);
  if (!m) throw new Error(`no summary row in:\n${stdout}`);
  return { locale: m[1], emitted: Number(m[2]), skeleton: Number(m[3]), breakdown: m[4].trim() };
}

function countJsonLeaves(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  let n = 0;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v === 'string') n += 1;
    else if (v && typeof v === 'object') n += countJsonLeaves(v);
  }
  return n;
}

describe('os i18n extract — the number printed is the number written (#16121)', () => {
  /**
   * The four flag states are the point: a count taken off the emitted sub-tree
   * is right in all of them, and one taken off the walk is right in none.
   * Falsifier — restoring `keys: result.counts[locale]` makes the two
   * `--objects-only` rows print 776 against 2 leaves on disk, and the two
   * `--no-objects-only` rows 776 against 3.
   */
  it.each([
    ['default', [] as string[]],
    ['no-metadata-forms', ['--no-metadata-forms']],
    ['no-objects-only', ['--no-objects-only']],
    ['neither', ['--no-objects-only', '--no-metadata-forms']],
  ])("every printed file count is that file's own leaf count (%s)", (name, flags) => {
    const run = runExtract(`counts-${name}`, CONFIG, flags);
    const printed = printedFileCounts(run.stdout);

    // Every file written is announced, and nothing is announced that was not
    // written — two faces of one list.
    expect(Object.keys(printed).sort()).toEqual(run.files);
    expect(run.files.length).toBeGreaterThan(0);

    for (const file of run.files) {
      expect({ file, keys: printed[file] }).toEqual({ file, keys: leavesOnDisk(run.dir, file) });
    }
  });

  /**
   * The summary is a PARTITION of the skeleton, never a sum over it. The old
   * line appended the baseline to a number that already contained it and read
   * `776 key(s) (of 776 expected) + 773 metadataForms key(s)` — 1549 claimed
   * against 776 built. Falsifier: any re-appearance of that shape makes
   * `emitted` exceed `skeleton` here.
   */
  it('summarises the emitted keys as a partition of the skeleton, in both sub-tree modes', () => {
    for (const [name, flags] of [
      ['objects-only', [] as string[]],
      ['stack', ['--no-objects-only']],
    ] as const) {
      const run = runExtract(`partition-${name}`, CONFIG, flags);
      const row = summaryRow(run.stdout);
      const onDisk = run.files.reduce((n, f) => n + leavesOnDisk(run.dir, f), 0);

      expect(row.locale).toBe('zh-CN');
      expect(run.files.length).toBe(2);
      // What the summary claims was emitted is what the files hold, together.
      expect(row.emitted).toBe(onDisk);
      // ...and it is a selection OF the skeleton, so it can never be more.
      expect(row.emitted).toBeLessThanOrEqual(row.skeleton);
      // Both modules carry keys here, so the breakdown names them and its parts
      // add up to the whole — the reading the `+ N metadataForms` tail denied.
      const parts = [...row.breakdown.matchAll(/([A-Za-z]+) (\d+)/g)].map((m) => Number(m[2]));
      expect(parts.length).toBe(2);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(row.emitted);
    }

    // Under `--no-objects-only` the two modules together ARE the skeleton, so
    // the partition closes exactly: nothing dropped, nothing double-counted.
    const wholeRow = summaryRow(runExtract('partition-whole', CONFIG, ['--no-objects-only']).stdout);
    expect(wholeRow.emitted).toBe(wholeRow.skeleton);
    // ...and under the default one app label sits outside the `objects`
    // sub-tree, so exactly one key is built and not emitted. A summary that
    // could not tell those two runs apart is the defect.
    const narrowed = summaryRow(runExtract('partition-narrow', CONFIG, []).stdout);
    expect(narrowed.skeleton).toBe(wholeRow.skeleton);
    expect(wholeRow.emitted - narrowed.emitted).toBe(1);
  });

  /**
   * The `--json` face carries the same pair. `counts` used to forward the
   * extractor's skeleton size while `bundles` beside it held the emitted
   * sub-tree — 776 against a 2-leaf payload. Falsifier: that arrangement fails
   * the first expectation under `--objects-only`, which is why the narrowed
   * state is driven and not only the wide one.
   */
  it('--json counts describe the payload printed beside them, in both sub-tree modes', () => {
    const runJson = (flags: readonly string[]) => {
      const stdout = execFileSync(TSX, [CLI, 'i18n', 'extract', CONFIG, '--locales=zh-CN', '--json', ...flags], {
        encoding: 'utf8',
        env: childEnv(),
        timeout: 180_000,
      });
      return JSON.parse(stdout) as {
        totalExpected: number;
        counts: Record<string, number>;
        metadataFormsCounts: Record<string, number>;
        bundles: Record<string, unknown>;
        metadataForms: Record<string, unknown>;
      };
    };

    const narrow = runJson([]);
    const whole = runJson(['--no-objects-only']);
    const suppressed = runJson(['--no-metadata-forms']);

    for (const payload of [narrow, whole, suppressed]) {
      expect(payload.counts['zh-CN']).toBe(countJsonLeaves(payload.bundles['zh-CN']));
      // The skeleton total is still reported — under its own name.
      expect(payload.totalExpected).toBeGreaterThan(payload.counts['zh-CN']);
    }

    // The sub-tree flag MOVES the count, which is what makes the assertion
    // above an axis rather than a coincidence: the app label is in one payload
    // and not the other.
    expect(whole.counts['zh-CN'] - narrow.counts['zh-CN']).toBe(1);

    // ⚠️ `metadataFormsCounts` is NOT the same relationship, and driving the
    // flag ON only is what let that claim stand unmeasured through a review.
    // It reports the baseline as BUILT, whether or not the run emits it: with
    // the flag off the payload carries a positive count beside an empty
    // `metadataForms` map. So the two counts in this payload mean two different
    // things — deliberately, and pinned here so a change to either is seen.
    expect(narrow.metadataFormsCounts['zh-CN']).toBe(countJsonLeaves(narrow.metadataForms['zh-CN']));
    expect(suppressed.metadataFormsCounts['zh-CN']).toBeGreaterThan(100);
    expect(suppressed.metadataForms['zh-CN']).toBeUndefined();
    expect(countJsonLeaves(suppressed.metadataForms['zh-CN'])).toBe(0);
    expect(suppressed.metadataFormsCounts['zh-CN']).toBe(narrow.metadataFormsCounts['zh-CN']);
  });

  /**
   * The commonest path in this repository is `--no-metadata-forms` — 8 of the 9
   * extract configs pass it — and there the run emits ONE module. The first cut
   * of this repair printed a bare `2 of 776 key(s) emitted` for it: correct, and
   * a regression on what the old (double-counting) line at least told the
   * operator, which is how big the baseline they switched off is.
   *
   * Falsifier: dropping the suppressed candidate from the summary leaves the
   * breakdown empty here, and adding it into the total instead of labelling it
   * makes the first expectation read 775.
   */
  it('names a flag-suppressed module and its size, without adding it in', () => {
    const run = runExtract('suppressed-baseline', CONFIG, ['--no-metadata-forms']);

    expect(run.files).toEqual(['zh-CN.objects.generated.ts']);
    const row = summaryRow(run.stdout);
    // The emitted total is the one file's leaves — the baseline is NOT in it.
    expect(row.emitted).toBe(leavesOnDisk(run.dir, 'zh-CN.objects.generated.ts'));
    // ...and it is named, with its size, and with the words that keep it out.
    expect(row.breakdown).toMatch(/metadataForms \d+ not emitted/);
    const suppressed = Number(row.breakdown.match(/metadataForms (\d+) not emitted/)![1]);
    expect(suppressed).toBeGreaterThan(100);
    expect(row.emitted + suppressed).toBeLessThanOrEqual(row.skeleton);
  });

  /**
   * A module with no leaves is not a file. The emit gate was
   * `result.counts[locale] > 0`, a property of the skeleton rather than of the
   * module: on a stack whose only surface is apps, the default `--objects-only`
   * wrote a `zh-CN.objects.generated.ts` holding `{}` and announced it as `774
   * keys` (measured at `f5aec38a6af`). Falsifier: restoring that gate writes
   * one file here, and `printedFileCounts` reports 774 for a file with 0
   * leaves.
   */
  it('writes no module for an empty sub-tree, and announces none', () => {
    const run = runExtract('empty-subtree', APPS_ONLY, ['--no-metadata-forms']);

    expect(run.files).toEqual([]);
    expect(printedFileCounts(run.stdout)).toEqual({});
    const row = summaryRow(run.stdout);
    expect(row.emitted).toBe(0);
    // The keys ARE there — they are simply outside the sub-tree the flags
    // selected, and the line says so instead of claiming them as written.
    expect(row.skeleton).toBeGreaterThan(100);
    expect(row.breakdown).toMatch(/metadataForms \d+ not emitted/);

    // The same stack under `--no-objects-only` does have a module, so the empty
    // result above is the sub-tree selection and not an inert fixture.
    const wide = runExtract('empty-subtree-wide', APPS_ONLY, ['--no-objects-only', '--no-metadata-forms']);
    expect(wide.files).toEqual(['zh-CN.objects.generated.ts']);
    expect(printedFileCounts(wide.stdout)['zh-CN.objects.generated.ts']).toBe(
      leavesOnDisk(wide.dir, 'zh-CN.objects.generated.ts'),
    );
    expect(summaryRow(wide.stdout).emitted).toBe(1);
  });
  // Each case spawns the CLI through `tsx`; measured at ~6 s per run on a
  // shared box, well over vitest's 5 s default. Same instrument and the same
  // generous ceiling as the sibling CLI-spawning pins in this directory.
}, 900_000);
