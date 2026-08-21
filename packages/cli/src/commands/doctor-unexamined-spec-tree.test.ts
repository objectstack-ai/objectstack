// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor` does not print `✓ Test coverage` / `✓ Deprecations` about a tree
 * it never examined (#10679).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `findMissingTests()` and `findDeprecatedUsages()` both walk
 * `<cwd>/packages/spec/src`, a path that exists in this monorepo and in no
 * application built with the framework. Both opened with:
 *
 *     const specSrcDir = path.join(cwd, 'packages/spec/src');
 *     if (!fs.existsSync(specSrcDir)) return [];
 *
 * so "that directory is not here" and "I walked it and found nothing wrong"
 * arrived at the caller as the same value — an empty array — and the caller's
 * `else` branch printed, in a stock `create-objectstack -t blank` scaffold:
 *
 *     ✓ Test coverage         All *.zod.ts files have matching tests
 *     ✓ Deprecations          No @deprecated tags found
 *
 * about files doctor never opened. The command exits 0 either way, so "no
 * problems found" and "I never looked" are byte-identical to every downstream
 * reader — a CI step, a scripted preflight, an operator scanning the report.
 *
 * ── Why this is doctor's own rule, not a new one ─────────────────────────
 *
 * One screen down, the ADR-0120 D5e advisory already refuses to do this: its
 * `✓ Unique scope` is printed only when `ledgerReadingIsComplete()` says the
 * ledger half was read in full (#5412 / #5413 / #5644, pinned next door in
 * `doctor-ledger-read-failure.test.ts`), because a `✓` over an unread half is
 * a false PASS and a false PASS is the one thing that stops an operator
 * looking further. These two checks escaped that discipline. Restoring it is
 * what this file pins.
 *
 * The fix takes #5413's shape as well as its rule: whether the tree was
 * examined is now a FACT IN THE TYPE (`MonorepoTreeScan`'s `scanned` arm)
 * rather than an absence, so the print site cannot reach the `✓` from the
 * unexamined arm even by accident.
 *
 * ── The adjacent row, same class (same card) ─────────────────────────────
 *
 * `⚠ @objectstack/spec  Not built` probed `<cwd>/packages/spec/dist` with no
 * check that the workspace it names is part of the tree at all. In an
 * application it warned about a package that is not there, flipped the run's
 * summary to "functional but has some warnings", and prescribed
 * `pnpm --filter @objectstack/spec build` — a command that cannot succeed
 * where there is no such workspace. It is now gated on the workspace
 * existing; inside the monorepo the warning is unchanged, and the last two
 * describes below pin both halves of that.
 *
 * ── What this file deliberately does NOT do ──────────────────────────────
 *
 * It does not assert that the `✓` still appears when the tree WAS walked and
 * call that a fix — that assertion passes against the defect. Every case
 * below is anchored on the user-app cwd where the tree is absent, with the
 * monorepo-shaped cwd present only as the no-regression half.
 *
 * Nor does it change any exit code. The skip is informational (`ℹ`), never a
 * warning: nothing is wrong in an application that has no `packages/spec/src`,
 * and withholding a false `✓` must not manufacture a false `⚠`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor, { monorepoTreeSkipNotice } from './doctor.js';

/** `packages/cli` — the oclif root the real command is loaded against below. */
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * `chalk` may or may not emit SGR codes depending on TTY detection.
 *
 * The escape is written as `\x1b`, never as the byte itself: one raw control
 * character makes `grep` treat the whole file as binary, and a test file no
 * `git grep` can find stops being maintained (#4890 / #5157).
 */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

/** The two clean bills of health that must NOT appear over an unwalked tree. */
const TEST_COVERAGE_CLAIM = 'All *.zod.ts files have matching tests';
const DEPRECATIONS_CLAIM = 'No @deprecated tags found';

/** The head of the row that replaces each of them. */
const SKIP_HEADLINE = 'Skipped — no packages/spec/src in this directory';

/** The monorepo-anchored build probe's warning and its unusable prescription. */
const NOT_BUILT = 'Not built';
const NOT_BUILT_FIX = 'pnpm --filter @objectstack/spec build';

describe('monorepoTreeSkipNotice — the line an unexamined tree prints instead of a ✓', () => {
  const DIR = '/srv/app/packages/spec/src';

  it('names the reason, not merely that something was skipped', () => {
    const notice = monorepoTreeSkipNotice('Test coverage', DIR);

    // "Skipped" alone is the same silence in a different hat: the operator
    // still cannot tell WHICH tree went unread or why.
    expect(notice.message).toContain('Skipped');
    expect(notice.message).toContain('packages/spec/src');
    expect(notice.message).toContain('monorepo-only check');
  });

  it('keeps the check’s own name in the column an operator scans', () => {
    // Load-bearing, not cosmetic — the same reason the ledger rows kept a name
    // column rather than vanishing (#5429). A row that disappears is
    // indistinguishable from a check that was silently dropped.
    const notice = monorepoTreeSkipNotice('Test coverage', DIR);

    expect(notice.message.startsWith('Test coverage')).toBe(true);
    // 22-column name field, matching the sibling `✓` lines of this report.
    expect(notice.message.indexOf('Skipped')).toBe(22);
  });

  it('names the directory doctor actually resolved, in the verbose detail', () => {
    // A relative literal restated in prose is a claim the reader has to trust.
    // The resolved path is one they can check.
    const notice = monorepoTreeSkipNotice('Deprecations', DIR);

    expect(notice.detail).toContain(DIR);
  });

  it('never carries either clean bill of health', () => {
    for (const name of ['Test coverage', 'Deprecations']) {
      const notice = monorepoTreeSkipNotice(name, DIR);
      expect(notice.message).not.toContain(TEST_COVERAGE_CLAIM);
      expect(notice.message).not.toContain(DEPRECATIONS_CLAIM);
      expect(notice.detail).not.toContain(TEST_COVERAGE_CLAIM);
      expect(notice.detail).not.toContain(DEPRECATIONS_CLAIM);
    }
  });
});

/**
 * `node_modules/` exists in every temp cwd below on purpose — without it
 * doctor's `Dependencies` check is itself an `error` and exits 1 on its own,
 * which would make an assertion pass for a reason having nothing to do with
 * this change (the trap PR #5390 wrote down, inherited via #5402 / #5410).
 */
function makeTempCwd(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `os-doctor-10679-${tag}-`));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  return dir;
}

describe('os doctor, end to end, in a user-app cwd with no packages/spec', () => {
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = makeTempCwd('userapp');
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function runDoctor(argv: string[] = []): Promise<{ out: string; exitCode: number | undefined }> {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error(`__PROCESS_EXIT__:${code}`);
    }) as never);

    try {
      await Doctor.run(argv, { root: CLI_ROOT });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__PROCESS_EXIT__')) throw err;
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
    return { out: plain(logs.join('\n')), exitCode };
  }

  // A real `Doctor.run()` takes seconds (it shells out to `git --version`,
  // walks the workspace and reads the ledger), so every case here carries an
  // explicit timeout instead of racing vitest's 5s default.
  const E2E_TIMEOUT = 60_000;

  it('withholds BOTH clean bills of health, and says why instead', async () => {
    const run = await runDoctor();

    // ① THE assertion of this issue: the two false PASSes are gone.
    expect(run.out).not.toContain(TEST_COVERAGE_CLAIM);
    expect(run.out).not.toContain(DEPRECATIONS_CLAIM);

    // ② …replaced by rows that name what was not examined and why. Present,
    // not merely absent — see the name-column case above.
    expect(run.out).toContain('Test coverage');
    expect(run.out).toContain('Deprecations');
    const skipRows = run.out.split('\n').filter((line) => line.includes(SKIP_HEADLINE));
    expect(skipRows).toHaveLength(2);
  }, E2E_TIMEOUT);

  it('does not announce a scan that never started', async () => {
    // The step lines pair with a result. "Checking for missing test files..."
    // followed by a skip row is the same overclaim one line earlier.
    const run = await runDoctor();

    expect(run.out).not.toContain('Checking for missing test files');
    expect(run.out).not.toContain('Scanning for @deprecated usage');
  }, E2E_TIMEOUT);

  it('marks the skip as informational — a withheld ✓ must not become a ⚠', async () => {
    const run = await runDoctor();

    for (const name of ['Test coverage', 'Deprecations']) {
      const row = run.out.split('\n').find((line) => line.includes(name));
      expect(row, `no row named ${name}`).toBeDefined();
      // The glyph IS the verdict for a reader scanning the column.
      expect(row).toContain('ℹ');
      expect(row).not.toContain('✓');
      expect(row).not.toContain('⚠');
    }
  }, E2E_TIMEOUT);

  it('names the directory it did not walk, and only when asked', async () => {
    const unwalked = path.join(tmp, 'packages', 'spec', 'src');

    // #5403's rule: a detail is optional reading until the operator asks.
    const quiet = await runDoctor();
    expect(quiet.out).not.toContain(unwalked);

    const verbose = await runDoctor(['--verbose']);
    expect(verbose.out).toContain(unwalked);
  }, E2E_TIMEOUT);

  it('drops the monorepo-anchored `@objectstack/spec Not built` warning entirely', async () => {
    // Same class, same card: a verdict about a workspace that is not part of
    // this tree — prescribing a command that cannot succeed here.
    const quiet = await runDoctor();
    const verbose = await runDoctor(['--verbose']);

    expect(quiet.out).not.toContain(NOT_BUILT);
    expect(quiet.out).not.toContain(NOT_BUILT_FIX);
    expect(verbose.out).not.toContain(NOT_BUILT);
    expect(verbose.out).not.toContain(NOT_BUILT_FIX);
  }, E2E_TIMEOUT);

  it('changes nothing about the exit contract — still 0, still no error rows', async () => {
    // The fence on this card: withholding a ✓ is a reporting change, not a
    // severity change. `process.exit` is never reached.
    const run = await runDoctor();

    expect(run.exitCode).toBeUndefined();
    expect(run.out).not.toContain('Some critical issues found');
  }, E2E_TIMEOUT);
});

describe('os doctor, end to end, in a monorepo-shaped cwd — the no-regression half', () => {
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let specSrc: string;

  beforeEach(() => {
    tmp = makeTempCwd('monorepo');
    specSrc = path.join(tmp, 'packages', 'spec', 'src');
    fs.mkdirSync(specSrc, { recursive: true });
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function runDoctor(argv: string[] = []): Promise<{ out: string; exitCode: number | undefined }> {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error(`__PROCESS_EXIT__:${code}`);
    }) as never);

    try {
      await Doctor.run(argv, { root: CLI_ROOT });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__PROCESS_EXIT__')) throw err;
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
    return { out: plain(logs.join('\n')), exitCode };
  }

  const E2E_TIMEOUT = 60_000;

  it('prints both ✓ lines when the tree really was walked and is clean', async () => {
    fs.writeFileSync(path.join(specSrc, 'account.zod.ts'), 'export const A = 1;\n');
    fs.writeFileSync(path.join(specSrc, 'account.test.ts'), 'export const T = 1;\n');

    const run = await runDoctor();

    expect(run.out).toContain(TEST_COVERAGE_CLAIM);
    expect(run.out).toContain(DEPRECATIONS_CLAIM);
    // The skip is unreachable from this arm.
    expect(run.out).not.toContain('Skipped');
    // And the step lines are back, because a scan really did start.
    expect(run.out).toContain('Checking for missing test files');
    expect(run.out).toContain('Scanning for @deprecated usage');
  }, E2E_TIMEOUT);

  it('still reports the real findings when the walked tree is not clean', async () => {
    // No sibling `.test.ts`, and a `@deprecated` tag in the file itself: one
    // finding for each check, from a tree that genuinely was examined.
    fs.writeFileSync(
      path.join(specSrc, 'invoice.zod.ts'),
      '/** @deprecated use billing */\nexport const I = 1;\n',
    );

    const run = await runDoctor();

    expect(run.out).toContain('Missing test: invoice.test.ts');
    expect(run.out).toContain('@deprecated tag found');
    expect(run.out).not.toContain(TEST_COVERAGE_CLAIM);
    expect(run.out).not.toContain(DEPRECATIONS_CLAIM);
    expect(run.out).not.toContain('Skipped');
    // Warnings never flip the exit code.
    expect(run.exitCode).toBeUndefined();
  }, E2E_TIMEOUT);

  it('keeps ⚠ Not built where the spec workspace really exists and is unbuilt', async () => {
    fs.writeFileSync(
      path.join(tmp, 'packages', 'spec', 'package.json'),
      JSON.stringify({ name: '@objectstack/spec', version: '1.0.0' }),
    );

    const run = await runDoctor(['--verbose']);

    // Gating this probe on the workspace must not silence it where the
    // workspace is real — that would be trading a false warning for no warning.
    expect(run.out).toContain(NOT_BUILT);
    expect(run.out).toContain(NOT_BUILT_FIX);
  }, E2E_TIMEOUT);

  it('prints ✓ Built once that workspace has a dist/', async () => {
    fs.writeFileSync(
      path.join(tmp, 'packages', 'spec', 'package.json'),
      JSON.stringify({ name: '@objectstack/spec', version: '1.0.0' }),
    );
    fs.mkdirSync(path.join(tmp, 'packages', 'spec', 'dist'));

    const run = await runDoctor();

    expect(run.out).toContain('@objectstack/spec');
    expect(run.out).not.toContain(NOT_BUILT);
    expect(run.out).toMatch(/@objectstack\/spec\s+Built/);
  }, E2E_TIMEOUT);
});
