// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#38236] `bulkCreate` on SQLite past one INSERT statement's bounds.
 *
 * knex compiles a multi-row INSERT on SQLite as `insert … select … union all
 * select …`, and SQLite refuses one statement past either of two bounds,
 * measured on the better-sqlite3 build this package ships (SQLite 3.53.4):
 *
 * | bound | value | first refused batch | SQLite's words |
 * |:---|:---|:---|:---|
 * | `SQLITE_MAX_COMPOUND_SELECT` | 500 terms | 501 rows, any width | `too many terms in compound SELECT` |
 * | `SQLITE_MAX_VARIABLE_NUMBER` | 32766 parameters | 469 rows of 70 columns | `too many SQL variables` |
 *
 * Before this change the driver sent every batch as one INSERT, so
 * `engine.insert(object, rows)` with more than 500 rows threw on SQLite and
 * on no other dialect. It now sends such a batch as several INSERTs inside one
 * transaction. These pins hold the guarantees `bulkCreate` states for a batch
 * to the split one: every row lands, a failing statement leaves nothing stored,
 * the auto-number reservation is the batch's one reservation dealt in row
 * order, and a batch that fits one statement is still exactly one statement.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from './index.js';
import { SQLITE_MAX_INSERT_ROWS, SQLITE_MAX_INSERT_VARIABLES, sqliteInsertStatements } from './sql-driver-bulk-operations.js';

const SEQUENCES_TABLE = '_objectstack_sequences';

const TICKET = {
  name: 'bound_ticket',
  fields: {
    ticket_number: { type: 'autonumber', format: 'T-{00000}', unique: true },
    title: { type: 'string' },
    priority: { type: 'number' },
    status: { type: 'string' },
    owner: { type: 'string' },
    notes: { type: 'text' },
  },
} as any;

/** 80 declared columns: a batch of 450 binds 36000+ parameters, past 32766, while under 500 rows. */
const WIDE = {
  name: 'bound_wide',
  fields: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`c${i}`, { type: 'string' }])),
} as any;

const ticketRows = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${String(from + i).padStart(5, '0')}`,
    title: `ticket ${from + i}`,
    priority: (from + i) % 5,
    status: 'open',
    owner: 'ops',
    notes: 'n',
  }));

describe('[#38236] bulkCreate on SQLite past one INSERT statement\'s bounds', () => {
  let driver: SqlDriver;
  /** The SQL of every statement the driver sent to the object's table, in order. */
  let sent: string[];

  const knex = () => (driver as any).knex;
  const insertsInto = (table: string) => sent.filter((sql) => sql.startsWith(`insert into \`${table}\``));
  const rowCount = async (table: string) => Number((await knex()(table).count({ c: '*' }).first()).c);
  const lastValue = async (): Promise<number | undefined> => {
    const row = (await knex()(SEQUENCES_TABLE).select('*')).find((r: any) => r.object === TICKET.name && r.field === 'ticket_number');
    return row ? Number(row.last_value) : undefined;
  };

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([TICKET, WIDE]);
    sent = [];
    knex().on('query', (q: { sql: string }) => sent.push(q.sql.trim().toLowerCase()));
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('inserts every row of a 1200-row batch, in order, as statements within both bounds', async () => {
    const rows = ticketRows(1200);
    const result = await driver.bulkCreate(TICKET.name, rows);

    expect(result).toHaveLength(1200);
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(await rowCount(TICKET.name)).toBe(1200);
    // 500 + 500 + 200: the compound-SELECT bound is the one that binds here.
    expect(insertsInto(TICKET.name)).toHaveLength(3);
  });

  it('splits a wide batch by the parameter bound even under 500 rows', async () => {
    const rows = Array.from({ length: 450 }, (_, r) => ({
      id: `w${r}`,
      ...Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`c${i}`, `v${r}-${i}`])),
    }));
    const result = await driver.bulkCreate(WIDE.name, rows);

    expect(result).toHaveLength(450);
    expect(await rowCount(WIDE.name)).toBe(450);
    expect(insertsInto(WIDE.name).length).toBeGreaterThan(1);
    expect(result[449].c79).toBe('v449-79');
  });

  it('deals the batch\'s auto-numbers contiguously and in row order across statements', async () => {
    const result = await driver.bulkCreate(TICKET.name, ticketRows(1200));

    const expected = Array.from({ length: 1200 }, (_, i) => `T-${String(i + 1).padStart(5, '0')}`);
    expect(result.map((r) => r.ticket_number)).toEqual(expected);
    const stored = await knex()(TICKET.name).select('id', 'ticket_number').orderBy('id');
    expect(stored.map((r: any) => r.ticket_number)).toEqual(expected);
    expect(await lastValue()).toBe(1200);
  });

  it('leaves nothing stored when the LAST statement fails, and burns the reservation once, as one statement does', async () => {
    // CONTROL: a 3-row batch refused as one statement. The driver documents the
    // shape: no row stored, the reserved numbers burned (they commit on purpose).
    const control = ticketRows(3, 9000);
    control[2].id = control[0].id;
    await expect(driver.bulkCreate(TICKET.name, control)).rejects.toThrow(/UNIQUE constraint failed: bound_ticket\.id/);
    expect(await rowCount(TICKET.name)).toBe(0);
    expect(await lastValue()).toBe(3);

    // A 1200-row batch whose row 1150 (in the third statement) repeats row 5's id.
    const rows = ticketRows(1200);
    rows[1150].id = rows[5].id;
    await expect(driver.bulkCreate(TICKET.name, rows)).rejects.toThrow(/UNIQUE constraint failed: bound_ticket\.id/);
    expect(insertsInto(TICKET.name).length).toBeGreaterThanOrEqual(4); // the control's one, then the split batch's three
    expect(await rowCount(TICKET.name)).toBe(0);
    // Burned once for the whole batch, exactly as the control burned its three.
    expect(await lastValue()).toBe(3 + 1200);

    // The next batch continues above the burned range, with no duplicate.
    const next = await driver.bulkCreate(TICKET.name, ticketRows(2, 9500));
    expect(next.map((r) => r.ticket_number)).toEqual(['T-01204', 'T-01205']);
  });

  it('runs inside the caller\'s transaction: the caller\'s rollback removes every statement\'s rows', async () => {
    const trx = await knex().transaction();
    const result = await driver.bulkCreate(TICKET.name, ticketRows(1200), { transaction: trx } as any);
    expect(result).toHaveLength(1200);
    expect(Number((await trx(TICKET.name).count({ c: '*' }).first()).c)).toBe(1200);
    await trx.rollback();
    expect(await rowCount(TICKET.name)).toBe(0);
  });

  it('undoes a failed split batch inside the caller\'s transaction and keeps the caller\'s own writes', async () => {
    const trx = await knex().transaction();
    await driver.bulkCreate(TICKET.name, ticketRows(1, 7000), { transaction: trx } as any);
    const rows = ticketRows(1200);
    rows[1150].id = rows[5].id;
    await expect(driver.bulkCreate(TICKET.name, rows, { transaction: trx } as any)).rejects.toThrow(/UNIQUE constraint failed/);
    expect(Number((await trx(TICKET.name).count({ c: '*' }).first()).c)).toBe(1);
    await trx.commit();
    expect(await rowCount(TICKET.name)).toBe(1);
  });

  it('CONTROL: a batch at the bound is still ONE statement with no transaction opened', async () => {
    const result = await driver.bulkCreate(TICKET.name, ticketRows(500));

    expect(result).toHaveLength(500);
    expect(insertsInto(TICKET.name)).toHaveLength(1);
    expect(sent.some((sql) => sql.startsWith('begin') || sql.startsWith('savepoint'))).toBe(false);
  });

  it('one row past the bound is two statements', async () => {
    await driver.bulkCreate(TICKET.name, ticketRows(501));
    expect(insertsInto(TICKET.name)).toHaveLength(2);
    expect(await rowCount(TICKET.name)).toBe(501);
  });
});

describe('[#38236] sqliteInsertStatements', () => {
  const rowsOf = (n: number, width: number) =>
    Array.from({ length: n }, () => Object.fromEntries(Array.from({ length: width }, (_, i) => [`c${i}`, 1])));

  it('keeps a batch within both bounds as the one array it was given', () => {
    const rows = rowsOf(SQLITE_MAX_INSERT_ROWS, 5);
    const statements = sqliteInsertStatements(rows);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(rows);
  });

  it('bounds every statement by rows and by rows times the union of columns', () => {
    for (const [n, width] of [[1200, 6], [450, 80], [100, 2000], [501, 1]] as const) {
      const rows = rowsOf(n, width);
      const statements = sqliteInsertStatements(rows);
      expect(statements.flat()).toEqual(rows);
      for (const s of statements) {
        expect(s.length).toBeLessThanOrEqual(SQLITE_MAX_INSERT_ROWS);
        expect(s.length * width).toBeLessThanOrEqual(SQLITE_MAX_INSERT_VARIABLES);
      }
    }
  });

  it('counts a column any row carries against every row', () => {
    // 469 rows: 468 carry 69 columns, the last carries a 70th. knex binds all 70 for each row.
    const rows = rowsOf(469, 69);
    (rows[468] as any).c69 = 1;
    expect(sqliteInsertStatements(rows).length).toBeGreaterThan(1);
  });
});
