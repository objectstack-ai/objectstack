// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A filter that cannot be compiled must THROW, never be skipped. (#3948)
 *
 * `applyFilters` walked the filter array and `continue`d past anything that was
 * not a join keyword or a condition array. For a BARE comparison triple —
 * `['close_date', 'before', '2024-01-01']` — the three elements are all strings,
 * so every one was skipped and **no WHERE clause was emitted at all**: the caller
 * asked to filter and silently received every row.
 *
 * A bare triple reaches a driver only when `isFilterAST()` refused it, i.e. its
 * operator is outside `VALID_AST_OPERATORS`, so `parseFilterAST()` never
 * converted it and the raw array arrived as `where`. That is reachable from
 * ordinary authoring: `before`/`after` are canonical `VIEW_FILTER_OPERATORS`
 * members which `VALID_AST_OPERATORS` does not accept.
 *
 * The nested and `$`-object paths already threw on the same class of input, so
 * the three code paths disagreed about one query. These tests pin the loud
 * behaviour, and pin that well-formed filters still compile.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver rejects an uncompilable filter instead of dropping it', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          amount: { type: 'number', name: 'amount' },
        },
      } as any,
    ]);

    await driver.create('deal', { id: '1', stage: 'won', amount: 10 });
    await driver.create('deal', { id: '2', stage: 'lost', amount: 20 });
  });

  const find = (where: unknown) =>
    driver.find('deal', { object: 'deal', fields: ['id'], where } as any);

  it('throws on a bare triple whose operator the AST gate refused', async () => {
    // The exact shape a stored single-condition `before` view produced.
    await expect(find(['close_date', 'before', '2024-01-01']))
      .rejects.toThrow(/Unrecognized filter operator "close_date"/);
  });

  it('does not silently return every row for that filter', async () => {
    // The regression itself: before the fix this resolved with BOTH rows.
    await expect(find(['stage', 'sounds_like', 'won'])).rejects.toThrow();
  });

  it('throws on a filter element that is neither a keyword nor a condition', async () => {
    await expect(find([42 as any])).rejects.toThrow(/Unrecognized filter element of type "number"/);
    await expect(find([null as any])).rejects.toThrow(/Unrecognized filter element of type "null"/);
  });

  it('still throws on an unsupported operator inside a well-formed condition', async () => {
    // Pre-existing behaviour, pinned so the two paths cannot diverge again.
    await expect(find([['stage', 'sounds_like', 'won']]))
      .rejects.toThrow(/Unsupported filter operator "sounds_like"/);
  });

  it('compiles a nested condition array', async () => {
    const rows = await find([['stage', '=', 'won']]);
    expect(rows.map((r: any) => r.id)).toEqual(['1']);
  });

  it('compiles an infix logical join', async () => {
    // This path's legacy array form is INFIX — `[condA, 'or', condB]`. The
    // prefix spec-AST form `['or', condA, condB]` reaches the driver already
    // converted to `{$or: […]}` by `parseFilterAST()`, so it takes the
    // object branch instead and never lands here.
    const rows = await find([['stage', '=', 'won'], 'or', ['stage', '=', 'lost']]);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['1', '2']);
  });

  it('compiles an object-form filter', async () => {
    const rows = await find({ stage: 'lost' });
    expect(rows.map((r: any) => r.id)).toEqual(['2']);
  });

  it('leaves an empty filter alone (no filter is not a failed filter)', async () => {
    const rows = await find([]);
    expect(rows).toHaveLength(2);
  });
});
