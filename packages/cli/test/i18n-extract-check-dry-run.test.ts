// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os i18n extract --check --dry-run` COMPARES, and says what it found (#16480).
 *
 * ## What was wrong
 *
 * The two flags are both "write nothing" modes, so the pair reads as the safest
 * spelling to put in CI. It was the one spelling that measured nothing. Driven
 * on one drifted fixture, the two invocations differing ONLY by `--dry-run`:
 *
 *     $ os i18n extract CONFIG --locales=zh-CN --no-metadata-forms --out=OUT --check
 *       missing:    OUT/zh-CN.objects.generated.ts
 *       Translation bundles have drifted from the schema. Regenerate and commit:
 *     -> exit 1
 *
 *     $ os i18n extract CONFIG --locales=zh-CN --no-metadata-forms --out=OUT --check --dry-run
 *       Dry run — no files written (pass --out=<dir> to write).
 *     -> exit 0, with no `missing:` / `out of date:` / in-sync line at all
 *
 * The first run is the second one's positive control: the drift is provably
 * there, and the second reported success. The `--dry-run` branch returned
 * before the `--check` block was reached, so nothing was compared — and a
 * check that cannot fail is indistinguishable from a check that finds nothing.
 * Unlike an ignored flag that produces bad advice on a real failure, this
 * direction is silent: the pipeline goes green and nobody learns the bundles
 * have drifted.
 *
 * ## Why these shapes
 *
 * ⚠️ A case asserting only the new exit code would be satisfied by a `--check`
 * that still compares nothing and merely fails — so every case here pins the
 * REPORTED DRIFT beside the code, and the suite pins the comparison in both
 * directions:
 *
 *   - the drifted cases are stated as an EQUALITY against the same invocation
 *     WITHOUT `--dry-run`, which is the card's own method rather than a
 *     re-derivation of it. The expected values are spelled out too, because an
 *     equality alone is also satisfied by two runs that are both broken;
 *   - the in-sync case is what no unconditional failure can pass, and it is
 *     asserted as `exit 0` AND the in-sync sentence — the same "code plus
 *     report" rule, in the direction where the code is the passing one;
 *   - "writing nothing" is measured from the filesystem on both drift shapes:
 *     an empty `--out` stays empty, and a committed-but-stale bundle keeps its
 *     bytes.
 *
 * ## Why this file is not named `.e2e`
 *
 * The `.e2e` filename tier runs NIGHTLY on `main` and not on a pull request or
 * in the merge queue (`scripts/nightly-tiers.mjs`), which is the right trade
 * for most of this package's CLI-spawning suites. It is the wrong one for this
 * card's class: the regression it pins reads GREEN, so between reintroduction
 * and the next nightly every run of the pair reports success about a
 * comparison that is not happening, and PRs merge on top of it. So this file
 * takes the queue run by carrying no tier in its name. Its PROJECT is still
 * decided by what it does, not by what it is called — it spawns the CLI, so
 * `vitest-tiers.ts` classifies it `integration` either way. Cost, MEASURED on
 * the (shared, contended) box this landed on rather than estimated: 7 CLI
 * spawns, ~11s each, 77s for the file. That is the price of the trade and it
 * is written here so the trade can be re-made against a number: renaming this
 * file to `.e2e` moves it to the nightly and costs nothing else.
 *
 * ## Fixture placement
 *
 * The stack config goes under this package's git-ignored `tmp/` and the `--out`
 * roots in the system temp dir, for the reason `i18n-extract-check-hint.e2e`
 * records: `bundle-require` writes its bundled module next to the config, so
 * Node resolves the bare `@objectstack/spec` specifier from THAT directory, and
 * only under `packages/cli/tmp/` does that lookup reach this package's real
 * `node_modules`. `afterAll` removes only this suite's own `mkdtemp`
 * directories — several suites share that root and run concurrently.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const CLI_PACKAGE_ROOT = resolve(HERE, '..');

/** One object, and a `defaultLocale` equal to the only locale asked for. */
const STACK_CONFIG = [
  "import { defineStack } from '@objectstack/spec';",
  '',
  'export default defineStack({',
  "  i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN'] },",
  "  objects: [{ name: 'kpi_metric', label: 'Metric', fields: { name: { type: 'text', label: 'Name' } } }],",
  '});',
  '',
].join('\n');

/** The one bundle this invocation commits. `--no-metadata-forms` keeps it at one. */
const BUNDLE = 'zh-CN.objects.generated.ts';
const FLAGS = ['--locales=zh-CN', '--no-metadata-forms'];

let fixtureRoot: string;
let outRoot: string;
let CONFIG: string;
/** An `--out` whose committed bundle is in sync — written once, copied per case. */
let syncedOut: string;

/** stdout with SGR sequences removed — chalk is off through a pipe, belt and braces. */
function plain(text: string): string {
  // The escape byte is SPELLED, never embedded: a raw control byte in a source
  // file renders as nothing and is findable by neither spelling.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

interface Run {
  stdout: string;
  status: number | null;
}

/** The CLI, from source, with `--check`'s non-zero exit treated as data. */
function runCli(args: readonly string[]): Run {
  const child = spawnSync(TSX, [CLI, 'i18n', 'extract', ...args], {
    cwd: CLI_PACKAGE_ROOT,
    encoding: 'utf8',
    env: childEnv(),
    timeout: 180_000,
  });
  return { stdout: plain(`${child.stdout ?? ''}${child.stderr ?? ''}`), status: child.status };
}

/** The `missing:` / `out of date:` paths `--check` reported, verb included, in order. */
function driftReport(stdout: string): string[] {
  return [...stdout.matchAll(/(missing:|out of date:)\s+(\S+)/g)].map((m) => `${m[1]} ${m[2]}`);
}

/** Exit code, reported drift and the summary sentence — one comparable reading. */
function verdict(run: Run): { status: number | null; drift: string[]; drifted: boolean; inSync: boolean } {
  return {
    status: run.status,
    drift: driftReport(run.stdout),
    drifted: run.stdout.includes('Translation bundles have drifted from the schema'),
    inSync: run.stdout.includes('in sync with the schema'),
  };
}

/** A private `--out` for one case, optionally seeded from the in-sync tree. */
function outDir(name: string, seeded = false): string {
  const dir = join(outRoot, name);
  if (seeded) cpSync(syncedOut, dir, { recursive: true });
  else mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  const sharedRoot = join(CLI_PACKAGE_ROOT, 'tmp');
  mkdirSync(sharedRoot, { recursive: true });
  fixtureRoot = mkdtempSync(join(sharedRoot, 'os-i18n-16480-fixture-'));
  CONFIG = join(fixtureRoot, 'objectstack.config.ts');
  writeFileSync(CONFIG, STACK_CONFIG, 'utf8');
  outRoot = mkdtempSync(join(tmpdir(), 'os-i18n-16480-'));

  // A real extract, so the "in sync" tree is what the command itself writes
  // rather than bytes this file predicted.
  syncedOut = join(outRoot, 'synced');
  const wrote = runCli([CONFIG, ...FLAGS, `--out=${syncedOut}`]);
  expect({ status: wrote.status, files: readdirSync(syncedOut) }).toEqual({ status: 0, files: [BUNDLE] });
}, 300_000);

afterAll(() => {
  // This suite's own directories only. Never the shared `tmp/` root.
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(outRoot, { recursive: true, force: true });
});

describe('os i18n extract --check --dry-run — compares, and reports what it found (#16480)', () => {
  /**
   * The card's own table: two invocations differing only by `--dry-run` must
   * reach the same verdict, and that verdict is a REPORTED drift.
   *
   * Falsifier: restoring the unconditional `return` in the `--dry-run` branch
   * gives the second run `{ status: 0, drift: [], drifted: false }` against the
   * control's `{ status: 1, drift: ['missing: …'], drifted: true }`.
   */
  it('reports nothing committed exactly as the same run without --dry-run does', () => {
    const out = outDir('missing');
    const args = [CONFIG, ...FLAGS, `--out=${out}`, '--check'];

    const control = runCli(args);
    const dryRun = runCli([...args, '--dry-run']);

    const expected = {
      status: 1,
      drift: [`missing: ${join(out, BUNDLE)}`],
      drifted: true,
      inSync: false,
    };
    // Spelled out as well as compared, so two runs that BOTH compare nothing
    // cannot satisfy this by agreeing with each other.
    expect(verdict(control)).toEqual(expected);
    expect(verdict(dryRun)).toEqual(expected);
    // …while writing nothing, which is the half `--dry-run` contributes.
    expect(readdirSync(out)).toEqual([]);
  });

  /**
   * The second drift shape, and the stronger "writes nothing": a committed
   * bundle that is out of date is REPORTED and left byte-for-byte alone.
   */
  it('reports a stale committed bundle without rewriting it', () => {
    const out = outDir('stale', true);
    const bundle = join(out, BUNDLE);
    const stale = `${readFileSync(bundle, 'utf8')}\n// edited by hand\n`;
    writeFileSync(bundle, stale, 'utf8');
    const dryRun = runCli([CONFIG, ...FLAGS, `--out=${out}`, '--check', '--dry-run']);

    // Spelled out rather than compared against a second control run: the
    // control-vs-dry-run equality is the case above, and naming the expected
    // report is the stronger half of it anyway. One spawn saved, ~11s.
    expect(verdict(dryRun)).toEqual({
      status: 1,
      drift: [`out of date: ${bundle}`],
      drifted: true,
      inSync: false,
    });
    expect(readFileSync(bundle, 'utf8')).toBe(stale);
  });

  /**
   * The direction no unconditional failure can pass: an in-sync tree exits 0
   * AND says so. Without this case, "always fail under --check --dry-run"
   * would satisfy every other assertion in this file.
   */
  it('passes an in-sync tree and says it compared it', () => {
    const out = outDir('in-sync', true);
    const run = runCli([CONFIG, ...FLAGS, `--out=${out}`, '--check', '--dry-run']);

    expect(verdict(run)).toEqual({ status: 0, drift: [], drifted: false, inSync: true });
    expect(readdirSync(out)).toEqual([BUNDLE]);
  });

  /**
   * The secondary wrinkle on the same branch: the advice to pass `--out` was
   * printed to runs that had just passed `--out`, which reads as "your
   * directory was ignored" — and it was not. The second case is the falsifier
   * that separates repairing the line from deleting it.
   */
  it('names the --out it was given instead of advising the flag that was passed', () => {
    const out = outDir('wrinkle');
    const run = runCli([CONFIG, ...FLAGS, `--out=${out}`, '--dry-run']);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Dry run — no files written to ${out}.`);
    expect(run.stdout).not.toContain('pass --out=');
    expect(readdirSync(out)).toEqual([]);
  });

  it('keeps advising --out on a run that has none', () => {
    const run = runCli([CONFIG, ...FLAGS, '--dry-run']);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Dry run — no files written (pass --out=<dir> to write).');
  });
  // Every case spawns the CLI through `tsx`; measured at ~4 s per run on a
  // shared box, over vitest's 5 s default once a case spawns twice. Same
  // instrument and the same generous ceiling as the sibling CLI-spawning pins
  // in this directory.
}, 900_000);
