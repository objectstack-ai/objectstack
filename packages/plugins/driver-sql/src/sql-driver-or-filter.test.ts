// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for the SQL compiler, on a real engine
 * (in-memory better-sqlite3).
 *
 * The shared cases come from `@objectstack/spec/data` so this backend,
 * `driver-memory`, `formula`'s `matchesFilterCondition` and `read-scope-sql`
 * are all held to one standard — see `filter-logic-conformance.ts` for why that
 * standard exists (#3774). Adding a case there adds it to all four at once.
 *
 * This file is the one that was actually failing: `applyFilterCondition` passed
 * `logicalOp='or'` down into each `$or` branch's recursive call, so the branch's
 * own contents were joined with `orWhere` too — `{$or:[{a,b}]}` compiled to
 * `a = ? OR b = ?`, and `{$or:[{d:{$gte:X,$lt:Y}}]}` to `d >= ? OR d < ?`, which
 * matches every row. Every such miscompile widens the result set.
 *
 * The SQL-specific cases below the conformance sweep cover ground the shared
 * table deliberately leaves out: a real DATE-typed column, and columns whose
 * values are not the shared fixture's plain strings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver filter logic conformance (SQLite)', () => {
  let driver: SqlDriver;
  let knexInstance: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knexInstance = (driver as any).knex;

    await knexInstance.schema.createTable('t', (t: any) => {
      t.string('id').primary();
      t.string('a');
      t.string('b');
      t.string('c');
      t.string('owner');
      t.string('status');
      t.string('parent_object');
      t.string('parent_id');
    });
    await knexInstance('t').insert([...FILTER_LOGIC_ROWS]);
  });

  afterEach(async () => {
    await knexInstance.destroy();
  });

  describe('shared conformance cases', () => {
    for (const c of FILTER_LOGIC_CASES) {
      it(c.name, async () => {
        const rows = await driver.find('t', { object: 't', where: c.filter });
        const got = rows
          .map((r: any) => String(r.id))
          .sort((x: string, y: string) => x.localeCompare(y));
        expect(got, c.note).toEqual(c.expected);
      });
    }
  });

  /**
   * The abutting-window pattern the automation skill docs recommend and the CLI
   * flow linter blesses (`lint-flow-patterns`): each tier is one field carrying
   * two operators. "Windows tile the timeline so each record matches exactly one
   * tier" only holds if those operators AND — under the old compile every tier
   * degenerated to `d >= lo OR d < hi`, i.e. matched every row.
   *
   * The shared table pins this shape on plain strings; this pins it on a real
   * date column, where value coercion also runs.
   */
  describe('multi-operator date windows inside $or', () => {
    beforeEach(async () => {
      await knexInstance.schema.createTable('task', (t: any) => {
        t.string('id').primary();
        t.date('end_date');
      });
      await knexInstance('task').insert([
        { id: 'd07', end_date: '2026-08-07' },
        { id: 'd15', end_date: '2026-08-15' },
        { id: 'd30', end_date: '2026-08-30' },
        { id: 'd60', end_date: '2026-09-29' },
      ]);
    });

    it('matches only the rows inside the abutting windows', async () => {
      const rows = await driver.find('task', {
        object: 'task',
        where: {
          $or: [
            { end_date: { $gte: '2026-08-07', $lt: '2026-08-08' } },
            { end_date: { $gte: '2026-08-30', $lt: '2026-08-31' } },
          ],
        },
      });
      expect(rows.map((r: any) => r.id).sort()).toEqual(['d07', 'd30']);
    });

    it('keeps a window AND-ed with a sibling key in the same branch', async () => {
      const rows = await driver.find('task', {
        object: 'task',
        where: { $or: [{ id: 'nope' }, { end_date: { $gte: '2026-08-07', $lt: '2026-08-31' }, id: 'd15' }] },
      });
      expect(rows.map((r: any) => r.id)).toEqual(['d15']);
    });
  });
});
