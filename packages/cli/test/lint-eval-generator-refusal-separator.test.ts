// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16359] `os lint --eval --generator ""` printed TWO spaces after our own
 * separator, on both faces.
 *
 * ## The measured before-shape
 *
 * Re-driven at `923caede80` (this card's branch point) through `od -c`, not by
 * eye — a double space is exactly the kind of detail that survives a copy
 * badly, and the filing seat did not independently re-drive it. `bin/run-dev.js`,
 * `NO_COLOR=1`, both faces:
 *
 *     os lint --eval        --generator ""     exit 1 · stdout  59 B · stderr 0 B
 *       `  ✗ Failed to load generator "":  is not a valid JS file`
 *     os lint --eval --json --generator ""     exit 1 · stdout  67 B · stderr 0 B
 *       `{"error":"Failed to load generator \"\":  is not a valid JS file"}`
 *     os lint --eval        --generator <unresolvable>   ONE space
 *     os lint --eval --json --generator <unresolvable>   ONE space
 *
 * ⇒ the defect is on BOTH faces, and the non-empty path was already correct.
 *
 * ## Why the seam exists
 *
 * `bundle-require` composes its own refusal as `${filepath} is not a valid JS
 * file`. An EMPTY filepath contributes no characters, so that fragment arrives
 * with a LEADING space and lands against the space in our own `": "`
 * separator. Neither side is wrong alone, and the seam was UNREACHABLE before
 * #16341 (card #16161) — the truthiness guard skipped the whole load block, so
 * no message was printed at all. A defect newly made REACHABLE by a correct
 * fix, ⛔ not a regression that fix introduced.
 *
 * ## What is pinned, and the property that outranks the spacing
 *
 * #16161 ruled that the empty string must answer through the door an
 * unresolvable path already answers through; a bespoke message for the empty
 * value would be the second refusal shape that card exists to avoid. So the
 * repair normalises the SEAM (leading spaces on the detail) and never branches
 * on `flags.generator`, and this file pins BOTH halves:
 *
 *   - the empty value's message bytes, EXACTLY — a `toContain` of a fragment a
 *     double space would still satisfy is not a pin;
 *   - ⛔ the same-door property — the empty string and an unresolvable path
 *     reach the same exit code, the same one-key `{error}` envelope and the
 *     same `Failed to load generator "…": …` shape. A repair that special-cased
 *     the empty value could satisfy every spacing assertion here and would fail
 *     `the same door`.
 *
 * The unresolvable path is also the NEGATIVE CONTROL for the repair itself:
 * that is the direction a seam trim most easily breaks, so its message is
 * asserted to still carry exactly one space and its own detail intact.
 *
 * ## Why this file is queue tier and not `*.e2e.test.ts`
 *
 * `*.e2e.test.ts` is the NIGHTLY tier (`scripts/nightly-tiers.mjs`): a pin
 * there never guards a pull request or a merge-queue entry — deliberate and
 * documented, ⛔ not a defect, but not protection for this property either.
 * The nightly cut is by FILENAME and the `unit`/`integration` cut is by
 * BEHAVIOUR (`packages/cli/vitest-tiers.ts`), so this file — which spawns the
 * CLI and carries no `.e2e` name — is collected on every PR and every queue
 * entry, in the `integration` project. A `unit`-tier pin would have to test a
 * pure helper extracted out of `runEval`, which trades the ACTUAL emitted
 * bytes on the actual command for a new exported surface; these assertions are
 * about bytes an operator sees, so they are driven through the CLI.
 *
 * ⛔ The existing `test/lint-eval-generator-load-envelope.e2e.test.ts` pins —
 * including its four `stderr).toBe('')` assertions — are neither weakened,
 * rewritten nor moved by this card; this is a new file beside them.
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
import { mkdtempSync, rmSync } from 'node:fs';
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

/** The human face prints through `printError`, which writes the line to STDOUT. */
function humanLine(run: Run, label: string): string {
  const line = run.stdout.split('\n').find((l) => l.includes('Failed to load generator'));
  if (line === undefined) {
    throw new Error(
      `${label}: no refusal line on stdout (exit ${run.code})\n` +
        `stdout: ${JSON.stringify(run.stdout)}\nstderr: ${JSON.stringify(run.stderr)}`,
    );
  }
  return line;
}

function payloadOf(run: Run, label: string): { error?: string } {
  try {
    return JSON.parse(run.stdout) as { error?: string };
  } catch {
    throw new Error(
      `${label}: stdout was not one JSON document (exit ${run.code}, ${run.stdout.length} bytes)\n` +
        `stdout: ${JSON.stringify(run.stdout)}\nstderr: ${JSON.stringify(run.stderr)}`,
    );
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-lint-eval-separator-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('os lint --eval --generator "" — one space after our separator, on both faces', () => {
  it('the machine face carries the message BYTE-EXACTLY', async () => {
    const run = await runLint(['--json', '--generator', '']);
    const payload = payloadOf(run, 'empty generator — machine face');

    expect(run.code).toBe(1);
    // The whole composed message, not a fragment: two spaces fail this line.
    expect(payload.error).toBe('Failed to load generator "": is not a valid JS file');
  }, 120_000);

  it('the human face carries the same message, byte for byte', async () => {
    const run = await runLint(['--generator', '']);

    expect(run.code).toBe(1);
    // `printError` -> `errorLine` -> `  ✗ ${msg}`, uncoloured under NO_COLOR.
    expect(humanLine(run, 'empty generator — human face')).toBe(
      '  ✗ Failed to load generator "": is not a valid JS file',
    );
  }, 120_000);
});

describe('os lint --eval — the non-empty detail is untouched [negative control]', () => {
  it('an unresolvable path still answers with exactly one space, on the machine face', async () => {
    const missing = join(dir, 'does-not-exist.mjs');
    const run = await runLint(['--json', '--generator', missing]);
    const payload = payloadOf(run, 'unresolvable path — machine face');

    expect(run.code).toBe(1);
    // The seam, exactly: one space, and esbuild's own first line intact behind
    // it. This is the direction a seam trim most easily breaks.
    expect(payload.error).toContain(`"${missing}": Build failed with 1 error:`);
    // ⛔ and the detail is not otherwise re-flowed.
    expect(payload.error).toContain(`error: Could not resolve "${missing}"`);
  }, 120_000);

  it('an unresolvable path still answers with exactly one space, on the human face', async () => {
    const missing = join(dir, 'does-not-exist.mjs');
    const run = await runLint(['--generator', missing]);

    expect(run.code).toBe(1);
    expect(humanLine(run, 'unresolvable path — human face')).toBe(
      `  ✗ Failed to load generator "${missing}": Build failed with 1 error:`,
    );
  }, 120_000);
});

describe('os lint --eval — the empty string and an unresolvable path answer through the SAME door [#16161]', () => {
  it('same exit code, same envelope, same message shape', async () => {
    const empty = await runLint(['--json', '--generator', '']);
    const missing = await runLint(['--json', '--generator', join(dir, 'does-not-exist.mjs')]);

    const emptyPayload = payloadOf(empty, 'same door — empty');
    const missingPayload = payloadOf(missing, 'same door — unresolvable');

    // ⛔ The property #16161 ruled on, and the one a "special-case the empty
    // value" repair would break while still satisfying every spacing
    // assertion above. The empty string is a path that names no module, not a
    // separate error class.
    expect(empty.code).toBe(missing.code);
    expect(empty.code).toBe(1);
    expect(Object.keys(emptyPayload)).toEqual(Object.keys(missingPayload));
    expect(Object.keys(emptyPayload)).toEqual(['error']);

    for (const [label, message] of [
      ['empty', emptyPayload.error],
      ['unresolvable', missingPayload.error],
    ] as const) {
      expect(message, label).toMatch(/^Failed to load generator "[^]*?": \S/);
    }
  }, 120_000);
});
