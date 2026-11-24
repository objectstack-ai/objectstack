// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A declared scalar `Field.boolean` / `Field.toggle` is stored as a boolean on
 * SQLite whatever spelling the caller hands a write door, and a value that
 * spells no boolean is refused instead of stored.
 *
 * The engine writes the boolean its validator judged, but a caller that writes
 * through the driver itself (a plugin, a migration, a `beforeInsert` hook's
 * assignment, which lands after the engine's rewrite) reached `formatInput`
 * with the text `'true'` / `'false'`, and SQLite kept that TEXT beside rows
 * holding the INTEGER `1` / `0`. Every filter, sort and group then ran against
 * the raw cell: `'true' <> 1` holds in SQLite, so a row written as `'true'`
 * satisfied `$ne: true`. Any other text (`'yes'`) was stored as itself and read
 * back as `Boolean('yes')`.
 *
 * The accepted spellings are exactly the ones the boot convergence reads
 * (`SQLITE_BOOLEAN_TEXT_READINGS`): `true` / `false`, the numbers `1` / `0`,
 * and the text `'1'` / `'0'`, `'true'` / `'false'` and `'1.0'` / `'0.0'`. Each
 * is bound as `sqliteBooleanBinding`'s `'1'` / `'0'`, which a column the driver
 * created stores as the INTEGER `1` / `0` and a TEXT-affinity column (a `text`
 * field retyped to `boolean`) as the text `'1'` / `'0'`. Anything else answers
 * `VALIDATION_ERROR` / 400 on every door and writes nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { lowerFilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';

const CREATED = 'bool_spellings_created';
const RETYPED = 'bool_spellings_retyped';

function sqliteDriver(): SqlDriver {
  return new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
}

const asText = (name: string) => ({ name, fields: { label: { type: 'string' }, flag: { type: 'text' }, live: { type: 'text' } } });
const asBoolean = (name: string) => ({ name, fields: { label: { type: 'string' }, flag: { type: 'boolean' }, live: { type: 'toggle' } } });

/** Every spelling a write door accepts, and the boolean it is stored as. */
const ACCEPTED: ReadonlyArray<readonly [unknown, boolean]> = [
  [true, true], [false, false], [1, true], [0, false], ['1', true], ['0', false],
  ['true', true], ['false', false], ['1.0', true], ['0.0', false],
];

/** Values that spell no boolean: refused on every door. */
const REFUSED: ReadonlyArray<unknown> = ['yes', 'TRUE', ' true', '', 2, -1, Number.NaN, ['true'], { value: true }];

type Door = 'create' | 'update' | 'upsert' | 'bulkCreate' | 'bulkUpdate' | 'updateMany';
const DOORS: readonly Door[] = ['create', 'update', 'upsert', 'bulkCreate', 'bulkUpdate', 'updateMany'];

/** Write `value` to both boolean fields of row `id` through `door`; update doors first create the row as `seed`. */
async function writeThrough(driver: SqlDriver, table: string, door: Door, id: string, value: unknown, seed = false): Promise<void> {
  const row = { id, label: door, flag: value, live: value };
  switch (door) {
    case 'create': await driver.create(table, row); return;
    case 'upsert': await driver.upsert(table, row); return;
    case 'bulkCreate': await driver.bulkCreate(table, [row]); return;
    default: break;
  }
  await driver.create(table, { id, label: door, flag: seed, live: seed });
  const patch = { flag: value, live: value };
  if (door === 'update') await driver.update(table, id, patch);
  else if (door === 'bulkUpdate') await driver.bulkUpdate(table, [{ id, data: patch }]);
  else await driver.updateMany(table, { where: { id } } as DriverQuery, patch);
}

async function storedCell(driver: SqlDriver, table: string, id: string): Promise<Array<[unknown, string]> | null> {
  const rows = await (driver as any).knex.raw(`select flag, typeof(flag) as t, live, typeof(live) as lt from ${table} where id = ?`, [id]);
  return rows.length ? [[rows[0].flag, rows[0].t], [rows[0].live, rows[0].lt]] : null;
}

const label = (v: unknown) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : JSON.stringify(v));

for (const [table, form] of [[CREATED, 'INTEGER'], [RETYPED, 'TEXT']] as const) {
  describe(`driver-sql — a boolean / toggle field on a ${form}-form column is stored as a boolean whatever spelling it is written in (sqlite)`, () => {
    let driver: SqlDriver;
    const stored = (b: boolean) => (form === 'INTEGER' ? [b ? 1 : 0, 'integer'] : [b ? '1' : '0', 'text']);

    beforeAll(async () => {
      driver = sqliteDriver();
      if (form === 'TEXT') await driver.initObjects([asText(table)]);
      await driver.initObjects([asBoolean(table)]);
    });

    afterAll(async () => {
      await driver.disconnect();
    });

    it('the fixture: the column forms are the ones named', async () => {
      const cols = await (driver as any).knex.raw(`select name, type from pragma_table_info('${table}') where name in ('flag', 'live') order by name`);
      expect(cols.map((c: any) => c.type)).toEqual(form === 'INTEGER' ? ['boolean', 'boolean'] : ['TEXT', 'TEXT']);
    });

    for (const door of DOORS) {
      it(`${door}: every accepted spelling is stored as its boolean`, async () => {
        const got: Record<string, unknown> = {};
        const want: Record<string, unknown> = {};
        for (const [i, [value, b]] of ACCEPTED.entries()) {
          const id = `${door}_ok_${i}`;
          // An update door seeds the opposite value, so a write that changed nothing is seen.
          await writeThrough(driver, table, door, id, value, !b);
          got[label(value)] = await storedCell(driver, table, id);
          want[label(value)] = [stored(b), stored(b)];
        }
        expect(got).toEqual(want);
      });

      it(`${door}: a value that spells no boolean is refused with VALIDATION_ERROR / 400 and writes nothing`, async () => {
        const verdicts: Record<string, unknown> = {};
        const want: Record<string, unknown> = {};
        for (const [i, value] of REFUSED.entries()) {
          const id = `${door}_no_${i}`;
          const outcome = await writeThrough(driver, table, door, id, value, true).then(
            () => 'written',
            (e: any) => ({ code: e?.code, status: e?.status }),
          );
          const cell = await storedCell(driver, table, id);
          verdicts[label(value)] = { outcome, cell };
          // An insert door leaves no row; an update door leaves the seeded `true` as it was.
          const cellWant = ['create', 'upsert', 'bulkCreate'].includes(door) ? null : [stored(true), stored(true)];
          want[label(value)] = { outcome: { code: 'VALIDATION_ERROR', status: 400 }, cell: cellWant };
        }
        expect(verdicts).toEqual(want);
      });
    }

    it('null still writes NULL, and a write that names neither field leaves them as they were', async () => {
      await driver.create(table, { id: 'nul', label: 'x', flag: null, live: null });
      expect(await storedCell(driver, table, 'nul')).toEqual([[null, 'null'], [null, 'null']]);
      await driver.create(table, { id: 'untouched', label: 'x', flag: 'true', live: 'false' });
      await driver.update(table, 'untouched', { label: 'y' });
      expect(await storedCell(driver, table, 'untouched')).toEqual([stored(true), stored(false)]);
    });

    it('$ne: true / $nin: [true] / $not of = true never select a row written as the text true', async () => {
      await driver.create(table, { id: 'neg_text_true', label: 'neg', flag: 'true', live: 'true' });
      await driver.create(table, { id: 'neg_text_false', label: 'neg', flag: 'false', live: 'false' });
      await driver.create(table, { id: 'neg_bool_true', label: 'neg', flag: true, live: true });
      // The filter as a seam hands it to the driver (the shared lowering).
      const ids = async (where: Record<string, unknown>) => {
        const lowered = lowerFilterCondition({ label: 'neg', ...where }, { isDatetimeColumn: () => false });
        return ((await driver.find(table, { where: lowered } as DriverQuery)) as Array<{ id: string }>).map((r) => r.id).sort();
      };
      for (const field of ['flag', 'live']) {
        expect(await ids({ [field]: { $ne: true } })).toEqual(['neg_text_false']);
        expect(await ids({ [field]: { $nin: [true] } })).toEqual(['neg_text_false']);
        expect(await ids({ $not: { [field]: true } })).toEqual(['neg_text_false']);
        expect(await ids({ [field]: { $ne: false } })).toEqual(['neg_bool_true', 'neg_text_true']);
        expect(await ids({ [field]: true })).toEqual(['neg_bool_true', 'neg_text_true']);
      }
    });
  });
}
