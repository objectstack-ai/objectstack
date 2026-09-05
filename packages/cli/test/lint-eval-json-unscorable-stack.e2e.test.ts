// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os lint --eval --json` had NO machine face for an uncaught throw.
 *
 * ## The measured before-shape
 *
 * `run()` dispatches eval mode and returns ENTIRELY ABOVE the project-lint
 * `try`, so nothing thrown out of `runEval` can reach that mode's catch-all
 * JSON exit; and `lint.ts` hand-rolls `json` as a plain `Flags.boolean` rather
 * than oclif's `enableJsonFlag` (zero occurrences anywhere in
 * `packages/cli/src`), so no framework envelope sits underneath either. Driven
 * on the published entry before the fix:
 *
 *     os lint --eval --json --generator ./poison.mjs
 *     exit 1 · stdout 0 BYTES · stderr "    Error: poison getter"
 *
 * ⇒ a caller that asked for `--json` got oclif's human text on stderr and no
 * document at all to parse.
 *
 * ## What was actually broken, and what was NOT
 *
 * ⛔ Nothing new appears on the `--json` face and nothing was added to it. The
 * eval report exit already emits JSON and already `process.exit(1)`s when
 * `!report.ok`. The defect was that a whole class of failure could never REACH
 * that exit, because `runMetadataEval` — whose docblock says *"Never throws"* —
 * wrapped only `options.generate(...)` in its `try` and left the
 * `scoreMetadata(stack)` call outside it. A generator that THREW became a
 * failed case; one that RETURNED a value nobody could walk escaped. The fix
 * makes the existing exit reachable; it does not widen it.
 *
 * ## ⛔ The trap this file exists to keep shut
 *
 * A guard that swallowed the throw and let the poisoned case be reported as
 * PASSING would be worse than the crash — it turns a loud failure into a quiet
 * wrong answer. So `stdout parses` is never asserted alone here: every positive
 * requires `ok: false`, the case FAILED, the cause NAMED in `generationError`,
 * and a nonzero exit. `a silent swallow would be caught` pins the negative
 * directly, against the specific benign shape a swallow would produce
 * (`scoreMetadata({})` is 100 / A / `valid: true`).
 *
 * That benign shape was not hypothetical on the OTHER failure path: a
 * generator that THREW had the empty stack substituted for it and scored, so
 * `meanScore` read 100 on a run where nothing was generated. Both paths now
 * answer 0 / F / `valid: false`, and `every generation threw ⇒ meanScore 0`
 * pins it on the same published `--json` face.
 *
 * ## Why the negative controls are here
 *
 * The reachable class is narrow, and that narrowness is a MEASUREMENT: every
 * off-shape stack below already produced valid JSON before this change, and
 * must still. They are the guard against a fix that "solved" the crash by
 * routing ordinary bad metadata into the failure channel too — an off-shape
 * stack is a SCORED case with schema errors, never a `generationError`.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, the SOURCE entry — same CLI, run
 * from `src/` through tsx — so `metadata-eval.ts` is loaded from source by the
 * child and an ablation of it is measured without a rebuild. Its dependency
 * `@objectstack/spec`, which owns `normalizeStackInput`, resolves through
 * `exports` to `dist/`, and this change does not touch it.
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

function runEval(generatorPath?: string): Promise<Run> {
  const args = [CLI, 'lint', '--eval', '--json', ...(generatorPath ? ['--generator', generatorPath] : [])];
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      args,
      { cwd: dir, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

interface EvalCaseResult {
  id: string;
  generationError?: string;
  passed: boolean;
  score: { score: number; grade: string; valid: boolean; counts: { schemaErrors: number } };
}

interface EvalReport {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  meanScore: number;
  results: EvalCaseResult[];
}

/** stdout as ONE JSON document, or a failure that quotes what was there instead. */
function payloadOf(run: Run, label: string): EvalReport {
  try {
    return JSON.parse(run.stdout) as EvalReport;
  } catch {
    throw new Error(
      `${label}: stdout was not one JSON document (exit ${run.code}, ${run.stdout.length} stdout bytes)\n` +
        `stdout: ${JSON.stringify(run.stdout)}\nstderr: ${JSON.stringify(run.stderr)}`,
    );
  }
}

/** Poison on a TOP-LEVEL key — throws in `normalizeStackInput`'s `{ ...input }`. */
const TOP_LEVEL_POISON = `export default function () {
  return { name: 'poison', get objects() { throw new Error('poison getter'); } };
}
`;

/** Poison one level DOWN — survives the shallow spread, throws inside the schema parse. */
const NESTED_POISON = `export default function () {
  return {
    name: 'poison_nested',
    objects: [{ name: 'account', label: 'Account', get fields() { throw new Error('nested poison getter'); } }],
  };
}
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-lint-eval-json-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('os lint --eval --json — an unscorable generated stack has a machine face', () => {
  it('a top-level poisoned getter: stdout is JSON, the case FAILED, the cause is named', async () => {
    const run = await runEval(generator('top-level-poison', TOP_LEVEL_POISON));
    const payload = payloadOf(run, 'top-level poison');

    // The failure is LOUD: nonzero exit, ok:false, every case failed.
    expect(run.code).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.failed).toBe(payload.total);
    expect(payload.passed).toBe(0);

    // …and the cause is NAMED, on the per-case channel a throwing generator uses.
    expect(payload.results[0].generationError).toContain('poison getter');
    expect(payload.results[0].passed).toBe(false);

    // Nothing leaked to the human channel on a --json run.
    expect(run.stderr).toBe('');
  }, 120_000);

  it('a poisoned getter BELOW the top level is caught too — the schema parse walks there', async () => {
    // The SITE control. This throw never reaches `normalizeStackInput`: the
    // top-level spread copies `objects` by reference and the getter fires later,
    // inside zod. A guard around the normalizer alone would leave this red.
    const run = await runEval(generator('nested-poison', NESTED_POISON));
    const payload = payloadOf(run, 'nested poison');

    expect(run.code).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.results[0].generationError).toContain('nested poison getter');
    expect(payload.results[0].passed).toBe(false);
  }, 120_000);

  it('⛔ a silent swallow would be caught: the unscorable case is not scored as clean', async () => {
    const run = await runEval(generator('swallow-control', TOP_LEVEL_POISON));
    const payload = payloadOf(run, 'swallow control');
    const first = payload.results[0];

    // A swallow that substituted the empty stack would report 100 / A / valid.
    expect(first.score.score).toBe(0);
    expect(first.score.grade).toBe('F');
    expect(first.score.valid).toBe(false);
    expect(payload.meanScore).toBe(0);
  }, 120_000);
});

describe('os lint --eval --json — the negative controls still answer the same', () => {
  it('offline mode is untouched: exit 0 and every golden case passes', async () => {
    const run = await runEval();
    const payload = payloadOf(run, 'offline baseline');

    expect(run.code).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.failed).toBe(0);
    expect(payload.results.every((r) => r.generationError === undefined)).toBe(true);
  }, 120_000);

  it('a generator that THROWS is still a generation error, not a scoring one', async () => {
    const run = await runEval(
      generator('throws', `export default function () { throw new Error('model unavailable'); }\n`),
    );
    const payload = payloadOf(run, 'throwing generator');

    expect(run.code).toBe(1);
    expect(payload.results[0].generationError).toBe('model unavailable');
  }, 120_000);

  /**
   * ⭐ The machine face of the defect this file's sibling card names, driven
   * here rather than reasoned about. Measured on this entry BEFORE the repair,
   * with a generator that throws for every prompt:
   *
   *     exit 1 · ok: false · passed: 0 · failed: 5 · meanScore: 100
   *     every case: score 100 · grade A · valid true · generationError set
   *
   * ⇒ the published `--json` payload's headline number read PERFECT exactly
   * when the model under test produced nothing. The throwing path substituted
   * an empty stack and scored it, and the empty stack is 100 / A / `valid`.
   *
   * ⛔ `passed` was never part of it and is asserted here unchanged — the
   * report always said `ok: false`, which is what made the 100 survivable
   * enough to sit on `main`.
   */
  it('⭐ every generation threw ⇒ meanScore 0 on the --json face, never 100', async () => {
    const run = await runEval(
      generator('throws-all', `export default function () { throw new Error('model unavailable'); }\n`),
    );
    const payload = payloadOf(run, 'throwing generator — mean');

    expect(run.code).toBe(1);
    expect(payload.meanScore).toBe(0);
    expect(payload.results.every((r) => r.score.score === 0)).toBe(true);
    expect(payload.results.every((r) => r.score.grade === 'F')).toBe(true);
    expect(payload.results.every((r) => r.score.valid === false)).toBe(true);

    // The half that was already correct, pinned so a repair to it goes red.
    expect(payload.ok).toBe(false);
    expect(payload.passed).toBe(0);
    expect(payload.failed).toBe(payload.total);
    expect(payload.results.every((r) => r.passed === false)).toBe(true);
  }, 120_000);

  it.each([
    ['manifest-as-string', `export default () => ({ manifest: 'not-an-object' });\n`],
    ['objects-as-string', `export default () => ({ objects: 'not-an-array' });\n`],
    ['objects-as-number', `export default () => ({ objects: 42 });\n`],
    ['objects-as-null', `export default () => ({ objects: null });\n`],
    ['nested-wrong-types', `export default () => ({ objects: [{ name: 123, label: [], fields: 'nope' }] });\n`],
    ['bare-string', `export default () => 'just a string';\n`],
  ])('off-shape stack %s is a SCORED case with schema errors, never a generationError', async (name, source) => {
    const run = await runEval(generator(name, source));
    const payload = payloadOf(run, name);
    const first = payload.results[0];

    expect(run.code).toBe(1);
    expect(payload.ok).toBe(false);
    // ⭐ The line that keeps the fix honest: ordinary bad metadata must NOT be
    // rerouted into the failure channel — it is scored, and its schema errors
    // are what fail it.
    expect(first.generationError).toBeUndefined();
    expect(first.score.counts.schemaErrors).toBeGreaterThan(0);
  }, 120_000);

  it('a generator that cannot be loaded still takes the generator-load JSON exit', async () => {
    const run = await runEval(join(dir, 'does-not-exist.mjs'));

    expect(run.code).toBe(1);
    const payload = JSON.parse(run.stdout) as { error?: string };
    expect(payload.error).toContain('Failed to load generator');
  }, 120_000);
});
