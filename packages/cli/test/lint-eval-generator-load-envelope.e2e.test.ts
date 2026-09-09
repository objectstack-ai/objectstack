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
 * ## [#16358] The second property this file pins: the human channel stays EMPTY
 *
 * `a coded failure at import surfaces BOTH carriers` below ends with
 * `expect(run.stderr).toBe('')` under the comment *"A --json run leaks nothing
 * to the human channel"*. That comment states a property of the `--json` face
 * AS A WHOLE, and it was honest about the one door it drove — a module that
 * EXISTS AND THROWS AT IMPORT, where esbuild bundles cleanly and prints
 * nothing. The other doors into the same `catch` were uncovered, and they
 * leaked: esbuild's own logger writes straight to stderr from inside
 * `bundleRequire`, BEFORE anything throws, so the `catch` that builds the
 * one-key `{error}` document never gets a chance to suppress it.
 *
 * Re-driven at `7f96e1417e` before the repair, `bin/run-dev.js`, `NO_COLOR=1`:
 *
 *     os lint --eval --json --generator /tmp/os16358/nope.mjs
 *       exit 1 · stdout 143 B (well-formed `{error}`) · stderr  55 B
 *       `✘ [ERROR] Could not resolve "/tmp/os16358/nope.mjs"`
 *     os lint --eval --json --generator /tmp/os16358/warn.mjs   (LOADS FINE)
 *       exit 0 · stdout 3158 B (the live eval report) · stderr 340 B
 *       `▲ [WARNING] The "typeof" operator will never evaluate to "null"`
 *
 * ⇒ same command, same face, three answers — with a green pin asserting the
 * one that held. The repair passes `esbuildOptions: { logLevel: 'silent' }`
 * to that ONE `bundleRequire` call and ONLY when `--json` is set; the two
 * cases below drive the two uncovered doors, and each carries its own
 * negative control so a fix that silenced the REFUSAL along with the logger
 * goes red here rather than reading green:
 *
 *   - unresolvable path — stderr empty AND the exit is still 1 with the
 *     well-formed one-key `{error}` naming the unresolved path;
 *   - warning-only — stderr empty on the `--json` face AND the SAME fixture
 *     still shows the warning on the HUMAN face. That second leg is what
 *     keeps the first from going vacuous: if a future esbuild stopped
 *     emitting `impossible-typeof`, an `stderr === ''` assertion alone would
 *     stay green while measuring nothing, and the human-face leg reddens
 *     instead of hiding it. It also pins the scope of the silence — ⛔ the
 *     repair must not reach the face that asked for human output.
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

/**
 * [#16358] Bundles and LOADS successfully, and makes esbuild emit a warning
 * while doing it (`impossible-typeof`). Nothing throws here, so no `catch`
 * ever sees this diagnostic and nothing carries it onto stdout — before the
 * repair it reached stderr on both faces, including the machine one.
 *
 * The generated stack is deliberately trivial: this fixture measures the
 * CHANNEL, not the rubric. `mode: 'live'` in the payload is what proves the
 * module was actually loaded and called.
 */
const WARNS_BUT_LOADS = `const probe = 1;
if (typeof probe === 'null') { throw new Error('unreachable'); }
export default function () { return { objects: [] }; }
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

describe('os lint --eval --json — the human channel stays empty on EVERY door [#16358]', () => {
  it('the unresolvable path leaks nothing to stderr — and still refuses on stdout', async () => {
    // The door the sibling pin above does NOT drive. esbuild never reaches
    // module evaluation: it throws a `BuildFailure`, and its logger had
    // already written `✘ [ERROR] Could not resolve "…"` to stderr from inside
    // `bundleRequire` — 55 bytes measured at 7f96e1417e for this path length
    // (the emission is `✘ [ERROR] Could not resolve "<path>"`, so the byte
    // count tracks the path; the card's 54 was a 20-character path).
    const run = await runJson(join(dir, 'does-not-exist.mjs'));

    // The property the card exists for, in the same shape the existing pin
    // uses one describe up.
    expect(run.stderr).toBe('');

    // ⛔ NEGATIVE CONTROL, on the SAME run: silencing esbuild's logger must
    // not also silence the refusal. A repair that swallowed the throw would
    // satisfy the line above and fail every line below.
    const payload = payloadOf(run, 'unresolvable path — stderr pin');
    expect(run.code).toBe(1);
    expect(Object.keys(payload)).toEqual(['error']);
    expect(payload.error).toContain('Failed to load generator');
    expect(payload.error).toContain('Could not resolve');
  }, 120_000);

  it('a generator that only WARNS leaks nothing either — and the human face still shows it', async () => {
    const file = generator('warns-but-loads', WARNS_BUT_LOADS);

    // The third door: nothing throws at all, so the `catch` is never entered
    // and there is no error path to blame. 340 bytes of esbuild warning
    // reached stderr here before the repair, on a run that exits 0.
    const machine = await runJson(file);
    expect(machine.stderr).toBe('');

    const payload = payloadOf(machine, 'warning generator — machine face') as unknown as {
      mode?: string;
      error?: unknown;
    };
    // The module really was loaded and called — otherwise `stderr === ''`
    // above would be measuring a run that never bundled anything.
    expect(payload.mode).toBe('live');
    expect(payload.error).toBeUndefined();

    // ⛔ SCOPE CONTROL: the silence is the machine face's, not the command's.
    // The same fixture on the HUMAN face must still show esbuild's warning —
    // which also keeps the assertion above from going vacuous if a future
    // esbuild stops emitting this diagnostic.
    const human = await runLint(['--generator', file]);
    expect(human.stderr).toContain('[WARNING]');
    expect(human.stderr).toContain('typeof');
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
