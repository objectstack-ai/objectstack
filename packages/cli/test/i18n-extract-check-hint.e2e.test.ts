// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The command `os i18n extract --check` prints when it fails is a command that
 * REGENERATES the bytes it just refused (#14895).
 *
 * ## What was wrong
 *
 * The hint was assembled from the four things the print site happened to have
 * in scope — the config arg, the emitted locales minus the default one,
 * `--fill` and `--out`. Driven here on the reporter's own invocation, against a
 * stack whose `i18n.defaultLocale` is `zh-CN`:
 *
 *     $ os i18n extract stack.config.ts --locales=zh-CN --no-metadata-forms
 *         --no-objects-only --filter=kpi_ --out=OUT --check
 *       missing:    ../../../../../tmp/os-i18n-repro-jNrZ/zh-CN.objects.generated.ts
 *       Translation bundles have drifted from the schema. Regenerate and commit:
 *       os i18n extract stack.config.ts --locales= --fill=empty --out=OUT
 *
 * Three defects in one line, and the third is on the line above it:
 *
 *   1. `--locales=` came out EMPTY. The echo dropped the default locale on the
 *      grounds that `--locales` always includes it — and here the only locale
 *      asked for WAS the default one, so nothing was left. The `Skeleton
 *      summary` two lines up is the report's own control: it names `zh-CN`, so
 *      one code path had the locale and the other did not.
 *   2. `--no-metadata-forms`, `--no-objects-only` and `--filter=kpi_` were not
 *      in the expression at all, so they were not in the advice. Running what
 *      it printed wrote 775 keys across two files where the operator's own
 *      command writes 2 across one — including a `metadata-forms` companion
 *      they had explicitly switched off.
 *   3. `missing:` printed a `../../../../../…` walk out of the cwd for a
 *      directory the operator had just typed in full.
 *
 * Defect 2 is the one that costs something. `--check` failing is SELF-HEALABLE:
 * regenerate, commit, done. Following the printed advice instead emitted a
 * different key set, so the next `--check` failed again — on `out of date:`
 * rather than `missing:` — and printed the same wrong command. Measured, both
 * halves, before the repair.
 *
 * ## Why these shapes
 *
 * The defect is not that some flag was formatted wrong; it is that the printed
 * line was BUILT rather than reproduced, so a flag nobody thought about at the
 * print site is silently absent. A pin that checked for `--filter` and
 * `--no-objects-only` by name would inherit exactly that blind spot — it would
 * be green for the next flag added to this command. So the central case asserts
 * the WHOLE token list: the hint is this run's argv with one token removed, and
 * nothing else, for every flag whether or not this file has heard of it.
 *
 * The second case is the property the card is actually about, and it is the one
 * no approximate command can satisfy: the printed line is executed VERBATIM
 * through a real shell — an `os` shim on `PATH` puts it in front of this
 * repo's source entry point — and the original `--check` must then pass. That
 * closes the loop end to end, quoting included, without this file re-deriving
 * what the command should have been.
 *
 * ## Fixture placement
 *
 * The stack config goes under this package's git-ignored `tmp/` and the `--out`
 * roots in the system temp dir, for the reason `i18n-extract-key-count.e2e`
 * records: `bundle-require` writes its bundled module next to the config, so
 * Node resolves the bare `@objectstack/spec` specifier from THAT directory, and
 * only under `packages/cli/tmp/` does that lookup reach this package's real
 * `node_modules`. `git check-ignore -v packages/cli/tmp/x` answers
 * `.gitignore:55:tmp/`. `afterAll` removes only this suite's own `mkdtemp`
 * directories — several suites share that root and run concurrently.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const CLI_PACKAGE_ROOT = resolve(HERE, '..');

/**
 * The reporter's stack: one `kpi_`-prefixed object, and — the condition that
 * makes defect 1 visible at all — a `defaultLocale` equal to the only locale
 * the invocation asks for.
 */
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

let fixtureRoot: string;
let outRoot: string;
let shimRoot: string;
let CONFIG: string;

beforeAll(() => {
  const sharedRoot = join(CLI_PACKAGE_ROOT, 'tmp');
  mkdirSync(sharedRoot, { recursive: true });
  fixtureRoot = mkdtempSync(join(sharedRoot, 'os-i18n-14895-fixture-'));
  // Named for AUTO-DISCOVERY, so the case that passes no config argument can
  // reach it the way the reporter's own invocation reached theirs.
  CONFIG = join(fixtureRoot, 'objectstack.config.ts');
  writeFileSync(CONFIG, STACK_CONFIG, 'utf8');
  outRoot = mkdtempSync(join(tmpdir(), 'os-i18n-14895-'));

  // The `os` a copied command line calls. It has to be a real executable on
  // `PATH` rather than a string substitution, because the point of the case
  // that uses it is that a SHELL reads the printed line — substituting the
  // entry point in first would edit the very bytes under test.
  shimRoot = mkdtempSync(join(tmpdir(), 'os-i18n-14895-bin-'));
  const shim = join(shimRoot, 'os');
  writeFileSync(shim, `#!/bin/sh\nexec ${JSON.stringify(TSX)} ${JSON.stringify(CLI)} "$@"\n`, 'utf8');
  chmodSync(shim, 0o755);
});

afterAll(() => {
  // This suite's own directories only. Never the shared `tmp/` root.
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(outRoot, { recursive: true, force: true });
  rmSync(shimRoot, { recursive: true, force: true });
});

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
function runCli(args: readonly string[], cwd: string = CLI_PACKAGE_ROOT): Run {
  const child = spawnSync(TSX, [CLI, 'i18n', 'extract', ...args], {
    cwd,
    encoding: 'utf8',
    env: childEnv(),
    timeout: 180_000,
  });
  return { stdout: plain(`${child.stdout ?? ''}${child.stderr ?? ''}`), status: child.status };
}

/**
 * The line `--check` prints under "Regenerate and commit:" — the hint itself,
 * whatever shape it is in. Read positionally rather than by matching `os …`, so
 * that the degraded sentence would be returned rather than look like an absence.
 */
function hintLine(stdout: string): string {
  const lines = stdout.split('\n');
  const at = lines.findIndex((line) => line.includes('Regenerate and commit:'));
  if (at === -1 || at + 1 >= lines.length) throw new Error(`no regenerate hint in:\n${stdout}`);
  return lines[at + 1].trim();
}

/** The `missing:` / `out of date:` paths `--check` reported, in order. */
function driftPaths(stdout: string): string[] {
  return [...stdout.matchAll(/(?:missing:|out of date:)\s+(\S+)/g)].map((m) => m[1]);
}

/** The reporter's invocation, minus `--out` and `--check`, which each case supplies. */
const REPORTED_FLAGS = ['--locales=zh-CN', '--no-metadata-forms', '--no-objects-only', '--filter=kpi_'];

describe('os i18n extract --check — the hint is the invocation, not a reconstruction of it (#14895)', () => {
  /**
   * Defects 1 and 2 together, as ONE total assertion.
   *
   * Falsifier: restoring the assembled expression prints
   * `os i18n extract CONFIG --locales= --fill=empty --out=OUT` — which differs
   * from the expected list in four places at once (an empty `--locales`, an
   * invented `--fill`, and three flags missing).
   */
  it("echoes this run's own argv with `--check` removed, flag for flag", () => {
    const out = join(outRoot, 'echo');
    const argv = [CONFIG, ...REPORTED_FLAGS, `--out=${out}`, '--check'];
    const run = runCli(argv);

    expect(run.status).toBe(1);
    expect(hintLine(run.stdout).split(' ')).toEqual([
      'os',
      'i18n',
      'extract',
      ...argv.filter((token) => token !== '--check'),
    ]);
  });

  /**
   * The loop this card reports, closed end to end.
   *
   * The printed line is handed to `sh -c` with the shim on `PATH`, so what runs
   * is the bytes the operator would have copied — spacing, quoting and all —
   * and the ORIGINAL `--check` then has to pass. Before the repair this suite's
   * first shape wrote two files instead of one and the re-check failed again
   * with `out of date:`.
   *
   * The second shape carries a `|` in a flag value, which is a pipe to a shell
   * and nothing to the CLI: it passes only if the hint quotes what it echoes.
   */
  it.each([
    ['reported invocation', REPORTED_FLAGS],
    ['shell-hostile flag value', ['--locales=zh-CN', '--no-metadata-forms', '--filter=kpi_|nothing_else']],
  ])('following the printed command makes the next --check pass (%s)', (name, flags) => {
    const out = join(outRoot, `heal-${name.replace(/\W+/g, '-')}`);
    const args = [CONFIG, ...flags, `--out=${out}`, '--check'];

    const failed = runCli(args);
    expect(failed.status).toBe(1);
    const hint = hintLine(failed.stdout);
    expect(hint.startsWith('os i18n extract ')).toBe(true);

    // Executed as a SHELL COMMAND, not as an argv this file rebuilt.
    const copied = spawnSync('sh', ['-c', hint], {
      cwd: CLI_PACKAGE_ROOT,
      encoding: 'utf8',
      env: childEnv({ PATH: `${shimRoot}:${process.env.PATH ?? ''}` }),
      timeout: 180_000,
    });
    expect({ status: copied.status, stderr: copied.stderr }).toEqual({ status: 0, stderr: '' });

    const healed = runCli(args);
    expect({ status: healed.status, drift: driftPaths(healed.stdout) }).toEqual({ status: 0, drift: [] });
    expect(healed.stdout).toContain('in sync with the schema');
    // And it wrote what this invocation asks for and nothing beside it: the
    // suppressed `metadata-forms` companion is the file the old hint added.
    expect(readdirSync(out).sort()).toEqual(['zh-CN.objects.generated.ts']);
  });

  /**
   * The deletion is positional and touches only its own token: `--check` first,
   * values spelled with spaces instead of `=`, and no config argument at all.
   * Falsifier — an echo rebuilt from parsed flags cannot produce `--locales
   * zh-CN` at all; it would normalise to `--locales=zh-CN`.
   */
  it('removes only the --check token, leaving spelling and order alone', () => {
    const out = join(outRoot, 'spelling');
    const run = runCli(['--check', '--out', out, '--locales', 'zh-CN', '--no-metadata-forms'], fixtureRoot);

    expect(run.status).toBe(1);
    expect(hintLine(run.stdout)).toBe(`os i18n extract --out ${out} --locales zh-CN --no-metadata-forms`);
  });

  /**
   * Defect 3, in the direction that was wrong: an `--out` the cwd cannot reach
   * downwards is named in full, never as a walk.
   */
  it('names a drifted bundle outside the cwd by its absolute path', () => {
    const out = join(outRoot, 'absolute');
    const run = runCli([CONFIG, ...REPORTED_FLAGS, `--out=${out}`, '--check']);

    expect(run.status).toBe(1);
    expect(driftPaths(run.stdout)).toEqual([join(out, 'zh-CN.objects.generated.ts')]);
  });

  /**
   * Defect 3, in the direction that was already right — and the reason the
   * repair is a threshold rather than "print everything absolutely". All nine
   * of this repo's extract configs write in-tree, and their `--check` output
   * keeps the short relative form it has always had.
   */
  it('keeps the short relative form for an --out below the cwd', () => {
    const run = runCli([CONFIG, ...REPORTED_FLAGS, '--out=bundles', '--check'], fixtureRoot);

    expect(run.status).toBe(1);
    expect(driftPaths(run.stdout)).toEqual([join('bundles', 'zh-CN.objects.generated.ts')]);
  });
  // Every case spawns the CLI through `tsx`, and the healing cases spawn it
  // three times; measured at ~6 s per run on a shared box, well over vitest's
  // 5 s default. Same instrument and the same generous ceiling as the sibling
  // CLI-spawning pins in this directory.
}, 900_000);
