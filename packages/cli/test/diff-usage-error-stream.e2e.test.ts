// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os diff` with NO path arguments ⇒ nothing unparseable on stdout, in EITHER
 * face (#15697).
 *
 * ## Why this is a second file rather than a case in the sibling pin
 *
 * `config-miss-stdout-purity.e2e.test.ts` (#15547) drives the same command, but
 * a different branch of it: its `FAMILY` entry is
 * `diff: { explicit: [MISSING, MISSING], auto: null }` — two paths, supplied so
 * the run gets *past* the usage check and down into `resolveConfigPath()`. It
 * says so in place: "`os diff` requires two config paths, so there is no bare
 * form that reaches the helper without one."
 *
 * That is precisely the branch this file drives — the bare form. The refusal
 * here is `diff.ts`'s own usage error, reached BEFORE any config work happens,
 * so the sibling pin structurally cannot see it and stayed green through it.
 *
 * ## What was measured
 *
 * The four writes sat ABOVE the command's first `if (!flags.json)`, so the face
 * was still undecided when they ran and they fired in BOTH. On the published
 * entry `bin/run.js`, `NO_COLOR=1`, streams captured separately:
 *
 *     os diff --json   → exit 1 · stdout 141 bytes of prose · stderr 0 bytes
 *     os diff          → exit 1 · stdout 141 bytes of prose · stderr 0 bytes
 *
 * Byte-identical, because there was no branch to tell the faces apart. And
 * `JSON.parse(stdout)` threw on the one stream `--json` reserves for the
 * machine.
 *
 * ## What is asserted — and what is deliberately NOT
 *
 * ⛔ No error-payload shape is pinned here. Whether `--json` should emit an
 * envelope on a refusal is an open question entangled with #15549
 * (`os lint --eval --json`'s bare `{ error }`, no `code`, no `httpStatus`), and
 * settling it is above this pin's authority.
 *
 * So the assertion is the half that needs no ruling, and it is a PROPERTY, not
 * a string: **stdout carries nothing a machine cannot read.** Empty passes, one
 * JSON document passes, prose fails. A pin on "141 bytes" would rot on the next
 * wording change; this one survives it, and survives whoever settles the
 * envelope question without their having to touch this file.
 *
 * The other assertions are the ones a "just silence it" regression would break:
 * the diagnostic must still reach the operator on **stderr**, and the exit
 * status must still be 1.
 *
 * ## Anti-vacuity
 *
 * Every assertion below is green if the command dies early for an unrelated
 * reason — an empty stdout is "machine-readable" and a missing string is "not
 * on stdout". So the suite refuses to report until a CONTROL has shown that
 * this argv actually reaches this command: `os diff --help` must exit 0 and
 * render the command's own description. If the binary were broken, the control
 * goes red and the rest is known to be worthless rather than quietly green.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const COMMANDS_DIR = resolve(HERE, '../src/commands');

/** The refusal and its two hint lines — what must be on stderr, never stdout. */
const REFUSAL = 'Two config file paths are required.';
const HINTS = ['Usage: objectstack diff', 'or: objectstack diff --before'] as const;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(argv: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...argv],
      { cwd, maxBuffer: 32 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err
            ? (typeof (err as { code?: unknown }).code === 'number'
                ? (err as unknown as { code: number }).code
                : 1)
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/**
 * Whether stdout is something a program can read: nothing at all, or exactly
 * one JSON document. Prose is the failure — see the header for why the choice
 * between the two passing shapes is deliberately left open.
 */
function stdoutIsMachineReadable(stdout: string): boolean {
  if (stdout.trim() === '') return true;
  try {
    JSON.parse(stdout);
    return true;
  } catch {
    return false;
  }
}

/**
 * The two faces, both driven with NO path arguments — the argv that reaches the
 * usage error. `--json` is the machine face; bare is the text face. The defect
 * fired in both, so both are pinned.
 */
const FACES: Record<string, string[]> = {
  'machine face (--json)': ['diff', '--json'],
  'text face (bare)': ['diff'],
};

let dir: string;
let control: Run;
let runs: Record<string, Run>;

beforeAll(async () => {
  // Deliberately EMPTY. The usage error is raised before any config work, so
  // the cwd cannot influence it — an empty dir keeps that true rather than
  // assumed, by making sure no stray `objectstack.config.*` is in reach.
  dir = mkdtempSync(join(tmpdir(), 'os-diff-usage-e2e-'));

  // Sequential: concurrent `tsx` starts are the kind of load that makes a
  // shared box report timeouts instead of verdicts.
  control = await runCli(['diff', '--help'], dir);
  runs = {};
  for (const [name, argv] of Object.entries(FACES)) {
    runs[name] = await runCli(argv, dir);
  }
}, 900_000);

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('control — the reading below is worthless without this', () => {
  it('resolves the dev entry it drives', () => {
    // A run against a path that does not exist fails exactly like a true
    // negative: empty streams, non-zero exit. Rule it out before reading
    // anything off the runs.
    expect(existsSync(CLI)).toBe(true);
    expect(existsSync(TSX)).toBe(true);
  });

  it('actually reaches `os diff` with this argv', () => {
    // If this is red, every assertion below is green for the wrong reason.
    expect(control.code).toBe(0);
    expect(control.stdout).toContain('Compare two ObjectStack configurations');
  });
});

describe.each(Object.keys(FACES))('os diff, no path arguments — %s', (face) => {
  const runOf = (): Run => runs[face];

  it('leaves nothing on stdout that a machine cannot read', () => {
    // Under the defect this was 141 bytes of `  ✗ Two config file paths are
    // required.` plus a blank line and two usage hints — on the one stream
    // `--json` reserves for the machine, with stderr completely empty.
    expect(stdoutIsMachineReadable(runOf().stdout)).toBe(true);
  });

  it('keeps the human refusal off stdout entirely', () => {
    // Asserted separately from the parse so a regression names its cause
    // rather than only `Unexpected token`.
    const { stdout } = runOf();
    expect(stdout).not.toContain(REFUSAL);
    for (const hint of HINTS) expect(stdout).not.toContain(hint);
  });

  it('still shows the operator the refusal and both hints — on stderr', () => {
    // Diagnostics are MOVED, never destroyed: a regression toward silencing
    // this path goes red here. This is also the pair that makes the assertion
    // above non-vacuous — an early death would leave stderr without these.
    const { stderr } = runOf();
    expect(stderr).toContain(REFUSAL);
    for (const hint of HINTS) expect(stderr).toContain(hint);
  });

  it('still exits 1', () => {
    expect(runOf().code).toBe(1);
  });
});

/**
 * The structural tripwire: `diff` was the ONLY command shaped this way, and a
 * new one must not arrive unnoticed.
 *
 * ⚠️ Its bound, stated rather than implied: this is a source-text scan, so it
 * sees only the print helpers it names, called syntactically inside `run()`
 * above the first `flags.json` read. It does NOT follow calls into helpers —
 * that is how #15547 was reached, through `loadConfig()` — and a command that
 * reads `flags.json` into a local on its first line hides everything below from
 * this check. It is a tripwire for the shape that was measured, not a proof
 * that no other shape exists.
 */
describe('no new command has grown a stdout write above its --json guard', () => {
  function commandFiles(d: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(d)) {
      const abs = join(d, entry);
      if (statSync(abs).isDirectory()) {
        out.push(...commandFiles(abs));
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
      out.push(abs);
    }
    return out;
  }

  const WRITES_TO_STDOUT =
    /\b(?:console\.log|printHeader|printStep|printInfo|printSuccess|printWarning|printError)\(/;

  function offenders(): string[] {
    const found: string[] = [];
    for (const abs of commandFiles(COMMANDS_DIR)) {
      const lines = readFileSync(abs, 'utf-8').split('\n');
      if (!lines.some((l) => /\bjson:\s*Flags\.boolean\(/.test(l))) continue;
      const runIdx = lines.findIndex((l) => /async run\s*\(/.test(l));
      if (runIdx < 0) continue;
      const guardIdx = lines.findIndex(
        (l, i) => i >= runIdx && /flags\.json|flags\[['"]json['"]\]/.test(l),
      );
      if (guardIdx < 0) continue;
      if (lines.slice(runIdx, guardIdx).some((l) => WRITES_TO_STDOUT.test(l))) {
        found.push(relative(COMMANDS_DIR, abs).split(sep).join('/'));
      }
    }
    return found.sort();
  }

  it('scans a non-empty family — refuse to reason from zero', () => {
    // The scan is only evidence if it looked at something. A refactor that
    // moved or renamed the commands directory would otherwise report "no
    // offenders" from an empty sweep.
    const withJson = commandFiles(COMMANDS_DIR).filter((abs) =>
      /\bjson:\s*Flags\.boolean\(/.test(readFileSync(abs, 'utf-8')),
    );
    expect(withJson.length).toBeGreaterThan(10);
  });

  it('finds none', () => {
    expect(offenders()).toEqual([]);
  });
});
