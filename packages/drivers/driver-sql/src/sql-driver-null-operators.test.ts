// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseFilterAST, type FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';

/**
 * Regression tests for issue #2704 — driver-sql must give IS NULL / IS NOT NULL
 * filters a real SQL rendering and must NOT forward an unknown operator to Knex
 * verbatim (which silently returned the whole table on a null comparand — a
 * filter-bypass on permission/assignment-scoped list views).
 *
 * [#5158] The array-format block below used to hand the raw
 * `[['assignee','isnull',true]]` to the driver, which carried its own compiler
 * for it. That dialect is deleted: `FilterArray` is input-only sugar, lowered
 * through `parseFilterAST` at the engine/protocol doors. The authored shapes
 * are unchanged — they now travel the declared route, which is what the block
 * calls explicitly. #2704's condition is untouched: `isnull` must still render
 * IS NULL and an unknown operator must still throw rather than scan the table.
 */
describe('SqlDriver — null / empty operators (#2704)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    const k = (driver as any).knex;
    await k.schema.createTable('tasks', (t: any) => {
      t.string('id').primary();
      t.string('title');
      t.string('assignee').nullable();
    });

    await k('tasks').insert([
      { id: '1', title: 'A', assignee: 'alice' },
      { id: '2', title: 'B', assignee: null },
      { id: '3', title: 'C', assignee: 'carol' },
      { id: '4', title: 'D', assignee: null },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  const ids = (rows: any[]) => rows.map((r) => r.id).sort();

  describe('authored array form, lowered the declared way (#5158)', () => {
    // The exact route the engine and the protocol face take: the caller's
    // `FilterArray` through `parseFilterAST`, and only the `FilterCondition`
    // reaches the driver. Feeding the array raw is what this driver no longer
    // does — pinned at the bottom of this block.
    const lowered = (where: unknown) =>
      driver.find('tasks', { where: parseFilterAST(where) as FilterCondition });

    it('equals + null → IS NULL (baseline that already worked)', async () => {
      expect(ids(await lowered([['assignee', '=', null]]))).toEqual(['2', '4']);
    });

    it.each(['is_null', 'isnull', 'is_empty'])('%s → IS NULL', async (op) => {
      expect(ids(await lowered([['assignee', op, true]]))).toEqual(['2', '4']);
    });

    it.each(['is_not_null', 'isnotnull', 'is_not_empty'])('%s → IS NOT NULL', async (op) => {
      expect(ids(await lowered([['assignee', op, true]]))).toEqual(['1', '3']);
    });

    it('!= null → IS NOT NULL (not a `<> NULL` that matches nothing)', async () => {
      expect(ids(await lowered([['assignee', '!=', null]]))).toEqual(['1', '3']);
    });

    it('unknown operator throws instead of returning the whole table', async () => {
      // `parseFilterAST` is lenient here on purpose (`$${op}` fallback) — the
      // ENGINE door gates on `isFilterAST` first and refuses this a layer
      // earlier (engine-filter-array-lowering.test.ts). Either way it throws;
      // what #2704 forbids is the whole-table answer.
      await expect(lowered([['assignee', 'totally_bogus', null]]))
        .rejects.toThrow(/Unsupported filter operator/);
    });

    it('count with is_null is scoped, not the whole table', async () => {
      const count = await driver.count('tasks', {
        where: parseFilterAST([['assignee', 'isnull', true]]) as FilterCondition,
      });
      expect(count).toBe(2);
    });

    it('the raw array is refused by the driver — the dialect is gone (#5158)', async () => {
      await expect(
        driver.find('tasks', { where: [['assignee', 'isnull', true]] as any }),
      ).rejects.toThrow(/A filter ARRAY reached the driver/);
    });
  });

  describe('object-format where ($-operators)', () => {
    it('$null: true → IS NULL', async () => {
      const rows = await driver.find('tasks', { where: { assignee: { $null: true } } });
      expect(ids(rows)).toEqual(['2', '4']);
    });

    it('$null: false → IS NOT NULL', async () => {
      const rows = await driver.find('tasks', { where: { assignee: { $null: false } } });
      expect(ids(rows)).toEqual(['1', '3']);
    });

    it('$ne: null → IS NOT NULL', async () => {
      const rows = await driver.find('tasks', { where: { assignee: { $ne: null } } });
      expect(ids(rows)).toEqual(['1', '3']);
    });

    it('$startsWith → prefix LIKE', async () => {
      const rows = await driver.find('tasks', { where: { assignee: { $startsWith: 'a' } } });
      expect(ids(rows)).toEqual(['1']);
    });

    // [#5702] REPLACED. This case was `$regex (better-auth contains) → substring
    // LIKE, not exact match` and expected `['3']` — it pinned the `case '$regex':`
    // fallthrough that existed for exactly one producer, plugin-auth's ObjectQL
    // adapter. #5710 flipped that producer to `$contains`, #4706 retired the
    // spelling, and the fallthrough is deleted; there is no substring-LIKE
    // answer left to assert.
    //
    // Its replacement is the same query on the operator that DOES mean this,
    // plus the refusal — asserted on `code` and `status`, not on `toThrow()`
    // alone, which would stay green against any error including the uncoded ones
    // the ADR-0112 envelope exists to eliminate.
    it('$contains → substring LIKE, the operator $regex is retired in favour of', async () => {
      const rows = await driver.find('tasks', { where: { assignee: { $contains: 'aro' } } });
      expect(ids(rows)).toEqual(['3']);
    });

    it('$regex is REFUSED, in the ADR-0112 envelope, naming $icontains', async () => {
      const err = await driver
        .find('tasks', { where: { assignee: { $regex: 'aro' } } })
        .then(() => null, (e: any) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$regex');
      expect(err.message).toContain('$icontains');
    });

    it('$not (CEL `!expr` scope filter) → negated sub-condition, not a bogus "$not" column', async () => {
      // `!(assignee == 'alice')` → { $not: { assignee: { $eq: 'alice' } } }.
      //
      // [#5146] This case used to expect ['3'] alone: `NOT (assignee = 'alice')`
      // is UNKNOWN for the null-assignee rows 2/4, so SQL dropped them while
      // `driver-memory` and `formula` returned them — one permission rule, two
      // visible sets. `$not` is now compiled over a TOTAL predicate
      // (`NOT (assignee IS NOT NULL AND assignee = 'alice')`), so "has no
      // assignee" counts as "is not alice", as it always did on the other two
      // backends. The unassigned rows are the behaviour change.
      const rows = await driver.find('tasks', {
        where: { $not: { assignee: { $eq: 'alice' } } },
      } as any);
      expect(ids(rows)).toEqual(['2', '3', '4']);
    });

    it('unknown $-operator throws instead of a silent equality compare', async () => {
      await expect(
        driver.find('tasks', { where: { assignee: { $bogus: 1 } } }),
      ).rejects.toThrow(/Unsupported filter operator/);
    });
  });
});
