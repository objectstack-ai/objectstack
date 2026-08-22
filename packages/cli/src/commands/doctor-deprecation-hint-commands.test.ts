// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor` never prescribes a command `os` does not register (#10680).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * After `--scan-deprecations` reported its hits, doctor printed:
 *
 *     ℹ Found N deprecated pattern(s). Run `objectstack codemod v2-to-v3` to auto-fix.
 *
 * There is no `codemod` command. oclif resolves this CLI's commands by
 * globbing `dist/commands/**` (`package.json` → `oclif.commands`, pattern
 * strategy); nothing under `src/commands/` compiles to `codemod`, and neither
 * bundled plugin (`@oclif/plugin-help`, `@oclif/plugin-plugins`) supplies one.
 * An operator who followed the prescription got oclif's exit 2,
 * `command codemod:v2-to-v3 not found` — after spending their time on it.
 * `content/docs/protocol/backward-compatibility.mdx` already recorded the
 * automated codemod as "not yet available"; the tool was the last place still
 * claiming otherwise.
 *
 * This is the same class as the two defects fixed next door: `os doctor`
 * printing `✓` over a tree it never walked (#10679) and `os datasource
 * validate` passing over drift it never read. A tool that speaks with
 * confidence about work it cannot do costs the reader their time before they
 * can find out — and a WRONG prescription costs more than no prescription.
 *
 * ── Why the hint was removed rather than repointed ───────────────────────
 *
 * The obvious repair — point it at `os migrate meta`, the registered metadata
 * migrator — would have been the same defect respelled, so it is deliberately
 * NOT what landed:
 *
 *   · `os migrate meta`'s subject is an authored stack CONFIG replayed across
 *     protocol majors. Its own header declines the rewrite this hint promises:
 *     it "does not silently rewrite TS config source (that AST rewrite is
 *     unsafe and lossy)". Both of its writes are `--out` JSON snapshots, and
 *     `--from` is required, so a bare `os migrate meta` fails too. It cannot
 *     touch the `src/**` TypeScript the scan reports on, and three of the
 *     eight DEPRECATED_PATTERNS (`EnhancedObjectKernel` and the two
 *     deep-import paths) are not metadata at all.
 *   · `os lint --fix` is print-only by declaration: "Show what would be fixed
 *     (dry-run)".
 *
 * Nothing registered does the job, so the line says nothing about a codemod
 * and points at the replacement it already computed for each finding instead.
 *
 * ── What this file pins ──────────────────────────────────────────────────
 *
 * The first describe closes the CLASS, not the instance: EVERY `os …` /
 * `objectstack …` hint doctor can print must name a command that resolves
 * under `src/commands/`. It fails on the shipped defect (that hint was the
 * only unresolvable one of the six in the file) and on any future one. The
 * rest drive the real command and pin both the corrected line and the scan
 * clauses that were already correct and must stay that way.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor from './doctor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `packages/cli/src/commands` — where oclif's pattern strategy finds commands. */
const COMMANDS_DIR = HERE;
/** `packages/cli` — the oclif root the real command is loaded against below. */
const CLI_ROOT = path.resolve(HERE, '..', '..');
const DOCTOR_SRC = path.join(COMMANDS_DIR, 'doctor.ts');

/**
 * chalk may or may not emit SGR codes depending on TTY detection.
 *
 * The escape is written as `\x1b`, never as the byte itself: one raw control
 * character makes `grep` treat the whole file as binary, and a test file no
 * `git grep` can find stops being maintained.
 */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

/**
 * Every backticked `os …` / `objectstack …` hint in a blob of text.
 *
 * Reads the raw source as well as rendered output, so the escaped backticks a
 * template literal carries (`` \` ``) are tolerated on both ends.
 */
function commandHintsIn(text: string): string[] {
  const hints: string[] = [];
  const re = /\\?`(os|objectstack)\s+([^`\n]*?)\\?`/g;
  for (const m of text.matchAll(re)) hints.push(`${m[1]} ${m[2]}`.trim());
  return hints;
}

/**
 * The command words of a hint: everything up to the first flag or placeholder.
 *
 * `os migrate meta --stored` addresses the command `migrate meta`; the flags
 * are that command's business, not the registry's.
 */
function commandWords(hint: string): string[] {
  const words = hint.split(/\s+/).slice(1);
  const out: string[] = [];
  for (const w of words) {
    if (!/^[a-z][a-z0-9-]*$/.test(w)) break;
    out.push(w);
  }
  return out;
}

/**
 * The file oclif would load for a hint, or `null` when nothing registers it.
 *
 * Longest prefix wins, mirroring oclif's topic resolution: `os migrate plan`
 * is `migrate/plan.ts`, `os serve` is `serve.ts`.
 */
function resolveCommand(hint: string): string | null {
  const words = commandWords(hint);
  for (let k = words.length; k > 0; k--) {
    const stem = path.join(COMMANDS_DIR, ...words.slice(0, k));
    for (const candidate of [`${stem}.ts`, path.join(stem, 'index.ts')]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function unregisteredHintsIn(text: string): string[] {
  return [...new Set(commandHintsIn(text))].filter((h) => resolveCommand(h) === null);
}

/**
 * The source with its comment lines removed — what doctor can actually PRINT.
 *
 * The rule this file enforces is about the report an operator reads, so a
 * command named in a comment (the print site documents the dead prescription
 * it replaced, verbatim) is prose, not a prescription. Only whole comment
 * lines are dropped, never a trailing `//`: `http://localhost:3000` lives
 * inside these strings, and a regex greedy enough to strip after it would
 * silently delete real hints and leave the sweep below passing over less than
 * it claims.
 */
function printableSource(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

describe('resolveCommand — the registry probe these cases are judged with', () => {
  // A probe that cannot fail proves nothing about the source it clears, so it
  // is exercised on both verdicts before being trusted below.
  it('resolves a real command, including a topic command', () => {
    expect(resolveCommand('os serve')).toBe(path.join(COMMANDS_DIR, 'serve.ts'));
    expect(resolveCommand('os migrate meta')).toBe(path.join(COMMANDS_DIR, 'migrate', 'meta.ts'));
  });

  it('refuses the exact prescription this issue is about', () => {
    expect(resolveCommand('objectstack codemod v2-to-v3')).toBeNull();
    // …and is not merely rejecting the version suffix.
    expect(resolveCommand('os codemod')).toBeNull();
  });

  it('addresses the command, not its flags', () => {
    expect(resolveCommand('os migrate meta --stored --apply')).toBe(
      path.join(COMMANDS_DIR, 'migrate', 'meta.ts'),
    );
    expect(resolveCommand('os doctor --scan-deprecations')).toBe(path.join(COMMANDS_DIR, 'doctor.ts'));
  });
});

describe('doctor.ts source — no phantom prescriptions anywhere in the file', () => {
  const printable = printableSource(fs.readFileSync(DOCTOR_SRC, 'utf8'));

  it('names only commands `os` registers', () => {
    // The class-closing assertion. Before the fix this listed exactly one
    // entry, `objectstack codemod v2-to-v3`; it must stay empty.
    expect(unregisteredHintsIn(printable)).toEqual([]);
  });

  it('finds enough hints for the sweep above to mean something', () => {
    // Guards the assertion against a haystack that quietly emptied — a regex
    // that stops matching, or a comment filter that ate the code with the
    // comments. Either would make the case above pass over nothing at all.
    expect(commandHintsIn(printable).length).toBeGreaterThan(10);
  });

  it('has dropped the dead codemod prescription outright', () => {
    // The print site still documents the dead command in a comment, on
    // purpose — that is the record of why this line reads as it does. What
    // must not survive is the prescription reaching an operator's screen.
    // (The word itself does survive, in the sentence that reports there is no
    // codemod; banning the word would ban saying so.)
    expect(printable).not.toContain('codemod v2-to-v3');
    expect(printable).not.toContain('os codemod');
    // Not repointed at `os migrate meta` either: that command declines the TS
    // rewrite this hint promised, so prescribing it would restate the defect.
    expect(printable).not.toContain('migrate meta');
  });
});

/**
 * `node_modules/` exists in every temp cwd on purpose — without it doctor's
 * `Dependencies` check is itself an `error` and exits 1 on its own, which
 * would make an assertion pass for a reason having nothing to do with this
 * change.
 */
function makeTempCwd(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `os-doctor-10680-${tag}-`));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'src'));
  return dir;
}

describe('os doctor --scan-deprecations, end to end', () => {
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = makeTempCwd('scan');
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeDeprecatedSource(): void {
    fs.writeFileSync(
      path.join(tmp, 'src', 'legacy.ts'),
      [
        "import { EnhancedObjectKernel } from '@objectstack/core/enhanced';",
        'export const field = { max_length: 40 };',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  async function runDoctor(argv: string[]): Promise<{ out: string; exitCode: number | undefined }> {
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
  // walks the workspace and reads the ledger), so every case carries an
  // explicit timeout instead of racing vitest's 5s default.
  const E2E_TIMEOUT = 60_000;

  it('prescribes no codemod, and nothing else `os` cannot run', async () => {
    writeDeprecatedSource();
    const run = await runDoctor(['--scan-deprecations']);

    // ① THE assertion of this issue.
    expect(run.out).not.toContain('codemod v2-to-v3');
    expect(run.out).not.toContain('to auto-fix');

    // ② …and the whole report is held to the same rule, not just this line.
    expect(unregisteredHintsIn(run.out)).toEqual([]);
  }, E2E_TIMEOUT);

  it('still reports the count, and says plainly that no codemod exists', async () => {
    writeDeprecatedSource();
    const run = await runDoctor(['--scan-deprecations']);

    // Removing a false prescription must not remove the finding's summary —
    // silence about the count would trade one defect for a smaller one.
    // 3, not 2: line 1 trips both `EnhancedObjectKernel` and the
    // `@objectstack/core/enhanced` import pattern. Pinning the real number
    // keeps this honest about what the scanner reports.
    expect(run.out).toContain('Found 3 deprecated pattern(s).');
    expect(run.out).toContain('No automated codemod ships with the CLI');
    // The remedy it points at is one that exists: the per-finding replacement,
    // reachable by a flag this command really declares.
    expect(run.out).toContain('re-run with --verbose to print them');
  }, E2E_TIMEOUT);

  it('drops the re-run advice once --verbose is already on', async () => {
    writeDeprecatedSource();
    const run = await runDoctor(['--scan-deprecations', '--verbose']);

    expect(run.out).toContain('No automated codemod ships with the CLI');
    expect(run.out).not.toContain('re-run with --verbose');
    // The thing it now points at is on screen: the → replacement per finding.
    expect(run.out).toContain('Use maxLength (camelCase)');
    expect(run.out).toContain("Use import from '@objectstack/core'");
  }, E2E_TIMEOUT);

  it('keeps file:line attribution for every hit', async () => {
    // A passing clause of the QA item — pinned here so this edit cannot be the
    // thing that regresses it.
    writeDeprecatedSource();
    const run = await runDoctor(['--scan-deprecations']);

    expect(run.out).toContain('legacy.ts:1');
    expect(run.out).toContain('legacy.ts:2');
    expect(run.out).toContain('snake_case config key: max_length');
  }, E2E_TIMEOUT);

  it('still warns rather than gates — hits do not change the exit code', async () => {
    // The other passing clause: the scan is advisory. Measured as a DELTA
    // against the same cwd with a clean `src/`, so an unrelated finding in the
    // temp cwd cannot make this pass or fail for the wrong reason.
    const clean = await runDoctor(['--scan-deprecations']);
    writeDeprecatedSource();
    const dirty = await runDoctor(['--scan-deprecations']);

    expect(clean.out).toContain('No deprecated patterns found');
    expect(dirty.exitCode).toBe(clean.exitCode);
    expect(dirty.exitCode).not.toBe(1);
  }, E2E_TIMEOUT);

  it('says nothing about codemods when the tree is clean', async () => {
    const run = await runDoctor(['--scan-deprecations']);

    expect(run.out).toContain('No deprecated patterns found');
    expect(run.out).not.toContain('No automated codemod ships with the CLI');
  }, E2E_TIMEOUT);
});
