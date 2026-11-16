// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34199] An unresolved `lookupFilters` `{ $record: 'path' }` comparand never
 * reaches this driver: the engine's token pass (`resolveFilterTokens`,
 * `@objectstack/core`) refuses it by name, `INVALID_FILTER` / 400, naming the
 * field, the `$record` path and its position.
 *
 * `{ $record }` reads the record a form is editing, which only that form's
 * record picker knows; a picker that does not resolve it sends the eq
 * shorthand `{ cb_market: { $record: 'account.cb_market' } }` or an operator
 * comparand. Measured on `origin/main` 22438726f3 (SQLite, in-process), this
 * driver refused both itself, in words that withheld which operator and field
 * it met: "A filter operator in this filter is not one this driver evaluates"
 * (shorthand) and "requires a single comparable value" (`$eq`), each
 * `INVALID_FILTER` / 400. The second half below pins that it still refuses,
 * so a caller that passes no seam never gets rows for it either.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveFilterTokens } from '@objectstack/core';
import type { FilterCondition } from '@objectstack/spec/data';
import { lowerFilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './index.js';

/** What the engine hands a driver: tokens resolved, then the shared lowering. */
const seamed = (where: unknown): FilterCondition =>
  lowerFilterCondition(resolveFilterTokens(where, { userId: 'usr_1' }) as FilterCondition, { isDatetimeColumn: () => false }) as FilterCondition;

interface Refusal { code?: string; status?: number; message: string }

describe('[#34199] SqlDriver — an unresolved { $record } comparand', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([
      {
        name: 'price_book',
        fields: {
          id: { type: 'text', name: 'id' },
          cb_market: { type: 'text', name: 'cb_market' },
          owner: { type: 'text', name: 'owner' },
          attachment: { type: 'json', name: 'attachment' },
        },
      } as any,
    ]);
    await driver.create('price_book', { id: '1', cb_market: 'export', owner: 'usr_1' });
    await driver.create('price_book', { id: '2', cb_market: null, owner: 'usr_2' });
  });

  const refusalOf = async (read: () => Promise<unknown>): Promise<Refusal> => {
    try {
      await read();
    } catch (e) {
      return e as Refusal;
    }
    throw new Error('expected a refusal, but the read resolved');
  };

  const SHAPES: ReadonlyArray<readonly [string, unknown, string]> = [
    ['the eq shorthand', { cb_market: { $record: 'account.cb_market' } }, 'filter.cb_market'],
    ['an operator comparand', { cb_market: { $eq: { $record: 'account.cb_market' } } }, 'filter.cb_market.$eq'],
  ];

  for (const [label, where, at] of SHAPES) {
    it(`${label}: refused by name at the engine's token seam, before the driver is asked`, async () => {
      const find = vi.spyOn(driver, 'find');
      const err = await refusalOf(async () => driver.find('price_book', { fields: ['id'], where: seamed(where) }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('{ "$record": "account.cb_market" }');
      expect(err.message).toContain('on field "cb_market"');
      expect(err.message).toContain(`at ${at} reached the server unresolved`);
      expect(find).not.toHaveBeenCalled();
    });

    it(`${label}: a caller that passes no seam is refused by the driver itself, never answered rows`, async () => {
      const err = await refusalOf(() => driver.find('price_book', { fields: ['id'], where: where as FilterCondition }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });
  }

  it('control — a { $record } inside a deep-equality comparand reaches the driver unchanged and is answered as before', async () => {
    // Not a field's comparand: the no-`$` object beneath `attachment` is a
    // deep-equality literal. The token pass hands it over by reference, so
    // this driver gives the answer it gave before the pass learned the
    // reference, whatever that answer is.
    const where = { attachment: { meta: { $record: 'x' } } };
    expect(resolveFilterTokens(where, { userId: 'usr_1' })).toBe(where);
    const answer = async (w: unknown) => {
      try {
        return { rows: await driver.find('price_book', { fields: ['id'], where: w as FilterCondition }) };
      } catch (e) {
        const { code, status } = e as Refusal;
        return { code, status };
      }
    };
    expect(await answer(seamed(where))).toEqual(await answer(where));
  });

  it('control — an ordinary filter and a string token run through the same seam as before', async () => {
    const ids = async (where: unknown) =>
      ((await driver.find('price_book', { fields: ['id'], where: seamed(where) })) as Array<{ id: string }>).map((r) => String(r.id)).sort();
    expect(await ids({ cb_market: 'export' })).toEqual(['1']);
    expect(await ids({ owner: '{current_user_id}' })).toEqual(['1']);
  });
});
