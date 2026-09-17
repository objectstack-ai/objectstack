// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18200 — say, at the end of the run, which dialects this run did NOT exercise.
 *
 * ## The failure this exists for
 *
 * A local `pnpm --filter @objectstack/driver-sql test` with no servers present
 * ends on a line a round reads as coverage:
 *
 * ```
 *   Test Files  178 passed | 11 skipped (189)
 *        Tests  2627 passed | 168 skipped (2795)
 * ```
 *
 * Every live-Postgres and live-MySQL cell in this package is inside those
 * skipped counts, and `178 passed` is SQLite only. Measured cost, three
 * recorded instances: #17469 round 1 shipped four red CI jobs after a clean
 * local sweep, one of them a live-PG-only fixture nothing local could have run;
 * #17231 declared its live cells skipped locally and then went red on the MySQL
 * cell nobody had run. The run "was healthy and delivered nothing".
 *
 * Worse than the 11 is what the 11 hides: on the same run, **56 further files
 * report as PASSED while carrying a skipped live cell inside them**. A file
 * with a green tick next to it is the least visible skip in the output.
 *
 * ## What this is, and deliberately is not
 *
 * DECLARATION ONLY. It reads the run that already happened and writes a block
 * to stdout. It never fails, never changes an exit code, never skips or
 * un-skips anything, and adds no gate — a suite that refuses to go green on a
 * skipped live cell is a new required gate and is not this file's to introduce
 * (#18200 carries that question).
 *
 * Every hook body is wrapped, so a defect in this reporter cannot redden a run
 * either: a signal that can break the thing it reports on would be removed, and
 * then there would be no signal.
 *
 * ## Why the two states differ, and where the numbers come from
 *
 *   - WHICH dialects ran is read from {@link DIALECT_CELLS} — this package's own
 *     single source of truth for the driver axis — never inferred from test
 *     names. A cell's `env` is the variable that provisions it, so the block can
 *     name the exact knob rather than warning in the abstract.
 *   - HOW MANY tests were skipped is read from the run's own results. Those are
 *     reported as the raw skip counts they are; the block does not claim each
 *     one is a backend skip (two in this package are not). The causal sentence
 *     is attached to the per-dialect lines, which are exact.
 *
 * With a backend provisioned the block says so and the counts fall, so the
 * signal is not the same text in both states.
 *
 * ## The recipe is printed because a recipe nobody looks for is not a signal
 *
 * #18200: 「a recipe nobody knows to look for is not a signal」. The steps below
 * were run in the CI-shaped configuration before being written here —
 * PostgreSQL 16.13 from `/usr/lib/postgresql/16/bin`, `initdb` + `pg_ctl` on a
 * non-default port, server `timezone=Asia/Shanghai` against process
 * `TZ=America/New_York`. Two details that are not cosmetic:
 *
 *   - On Debian/Ubuntu `initdb` and `pg_ctl` are not on `PATH`, and `initdb`
 *     refuses to run as root — run both from `/usr/lib/postgresql/<major>/bin`
 *     as a non-root user (`su postgres -c '…'` in a container).
 *   - The three clocks must disagree: server zone, process `TZ`, and UTC. The
 *     matrix asserts that skew on purpose (`assertThreeWayZoneSkew`), because
 *     identical answers from a UTC server are answers no timezone could have
 *     perturbed — a pass that means nothing.
 *
 * MySQL is deliberately not in the printed recipe: provisioning it means
 * installing a server package into a shared container, which is not something
 * to put in front of a reader as a casual next step. The env var is named, so a
 * reader who has one knows what to set.
 *
 * ## Wiring notes
 *
 *   - Registered in `vitest.config.ts` AFTER `'default'`, so this block lands
 *     under the summary counts it qualifies — the place a round actually looks.
 *   - An explicit `--reporter=` on the command line replaces the configured
 *     list, this reporter included. That is vitest's own semantics; a round that
 *     asks for `--reporter=json` is not reading a terminal summary anyway.
 */

import type { Reporter, TestModule } from 'vitest/node';
import { DIALECT_CELLS, EXPECT_LIVE_DIALECTS } from './live-dialect-matrix.testkit.js';

/** Everything this reporter needs to know about the run, in one pass. */
interface SkipCensus {
  /** Modules vitest collected in this run. */
  files: number;
  /** Tests collected across them. */
  tests: number;
  /** Tests whose result state is `skipped`. */
  skippedTests: number;
  /** Modules where EVERY collected test was skipped — the "N skipped" files. */
  filesFullySkipped: number;
  /** Modules that ran, with at least one skipped test inside — the hidden half. */
  filesPartlySkipped: number;
}

function census(testModules: ReadonlyArray<TestModule>): SkipCensus {
  const c: SkipCensus = {
    files: testModules.length,
    tests: 0,
    skippedTests: 0,
    filesFullySkipped: 0,
    filesPartlySkipped: 0,
  };
  for (const mod of testModules) {
    let total = 0;
    let skipped = 0;
    for (const test of mod.children.allTests()) {
      total += 1;
      if (test.result().state === 'skipped') skipped += 1;
    }
    c.tests += total;
    c.skippedTests += skipped;
    if (skipped === 0) continue;
    if (skipped === total) c.filesFullySkipped += 1;
    else c.filesPartlySkipped += 1;
  }
  return c;
}

const PG_RECIPE = [
  "  PGBIN=/usr/lib/postgresql/16/bin   # Debian/Ubuntu: not on PATH, and initdb refuses root",
  '  $PGBIN/initdb -D /tmp/os-pg -U postgres --auth=trust',
  "  $PGBIN/pg_ctl -D /tmp/os-pg -l /tmp/os-pg/server.log -w start \\",
  "      -o '-p 54988 -c timezone=Asia/Shanghai'",
  '  OS_TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:54988/postgres TZ=America/New_York \\',
  '      pnpm --filter @objectstack/driver-sql test',
  '  $PGBIN/pg_ctl -D /tmp/os-pg -m fast stop && rm -rf /tmp/os-pg    # teardown',
];

function report(testModules: ReadonlyArray<TestModule>): string {
  const live = DIALECT_CELLS.filter((cell) => cell.live);
  const missing = live.filter((cell) => !cell.available);
  const ran = DIALECT_CELLS.filter((cell) => cell.available);
  const c = census(testModules);
  const lines: string[] = [''];

  if (missing.length === 0) {
    lines.push(
      `  driver-sql live-dialect coverage: all ${DIALECT_CELLS.length} dialects were exercised ` +
        `(${ran.map((cell) => cell.label).join(', ')}).`,
    );
    if (c.skippedTests > 0) {
      lines.push(
        `  ${c.skippedTests} test(s) were still skipped, in ` +
          `${c.filesFullySkipped + c.filesPartlySkipped} of ${c.files} files, for reasons other ` +
          `than a missing backend.`,
      );
    }
    lines.push('');
    return lines.join('\n');
  }

  if (EXPECT_LIVE_DIALECTS) {
    // The runner declared it provisioned the servers, so the testkit has already
    // turned each missing cell into a named FAILURE. Repeating the warning here
    // would compete with a red the run is already carrying; name the cause once.
    lines.push(
      `  driver-sql live-dialect coverage: OS_EXPECT_LIVE_DIALECT_MATRIX=1, but ` +
        `${missing.map((cell) => `${cell.label} (${cell.env})`).join(' and ')} ` +
        `${missing.length === 1 ? 'was' : 'were'} not provisioned — this run reported that as a ` +
        `named failure, not as a skip.`,
    );
    lines.push('');
    return lines.join('\n');
  }

  const width = Math.max(...DIALECT_CELLS.map((cell) => cell.label.length));
  lines.push(
    `  !! driver-sql live-dialect coverage: this run exercised ${ran.length} of ` +
      `${DIALECT_CELLS.length} dialects.`,
    '',
  );
  for (const cell of DIALECT_CELLS) {
    const label = cell.label.padEnd(width);
    lines.push(
      cell.available
        ? `       ${label}  RAN`
        : `       ${label}  NOT RUN -- set ${cell.env} to run it`,
    );
  }
  lines.push(
    '',
    `  The counts above this block are NOT coverage of the dialect(s) marked NOT RUN.`,
    `  This run skipped ${c.skippedTests} test(s) across ` +
      `${c.filesFullySkipped + c.filesPartlySkipped} of its ${c.files} files: ` +
      `${c.filesFullySkipped} file(s) vitest reported as skipped, and ${c.filesPartlySkipped}`,
    `  more it reported as PASSED with skipped tests inside them. Every ` +
      `${missing.map((cell) => cell.label).join(' and ')} cell in this package is in that`,
    '  population, and a green above says nothing about any of them.',
    '',
    '  CI runs those cells in `Temporal Conformance (live PG + MySQL)`, which sets',
    '  OS_EXPECT_LIVE_DIALECT_MATRIX=1 -- there an unprovisioned cell is a named failure',
    '  rather than a skip. To run the postgres half here (measured: ~1 min to provision):',
    '',
    ...PG_RECIPE,
    '',
    '  The server zone, TZ and UTC must all differ: the matrix asserts that skew, because',
    '  identical answers from a UTC server are answers no timezone could have perturbed.',
    '',
  );
  return lines.join('\n');
}

/**
 * Prints the block described above after the summary. Reads the run; writes
 * stdout; returns nothing.
 */
export default class LiveDialectCoverageReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    try {
      process.stdout.write(`${report(testModules)}\n`);
    } catch {
      // Declaration-only means declaration-only: a reporter that can fail a run
      // is a reporter someone deletes, and then the blind spot is back.
    }
  }
}
