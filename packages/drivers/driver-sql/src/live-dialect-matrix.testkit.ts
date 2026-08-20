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
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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

// ── Per-FILE schema isolation (#9350) ────────────────────────────────────────
//
// Every live cell used to hand back the same connection string, so all ~14
// live-matrix files in this package shared ONE conformance database: one
// `public` schema on Postgres, one `conformance` database on MySQL. Measured on
// a real Postgres 16 before this change, a run of the live-PG files left exactly
// one schema behind — `public`, holding `_objectstack_sequences`, the driver's
// internal auto-number counter table that EVERY file's autonumber path
// lazily creates (`hasTable` → `createTable`, a check-then-act pair) and writes
// rows into. Vitest runs those files in parallel workers, so that shared table
// is created, migrated (`_objectstack_sequences__rebuild`, a drop+rename) and
// written concurrently by files that know nothing about each other.
//
// The isolation is per FILE rather than per suite or per worker because a file
// is the unit vitest parallelises: two suites in one file never run at the same
// time, two files can always be running at once, and a worker is recycled
// across files so its identity outlives the isolation it would provide.
//
// ## The name derives from the FILE, and cannot be given a shared value
//
// {@link currentLiveSchema} reads vitest's own `testPath` — the caller passes
// nothing, so there is no parameter a copy-paste can carry over from the file
// it was copied from, and no constant a consumer can point two files at. That
// is the property `live-dialect-matrix.isolation.test.ts` asserts, and it is
// asserted structurally: distinct file paths map to distinct names, over the
// real list of live files in this package.
//
// ⛔ Note what this is NOT: no test is skipped, quarantined, retried or given a
// larger budget, and no assertion changed. Isolation removes contention; it
// does not accommodate it.

/** Prefix every per-file schema/database carries, so a leftover is identifiable. */
export const LIVE_SCHEMA_PREFIX = 'os_lv_';

/**
 * The per-file schema (Postgres) / database (MySQL — the same concept there)
 * for one test file, named by its repo-relative path.
 *
 * Pure and deterministic, so the isolation test can assert distinctness over the
 * real file list without a server. The shape is
 * `os_lv_<slug>_<12 hex of sha256(path)>`:
 *
 *  - the SLUG is readable, so an operator looking at `\dn` or `show databases`
 *    can tell which file owns a leftover;
 *  - the HASH is what carries uniqueness. The slug is truncated to keep the
 *    whole name inside the SHORTER of the two dialect limits (Postgres
 *    truncates an identifier over 63 bytes SILENTLY, which would turn two long
 *    file names back into one shared schema — the exact failure this removes),
 *    and a truncated slug is not injective. The hash is taken over the FULL
 *    path, so two files that truncate to the same slug still differ.
 *
 * `[a-z0-9_]` only, asserted below rather than assumed: the name is
 * interpolated into DDL, and a name that can only be those characters cannot
 * carry a quote out of a file name.
 */
export function liveSchemaNameFor(testFileKey: string): string {
  const key = testFileKey.replace(/\\/g, '/');
  const slug = basename(key)
    .replace(/\.test\.tsx?$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 34);
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
  const name = `${LIVE_SCHEMA_PREFIX}${slug}_${hash}`;
  if (!/^[a-z][a-z0-9_]*$/.test(name) || name.length > 63) {
    throw new Error(
      `live-dialect isolation: derived an unusable schema name ${JSON.stringify(name)} from ` +
        `${JSON.stringify(testFileKey)} — it must match /^[a-z][a-z0-9_]*$/ and fit Postgres' ` +
        `63-byte identifier limit.`,
    );
  }
  return name;
}

/** Memoised so the walk below runs once per file, not once per connection. */
const REPO_RELATIVE_CACHE = new Map<string, string>();

/**
 * An absolute test path reduced to something stable across machines: the path
 * relative to the workspace root (the nearest ancestor holding
 * `pnpm-workspace.yaml`).
 *
 * The absolute path would work for isolation — it differs per file either way —
 * but it also differs per checkout, so the same file would get a different
 * schema in a worktree than in CI and the isolation test could not pin a name.
 */
function repoRelativeTestPath(absolutePath: string): string {
  const cached = REPO_RELATIVE_CACHE.get(absolutePath);
  if (cached !== undefined) return cached;
  let dir = dirname(absolutePath);
  let relative = basename(absolutePath);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      relative = absolutePath.slice(dir.length + 1);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root: fall back to the basename
    dir = parent;
  }
  REPO_RELATIVE_CACHE.set(absolutePath, relative);
  return relative;
}

/**
 * The schema/database the CURRENT test file owns.
 *
 * Takes no argument on purpose. A parameter is the one thing a consumer could
 * get wrong — two files given the same literal are back to sharing a database,
 * and nothing about the call site would look wrong. `testPath` is vitest's own
 * per-file fact, measured available at module scope as well as inside a test
 * (vitest 4.1), so the derivation cannot be pointed anywhere else.
 *
 * Absent `testPath` is a hard error rather than a fallback: the fallback would
 * be a shared name, which is the defect.
 */
export function currentLiveSchema(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) {
    throw new Error(
      'live-dialect isolation (#9350): vitest reported no testPath, so this live connection ' +
        'cannot be given a per-file schema and would fall back to sharing one database with ' +
        'every other live file — the contention this removed. Build live connections from a ' +
        'test file, through DIALECT_CELLS[].config().',
    );
  }
  return liveSchemaNameFor(repoRelativeTestPath(testPath));
}

/**
 * Postgres: create the file's schema and point the session at it.
 *
 * Both halves run on EVERY pooled connection because a pool opens connections
 * lazily and forever — a second connection created an hour into the run must
 * land in the same schema as the first. `if not exists` makes the repeat free
 * and makes two connections of the same file racing each other a no-op.
 *
 * `searchPath` is ALSO set in the knex config (below) so knex's own schema
 * builder qualifies its DDL; knex applies that before this hook runs, against a
 * schema that may not exist yet — which Postgres permits, since `search_path`
 * entries are resolved per statement, not at `SET` time.
 */
function pgAfterCreate(schema: string) {
  return (conn: any, done: (err: unknown, conn: unknown) => void): void => {
    conn.query(`create schema if not exists "${schema}"`, (err: unknown) => {
      if (err) return done(err, conn);
      conn.query(`set search_path to "${schema}"`, (err2: unknown) => done(err2, conn));
    });
  };
}

/**
 * MySQL: create the file's database and switch the session into it.
 *
 * MySQL has no schema-inside-a-database, so a database IS the unit of
 * isolation — `create database` is the same cheap dictionary write `create
 * schema` is on Postgres, not a template copy.
 *
 * `use` rather than rewriting the connection URL, so the URL a runner
 * provisioned stays the thing we connect to and only the SESSION moves. It also
 * keeps `database()` — which several suites compare `information_schema.columns`
 * against — reporting the isolated database.
 */
function mysqlAfterCreate(schema: string) {
  return (conn: any, done: (err: unknown, conn: unknown) => void): void => {
    conn.query(`create database if not exists \`${schema}\``, (err: unknown) => {
      if (err) return done(err, conn);
      conn.query(`use \`${schema}\``, (err2: unknown) => done(err2, conn));
    });
  };
}

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
    config: () => {
      const schema = currentLiveSchema();
      return {
        client: 'pg',
        connection: PG_URL,
        // knex qualifies its own DDL with this; `pgAfterCreate` creates the
        // schema and re-points the session, so raw SQL in a suite lands there too.
        searchPath: [schema],
        pool: { afterCreate: pgAfterCreate(schema) },
      };
    },
  },
  {
    id: 'mysql',
    label: 'live mysql',
    env: 'OS_TEST_MYSQL_URL',
    url: MYSQL_URL,
    available: !!MYSQL_URL,
    live: true,
    hasLegacyStorageForm: false,
    config: () => {
      const schema = currentLiveSchema();
      return {
        client: 'mysql2',
        connection: MYSQL_URL,
        pool: { afterCreate: mysqlAfterCreate(schema) },
      };
    },
  },
] as const;

/** The live cells only — the ones the server-timezone axis applies to. */
export const LIVE_DIALECT_CELLS = DIALECT_CELLS.filter((c) => c.live);

/**
 * One cell by id — the entry point for a suite that is about ONE dialect and so
 * has no matrix to iterate (`sql-driver-datetime-mysql-storage.test.ts` is only
 * ever about MySQL).
 *
 * It exists so those suites stop reading `process.env.OS_TEST_*_URL` and
 * building `{ client, connection }` by hand. That hand-rolled pair is what put
 * every one of them in the SAME database: the env var is one value for the whole
 * process, and a config built from it carries no per-file isolation. Going
 * through the cell means `config()` — and therefore {@link currentLiveSchema} —
 * is the only way to reach a live server, which is what
 * `live-dialect-matrix.isolation.test.ts` enforces for this package.
 */
export function dialectCell(id: DialectId): DialectCell {
  const cell = DIALECT_CELLS.find((c) => c.id === id);
  if (!cell) throw new Error(`no dialect cell for ${id}`);
  return cell;
}

/** The MySQL cell. `.url` is the provisioned URL (or `undefined`) for `skipIf`. */
export const MYSQL_CELL = dialectCell('mysql');

/** The Postgres cell. `.url` is the provisioned URL (or `undefined`) for `skipIf`. */
export const PG_CELL = dialectCell('pg');

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
