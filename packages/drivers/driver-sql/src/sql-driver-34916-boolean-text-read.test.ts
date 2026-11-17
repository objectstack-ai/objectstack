// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34916] A declared `Field.boolean` column holding the TEXT `'false'` reads
 * as `false`.
 *
 * Before the engine wrote the boolean its arm judged, the readings the arm
 * admits (`'true'` / `'false'`, sent by the console's inline grid) reached a
 * SQLite boolean column as text. `formatOutput` presented every stored value
 * as `Boolean(value)`, so an un-ticked row (`'false'`) read as `true` on every
 * GET. Measured on `origin/main` @ `c81f498b5f`: a `/api/v1/batch` update with
 * `won: 'false'` stored `'false'` (typeof text) and GET answered `won: true`.
 *
 * The row-read door now reads the text `'false'` / `'0'` as `false` and
 * `'true'` / `'1'` as `true`. The integer and NULL cells are the controls: the
 * stored forms the driver writes itself read exactly as before.
 *
 * Out of this door: an equality filter compares the stored text, so
 * `won = false` still misses a row stored as `'false'` until it is re-saved.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';

const TABLE = 'bool_text_read_34916';

/** label · the raw value written past the driver · what find() presents */
const CELLS: ReadonlyArray<readonly [string, unknown, boolean | null]> = [
  ['text_false', 'false', false],
  ['text_zero', '0', false],
  ['text_true', 'true', true],
  ['text_one', '1', true],
  ['int_one', 1, true],
  ['int_zero', 0, false],
  ['null', null, null],
];

describe('[#34916] driver-sql — a boolean column holding text reads as the boolean it spells (sqlite)', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    await driver.initObjects([{ name: TABLE, fields: { label: { type: 'string' }, flag: { type: 'boolean' } } }]);
    const knex = (driver as any).knex;
    for (const [label, raw] of CELLS) {
      await knex(TABLE).insert({ id: label, label, flag: raw });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('the fixture holds the raw forms as written: text stays text, integers stay integers', async () => {
    const knex = (driver as any).knex;
    const rows = await knex.raw(`select label, typeof(flag) as t from ${TABLE} order by label`);
    const types = Object.fromEntries(rows.map((r: any) => [r.label, r.t]));
    expect(types).toEqual({
      int_one: 'integer', int_zero: 'integer', null: 'null',
      text_false: 'text', text_one: 'integer', text_true: 'text', text_zero: 'integer',
    });
  });

  for (const [label, raw, presented] of CELLS) {
    it(`find() presents ${JSON.stringify(raw)} as ${JSON.stringify(presented)}`, async () => {
      const rows = (await driver.find(TABLE, { where: { label } } as DriverQuery)) as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].flag).toBe(presented);
    });
  }

  it('findOne() presents the text false as false — the record a GET answers', async () => {
    const row = (await driver.findOne(TABLE, { where: { id: 'text_false' } } as DriverQuery)) as any;
    expect(row.flag).toBe(false);
  });
});
