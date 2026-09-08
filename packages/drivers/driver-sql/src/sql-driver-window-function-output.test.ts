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
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

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
