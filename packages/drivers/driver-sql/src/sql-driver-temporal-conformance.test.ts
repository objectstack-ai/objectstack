// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the SQL filter compiler (ADR-0053 D-A3).
 *
 * The cases come from `@objectstack/spec/data`, so this backend, the in-memory
 * and document drivers, the analytics preview and `formula`'s write-side
 * `check` evaluator are all held to one standard — see `temporal-conformance.ts`
 * for the four divergences that standard exists to prevent. Adding a case there
 * adds it here.
 *
 * This is the TYPED half of the matrix: the columns are declared through
 * `initObjects`, so the driver knows `at` is a `Field.datetime` and `on` a
 * `Field.date` and coerces comparands accordingly. That the same case yields the
 * same row set here and in the type-blind backends is the whole assertion.
 *
 * Four sweeps, because this driver owns two extra axes (#4081):
 *   1. canonical storage — rows seeded through `create()` in their tagged
 *      writer forms (ISO string vs JS `Date`, the D-E4 mixed-writer axis),
 *      which `formatInput` must converge;
 *   2. the same cases spelled in relative tokens, resolved through
 *      `@objectstack/core`'s `resolveFilterTokens` at the pinned `TEMPORAL_NOW`
 *      — the D-A3 "token → row results" axis;
 *   3. legacy storage — the same rows seeded RAW as pre-#3912 forms (INTEGER
 *      epoch ms / zone-naive TEXT) with the canonical marker cleared, so the
 *      read-repair path answers the same table;
 *   4. the same for `Field.time` (#4191) — the pre-#3994 forms (INTEGER epoch
 *      ms / full-timestamp TEXT), so the repair path that closed #3994 has a
 *      regression lock of its own instead of riding the datetime sweep's.
 *
 * # The DRIVER and SERVER-TIMEZONE axes (#4245)
 *
 * D-A3 declares the matrix over `driver {SQLite, Postgres at minimum}`, and
 * D-B3 added a server-timezone axis after D-B2 measured a dialect-divergent ROW
 * RESULT: a bare `YYYY-MM-DD` comparand meant midnight in the SERVER's timezone,
 * so the identical query over the identical instant put a row on a different
 * calendar day on PG 16 @ `Asia/Shanghai` than it did on SQLite. Every sweep
 * above used to hard-code `client: 'better-sqlite3'`, so neither axis existed
 * here: the file's head note claimed live PG and MySQL coverage that its four
 * drivers could not deliver, and the only thing holding the two dialects to the
 * consensus row sets was three suites asserting their own storage forms.
 *
 * So every sweep now runs once per cell of `DIALECT_CELLS` — SQLite always,
 * live Postgres and MySQL when `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are
 * provisioned — over the SAME `TEMPORAL_CASES` / `TEMPORAL_TIME_CASES`,
 * asserting the SAME `expected` row-id sets cell for cell. A dialect whose
 * comparand or storage path drifts from the consensus now has a named red to
 * fail, which is the signal #3773 / #3994 / #4047 each lacked.
 *
 * The `Temporal Conformance (live PG + MySQL)` CI job provisions both servers
 * on `Asia/Shanghai` / `+08:00`, runs this package under
 * `TZ=America/New_York`, and sets `OS_EXPECT_LIVE_DIALECT_MATRIX=1` so a lost
 * URL is a red rather than a silent return to SQLite-only coverage. Each live
 * cell additionally asserts the three-way zone skew it depends on
 * (`assertThreeWayZoneSkew`): server ≠ UTC, process ≠ UTC, server ≠ process. On
 * a UTC server or a UTC process the identical answers this file reports are
 * answers no timezone could have perturbed.
 *
 * The legacy-storage sweeps (3 and 4) run only where a pre-canonical storage
 * form can physically exist, which is SQLite — Postgres and MySQL keep a real
 * `timestamptz` / `DATETIME(3)` / `TIME(3)`, so their rows are already one shape
 * (`backfillCanonicalDatetimes` says exactly this and returns early). That is
 * asserted per cell against the driver's own `needsLegacy*Repair` rule rather
 * than assumed, so the day a dialect grows a repair path the missing grid says
 * so out loud.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { SqlDriver } from '../src/index.js';
import { LegacyStorageDriver } from './legacy-datetime-storage.testkit.js';
import {
  DIALECT_CELLS,
  assertThreeWayZoneSkew,
  declareUnprovisionedCell,
  readServerZone,
  type DialectCell,
  type ServerZone,
} from './live-dialect-matrix.testkit.js';

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

/**
 * One table per sweep, issue-prefixed: the live cells share a database with
 * every other suite in this package (and with each other's runs), so a name
 * collision would show up as a conformance failure in whichever suite lost the
 * race.
 */
const DATETIME_TABLE = 'os4245_conformance';
const DATETIME_LEGACY_TABLE = 'os4245_conformance_legacy';
const TIME_TABLE = 'os4245_time_conformance';
const TIME_LEGACY_TABLE = 'os4245_time_conformance_legacy';

const datetimeShape = (name: string) => ({
  name,
  fields: {
    at: { type: 'datetime' },
    on: { type: 'date' },
    why: { type: 'string' },
  },
});

const timeShape = (name: string) => ({
  name,
  fields: { at: { type: 'time' }, why: { type: 'string' } },
});

/** Row ids a filter reaches, sorted — the one thing every cell must agree on. */
async function matchedIds(driver: SqlDriver, table: string, where: unknown): Promise<string[]> {
  const rows = await driver.find(table, { where } as any);
  return (rows as any[]).map((r) => r.id).sort();
}

/** Live cells reuse one database, so every sweep starts from a dropped table. */
async function freshTable(driver: SqlDriver, shape: { name: string }): Promise<void> {
  await driver.execute(`drop table if exists ${shape.name}`).catch(() => {});
  await driver.initObjects([shape as any]);
}

async function dropTable(driver: SqlDriver | undefined, table: string): Promise<void> {
  await driver?.execute(`drop table if exists ${table}`).catch(() => {});
}

// ── The driver axis ─────────────────────────────────────────────────────────

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    // Reported, never omitted — a named skip locally, a red under
    // `OS_EXPECT_LIVE_DIALECT_MATRIX=1`. The guard is the testkit's (shared with
    // the pagination and filter-logic matrices, #4714) so it cannot weaken in
    // one consumer's copy alone.
    declareUnprovisionedCell(cell, 'temporal conformance');
    continue;
  }
  if (cell.live) declareServerTimezoneAxis(cell);
  declareDatetimeSweep(cell);
  declareLegacyDatetimeSweep(cell);
  declareTimeSweep(cell);
  declareLegacyTimeSweep(cell);
}

/**
 * The server-timezone axis (D-B3), asserted rather than assumed: three clocks —
 * the server's, the process's, and UTC — must be pairwise different, or every
 * sweep below could pass with the timezone code deleted.
 */
function declareServerTimezoneAxis(cell: DialectCell): void {
  describe(`sql-driver — temporal conformance server-timezone axis (${cell.label})`, () => {
    let zone: ServerZone;

    beforeAll(async () => {
      const probe = new SqlDriver(cell.config());
      try {
        zone = await readServerZone(cell, probe);
      } finally {
        await probe.disconnect?.();
      }
    });

    it('the server, the process and UTC are three different timezones', () => {
      assertThreeWayZoneSkew(cell, zone);
    });
  });
}

// ── Sweep 1 + 2: canonical storage, literal and token spellings ─────────────

function declareDatetimeSweep(cell: DialectCell): void {
  describe(`sql-driver — temporal conformance (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      // The declaration is what makes this the typed half — `at` is an instant,
      // `on` a calendar day, and the driver's coercion follows from that.
      await freshTable(driver, datetimeShape(DATETIME_TABLE));
      for (const r of TEMPORAL_ROWS) {
        await driver.create(
          DATETIME_TABLE,
          {
            id: r.id,
            // The writer-form axis (D-E4): both writer populations must
            // converge to the one canonical storage form on write.
            at: r.writerForm === 'native' ? new Date(r.at) : r.at,
            on: r.on,
            why: r.why,
          },
          { bypassTenantAudit: true },
        );
      }
    });

    afterAll(async () => {
      await dropTable(driver, DATETIME_TABLE);
      await driver?.disconnect?.();
    });

    for (const c of TEMPORAL_CASES) {
      it(c.name, async () => {
        expect(await matchedIds(driver, DATETIME_TABLE, c.filter), c.note).toEqual(
          [...c.expected].sort(),
        );
      });

      if (c.tokenFilter) {
        it(`${c.name} — via relative tokens`, async () => {
          expect(
            await matchedIds(driver, DATETIME_TABLE, resolveTokens(c.tokenFilter)),
            c.note,
          ).toEqual([...c.expected].sort());
        });
      }
    }
  });
}

// ── Sweep 3: un-backfilled legacy storage ───────────────────────────────────

function declareLegacyDatetimeSweep(cell: DialectCell): void {
  describe(`sql-driver — temporal conformance on un-backfilled legacy storage (${cell.label})`, () => {
    let driver: LegacyStorageDriver;

    beforeAll(async () => {
      driver = new LegacyStorageDriver(cell.config());
      await freshTable(driver, datetimeShape(DATETIME_LEGACY_TABLE));
      if (!cell.hasLegacyStorageForm) {
        // Nothing to seed — but the marker still has to go, or the probe below
        // would report "already canonical" and prove nothing about the dialect.
        driver.forgetCanonical(DATETIME_LEGACY_TABLE, 'at');
        return;
      }
      // The two pre-#3912 storage forms, split by the same writer-form tag:
      // `native` writes landed as INTEGER epoch ms (a bound JS Date), `wire`
      // writes as zone-naive TEXT (CURRENT_TIMESTAMP / REST payloads). One
      // column, both forms — the read-repair path must answer the same table
      // the canonical sweep does. (`on` is unaffected: bare-day text has been
      // the date canon since Phase 1.)
      await driver.seedLegacyRows(
        DATETIME_LEGACY_TABLE,
        'at',
        TEMPORAL_ROWS.map((r) => ({
          id: r.id,
          at: r.writerForm === 'native' ? Date.parse(r.at) : r.at.replace('T', ' ').replace('Z', ''),
          on: r.on,
          why: r.why,
        })),
      );
    });

    afterAll(async () => {
      await dropTable(driver, DATETIME_LEGACY_TABLE);
      await driver?.disconnect?.();
    });

    // The cell list says this grid exists on SQLite only; the driver's own rule
    // is what decides. Asserting them equal is what keeps "PG has no legacy
    // storage form" an enforced claim instead of a comment — and turns the day
    // a dialect grows a repair path into a red that names the missing grid.
    it('agrees with the driver about whether a pre-canonical storage form can exist here', () => {
      expect(
        driver.legacyDatetimeRepairApplies(DATETIME_LEGACY_TABLE, 'at'),
        cell.hasLegacyStorageForm
          ? 'this cell claims a legacy datetime storage form but the driver applies no read repair'
          : `${cell.label} grew a legacy datetime repair path — it now needs the legacy sweep too, ` +
            `so flip hasLegacyStorageForm and seed the dialect's raw pre-canonical forms`,
      ).toBe(cell.hasLegacyStorageForm);
    });

    // Literal spellings only: the token axis is orthogonal to storage form and
    // already swept above — a divergence here is a repair-path bug by construction.
    if (cell.hasLegacyStorageForm) {
      for (const c of TEMPORAL_CASES) {
        it(c.name, async () => {
          expect(await matchedIds(driver, DATETIME_LEGACY_TABLE, c.filter), c.note).toEqual(
            [...c.expected].sort(),
          );
        });
      }
    }
  });
}

// ── Sweep 4: Field.time, canonical and legacy ───────────────────────────────

function declareTimeSweep(cell: DialectCell): void {
  describe(`sql-driver — Field.time conformance (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await freshTable(driver, timeShape(TIME_TABLE));
      for (const r of TEMPORAL_TIME_ROWS) {
        await driver.create(
          TIME_TABLE,
          {
            id: r.id,
            // The mixed-writer axis for wall clocks (#3994 measured this exact
            // column): a bound `Date` and a canonical-text write must converge.
            at: r.writerForm === 'native' ? new Date(`1970-01-01T${r.at}Z`) : r.at,
            why: r.why,
          },
          { bypassTenantAudit: true },
        );
      }
    });

    afterAll(async () => {
      await dropTable(driver, TIME_TABLE);
      await driver?.disconnect?.();
    });

    for (const c of TEMPORAL_TIME_CASES) {
      it(c.name, async () => {
        expect(await matchedIds(driver, TIME_TABLE, c.filter), c.note).toEqual(
          [...c.expected].sort(),
        );
      });
    }
  });
}

function declareLegacyTimeSweep(cell: DialectCell): void {
  describe(`sql-driver — Field.time conformance on un-backfilled legacy storage (${cell.label})`, () => {
    let driver: LegacyStorageDriver;

    beforeAll(async () => {
      driver = new LegacyStorageDriver(cell.config());
      await freshTable(driver, timeShape(TIME_LEGACY_TABLE));
      if (!cell.hasLegacyStorageForm) {
        driver.forgetCanonicalTime(TIME_LEGACY_TABLE, 'at');
        return;
      }
      // The two pre-#3994 storage forms, split by the same writer-form tag
      // (the storage-form axis, #4191): `native` writes landed as INTEGER epoch
      // ms of the wall clock on the epoch day — `a_midnight` is the measured
      // hazard, INTEGER 0, which sorts before every TEXT row — and `wire`
      // writes as full-timestamp TEXT still carrying a calendar day (pinned to
      // the fixture's boundary day so every consumer seeds the same bytes).
      // The read-repair path (`sqliteCanonicalTimeSql`) must answer the same
      // table the canonical sweep does.
      await driver.seedLegacyTimeRows(
        TIME_LEGACY_TABLE,
        'at',
        TEMPORAL_TIME_ROWS.map((r) => ({
          id: r.id,
          at: r.writerForm === 'native' ? Date.parse(`1970-01-01T${r.at}Z`) : `2026-07-28T${r.at}Z`,
          why: r.why,
        })),
      );
    });

    afterAll(async () => {
      await dropTable(driver, TIME_LEGACY_TABLE);
      await driver?.disconnect?.();
    });

    it('agrees with the driver about whether a pre-canonical storage form can exist here', () => {
      expect(
        driver.legacyTimeRepairApplies(TIME_LEGACY_TABLE, 'at'),
        cell.hasLegacyStorageForm
          ? 'this cell claims a legacy time storage form but the driver applies no read repair'
          : `${cell.label} grew a legacy time repair path — it now needs the legacy sweep too, ` +
            `so flip hasLegacyStorageForm and seed the dialect's raw pre-canonical forms`,
      ).toBe(cell.hasLegacyStorageForm);
    });

    if (cell.hasLegacyStorageForm) {
      for (const c of TEMPORAL_TIME_CASES) {
        it(c.name, async () => {
          expect(await matchedIds(driver, TIME_LEGACY_TABLE, c.filter), c.note).toEqual(
            [...c.expected].sort(),
          );
        });
      }
    }
  });
}
