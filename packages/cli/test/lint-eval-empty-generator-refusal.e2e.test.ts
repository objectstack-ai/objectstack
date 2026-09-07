// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os lint --eval --generator ""` ran the offline eval and said nothing.
 *
 * ## The measured before-shape
 *
 * `runEval` guarded the generator load with a TRUTHINESS test, so an empty
 * string fell through it: no load, no else branch, no warning, and the
 * `Failed to load generator` message that exists for exactly this kind of
 * failure was never reached. Driven on both entries before the fix, from the
 * lint-clean probe project below, with a generator that writes a marker file at
 * TOP-LEVEL evaluation so "was it loaded?" is answered by the filesystem
 * instead of by reading control flow:
 *
 *     os lint --eval --generator ""   exit 0 · Mode: offline · 5/5 passed · marker ABSENT
 *     os lint --eval                  exit 0 · Mode: offline · 5/5 passed · marker ABSENT
 *
 * ⇒ and the two were not merely alike. Normalise the elapsed-time token and
 * their stdouts were BYTE-IDENTICAL — one sha256 across `bin/run-dev.js` and
 * `bin/run.js` alike — stderr was 0 bytes in all four runs, and the `--json`
 * face differed only in `duration`. Passing an empty generator was
 * INDISTINGUISHABLE from not passing the flag, on every channel this command
 * has, while the report said `Mode: offline` to an operator who had asked for a
 * live run and read `5/5 passed` as their generator's score.
 *
 * ## What is pinned, and why the negatives are not decoration
 *
 * The fix NARROWS the accept set — `--generator ""` goes from accepted to
 * refused — so the pins hold both directions:
 *
 *   - positive — the refusal happens, on both faces, in the envelope this
 *     command already answers with (#16044): the human message on `error`,
 *     exit 1, `--json` stdout still one JSON document.
 *   - ⭐ distinguishability — the empty-generator run and the no-flag run must
 *     DIFFER once the elapsed token is normalised. That is the property this
 *     card is actually about, and it is the assertion that was byte-for-byte
 *     false before the fix.
 *   - ⭐ symmetry — the eval and non-eval sides must answer `--generator ""`
 *     the same way. #15550 / PR #16115 gave the non-eval side a `!== undefined`
 *     test; this card is that ruling reaching the eval side. One flag, one rule
 *     for "the operator typed it". The two refusal MESSAGES differ, and should
 *     — they refuse different things — so the pin is on the disposition, not
 *     the prose: exit code, refusal on stdout, generator never loaded, and the
 *     `--json` key set. It fails loudly if either side drifts again.
 *   - ⛔ negative — a real `--eval --generator <module>` still LOADS (marker
 *     present, `Mode: live`), offline `--eval` and a plain project lint are
 *     untouched, and an unresolvable path refuses exactly as it always has. A
 *     "fix" that refused too broadly fails these directly.
 *
 * ⛔ `nothing is minted` pins the ADR-0112 restraint: `errorCodeFields` passes a
 * producer's code through and returns `{}` otherwise, and bundle-require's
 * rejection of an empty path carries neither key — so the payload's key set is
 * exactly `error`. A later edit that invents a code for it goes red here.
 *
 * ⛔ No separate refusal shape is invented for the empty case, and these pins
 * are deliberately not written to require one: once the load is attempted, an
 * empty string is a path that names no module and answers the way an
 * unresolvable path already answered. The sub-message belongs to bundle-require
 * and is NOT pinned; what is pinned is that the command names the flag and the
 * value it was given.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, the SOURCE entry — same CLI, run
 * from `src/` through tsx — so `commands/lint.ts` is loaded from source by the
 * child and this change is measured without a rebuild. (The shipped
 * `bin/run.js` was driven by hand and agreed on every reading above.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

let dir: string;

/** A project this command lints CLEAN, so any non-zero exit is the refusal. */
const CONFIG = `export default {
  name: 'empty_generator_probe',
  objects: [
    {
      name: 'probe_item',
      label: 'Probe Item',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
};
`;

/**
 * The marker path the generator writes at import. Absent ⇒ the module was
 * never evaluated, which is the fact "was the generator loaded?" needs.
 */
const MARKER = 'GENERATOR_WAS_LOADED.marker';

const GENERATOR = `import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./${MARKER}', import.meta.url), 'loaded\\n');
export default function generate() {
  return { name: 'from_generator', objects: [] };
}
`;

function markerPresent(): boolean {
  return existsSync(join(dir, MARKER));
}

function clearMarker(): void {
  rmSync(join(dir, MARKER), { force: true });
}

function runLint(args: string[]): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, 'lint', ...args],
      { cwd: dir, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** stdout as ONE JSON document, or a failure that quotes what was there instead. */
function payloadOf(run: Run, label: string): Record<string, unknown> {
  try {
    return JSON.parse(run.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${label}: stdout was not one JSON document (exit ${run.code}, ${run.stdout.length} stdout bytes)\n` +
        `stdout: ${JSON.stringify(run.stdout)}\nstderr: ${JSON.stringify(run.stderr)}`,
    );
  }
}

/**
 * The elapsed-time token is the only part of an eval report that varies run to
 * run; normalising it is what turned "the two runs look the same" into
 * "the two runs ARE the same" when this was measured.
 */
function normaliseElapsed(stdout: string): string {
  return stdout.replace(/\(\d+(\.\d+)?m?s\)/g, '(ELAPSED)');
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-lint-eval-empty-generator-'));
  writeFileSync(join(dir, 'objectstack.config.mjs'), CONFIG, 'utf8');
  writeFileSync(join(dir, 'gen-marker.mjs'), GENERATOR, 'utf8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('os lint --eval --generator "" is refused, not silently ignored', () => {
  it('refuses on the human face, naming the flag and the empty value it was given', async () => {
    clearMarker();
    const run = await runLint(['--eval', '--generator', '']);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('Failed to load generator ""');
    // ⛔ The sharpest pin: the offline eval did NOT run in place of the refusal.
    // Before the fix this line read `Mode: offline` with `5/5 passed` under it.
    expect(run.stdout).not.toContain('Mode: offline');
    expect(run.stdout).not.toContain('passed');
    expect(markerPresent()).toBe(false);
  }, 120_000);

  it('the --json face stays a machine face — one JSON document, nothing on stderr', async () => {
    clearMarker();
    const run = await runLint(['--json', '--eval', '--generator', '']);
    const payload = payloadOf(run, 'json refusal');

    expect(run.code).toBe(1);
    expect(String(payload.error)).toContain('Failed to load generator ""');
    expect(run.stderr).toBe('');
    expect(markerPresent()).toBe(false);
    // Before the fix this was the ordinary offline eval report: ok/mode/results.
    expect(payload.mode).toBeUndefined();
    expect(payload.results).toBeUndefined();
  }, 120_000);

  it('nothing is minted — the payload key set is exactly `error`', async () => {
    // ADR-0112: `errorCodeFields` passes a producer's code through and returns
    // `{}` otherwise; bundle-require's empty-path rejection carries neither key.
    const run = await runLint(['--json', '--eval', '--generator', '']);
    const payload = payloadOf(run, 'key set');

    expect(Object.keys(payload)).toEqual(['error']);
  }, 120_000);
});

describe('os lint --eval — the empty generator is DISTINGUISHABLE from not passing the flag', () => {
  it('differs from the no-flag run once the elapsed token is normalised', async () => {
    // ⭐ The card's grading pivot, as an assertion. Measured before the fix:
    // these two stdouts were byte-identical after this exact normalisation, and
    // both exited 0 with 0 bytes on stderr — so an operator had no channel on
    // which to see that their generator was never loaded.
    clearMarker();
    const withEmpty = await runLint(['--eval', '--generator', '']);
    const withoutFlag = await runLint(['--eval']);

    expect(normaliseElapsed(withEmpty.stdout)).not.toBe(normaliseElapsed(withoutFlag.stdout));
    expect(withEmpty.code).not.toBe(withoutFlag.code);
    expect(withoutFlag.code).toBe(0);
    expect(withoutFlag.stdout).toContain('Mode: offline');
  }, 120_000);
});

describe('os lint --generator "" — the eval and non-eval sides answer the same way', () => {
  it('both refuse: same exit code, refusal on stdout, generator never loaded', async () => {
    // ⭐ #15550 / PR #16115 settled `!== undefined` for the non-eval side; this
    // card is that ruling reaching the eval side. The two refusals say
    // different things — they refuse different things — so what is pinned is
    // the disposition, which is what the asymmetry was about.
    clearMarker();
    const evalSide = await runLint(['--eval', '--generator', '']);
    const evalSideMarker = markerPresent();
    clearMarker();
    const nonEvalSide = await runLint(['--generator', '']);
    const nonEvalSideMarker = markerPresent();

    expect(evalSide.code).toBe(nonEvalSide.code);
    expect(evalSide.code).toBe(1);
    expect(evalSide.stdout).not.toBe('');
    expect(nonEvalSide.stdout).not.toBe('');
    expect(evalSideMarker).toBe(false);
    expect(nonEvalSideMarker).toBe(false);
  }, 120_000);

  it('both answer the same --json envelope: exit 1 and a lone `error` key', async () => {
    const evalSide = await runLint(['--json', '--eval', '--generator', '']);
    const nonEvalSide = await runLint(['--json', '--generator', '']);

    expect(Object.keys(payloadOf(evalSide, 'json eval side'))).toEqual(['error']);
    expect(Object.keys(payloadOf(nonEvalSide, 'json non-eval side'))).toEqual(['error']);
    expect(evalSide.code).toBe(1);
    expect(nonEvalSide.code).toBe(1);
  }, 120_000);
});

describe('os lint --eval — what the refusal must NOT move', () => {
  it('`--eval` with the flag absent still runs the offline eval', async () => {
    const run = await runLint(['--eval']);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Mode: offline');
  }, 120_000);

  it('`--eval --generator <module>` still loads the generator and runs live', async () => {
    clearMarker();
    const run = await runLint(['--eval', '--generator', './gen-marker.mjs']);

    expect(markerPresent()).toBe(true);
    expect(run.stdout).toContain('Mode: live');
  }, 120_000);

  it('an unresolvable generator path refuses exactly as it always has', async () => {
    clearMarker();
    const run = await runLint(['--eval', '--generator', './does-not-exist.mjs']);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('Failed to load generator "./does-not-exist.mjs"');
    expect(markerPresent()).toBe(false);
  }, 120_000);

  it('a plain project lint is untouched', async () => {
    const run = await runLint([]);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('All checks passed');
  }, 120_000);
});
