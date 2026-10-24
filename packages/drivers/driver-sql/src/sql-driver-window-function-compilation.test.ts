// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How `findWithWindowFunctions()` turns a `windowFunctions[]` entry into SQL.
 *
 * Nothing the caller sends may reach the statement as text: the function name
 * and the sort direction come from closed tables (anything else is refused with
 * `INVALID_QUERY` / 400), and `partitionBy` / `orderBy` fields are emitted as
 * quoted column references. Each refusal case below is a spelling that the
 * builder used to splice into the statement verbatim.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from './index.js';

describe('findWithWindowFunctions — compiling a windowFunctions[] entry', () => {
  let driver: SqlDriver;
  let knexInstance: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knexInstance = (driver as any).knex;
    await knexInstance.schema.createTable('orders', (t: any) => {
      t.string('id').primary();
      t.string('customer');
      t.float('amount');
    });
    await knexInstance('orders').insert([
      { id: '1', customer: 'Alice', amount: 10 },
      { id: '2', customer: 'Bob', amount: 20 },
      { id: '3', customer: 'Alice', amount: 30 },
    ]);
  });

  afterEach(async () => {
    await knexInstance.destroy();
  });

  const expectInvalidQuery = async (promise: Promise<unknown>) => {
    const err: any = await promise.then(
      () => {
        throw new Error('expected the window-function read to be refused');
      },
      (e) => e,
    );
    expect(err.code).toBe('INVALID_QUERY');
    expect(err.status).toBe(400);
  };

  describe('the function name is a closed set', () => {
    it.each(['row_number', 'RANK', 'Dense_Rank', 'percent_rank', 'CUME_DIST'])('compiles %s', async (fn) => {
      const rows = await driver.findWithWindowFunctions('orders', {
        windowFunctions: [{ function: fn, alias: 'w', orderBy: [{ field: 'amount', order: 'desc' }] }],
      });
      expect(rows).toHaveLength(3);
      expect(rows.every((r: any) => r.w !== undefined)).toBe(true);
    });

    it.each([
      ['an unsupported function', 'median'],
      ['a function that needs an argument', 'lag'],
      ['an expression in the name slot', 'row_number() over () as x, (select count(*) from orders) as n, row_number'],
    ])('refuses %s with INVALID_QUERY / 400', async (_label, fn) => {
      await expectInvalidQuery(
        driver.findWithWindowFunctions('orders', { windowFunctions: [{ function: fn, alias: 'w' }] }),
      );
    });
  });

  describe('the sort direction is asc or desc', () => {
    it('accepts either direction in any case, and defaults to asc', async () => {
      for (const order of ['asc', 'DESC', undefined] as const) {
        const rows = await driver.findWithWindowFunctions('orders', {
          windowFunctions: [{ function: 'row_number', alias: 'w', orderBy: [{ field: 'amount', order: order as any }] }],
          orderBy: [{ field: 'amount', order: 'asc' }],
        });
        expect(rows.map((r: any) => r.w)).toEqual(order === 'DESC' ? [3, 2, 1] : [1, 2, 3]);
      }
    });

    it('refuses any other direction with INVALID_QUERY / 400', async () => {
      await expectInvalidQuery(
        driver.findWithWindowFunctions('orders', {
          windowFunctions: [
            { function: 'row_number', alias: 'w', orderBy: [{ field: 'amount', order: 'desc, (select 1)' as any }] },
          ],
        }),
      );
    });
  });

  describe('partitionBy / orderBy fields are quoted column references', () => {
    it('emits every field through the dialect quoting', () => {
      const sql = (driver as any).buildWindowFunction({
        function: 'rank',
        alias: 'w',
        partitionBy: ['customer'],
        orderBy: [{ field: 'amount', order: 'desc' }],
      });
      expect(sql).toBe('RANK() OVER (PARTITION BY `customer` ORDER BY `amount` DESC)');
    });

    it('reads an expression in a field slot as a column name, never as SQL', async () => {
      // As text, `length(customer)` is a valid partition expression and the read
      // would succeed; as a quoted identifier it names no column.
      await expect(
        driver.findWithWindowFunctions('orders', {
          windowFunctions: [{ function: 'row_number', alias: 'w', partitionBy: ['length(customer)'] }],
        }),
      ).rejects.toThrow(/no such column/);
      await expect(
        driver.findWithWindowFunctions('orders', {
          windowFunctions: [{ function: 'row_number', alias: 'w', orderBy: [{ field: 'length(customer)' }] }],
        }),
      ).rejects.toThrow(/no such column/);
    });
  });
});
