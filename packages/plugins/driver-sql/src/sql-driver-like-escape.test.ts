// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * P0-3 regression: the `contains` / `$contains` operator must escape LIKE
 * metacharacters (`%` / `_`) in the user value so they match literally. An
 * unescaped `%` would expand to `%%%` and match every row — a filter bypass.
 */
describe('SqlDriver — contains escapes LIKE metacharacters (P0-3)', () => {
  let driver: SqlDriver;
  let knex: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = (driver as any).knex;
    await knex.schema.createTable('docs', (t: any) => {
      t.string('id').primary();
      t.string('title');
    });
    await knex('docs').insert([
      { id: '1', title: '50% off sale' }, // literal %
      { id: '2', title: 'plain title' }, // no metacharacter
      { id: '3', title: 'a_b underscore' }, // literal _
    ]);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('a "%" value matches only rows containing a literal %, not every row', async () => {
    const r = await driver.find('docs', { object: 'docs', where: { title: { $contains: '%' } } });
    expect(r.map((x: any) => x.id)).toEqual(['1']);
  });

  it('a "_" value matches only rows containing a literal _, not any single char', async () => {
    const r = await driver.find('docs', { object: 'docs', where: { title: { $contains: '_' } } });
    expect(r.map((x: any) => x.id)).toEqual(['3']);
  });

  it('an ordinary substring still matches normally', async () => {
    const r = await driver.find('docs', { object: 'docs', where: { title: { $contains: 'sale' } } });
    expect(r.map((x: any) => x.id)).toEqual(['1']);
  });
});
