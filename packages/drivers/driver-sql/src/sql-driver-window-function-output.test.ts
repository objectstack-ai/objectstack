// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Rows leaving `findWithWindowFunctions()` (#16609).
 *
 * It was the last read door that returned `await builder` with NO presentation:
 * no `formatOutput` (which every `find()` / `findOne()` row gets) and no
 * `presentReadValue` (which `aggregate()` / `distinct()` got under #3797 /
 * #3849). So it handed back STORAGE forms where every other door hands back the
 * declared type's presentation — a declared `Field.boolean` answered `1`
 * instead of `true`, a declared `Field.object` answered the stored JSON TEXT
 * instead of the parsed object.
 *
 * The contract asserted here is DOOR-TO-DOOR AGREEMENT: the same row read
 * through `findWithWindowFunctions()` and through `find()` is the same row. It
 * is deliberately written as an agreement rather than as absolute literals for
 * the instant classes, because what `formatOutput` produces for them is itself
 * under change (ADR-0053 D-F1) — and an agreement is stable whichever way that
 * lands, since both doors move together. Booleans and JSON are additionally
 * pinned ABSOLUTELY: they are wrong on SQLite today and that ruling does not
 * touch them.
 *
 * The alias carve-out is pinned here too — see the collision block at the
 * bottom, which is the design question the card left to the implementer.
 *
 * ## Two arms, and why the SQLite one is not the whole file
 *
 * The first `describe` below is the SQLite agreement arm. It cannot measure two
 * halves of this door's contract, and says so rather than letting a green stand
 * in for them:
 *
 *   - the BOOLEAN rule fires under `isSqlite || isMysql` (`sql-driver.ts`
 *     `formatOutput`), so its MySQL half is invisible on SQLite;
 *   - the INSTANT classes are stored canonically on SQLite since #3912, so
 *     removing the read presentation moves nothing for them there — the five
 *     instant agreements CANNOT fail on this dialect. On Postgres and MySQL the
 *     client library hands the driver a `Date`, so the fold is real work.
 *
 * The `measure(cell)` arm at the bottom is those two halves, over `DIALECT_CELLS`
 * — the ADR-0053 D-A3 driver axis, declared through `declareDialectCell` so an
 * unprovisioned cell is a NAMED SKIP and never a silent pass. Locally (no
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL`) the two live cells report as
 * skips and this door's MySQL boolean half and PG/MySQL instant fold are NOT
 * MEASURED; the `Temporal Conformance (live PG + MySQL)` job provisions both and
 * measures them there.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import {
  DIALECT_CELLS,
  assertThreeWayZoneSkew,
  declareDialectCell,
  readServerZone,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

const TABLE = 'window_row';

/** Every declared kind the read presentation has a rule for. */
const FIELDS = {
  id: { type: 'text' },
  ok: { type: 'boolean' },
  meta: { type: 'object' },
  closed_at: { type: 'datetime' },
  closed_on: { type: 'date' },
  starts_at: { type: 'time' },
  amount: { type: 'number' },
  region: { type: 'string' },
} as const;

/** The declared columns, plus the audit stamps the driver adds itself. */
const DECLARED_COLUMNS = [...Object.keys(FIELDS), 'created_at', 'updated_at'];

const ROW_NUMBER = {
  function: 'row_number',
  alias: 'rn',
  orderBy: [{ field: 'id', order: 'asc' as const }],
};

describe('rows leaving findWithWindowFunctions() (#16609)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([{ name: TABLE, fields: FIELDS as any }]);

    for (const [id, ok, meta, amount, region] of [
      ['a', true, { k: 1 }, 10, 'east'],
      ['b', false, { k: 2, nested: ['x'] }, 20, 'west'],
    ] as const) {
      await driver.create(
        TABLE,
        {
          id,
          ok,
          meta,
          amount,
          region,
          closed_at: new Date('2026-01-10T09:00:00.123Z'),
          closed_on: '2026-01-10',
          starts_at: '09:30:00.500',
        },
        { bypassTenantAudit: true },
      );
    }
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  const viaFind = () =>
    driver.find(TABLE, { orderBy: [{ field: 'id', order: 'asc' }] }, { bypassTenantAudit: true });

  const viaWindow = (windowFunctions: any[] = [ROW_NUMBER]) =>
    driver.findWithWindowFunctions(
      TABLE,
      { windowFunctions, orderBy: [{ field: 'id', order: 'asc' }] },
      { bypassTenantAudit: true },
    );

  describe('door-to-door agreement — every declared kind', () => {
    it('answers each declared column exactly as find() answers it', async () => {
      const [found, windowed] = await Promise.all([viaFind(), viaWindow()]);
      expect(windowed).toHaveLength(found.length);
      expect(found.length).toBeGreaterThan(0);

      for (let i = 0; i < found.length; i++) {
        for (const column of DECLARED_COLUMNS) {
          // Same VALUE and same TYPE. `toEqual` alone would let `1` pass for
          // `true` under no coercion, but not `'{"k":1}'` for `{ k: 1 }` — so
          // the type assertion is what catches the boolean half.
          expect(typeof windowed[i][column], `typeof ${column} on row ${i}`).toBe(
            typeof found[i][column],
          );
          expect(windowed[i][column], `${column} on row ${i}`).toEqual(found[i][column]);
        }
      }
    });

    it('carries no declared column the other door does not', async () => {
      const [found, windowed] = await Promise.all([viaFind(), viaWindow()]);
      // The window door's row is the find() row plus the alias, and nothing else.
      expect(Object.keys(windowed[0]).sort()).toEqual([...Object.keys(found[0]), 'rn'].sort());
    });
  });

  describe('the absolute pins — boolean and json', () => {
    // These two are wrong on SQLite today and ADR-0053 D-F1 does not touch
    // them, so they are safe to assert as literals rather than as agreements.
    it('presents a declared Field.boolean as a boolean, not 1/0', async () => {
      const rows = await viaWindow();
      expect(rows.map((r: any) => r.ok)).toEqual([true, false]);
    });

    it('presents a declared Field.object as the parsed object, not JSON text', async () => {
      const rows = await viaWindow();
      expect(rows.map((r: any) => r.meta)).toEqual([{ k: 1 }, { k: 2, nested: ['x'] }]);
    });
  });

  describe('the instant classes — asserted as agreements, never as literals', () => {
    // ⛔ Deliberately NOT pinned to an absolute shape: what `formatOutput`
    // produces for a datetime / date / time is under change (ADR-0053 D-F1).
    // Both doors run the same pass, so they move together and this stays true.
    it.each(['closed_at', 'closed_on', 'starts_at', 'created_at', 'updated_at'])(
      'agrees with find() on %s',
      async (column) => {
        const [found, windowed] = await Promise.all([viaFind(), viaWindow()]);
        expect(windowed.map((r: any) => r[column])).toEqual(found.map((r: any) => r[column]));
        // And it is a presented value, not the raw SQLite storage form: an
        // un-presented `Field.datetime` written as a JS `Date` comes back an
        // INTEGER epoch. This half holds whatever the presented shape becomes.
        expect(windowed.every((r: any) => typeof r[column] !== 'number')).toBe(true);
      },
    );
  });

  describe('the alias columns are carved OUT of the presentation', () => {
    it('leaves the computed alias value alone', async () => {
      const rows = await viaWindow();
      expect(rows.map((r: any) => Number(r.rn))).toEqual([1, 2]);
    });

    // ── THE COLLISION RULING (#16609) ──────────────────────────────────────
    //
    // An alias may be spelled the same as a declared field. SQL decides that
    // one before the driver sees it: `select *` plus `<window> as ok` projects
    // two columns named `ok`, and the row object keeps the LAST — so the
    // COMPUTED value wins the key and the declared column's value is not in the
    // row at all. That was already true before #16609 and is unchanged by it.
    //
    // What #16609 rules is the second half: the winning value stays RAW. It is
    // a computed number, so no declared field's presentation rule may touch it
    // — applying the `Field.boolean` rule here would fold ROW_NUMBER 1 and 2
    // into `true` and `true` and destroy the value the caller asked for.
    //
    // This is the same ruling `aggregate()` already made for a date-BUCKETED
    // column aliased AS its own field name ("leaves a date-BUCKETED column as
    // its label, not an instant", `sql-driver-aggregate-temporal-output.test.ts`):
    // a computed value landing under a declared name is still a computed value.
    it('a colliding alias wins the key AND keeps its raw computed value', async () => {
      const rows = await viaWindow([{ ...ROW_NUMBER, alias: 'ok' }]);

      // The declared `Field.boolean ok` is `true` then `false`. If the alias
      // had lost the key we would read `[true, false]`; if it had won the key
      // but been presented as the declared boolean we would read `[true, true]`
      // — that pair is what makes this assertion able to fail three ways.
      expect(rows.map((r: any) => r.ok)).toEqual([1, 2]);
      expect(rows.every((r: any) => typeof r.ok === 'number')).toBe(true);
    });

    it('a colliding alias does not disturb the other declared columns', async () => {
      const rows = await viaWindow([{ ...ROW_NUMBER, alias: 'ok' }]);
      // `meta` is still presented; only the collided key is carved out.
      expect(rows.map((r: any) => r.meta)).toEqual([{ k: 1 }, { k: 2, nested: ['x'] }]);
    });
  });
});

// ── THE LIVE-DIALECT ARM ─────────────────────────────────────────────────────
//
// The two halves the SQLite arm above cannot measure, on the ADR-0053 D-A3
// driver axis. Everything here is asserted ABSOLUTELY rather than as a
// door-to-door agreement where the absolute shape is the point: an agreement
// between two doors that are both wrong is green, and the MySQL boolean half
// and the PG/MySQL instant fold are exactly the places this door had never been
// measured at all.

const LIVE_TABLE = 'os16609_window_row';

/** The canonical instant text — the ONE shape every read door presents. */
const LIVE_ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The instant classes this door now folds: the audit stamps + a `Field.datetime`. */
const LIVE_INSTANT_COLUMNS = ['closed_at', 'created_at', 'updated_at'] as const;

const LIVE_CLOSED_AT = ['2026-01-10T09:00:00.123Z', '2026-02-14T21:30:45.678Z'] as const;

/** Spelled once, the same assertion `sql-driver-13973-…` makes for the other doors. */
function expectCanonicalInstant(value: unknown, label: string): void {
  expect(value, `${label}: the window door did not return the column`).toBeDefined();
  expect(value, `${label}: null`).not.toBeNull();
  expect(
    value instanceof Date,
    `${label}: findWithWindowFunctions handed out a JS Date (${String(value)}) — ADR-0053 D-F1 ` +
      `rules the canonical text on every dialect, and this door runs the same formatOutput pass`,
  ).toBe(false);
  expect(typeof value, `${label}: type`).toBe('string');
  expect(value, `${label}: shape`).toMatch(LIVE_ISO_Z);
}

function measure(cell: DialectCell): void {
  describe(`#16609 — findWithWindowFunctions presents on every dialect (${cell.label})`, () => {
    let driver: SqlDriver;
    let windowed: any[] = [];
    let found: any[] = [];

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      // A live cell proves nothing unless server, process and UTC disagree —
      // the same guard every other matrix consumer runs.
      if (cell.live) assertThreeWayZoneSkew(cell, await readServerZone(cell, driver));
      await driver.execute(`drop table if exists ${LIVE_TABLE}`).catch(() => {});
      await driver.initObjects([{ name: LIVE_TABLE, fields: FIELDS as any }] as any);
      for (const [i, iso] of LIVE_CLOSED_AT.entries()) {
        await driver.create(
          LIVE_TABLE,
          {
            id: `w${i}`,
            // Row 0 declares `true`, row 1 `false` — a rule that folded every
            // value one way could not pass both.
            ok: i === 0,
            meta: { k: i },
            amount: 10 + i,
            region: i === 0 ? 'east' : 'west',
            // Bound as a JS `Date`, which is the shape whose fold this measures.
            closed_at: new Date(iso),
            closed_on: '2026-01-10',
            starts_at: '09:30:00.500',
          },
          { bypassTenantAudit: true },
        );
      }
      const query = { windowFunctions: [ROW_NUMBER], orderBy: [{ field: 'id', order: 'asc' as const }] };
      windowed = await driver.findWithWindowFunctions(LIVE_TABLE, query as any, { bypassTenantAudit: true });
      found = await driver.find(
        LIVE_TABLE,
        { orderBy: [{ field: 'id', order: 'asc' }] },
        { bypassTenantAudit: true },
      );
    }, 60_000);

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${LIVE_TABLE}`).catch(() => {});
      await driver?.disconnect();
    });

    it('§L0 the fixture is non-vacuous: the window door returned both rows carrying every column under test', () => {
      // Every assertion below reads these keys off these rows; a door that did
      // not select a column would let them all pass having checked nothing.
      expect(windowed).toHaveLength(LIVE_CLOSED_AT.length);
      for (const row of windowed) {
        for (const col of [...LIVE_INSTANT_COLUMNS, 'ok', 'rn'] as const) {
          expect(row[col], `${row.id}.${col} missing from the window row`).toBeDefined();
          expect(row[col], `${row.id}.${col} is null`).not.toBeNull();
        }
      }
    });

    it('§L1 a declared Field.boolean answers a boolean, not 1/0', () => {
      // The MySQL half of the `isSqlite || isMysql` gate in `formatOutput` —
      // `tinyint(1)`, which mysql2 hands back as a JS number. Unmeasurable on
      // the SQLite-only arm above, and the reason this cell exists.
      for (const row of windowed) {
        expect(typeof row.ok, `${row.id}.ok on ${cell.label}`).toBe('boolean');
      }
      expect(windowed.map((r) => r.ok)).toEqual([true, false]);
    });

    it('§L2 the instant classes are canonical ISO-Z text, never a Date', () => {
      // ADR-0053 D-F1 through this door: the audit stamps and every declared
      // `Field.datetime`. On PG/MySQL the client hands the driver a `Date`, so
      // this is the fold doing real work — see §L4.
      for (const row of windowed) {
        for (const col of LIVE_INSTANT_COLUMNS) expectCanonicalInstant(row[col], `${row.id}.${col}`);
      }
      expect(windowed.map((r) => r.closed_at)).toEqual([...LIVE_CLOSED_AT]);
    });

    it('§L3 the window row equals the find() row on every declared column', () => {
      expect(found).toHaveLength(windowed.length);
      for (let i = 0; i < found.length; i++) {
        for (const column of DECLARED_COLUMNS) {
          expect(typeof windowed[i][column], `typeof ${column} on row ${i} (${cell.label})`).toBe(
            typeof found[i][column],
          );
          expect(windowed[i][column], `${column} on row ${i} (${cell.label})`).toEqual(found[i][column]);
        }
      }
    });

    it("§L4 the fold is the driver's, not the client's: raw knex still materialises the dialect's own shape", async () => {
      const raw: any = await (driver as any).knex(LIVE_TABLE).where('id', 'w0').first();
      expect(raw, 'raw read returned nothing').toBeTruthy();
      if (cell.live) {
        // Postgres (`timestamptz`) and MySQL (`DATETIME(3)`) hand a `Date` to
        // the driver — D-F2: the client parser is untouched, the driver folds at
        // its own read boundary. This is what makes §L2 a measurement rather
        // than a restatement of the client's behaviour.
        for (const col of LIVE_INSTANT_COLUMNS) {
          expect(
            raw[col] instanceof Date,
            `${cell.label} raw ${col} is ${typeof raw[col]} (${String(raw[col])}) — the client ` +
              `parser was changed, which the #13973 ruling forbids`,
          ).toBe(true);
        }
        expect((raw.closed_at as Date).toISOString()).toBe(windowed[0].closed_at);
      }
      if (cell.id === 'mysql') {
        // Same for the boolean: `tinyint(1)` off the raw client is a number, so
        // §L1's `boolean` on this cell was produced by `formatOutput`.
        expect(typeof raw.ok, 'mysql raw ok').toBe('number');
      }
    });
  });
}

// A matrix that silently finds zero cells reports OK — every cell is declared
// EITHER WAY, measured when it is provisioned and a NAMED SKIP when it is not
// (a named RED under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`).
for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'window-function row presentation (#16609)', measure);
}
