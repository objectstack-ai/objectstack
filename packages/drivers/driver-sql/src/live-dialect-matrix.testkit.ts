// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The DRIVER axis of the shared conformance matrices (ADR-0053 D-A3: the matrix
 * is `driver {SQLite, Postgres at minimum}` × …), plus the SERVER-TIMEZONE axis
 * D-B3 added to it — one definition of "which backends does a matrix consumer
 * run on, and what makes that run non-vacuous", so every consumer spells it the
 * same way instead of hard-coding `client: 'better-sqlite3'` (#4245).
 *
 * Why this exists as a helper rather than a literal per suite: a hard-coded
 * client is invisible. `sql-driver-temporal-conformance.test.ts` carried four of
 * them while its own head note claimed it ran "against real Postgres and MySQL
 * too" — declared ≠ enforced, and the ADR's `Postgres at minimum` never
 * executed for the matrix at all. A cell list you have to *opt out of* fails
 * loudly the moment a new sweep forgets a dialect.
 *
 * ## The non-vacuity contract
 *
 * A live cell proves nothing unless the three clocks actually disagree, which is
 * exactly the configuration D-B2 measured the dialect divergence under:
 *
 *   - the SERVER's timezone (CI: PG `Asia/Shanghai`, MySQL `+08:00`),
 *   - the PROCESS's timezone (CI: `TZ=America/New_York`),
 *   - UTC, which is what the canon says every stored instant and every comparand
 *     denotes.
 *
 * {@link assertThreeWayZoneSkew} asserts all three are pairwise different. On a
 * UTC server, or a UTC process, the identical answers a green matrix reports are
 * answers no timezone could have perturbed — a pass that means nothing. The
 * guard turns that into a red with the fix in the message.
 *
 * ## Skips are visible, and can be made fatal
 *
 * Without `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` a live cell is reported
 * as a named SKIP (never a silent pass). A runner that *knows* it provisioned
 * the servers — the `Temporal Conformance (live PG + MySQL)` CI job — sets
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1`, which turns a missing URL into a failure:
 * without it, dropping the `env:` block from that job would silently return the
 * whole matrix to SQLite-only coverage and stay green, which is the same
 * vacuous-pass hole the job's own process-zone assertion closes.
 *
 * Test-only: not exported from `index.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { SqlDriver, SqlDriverConfig } from './sql-driver.js';

/** The dialects `driver-sql` speaks that the matrices are run across. */
export type DialectId = 'sqlite' | 'pg' | 'mysql';

export interface DialectCell {
  id: DialectId;
  /** Human label, used in suite names. */
  label: string;
  /** The env var that provisions this cell — `null` for the embedded SQLite one. */
  env: string | null;
  /** Provisioned connection string, when this cell needs one. */
  url?: string;
  /** Can this cell run right now? (SQLite always can.) */
  available: boolean;
  /** Does the cell talk to a separate server that carries its own timezone? */
  live: boolean;
  /**
   * Can rows in a PRE-canonical storage form still exist on this dialect — i.e.
   * does the driver keep a read-side repair for them?
   *
   * SQLite only, and not by convention: SQLite has no temporal type, so a
   * pre-#3912/#3994 database really does hold INTEGER epoch ms next to
   * zone-naive TEXT in one column, and `needsLegacyDatetimeRepair` /
   * `needsLegacyTimeRepair` gate the repair on `isSqlite`. Postgres and MySQL
   * store a real `timestamptz` / `DATETIME(3)` / `TIME(3)`, so their rows are
   * already one shape and there is nothing on disk to repair — see
   * `backfillCanonicalDatetimes`, which says exactly this and returns early.
   *
   * This flag is what a legacy sweep selects cells by, and consumers must ASSERT
   * the driver agrees with it (see `LegacyStorageDriver.legacyDatetimeRepairApplies`)
   * rather than trusting the constant — otherwise it decays into the same
   * unverified claim the hard-coded client was.
   */
  hasLegacyStorageForm: boolean;
  /** Fresh driver config for this cell. */
  config(): SqlDriverConfig;
}

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const MYSQL_URL = process.env.OS_TEST_MYSQL_URL;

/**
 * `1` when the runner has provisioned the live servers and a missing URL is
 * therefore a defect in the runner, not a developer running without Docker.
 */
export const EXPECT_LIVE_DIALECTS = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';

/**
 * Every cell of the driver axis, available or not — a consumer iterates the
 * whole list so an unprovisioned dialect is *reported*, not omitted.
 */
export const DIALECT_CELLS: readonly DialectCell[] = [
  {
    id: 'sqlite',
    label: 'sqlite',
    env: null,
    available: true,
    live: false,
    hasLegacyStorageForm: true,
    config: () => ({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
  },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    url: PG_URL,
    available: !!PG_URL,
    live: true,
    hasLegacyStorageForm: false,
    config: () => ({ client: 'pg', connection: PG_URL }),
  },
  {
    id: 'mysql',
    label: 'live mysql',
    env: 'OS_TEST_MYSQL_URL',
    url: MYSQL_URL,
    available: !!MYSQL_URL,
    live: true,
    hasLegacyStorageForm: false,
    config: () => ({ client: 'mysql2', connection: MYSQL_URL }),
  },
] as const;

/** The live cells only — the ones the server-timezone axis applies to. */
export const LIVE_DIALECT_CELLS = DIALECT_CELLS.filter((c) => c.live);

/**
 * Declare a cell nobody provisioned: REPORTED, never omitted.
 *
 * A named skip locally (so `it was not run` is readable in the output), a
 * failure under `OS_EXPECT_LIVE_DIALECT_MATRIX=1` — which is what stops the
 * `Temporal Conformance (live PG + MySQL)` job from quietly degrading to
 * SQLite-only coverage if its `env:` block is ever dropped.
 *
 * Lives here rather than in each consumer for the same reason `DIALECT_CELLS`
 * does: a guard copy-pasted per suite is a guard that can weaken in one copy
 * and nowhere else — and "the matrix silently found zero cells and reported
 * OK" is the failure #4646 already paid for once.
 *
 * @param matrix which matrix this cell belongs to, e.g. `temporal conformance`
 *   — it names both the suite and the failure message.
 */
export function declareUnprovisionedCell(cell: DialectCell, matrix: string): void {
  describe(`sql-driver — ${matrix} matrix (${cell.label})`, () => {
    it.skipIf(!EXPECT_LIVE_DIALECTS)(
      `is provisioned — set ${cell.env} to run this cell of the D-A3 driver axis`,
      () => {
        expect.fail(
          `${cell.env} is unset while OS_EXPECT_LIVE_DIALECT_MATRIX=1: this runner declared it ` +
            `provisions live Postgres and MySQL, so the ${cell.label} cell of the ${matrix} ` +
            `matrix must not be skipped (ADR-0053 D-A3 "Postgres at minimum").`,
        );
      },
    );
  });
}

/**
 * Run a cell EITHER WAY — measured when it is provisioned, declared un-run when
 * it is not — with no third outcome available to the caller.
 *
 * ## The hole this closes, which is not the one `declareUnprovisionedCell` closes
 *
 * That guard makes an UNPROVISIONED cell visible. It says nothing about the
 * provisioned case, and a consumer that writes only half the pair —
 *
 * ```ts
 * if (!MYSQL_CELL.available) declareUnprovisionedCell(MYSQL_CELL, '…');
 * //  ^ no else: when the URL IS set, nothing is declared and nothing is run
 * ```
 *
 * — inverts the whole design. Measured on this file's own MySQL cell (#8592):
 * under Test Core (`OS_TEST_MYSQL_URL` absent) it announced itself as un-run,
 * and under `Temporal Conformance (live PG + MySQL)` — the one job with a live
 * MySQL 8.0 attached — it declared nothing and measured nothing. **The
 * declaration disappeared exactly when the capability to measure appeared**, and
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1` could not catch it because a cell that
 * emits no suite at all is not a skip.
 *
 * So the fix is a TOTAL function rather than a louder warning: `measure` is a
 * required parameter, so the one-way form above does not typecheck. A consumer
 * can still hand-roll `if (!cell.available) … else …` (six of them do, inside a
 * `for … continue` loop, and those are two-way already) — what it can no longer
 * do is ask for the un-run declaration WITHOUT saying what running would mean.
 *
 * @param matrix which matrix this cell belongs to — names the suite and the
 *   failure message, exactly as in {@link declareUnprovisionedCell}.
 * @param measure declares the suites for a cell that CAN run right now.
 */
export function declareDialectCell(
  cell: DialectCell,
  matrix: string,
  measure: (cell: DialectCell) => void,
): void {
  if (!cell.available) {
    declareUnprovisionedCell(cell, matrix);
    return;
  }
  measure(cell);
}

/** What a server reports about its own timezone. */
export interface ServerZone {
  /** The dialect's own spelling: `Asia/Shanghai`, `+08:00`, `SYSTEM`, … */
  setting: string;
  /**
   * Minutes east of UTC the server is currently at, or `NaN` when the dialect
   * could not be made to say. `NaN` fails the skew guard on purpose: a zone we
   * cannot compare is a zone we cannot prove is skewed.
   */
  offsetMinutes: number;
}

/** Unwrap a raw result across knex's three dialect shapes. */
function rowsOf(res: any): any[] {
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0]; // mysql2: [rows, fields]
  if (Array.isArray(res)) return res; // better-sqlite3
  return res?.rows ?? []; // pg
}

/**
 * Read the SERVER's timezone through an already-connected driver.
 *
 * Both queries deliberately read the server's own setting rather than anything
 * the driver configured: `driver-sql` pins the mysql2 *session* to UTC (#3942)
 * and Postgres reads back whatever `TimeZone` the server was started with, so
 * asking the session would report the fix instead of the hazard the fix exists
 * for.
 */
export async function readServerZone(cell: DialectCell, driver: SqlDriver): Promise<ServerZone> {
  if (cell.id === 'pg') {
    const rows = rowsOf(
      await driver.execute(
        `select current_setting('TimeZone') as tz, extract(timezone from now())::int as off_seconds`,
      ),
    );
    const row = rows[0] ?? {};
    return { setting: String(row.tz ?? ''), offsetMinutes: eastOfUtc(Number(row.off_seconds) / 60) };
  }
  if (cell.id === 'mysql') {
    // `convert_tz` resolves a numeric `+08:00` zone without the (usually
    // unloaded) mysql tz tables; a NAMED global zone yields NULL there, so fall
    // back to parsing the setting and let the guard fail if neither can answer.
    const rows = rowsOf(
      await driver.execute(
        `select @@global.time_zone as tz,
                timestampdiff(second, utc_timestamp(),
                              convert_tz(utc_timestamp(), '+00:00', @@global.time_zone)) as off_seconds`,
      ),
    );
    const row = rows[0] ?? {};
    const setting = String(row.tz ?? '');
    const seconds = row.off_seconds == null ? Number.NaN : Number(row.off_seconds);
    return {
      setting,
      offsetMinutes: eastOfUtc(
        Number.isFinite(seconds) ? seconds / 60 : parseUtcOffsetMinutes(setting),
      ),
    };
  }
  // SQLite is in-process: there is no server, and therefore no server zone.
  return { setting: '', offsetMinutes: Number.NaN };
}

/**
 * Collapse `-0` onto `+0`.
 *
 * Not cosmetic: `expect(x).not.toBe(0)` is `Object.is`, and `Object.is(-0, 0)`
 * is FALSE — so a UTC zone that arrives as `-0` (which is what negating a
 * zero `getTimezoneOffset()` produces) sails through the "not UTC" guard. This
 * was measured by sabotage: `TZ=UTC` passed the guard until this existed.
 */
const eastOfUtc = (minutes: number): number => (minutes === 0 ? 0 : minutes);

/** `+08:00` / `-05:30` → minutes east of UTC; anything else → `NaN`. */
function parseUtcOffsetMinutes(setting: string): number {
  const m = /^([+-])(\d{1,2}):(\d{2})$/.exec(setting.trim());
  if (!m) return Number.NaN;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return eastOfUtc(m[1] === '-' ? -minutes : minutes);
}

/** The Node process's timezone, as the two facts the guard compares. */
export function processZone(): { name: string; offsetMinutes: number } {
  return {
    name: Intl.DateTimeFormat().resolvedOptions().timeZone || '(unknown)',
    // `getTimezoneOffset` is minutes WEST of UTC; flip it so both sides of the
    // comparison are "minutes east", the sign every server reports. Subtracting
    // rather than negating keeps a UTC process at `+0` — see {@link eastOfUtc}.
    offsetMinutes: eastOfUtc(0 - new Date().getTimezoneOffset()),
  };
}

/**
 * The non-vacuity guard: server ≠ UTC ≠ process, and server ≠ process.
 *
 * Call it from an `it()` so a mis-provisioned run is a named red rather than a
 * green nobody reads. Every failure message carries the command that fixes it,
 * because the usual cause is a local run that simply never set `TZ`.
 */
export function assertThreeWayZoneSkew(cell: DialectCell, server: ServerZone): void {
  const proc = processZone();
  const seen = `server=${cell.id}:${server.setting || '(unreported)'} (${server.offsetMinutes} min), ` +
    `process=${proc.name} (${proc.offsetMinutes} min)`;

  expect(
    Number.isFinite(server.offsetMinutes),
    `could not determine the ${cell.label} server's UTC offset (${seen}) — point it at a server ` +
      `with an explicit non-UTC timezone (PG: timezone=Asia/Shanghai, MySQL: default_time_zone='+08:00')`,
  ).toBe(true);

  expect(
    server.offsetMinutes,
    `the ${cell.label} server runs at UTC (${seen}) — on UTC the D-B2 divergence is invisible and ` +
      `this cell proves nothing; start it with timezone=Asia/Shanghai / default_time_zone='+08:00'`,
  ).not.toBe(0);

  expect(
    proc.offsetMinutes,
    `the process runs at UTC (${seen}) — re-run with a skewed zone, e.g. TZ=America/New_York, ` +
      `so a process-zone leak cannot hide behind an agreeing server`,
  ).not.toBe(0);

  expect(
    server.offsetMinutes,
    `the ${cell.label} server and the process share one UTC offset (${seen}) — the two zones must ` +
      `disagree, or a value folded through the wrong one still lands on the right answer`,
  ).not.toBe(proc.offsetMinutes);
}
