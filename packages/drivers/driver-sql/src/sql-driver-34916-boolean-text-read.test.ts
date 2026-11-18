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
 * `won = false` misses a row stored as `'false'`. [#34973] The boot's storage
 * convergence (`backfillCanonicalBooleans`) rewrites those cells to `1` / `0`;
 * its pins are the `[#34973]` describes at the end of this file.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { isInPlaceSchemaWork } from './schema-drift.js';

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

// ─── [#34973] The storage convergence: legacy text booleans become 1 / 0 ─────

const CONV = 'bool_text_converge_34973';
const CONV_OBJECT = {
  name: CONV,
  fields: { label: { type: 'string' }, flag: { type: 'boolean' }, live: { type: 'toggle' } },
};

/** id · raw `flag` · raw `live`, written past the driver (the pre-#34916 forms). */
const CONV_ROWS: ReadonlyArray<readonly [string, unknown, unknown]> = [
  ['int_one', 1, 1],
  ['int_zero', 0, null],
  ['nul', null, null],
  ['text_false', 'false', 'false'],
  ['text_true', 'true', null],
];

type Logged = { msg: string; meta?: any };

/** A SQLite database an older build wrote, with the driver's logger captured. */
async function legacyBooleanDatabase(): Promise<{ driver: SqlDriver; info: Logged[]; warn: Logged[] }> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
  // First boot: the table is created here, so it is clean without a read.
  await driver.initObjects([CONV_OBJECT]);
  const knex = (driver as any).knex;
  for (const [id, flag, live] of CONV_ROWS) await knex(CONV).insert({ id, label: id, flag, live });
  const info: Logged[] = [];
  const warn: Logged[] = [];
  // The default sink has no `info`; this instance gets one that records both.
  (driver as any).logger = {
    info: (msg: string, meta?: any) => { info.push({ msg, meta }); },
    warn: (msg: string, meta?: any) => { warn.push({ msg, meta }); },
  };
  return { driver, info, warn };
}

async function storedTypes(driver: SqlDriver, table: string, field: string): Promise<Record<string, string>> {
  const rows = await (driver as any).knex.raw(`select id, typeof(${field}) as t from ${table} order by id`);
  return Object.fromEntries(rows.map((r: any) => [r.id, r.t]));
}

async function idsWhere(driver: SqlDriver, where: Record<string, unknown>): Promise<string[]> {
  const rows = (await driver.find(CONV, { where } as DriverQuery)) as Array<{ id: string }>;
  return rows.map((r) => r.id).sort();
}

const converged = (log: Logged[]) => log.filter((l) => l.msg.includes('canonicalised boolean storage'));

describe('[#34973] driver-sql — boot converges legacy text booleans to 1 / 0 (sqlite)', () => {
  let driver: SqlDriver;
  let info: Logged[];
  let warn: Logged[];

  beforeEach(async () => {
    ({ driver, info, warn } = await legacyBooleanDatabase());
  });

  afterEach(async () => {
    await driver?.disconnect();
  });

  it('before the step, = false misses the text false and = true misses the text true', async () => {
    expect(await storedTypes(driver, CONV, 'flag')).toMatchObject({ text_false: 'text', text_true: 'text' });
    expect(await idsWhere(driver, { flag: false })).toEqual(['int_zero']);
    expect(await idsWhere(driver, { flag: true })).toEqual(['int_one']);
  });

  it('after initObjects, = false finds the text false and = true the text true', async () => {
    await driver.initObjects([CONV_OBJECT]);
    expect(await storedTypes(driver, CONV, 'flag')).toEqual({
      int_one: 'integer', int_zero: 'integer', nul: 'null', text_false: 'integer', text_true: 'integer',
    });
    expect(await idsWhere(driver, { flag: false })).toEqual(['int_zero', 'text_false']);
    expect(await idsWhere(driver, { flag: true })).toEqual(['int_one', 'text_true']);
    // A `toggle` column shares boolean storage and converges the same way.
    expect(await idsWhere(driver, { live: false })).toEqual(['text_false']);
  });

  it('after the step, $in, $ne and $nin answer a former text row as its integer twin', async () => {
    // Before: each operator compares the raw text, so it answers the text rows wrongly.
    expect(await idsWhere(driver, { flag: { $in: [false] } })).toEqual(['int_zero']);
    expect(await idsWhere(driver, { flag: { $ne: false } })).toContain('text_false');
    expect(await idsWhere(driver, { flag: { $nin: [true] } })).toContain('text_true');
    await driver.initObjects([CONV_OBJECT]);
    expect(await idsWhere(driver, { flag: { $in: [true, false] } })).toEqual(['int_one', 'int_zero', 'text_false', 'text_true']);
    expect(await idsWhere(driver, { flag: { $in: [false] } })).toEqual(['int_zero', 'text_false']);
    const ne = await idsWhere(driver, { flag: { $ne: false } });
    expect(ne).toContain('text_true');
    expect(ne).not.toContain('text_false');
    expect(ne).not.toContain('int_zero');
    const nin = await idsWhere(driver, { flag: { $nin: [true] } });
    expect(nin).toContain('text_false');
    expect(nin).not.toContain('text_true');
    expect(nin).not.toContain('int_one');
  });

  it('after the step, ORDER BY sorts a former text row with its boolean', async () => {
    const order = async () =>
      ((await driver.find(CONV, {
        orderBy: [{ field: 'flag', order: 'asc' }, { field: 'id', order: 'asc' }],
      } as DriverQuery)) as Array<{ id: string }>).map((r) => r.id);
    // Before: the text rows sort after every integer.
    expect(await order()).toEqual(['nul', 'int_zero', 'int_one', 'text_false', 'text_true']);
    await driver.initObjects([CONV_OBJECT]);
    expect(await order()).toEqual(['nul', 'int_zero', 'text_false', 'int_one', 'text_true']);
  });

  it('after the step, an aggregate groupBy groups a former text false as false', async () => {
    const groups = async () => {
      const rows = (await driver.aggregate(CONV, {
        groupBy: ['flag'],
        aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
      } as DriverQuery)) as Array<{ flag: unknown; n: number }>;
      return rows.map((r) => [r.flag, Number(r.n)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    };
    // Before: four groups, and the text 'false' group presents as true.
    expect(await groups()).toEqual([[false, 1], [null, 1], [true, 1], [true, 1], [true, 1]]);
    await driver.initObjects([CONV_OBJECT]);
    expect(await groups()).toEqual([[false, 2], [null, 1], [true, 2]]);
  });

  it('logs the rows converted per field with a sample of their ids, at info', async () => {
    await driver.initObjects([CONV_OBJECT]);
    const lines = converged(info).map((l) => l.meta);
    expect(lines).toEqual([
      { table: CONV, field: 'flag', rowsConverted: 2, sampleIds: ['text_false', 'text_true'] },
      { table: CONV, field: 'live', rowsConverted: 1, sampleIds: ['text_false'] },
    ]);
    expect(warn.filter((l) => l.msg.includes('boolean'))).toEqual([]);
  });

  it('is idempotent: a second boot converts 0 rows and logs nothing', async () => {
    await driver.initObjects([CONV_OBJECT]);
    const after = await storedTypes(driver, CONV, 'flag');
    info.length = 0;
    // Count every UPDATE the second boot sends against the table.
    const knex = (driver as any).knex;
    const updates: string[] = [];
    const onQuery = (q: { sql: string }) => {
      if (/^update/i.test(q.sql) && q.sql.includes(CONV)) updates.push(q.sql);
    };
    knex.on('query', onQuery);
    try {
      await driver.initObjects([CONV_OBJECT]);
    } finally {
      knex.removeListener('query', onQuery);
    }
    expect(updates.filter((sql) => sql.includes("'true'"))).toEqual([]);
    expect(converged(info)).toEqual([]);
    expect(await storedTypes(driver, CONV, 'flag')).toEqual(after);
  });

  it('a skipSchemaSync boot (OS_SKIP_SCHEMA_SYNC=1) leaves the text rows untouched', async () => {
    // What the objectql plugin runs for a skipSchemaSync boot instead of
    // `initObjects`: the DDL-free registration door, which reaches no backfill.
    driver.registerObjectMetadata([CONV_OBJECT]);
    expect(await storedTypes(driver, CONV, 'flag')).toMatchObject({ text_false: 'text', text_true: 'text' });
    expect(converged(info)).toEqual([]);
  });
});

describe('[#34973] driver-sql — text that names no boolean is withheld and warned (sqlite)', () => {
  const ODD = 'bool_text_odd_34973';
  const ODD_OBJECT = { name: ODD, fields: { flag: { type: 'boolean' } } };
  let driver: SqlDriver;
  let warn: Logged[];

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    await driver.initObjects([ODD_OBJECT]);
    // Past the validator, which would refuse 'yes' and 'TRUE': raw SQL only.
    await (driver as any).knex(ODD).insert([
      { id: 'odd_upper', flag: 'TRUE' },
      { id: 'odd_yes', flag: 'yes' },
      { id: 'text_false', flag: 'false' },
    ]);
    warn = [];
    (driver as any).logger = { warn: (msg: string, meta?: any) => { warn.push({ msg, meta }); } };
  });

  afterEach(async () => {
    await driver?.disconnect();
  });

  it('never rewrites the other text, converts the canonical text, and warns once with the count', async () => {
    await driver.initObjects([ODD_OBJECT]);
    const rows = await (driver as any).knex.raw(`select id, flag, typeof(flag) as t from ${ODD} order by id`);
    expect(rows).toEqual([
      { id: 'odd_upper', flag: 'TRUE', t: 'text' },
      { id: 'odd_yes', flag: 'yes', t: 'text' },
      { id: 'text_false', flag: 0, t: 'integer' },
    ]);
    const withheld = warn.filter((l) => l.msg.includes('unconverted'));
    expect(withheld.map((l) => l.meta)).toEqual([{ table: ODD, field: 'flag', rowsWithheld: 2 }]);
  });

  it('the plan counts only the rows the step converts, never the withheld ones', async () => {
    driver.setDeferredDdl(true);
    await driver.initObjects([ODD_OBJECT]);
    const pending = (await driver.previewDeferredSchemaWork()).filter((p) => p.kind === 'normalize_boolean_storage');
    expect(pending).toEqual([{ table: ODD, kind: 'normalize_boolean_storage', columns: ['flag'], rows: 1 }]);
  });
});

describe('[#34973] driver-sql — os migrate plan previews the boolean convergence (sqlite)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    ({ driver } = await legacyBooleanDatabase());
  });

  afterEach(async () => {
    await driver?.disconnect();
  });

  it('counts the rows as normalize_boolean_storage, in place, and writes nothing', async () => {
    driver.setDeferredDdl(true);
    await driver.initObjects([CONV_OBJECT]);
    const pending = await driver.previewDeferredSchemaWork();
    expect(pending).toEqual([{ table: CONV, kind: 'normalize_boolean_storage', columns: ['flag', 'live'], rows: 3 }]);
    expect(isInPlaceSchemaWork('normalize_boolean_storage')).toBe(true);
    // The deferral's promise: plan measures, apply changes.
    expect(await storedTypes(driver, CONV, 'flag')).toMatchObject({ text_false: 'text', text_true: 'text' });
    expect(await storedTypes(driver, CONV, 'live')).toMatchObject({ text_false: 'text' });
  });

  it('apply (the flush) converges the rows the plan named, and a re-plan finds none', async () => {
    driver.setDeferredDdl(true);
    await driver.initObjects([CONV_OBJECT]);
    await driver.flushDeferredSchemaDdl();
    expect(await idsWhere(driver, { flag: false })).toEqual(['int_zero', 'text_false']);
    driver.setDeferredDdl(true);
    await driver.initObjects([CONV_OBJECT]);
    expect(await driver.previewDeferredSchemaWork()).toEqual([]);
  });
});
