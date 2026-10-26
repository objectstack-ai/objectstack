// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--hookTimeout` must never return a GREEN from this package again (#18788).
 *
 * ## What was measured, and why the green was the defect
 *
 * `packages/cli` declares vitest `test.projects`. vitest 4.1.11's
 * `resolveProjects` carries a CLOSED twenty-name allowlist of CLI options into a
 * project's test config and applies everything else to the ROOT config only.
 * `testTimeout` is on that list; `hookTimeout` and `teardownTimeout` are not. So
 * a probe `beforeAll` sleeping 500ms passed under `--hookTimeout=1` here — exit
 * 0, `1 passed`, `tests 505ms` — with and without `--project`, while the same
 * probe body under `@objectstack/plugin-dev`, which declares no `projects`,
 * exited 1 with `Hook timed out in 1ms.`
 *
 * ⭐ That flag is the instrument this repo's own prior art reaches for to
 * witness that a cold load has left every clocked window: the header of
 * `packages/plugins/plugin-dev/src/dev-plugin-security-enforcement-warning.test.ts`
 * reads a green under `--hookTimeout=1` AS THE PASS. In this package that green
 * could not fail, and a reading that cannot fail is indistinguishable from one
 * that passed. `packages/cli/src/commands/datasource/envelope-unwrap.test.ts`
 * already records the same measurement and had to fall back to a source
 * assertion because of it.
 *
 * `vitest.config.ts` now REFUSES such a run at config load, through the shared
 * `runProjectCliOverridePreflight` in `packages/qa/vitest-filter-preflight`
 * (whose header carries the mechanism, the full measured table and why the value
 * is NOT forwarded into the projects instead).
 *
 * ## ⛔ Why this pin spawns, and what each leg controls for
 *
 * A source assertion that the config still contains the call would pass against
 * a preflight that refuses nothing. The subject here is a BEHAVIOUR of this
 * package's own config load, so it is asked of a real `vitest` child — the same
 * instrument, and the same `execFileSync` + `childEnv()` shape, that
 * `vitest-tiers-partition.test.ts` already uses to ask vitest for its file lists.
 *
 * ⭐ Every leg below owes a control that can go the other way, because that is
 * the exact error this card is about:
 *
 *   - `--hookTimeout` and `--teardownTimeout` must REFUSE — if the wiring is
 *     deleted or the preflight stops refusing, these two go green and fail here;
 *   - a run naming NO override must PASS — so the refusal is not unconditional,
 *     which a pin asserting only the red half could never tell apart;
 *   - `--testTimeout` must PASS — it is on vitest's allowlist and does reach the
 *     projects (measured in this package: 500ms in a test BODY exits 1 with
 *     `Test timed out in 1ms.`). This is what proves the detector discriminates
 *     by ALLOWLIST MEMBERSHIP rather than by "a flag whose name ends in
 *     Timeout", and a detector that refused it would be breaking a working
 *     instrument.
 *
 * Runs in the `unit` tier and needs no built `dist/`: `vitest list --filesOnly`
 * only globs, and the two refusing legs abort at config load before that.
 * Importing `node:child_process` to ask vitest a question is not spawning the
 * CLI — the same classification `vitest-tiers-partition.test.ts` carries.
 *
 * ## ⚠️ The DECLARED overlap with the population sweep
 *
 * `packages/qa/vitest-filter-preflight/test/config-wiring-sweep.test.ts` asks
 * two of these four questions of EVERY package that declares `projects`, this
 * one included: that `--hookTimeout` is really refused, and that a run naming no
 * override really is not. That sweep owns the POPULATION — it derives it, so a
 * ninth package is caught on the PR that adds it — and it is where those two
 * legs are maintained.
 *
 * ⭐ What is NOT duplicated, and why this file is the one that owns it: the
 * DISCRIMINATOR. `--testTimeout` is on vitest's allowlist and does reach the
 * projects here — measured in this package, 500ms in a test body exits 1 with
 * `Test timed out in 1ms.` — so a detector that refused it would be breaking a
 * working instrument, and `--teardownTimeout` is the second knob the same
 * allowlist drops. Both readings are about THIS package's measured table, which
 * is the card's subject, so they are asked here rather than eight times.
 * ⛔ The two overlapping legs are kept rather than deleted because this file
 * must stand on its own as `packages/cli`'s record of the defect: a reader who
 * finds a refusal here needs the control that says it is not unconditional, in
 * the same file, or the record is exactly the kind of one-sided reading this
 * card is about.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { childEnv } from './helpers/serve-process.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const require = createRequire(import.meta.url);
const VITEST_ENTRY = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

/** The refusal's own headline, as `renderInertOverrideNotice` prints it. */
const REFUSAL = 'TIMEOUT OVERRIDE CANNOT REACH THIS PACKAGE';

/**
 * The time budget of every case here: one `vitest list` child of this package
 * (#24927).
 *
 * Each case blocks on exactly one child (`runVitestList`, a synchronous
 * `execFileSync`), so a case's wall time is that child's wall time, and
 * vitest's 5000 ms default is a number nobody chose for that work. A control
 * child passes the config load and then resolves both projects and globs the
 * whole package; a refusing child stops at the config load. So the control
 * child is the larger one, and its reading sizes the budget for all four.
 *
 * Readings in ms, slowest case of each kind (refusal / control):
 *
 *   - CI, merge group run 39444329582, job `Test Core (2/6)`, a contended
 *     shard: 3355 / 7897. Both controls failed, `Test timed out in 5000ms.`
 *   - Local, idle, 6 runs of this file alone: 1244 / 2350.
 *   - Local, 12 runs beside this package's own Test Core slice
 *     (`OS_TEST_SHARD` 1/3, `OS_TEST_TIERS=queue`, `VITEST_MAX_WORKERS=3`),
 *     with this file pinned to one CPU that it shares with 2 busy loops:
 *     5134 / 8685. In the 6 runs at the default, both controls failed every
 *     time. This load reproduces the CI reading: the file read 21.2 to 24.4 s
 *     here and 21.2 s in CI.
 *
 * The rule follows plugin-sharing's scrypt budgets
 * (`share-link-password-webcontainer.test.ts`): take 3x the slowest reading
 * and round up to the next second. 3 x 8685 = 26055, so the budget is 27000.
 * The refusals are budgeted too: the same load took one of them to 5134 ms,
 * past the default.
 *
 * The case body blocks the event loop, so vitest cannot interrupt it. vitest
 * judges the budget after the child returns: its elapsed-time check fails a
 * synchronous case that ran past its timeout. `execFileSync` here is given no
 * `timeout`, so no child limit fires before this one. If a case's child count
 * or the package's test population changes, re-measure and re-size. Do not
 * make a control cheaper by narrowing what it lists (a `--project`, a file
 * filter): it asks about a run of the whole package.
 */
const VITEST_LIST_BUDGET_MS = 27_000;

interface ChildRun {
  readonly status: number;
  readonly output: string;
}

/**
 * `vitest list --filesOnly [flags]` against THIS package, never throwing.
 *
 * ⛔ `execFileSync` throws on a non-zero exit, and the non-zero exit is half of
 * what this file measures — so the status is read off the thrown error rather
 * than allowed to abort the case. `stdout` and `stderr` are joined because the
 * refusal is written to stderr at config load while vitest's own report of it
 * lands separately, and this file asserts on the text, not on the stream.
 */
function runVitestList(...flags: string[]): ChildRun {
  const args = [VITEST_ENTRY, 'list', '--filesOnly', ...flags];
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: PKG,
      env: childEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string; stderr?: string };
    // ⛔ A child that never ran (spawn failure) has a null status. Reporting
    // that as a refusal would be this card's own defect in a new place.
    expect(typeof e.status).toBe('number');
    return { status: e.status ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** How much of a child's output a failed status assertion carries. */
const REPORTED_OUTPUT_CHARS = 2_000;

/**
 * The message every status assertion here carries: the child's exit status and
 * the head of what it printed (#26047).
 *
 * Each case asserts a child's exit code, so any death of the child reads as
 * `expected 1 to be +0` and nothing else. Three merge-queue builds failed the
 * no-override control with exactly that line and no way to tell a refusal, a
 * config-load crash and a timeout apart. The head is kept because a config-load
 * failure prints its cause first (`failed to load config from …` and the
 * thrown error), and the length is bounded so a listing of the whole package
 * cannot flood the report.
 */
function describeRun(run: ChildRun): string {
  const head = run.output.slice(0, REPORTED_OUTPUT_CHARS);
  const cut = run.output.length > head.length ? `\n… (${run.output.length - head.length} more chars)` : '';
  return `vitest list exited ${run.status}; its output began:\n${head}${cut}`;
}

describe('#18788 a CLI timeout override that cannot reach a project is refused, not passed', () => {
  it('refuses `--hookTimeout`, naming the package and a spelling that does bite', () => {
    const run = runVitestList('--hookTimeout=1');

    expect(run.status, describeRun(run)).not.toBe(0);
    expect(run.output).toContain(REFUSAL);
    expect(run.output).toContain('--hookTimeout');
    // The #17978 finding against the sibling preflight, held here too: a shared
    // notice must name the package it is refusing FOR, or it sends the reader to
    // a command that runs the wrong suite.
    expect(run.output).toContain('@objectstack/cli');
    // ⛔ Refusing without a remedy is a bare 404 (AGENTS.md, Route & surface
    // ownership §3). Both spellings named here are measured in this package.
    expect(run.output).toContain('extends: true');
    expect(run.output).toContain('beforeAll(fn, 1)');
  }, VITEST_LIST_BUDGET_MS);

  it('refuses `--teardownTimeout` — the other knob the same allowlist drops', () => {
    const run = runVitestList('--teardownTimeout=1');

    expect(run.status, describeRun(run)).not.toBe(0);
    expect(run.output).toContain(REFUSAL);
    expect(run.output).toContain('--teardownTimeout');
  }, VITEST_LIST_BUDGET_MS);

  it('⭐ CONTROL — a run naming no override passes and says nothing', () => {
    // Without this leg the three above are satisfied by a config that refuses
    // everything, which would be a worse defect than the one being fixed.
    const run = runVitestList();

    expect(run.status, describeRun(run)).toBe(0);
    expect(run.output).not.toContain(REFUSAL);
    // It really listed something, so the zero is a reading and not an empty run.
    expect(run.output).toMatch(/\.test\.ts/);
  }, VITEST_LIST_BUDGET_MS);

  it('⭐ CONTROL — `--testTimeout` is on vitest’s allowlist, reaches the projects, and is NOT refused', () => {
    // The discriminator. `--testTimeout=1` bounds test bodies here for real
    // (measured: 500ms in a test body exits 1 with `Test timed out in 1ms.`),
    // so refusing it would break a working instrument. `list` collects without
    // running, so the budget is never applied and this stays a config-load
    // question.
    const run = runVitestList('--testTimeout=1');

    expect(run.status, describeRun(run)).toBe(0);
    expect(run.output).not.toContain(REFUSAL);
  }, VITEST_LIST_BUDGET_MS);
});
