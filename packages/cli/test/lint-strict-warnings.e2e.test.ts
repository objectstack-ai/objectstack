// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15935 — `os lint --strict`: a warning-severity finding fails the run.
 *
 * ## The contract, and why it is pinned as a PAIR
 *
 * Only an `error` failed `os lint`. `packages/lint` ships ≈250 authoring rules,
 * 119 of them at `warning`, and a run with any number of warnings and no
 * errors exited 0 — so an app that wanted one of those rules to gate its CI
 * re-implemented it locally at error level. `--strict` promotes `warning` to
 * failing; `suggestion` stays advisory; ⛔ the default is unchanged.
 *
 * Every positive assertion here has a negative twin on the SAME stack, and the
 * twin is the whole contract: "exit 1 under `--strict`" is worthless on its own
 * because a regression that makes the flag a no-op reads exactly like the
 * default — exit 0 — and a regression that promotes warnings by default reads
 * exactly like the flag. Only the pair, on one fixture, tells the two apart.
 *
 * ## ⭐ The fixture must REALLY warn, and the assertion must SAY SO first
 *
 * `--strict` over a stack with zero warnings exits 0 in every implementation,
 * including a broken one — the exit-1 assertion would then pass over an empty
 * set. So the warning count is read off the `--json` face of the run under
 * test and asserted `> 0` (and `errors === 0`, or an error would carry the
 * exit and hide a no-op flag) BEFORE either half of the pair is read. The
 * count is TWO, not one, so `failing === warnings` distinguishes "the number
 * of warnings" from "1 if any".
 *
 * What each fixture establishes:
 *
 *   fixture   | errors | warnings | suggestions | pins
 *   ----------+--------+----------+-------------+------------------------------
 *   warns     |   0    |    2     |      0      | the pair; the console reason
 *   suggests  |   0    |    0     |      2      | suggestions stay advisory
 *   errs      |   1    |    1     |      0      | errors still fail; `failing` sums
 *   clean     |   0    |    0     |      0      | `--strict` on a clean stack is 0
 *
 * Which rule produces each finding is incidental and deliberately NOT pinned —
 * a rule's severity is `packages/lint`'s decision. Should one move, the
 * precondition assertion goes red with a message naming the count, never
 * silently green over an emptier set.
 *
 * ## The `--json` verdict
 *
 * Two keys, unconditionally present: `strict` (was the flag in effect) and
 * `failing` (the count the exit code was read from — `errors`, or
 * `errors + warnings` under `--strict`). `passed` is `failing === 0`, the same
 * statement the exit code makes, so `--strict --json` on a warning-only stack
 * reads `passed: false` beside exit 1 rather than `passed: true` next to a
 * failing exit. The keys are asserted on the serialized BYTES as well as the
 * parsed object: `JSON.stringify` drops an `undefined` value silently.
 *
 * ## Why no `dist/` sits on the measured path
 *
 * These run the CLI through `bin/run-dev.js`, the SOURCE entry point — same
 * CLI, run from `src/` through tsx — so `lint.ts` is loaded from source by the
 * child and an ablation of it is measured without a rebuild.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** The console sentence a strict-only failure must print — count, then flag. */
const STRICT_REASON = /(\d+) warning\(s\) fail this run under --strict/;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
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

interface Verdict {
  passed: boolean;
  total: number;
  errors: number;
  warnings: number;
  suggestions: number;
  strict: boolean;
  failing: number;
}

function payloadOf(run: Run, label: string): Verdict & Record<string, unknown> {
  try {
    return JSON.parse(run.stdout) as Verdict & Record<string, unknown>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

/** The two verdict keys must survive serialization, not just exist on the object. */
function expectVerdictKeys(run: Run, payload: Record<string, unknown>, label: string): void {
  expect(Object.keys(payload), `${label}: the verdict keys must be published`).toEqual(
    expect.arrayContaining(['passed', 'strict', 'failing']),
  );
  expect(run.stdout, `${label}: \`strict\` must survive serialization`).toContain('"strict"');
  expect(run.stdout, `${label}: \`failing\` must survive serialization`).toContain('"failing"');
}

/**
 * One shape, four knobs. `engines` absent is one warning (`protocol/missing-
 * engines-range`); a master_detail without `required` is a second; omitting
 * its `deleteBehavior` / `inlineEdit` is two suggestions; an unknown list-view
 * column is an error. Each fixture below turns the knobs it needs and no other.
 */
function stack(
  ns: string,
  opts: { engines?: boolean; requireMaster?: boolean; adviseMaster?: boolean; unknownColumn?: boolean } = {},
): string {
  const { engines = true, requireMaster = true, adviseMaster = true, unknownColumn = false } = opts;
  const enginesLine = engines ? `engines: { protocol: '>=1' },` : '';
  const masterAdvice = adviseMaster ? `deleteBehavior: 'cascade', inlineEdit: true,` : '';
  const masterRequired = requireMaster ? `required: true,` : '';
  const columns = unknownColumn ? `'title', 'nope_missing'` : `'title'`;
  return `
export default {
  manifest: { id: 'com.example.${ns}', name: '${ns}', version: '1.0.0', type: 'app', namespace: '${ns}', ${enginesLine} },
  objects: [
    {
      name: '${ns}_invoice',
      label: 'Invoice',
      sharingModel: 'private',
      fields: { title: { type: 'text', label: 'Title' } },
      listViews: { all: { label: 'All', columns: [${columns}] } },
    },
    {
      name: '${ns}_line',
      label: 'Line',
      sharingModel: 'private',
      fields: {
        title: { type: 'text', label: 'Title' },
        invoice: { type: 'master_detail', reference: '${ns}_invoice', label: 'Invoice', ${masterRequired} ${masterAdvice} },
      },
    },
  ],
};
`;
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-lint-strict-'));
  const make = (name: string, config: string): void => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), config);
    dirs[name] = dir;
  };

  // Two warnings, nothing else — the pair's fixture.
  make('warns', stack('wrn', { engines: false, requireMaster: false }));
  // Two suggestions, nothing else — the "stays advisory" control.
  make('suggests', stack('sug', { adviseMaster: false }));
  // One error AND one warning — errors keep failing; `failing` sums under the flag.
  make('errs', stack('err', { engines: false, unknownColumn: true }));
  // Nothing at all — `--strict` on a clean stack must not invent a failure.
  make('clean', stack('cln'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#15935 — `os lint --strict` fails the run on warning-severity findings', () => {
  it('⭐ the fixture REALLY warns — ≥1 warning and 0 errors on the run under test', async () => {
    // The precondition every other assertion on `warns` stands on. Without it,
    // "exit 1 under --strict" passes over an empty set, in any implementation.
    const payload = payloadOf(await runCli(['lint', '--json'], dirs.warns), 'warns');
    expect(payload.errors, 'an error would carry the exit and hide a no-op flag').toBe(0);
    expect(payload.warnings, 'the pair is vacuous over zero warnings').toBeGreaterThan(0);
    expect(payload.warnings, 'two, so `failing === warnings` is a count and not a boolean').toBe(2);
  }, 120_000);

  it('without --strict the same stack exits 0 — the default is unchanged', async () => {
    // The negative half of the pair. A regression that promoted warnings by
    // default would pass the strict half below and fail here.
    const run = await runCli(['lint', '--json'], dirs.warns);
    const payload = payloadOf(run, 'warns/default');
    expect(run.code, 'warnings are advisory without the flag').toBe(0);
    expect(payload.passed).toBe(true);
    expectVerdictKeys(run, payload, 'warns/default');
    expect(payload.strict, 'the flag was not in effect, and the payload says so').toBe(false);
    expect(payload.failing, 'nothing decided a failing exit').toBe(0);
  }, 120_000);

  it('⭐ with --strict the same stack exits 1 — passed:false, strict:true, failing === warnings', async () => {
    // The positive half. A regression that made `--strict` a no-op reads
    // exactly like the default — exit 0, `passed: true` — and fails here.
    const run = await runCli(['lint', '--strict', '--json'], dirs.warns);
    const payload = payloadOf(run, 'warns/strict');
    expect(run.code, 'a warning fails the run under --strict, as an error does').toBe(1);
    expect(payload.passed, '`passed` makes the same statement the exit code does').toBe(false);
    expectVerdictKeys(run, payload, 'warns/strict');
    expect(payload.strict).toBe(true);
    expect(payload.failing, 'the count the exit was read from — every warning, not "1 if any"').toBe(payload.warnings);
    expect(payload.errors, 'no error was involved: the flag alone decided the exit').toBe(0);
  }, 120_000);

  it('⭐ the console face says why — the count and the flag, and the count is the measured one', async () => {
    const run = await runCli(['lint', '--strict'], dirs.warns);
    expect(run.code).toBe(1);
    const said = run.stdout.match(STRICT_REASON);
    expect(said, `the exit must state its reason, naming the flag:\n${run.stdout}`).not.toBeNull();
    // The number in the sentence is the number the run found, not a literal.
    const counted = payloadOf(await runCli(['lint', '--strict', '--json'], dirs.warns), 'warns/strict').warnings;
    expect(Number(said![1]), 'the sentence names the run\'s own warning count').toBe(counted);
  }, 180_000);

  it('the console face without the flag exits 0 and claims no strict failure', async () => {
    // The console twin: a reason printed unconditionally would satisfy the
    // test above and fail this one.
    const run = await runCli(['lint'], dirs.warns);
    expect(run.code).toBe(0);
    expect(run.stdout, 'the warnings are still printed').toMatch(/2 warning\(s\)/);
    expect(run.stdout, 'no strict verdict was made, so none may be claimed').not.toMatch(STRICT_REASON);
  }, 120_000);

  it('suggestions stay advisory under --strict', async () => {
    // The severity boundary: the flag promotes `warning` and nothing below it.
    // A regression that promoted "anything but clean" reads exit 1 here.
    const run = await runCli(['lint', '--strict', '--json'], dirs.suggests);
    const payload = payloadOf(run, 'suggests/strict');
    expect(payload.suggestions, 'the control is vacuous over zero suggestions').toBeGreaterThan(0);
    expect(payload.warnings, 'a warning here would be the flag firing for the right reason').toBe(0);
    expect(payload.errors).toBe(0);
    expect(run.code, 'a suggestion never fails the run, flag or no flag').toBe(0);
    expect(payload.passed).toBe(true);
    expect(payload.strict).toBe(true);
    expect(payload.failing).toBe(0);
  }, 120_000);

  it('an error still fails with and without the flag, and --strict counts the warnings on top', async () => {
    const plain = await runCli(['lint', '--json'], dirs.errs);
    const plainPayload = payloadOf(plain, 'errs/default');
    expect(plainPayload.errors, 'the control is vacuous over zero errors').toBeGreaterThan(0);
    expect(plainPayload.warnings, 'and needs a warning to show the sum').toBeGreaterThan(0);
    expect(plain.code, 'an error fails the run, as it always did').toBe(1);
    expect(plainPayload.passed).toBe(false);
    expect(plainPayload.strict).toBe(false);
    expect(plainPayload.failing, 'without the flag only the errors decided the exit').toBe(plainPayload.errors);

    const strict = await runCli(['lint', '--strict', '--json'], dirs.errs);
    const strictPayload = payloadOf(strict, 'errs/strict');
    expect(strict.code).toBe(1);
    expect(strictPayload.passed).toBe(false);
    expect(strictPayload.strict).toBe(true);
    expect(strictPayload.failing, 'under the flag every error and every warning decided it').toBe(
      strictPayload.errors + strictPayload.warnings,
    );
  }, 180_000);

  it('a clean stack exits 0 under --strict, in both faces', async () => {
    // Guards the other degenerate regression: a flag that fails unconditionally.
    const json = await runCli(['lint', '--strict', '--json'], dirs.clean);
    const payload = payloadOf(json, 'clean/strict');
    expect(payload.total, 'the control is vacuous unless the stack is really clean').toBe(0);
    expect(json.code).toBe(0);
    expect(payload.passed).toBe(true);
    expect(payload.strict).toBe(true);
    expect(payload.failing).toBe(0);

    const text = await runCli(['lint', '--strict'], dirs.clean);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('All checks passed');
    expect(text.stdout).not.toMatch(STRICT_REASON);
  }, 180_000);
});
