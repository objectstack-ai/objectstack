// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os lint --eval --json`'s generator-load failure emitted a bare `{error}`.
 *
 * ## The measured before-shape
 *
 * The `catch` around the `--generator` load built its message and then
 * DISCARDED the error object, so the one eval exit that does have a machine
 * face was off-envelope. Driven on this entry before the fix, with a generator
 * whose top-level evaluation throws a fully coded failure:
 *
 *     os lint --eval --json --generator ./toplevel-coded.mjs
 *     exit 1 · {"error":"Failed to load generator \"…\": upstream refused the model"}
 *
 * ⇒ `code` and `httpStatus` were both present on the thrown error and neither
 * reached the payload. A consumer that reads `code` to branch got a real code
 * from the project-lint catch-all and `undefined` from eval mode, on the same
 * command — the case a consumer is most likely to be caught by, because the
 * face is present and looks answerable.
 *
 * ## What is pinned, and what is deliberately NOT
 *
 * The fix spreads `errorCodeFields(error)` — the SAME helper `run()`'s
 * project-lint catch-all spreads. That helper PASSES A CODE THROUGH and mints
 * nothing, so the repaired exit is polymorphic in exactly the way its sibling
 * is, and this file pins BOTH halves:
 *
 *   - positive — an error that CARRIES the keys now surfaces them;
 *   - ⛔ negative — an error that carries neither still gets neither. A "fix"
 *     that minted a placeholder code for every load failure would satisfy the
 *     card's headline and hand consumers a vocabulary no ADR-0112 ledger
 *     declares. `nothing is minted` fails that fix directly.
 *
 * The negatives are not decoration: TWO of the four reachable load-failure
 * classes carry nothing. esbuild's `BuildFailure` (unresolvable path, syntax
 * error) has only `errors`/`warnings`, and the hand-thrown "module must
 * default-export a function" is a plain `Error`. Both must stay bare.
 *
 * ⛔ `conversions` is NOT asserted as present and must not be added by a later
 * edit here: that key on the `--eval` exits is a different card, fenced by
 * #14015 with its own review gate. `the key set is exactly the carriers` pins
 * that fence from this side, so a well-meaning widening goes red here.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, the SOURCE entry — same CLI, run
 * from `src/` through tsx — so `commands/lint.ts` and `utils/format.ts` are
 * both loaded from source by the child and this change is measured without a
 * rebuild.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function generator(name: string, source: string): string {
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, source, 'utf8');
  return file;
}

function runLint(args: string[]): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, 'lint', '--eval', ...args],
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

const runJson = (generatorPath: string) => runLint(['--json', '--generator', generatorPath]);

interface ErrorPayload {
  error?: string;
  code?: unknown;
  httpStatus?: unknown;
}

/** stdout as ONE JSON document, or a failure that quotes what was there instead. */
function payloadOf(run: Run, label: string): ErrorPayload {
  try {
    return JSON.parse(run.stdout) as ErrorPayload;
  } catch {
    throw new Error(
      `${label}: stdout was not one JSON document (exit ${run.code}, ${run.stdout.length} stdout bytes)\n` +
        `stdout: ${JSON.stringify(run.stdout)}\nstderr: ${JSON.stringify(run.stderr)}`,
    );
  }
}

/**
 * A generator whose TOP-LEVEL evaluation throws a fully coded failure — the
 * shape an SDK refusal takes when a live generator module builds its client at
 * import time. The error propagates out of `bundleRequire` with both carriers
 * intact; before the fix both were dropped.
 */
const CODED_THROW = `const e = new Error('upstream refused the model');
e.code = 'FORBIDDEN';
e.httpStatus = 403;
throw e;
`;

/** The errno vocabulary `format.ts` names for `os lint` — a file read at import. */
const ERRNO_THROW = `import { readFileSync } from 'node:fs';
readFileSync('/definitely/not/here.json');
export default function () { return {}; }
`;

/** Loads fine, exports the wrong thing — the hand-thrown plain `Error`. */
const NOT_A_FUNCTION = `export default { nope: true };
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-lint-eval-envelope-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('os lint --eval --json — the generator-load failure carries the ADR-0112 envelope', () => {
  it('a coded failure at import surfaces BOTH carriers on the --json face', async () => {
    const run = await runJson(generator('toplevel-coded', CODED_THROW));
    const payload = payloadOf(run, 'coded throw');

    expect(run.code).toBe(1);
    expect(payload.error).toContain('Failed to load generator');
    expect(payload.error).toContain('upstream refused the model');

    // The two keys the card exists for. Bare `{error}` before the fix.
    expect(payload.code).toBe('FORBIDDEN');
    expect(payload.httpStatus).toBe(403);

    // A --json run leaks nothing to the human channel.
    expect(run.stderr).toBe('');
  }, 120_000);

  it('an errno thrown at import passes through as `code`', async () => {
    const run = await runJson(generator('toplevel-errno', ERRNO_THROW));
    const payload = payloadOf(run, 'errno throw');

    expect(run.code).toBe(1);
    expect(payload.code).toBe('ENOENT');
    // Pass-through, not minting: the errno carries no HTTP status and none is
    // invented for it.
    expect(payload.httpStatus).toBeUndefined();
  }, 120_000);

  it('the key set is exactly the carriers — no `conversions`, no filler', async () => {
    // Pins the #14015 fence from this side, and pins that the spread adds the
    // two carriers and nothing else.
    const run = await runJson(generator('key-set', CODED_THROW));
    const payload = payloadOf(run, 'key set');

    expect(Object.keys(payload).sort()).toEqual(['code', 'error', 'httpStatus']);
  }, 120_000);
});

describe('os lint --eval --json — nothing is minted', () => {
  it('the hand-thrown "must default-export a function" stays exactly `{error}`', async () => {
    // The load SUCCEEDS and the export is wrong, so the error is our own plain
    // `Error`. It carries no code, so it gets none — the same answer the
    // project-lint catch-all gives for its own hand-thrown refusals.
    const run = await runJson(generator('not-a-function', NOT_A_FUNCTION));
    const payload = payloadOf(run, 'not a function');

    expect(run.code).toBe(1);
    expect(payload.error).toContain('module must default-export a function');
    expect(Object.keys(payload)).toEqual(['error']);
  }, 120_000);

  it("esbuild's BuildFailure carries neither key, so the payload stays bare", async () => {
    // An unresolvable path never reaches module evaluation: esbuild throws a
    // `BuildFailure` whose own keys are `errors`/`warnings` only. Asserted so a
    // later edit cannot "improve" this into a minted code.
    const run = await runJson(join(dir, 'does-not-exist.mjs'));
    const payload = payloadOf(run, 'unresolvable path');

    expect(run.code).toBe(1);
    expect(payload.error).toContain('Failed to load generator');
    expect(Object.keys(payload)).toEqual(['error']);
  }, 120_000);
});

describe('os lint --eval — the untouched controls', () => {
  it('the human path is unchanged: still exit 1, still no JSON document', async () => {
    const run = await runLint(['--generator', join(dir, 'does-not-exist.mjs')]);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('Failed to load generator');
    expect(() => JSON.parse(run.stdout)).toThrow();
  }, 120_000);

  it('offline eval is untouched: exit 0 and a report, not an error envelope', async () => {
    const run = await runLint(['--json']);
    const payload = payloadOf(run, 'offline baseline') as unknown as { ok?: boolean };

    expect(run.code).toBe(0);
    expect(payload.ok).toBe(true);
    expect((payload as ErrorPayload).error).toBeUndefined();
  }, 120_000);
});
