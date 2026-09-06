// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os lint --generator` claimed a precondition nothing checked.
 *
 * ## The measured before-shape
 *
 * The flag's description ends "Requires --eval." and `run()` enforced nothing.
 * Driven on this entry before the fix, from a lint-clean project, with a
 * generator that writes a marker file at TOP-LEVEL evaluation so "was it
 * loaded?" is answered by the filesystem instead of by reading control flow:
 *
 *     os lint --generator ./gen-marker.mjs             exit 0 · All checks passed · marker ABSENT
 *     os lint --generator ./does-not-exist.mjs         exit 0 · All checks passed
 *     os lint --json --generator ./does-not-exist.mjs  exit 0 · {"passed":true,…}
 *
 * ⇒ accepted by the parser, never loaded, and not named once on either face —
 * a path that does not exist passed too. The operator got a successful-looking
 * run whose generator was never called, with nothing said. Silent, not loud.
 *
 * ## What is pinned, and why the negatives are not decoration
 *
 * The fix REFUSES rather than amending the description, so the accept set
 * narrows and the pins have to hold both directions:
 *
 *   - positive — the refusal happens, on both faces, with the same envelope
 *     this command already answers with (#16044): the human message on
 *     `error`, exit 1, `--json` stdout still one JSON document.
 *   - ⛔ negative — `--eval --generator` still LOADS the generator (marker
 *     present, live mode). A "fix" that refused too broadly, or that refused
 *     after loading the module, fails these directly. So does one that moved
 *     plain `os lint` or offline `--eval`.
 *
 * ⛔ `nothing is minted` pins the ADR-0112 restraint from this side: the
 * refusal has no producer error to pass a `code` through, so the payload's key
 * set is exactly `error`. A later edit that invents a code for it goes red here
 * rather than handing consumers a vocabulary no ledger declares.
 *
 * ⛔ The refusal is deliberately NOT oclif's `dependsOn: ['eval']`. Measured on
 * this entry: `dependsOn` refuses in the parser with exit 2, a stack trace on
 * stderr, and EMPTY STDOUT under `--json`. `the --json face stays a machine
 * face` and the exit-code assertions fail that implementation.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, the SOURCE entry — same CLI, run
 * from `src/` through tsx — so `commands/lint.ts` is loaded from source by the
 * child and this change is measured without a rebuild.
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
  name: 'refusal_probe',
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

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-lint-generator-requires-eval-'));
  writeFileSync(join(dir, 'objectstack.config.mjs'), CONFIG, 'utf8');
  writeFileSync(join(dir, 'gen-marker.mjs'), GENERATOR, 'utf8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('os lint --generator without --eval is refused', () => {
  it('refuses on the human face, naming the flag it requires', async () => {
    clearMarker();
    const run = await runLint(['--generator', './gen-marker.mjs']);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('--generator');
    expect(run.stdout).toContain('--eval');
    // ⛔ The sharpest pin: the refusal happens INSTEAD of the run, not after
    // loading the module. Before the fix this marker was absent for the
    // opposite reason — nothing read the flag at all — so it is asserted
    // together with the exit code, which was 0 then.
    expect(markerPresent()).toBe(false);
  }, 120_000);

  it('the --json face stays a machine face — one JSON document, nothing on stderr', async () => {
    clearMarker();
    const run = await runLint(['--json', '--generator', './gen-marker.mjs']);
    const payload = payloadOf(run, 'json refusal');

    expect(run.code).toBe(1);
    expect(String(payload.error)).toContain('--eval');
    expect(run.stderr).toBe('');
    expect(markerPresent()).toBe(false);
  }, 120_000);

  it('nothing is minted — the payload key set is exactly `error`', async () => {
    // ADR-0112: this refusal has no producer error to pass a code through, and
    // the ledger is the authority on who may mint one.
    const run = await runLint(['--json', '--generator', './gen-marker.mjs']);
    const payload = payloadOf(run, 'key set');

    expect(Object.keys(payload)).toEqual(['error']);
  }, 120_000);

  it('is judged on the flag being TYPED, not on the path resolving', async () => {
    // Before the fix this exited 0 with "All checks passed" — a generator path
    // that does not exist was accepted as readily as one that does.
    const run = await runLint(['--generator', './does-not-exist.mjs']);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('--eval');
    // The refusal is this command's, not esbuild's: the module is never reached.
    expect(run.stdout).not.toContain('Failed to load generator');
  }, 120_000);
});

describe('os lint — what the refusal must NOT move', () => {
  it('`--eval --generator` still loads the generator and runs live', async () => {
    clearMarker();
    const run = await runLint(['--eval', '--generator', './gen-marker.mjs']);

    expect(markerPresent()).toBe(true);
    expect(run.stdout).toContain('Mode: live');
  }, 120_000);

  it('offline `--eval` with no generator is untouched', async () => {
    const run = await runLint(['--eval']);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Mode: offline');
  }, 120_000);

  it('a plain project lint is untouched', async () => {
    const run = await runLint([]);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('All checks passed');
  }, 120_000);
});
