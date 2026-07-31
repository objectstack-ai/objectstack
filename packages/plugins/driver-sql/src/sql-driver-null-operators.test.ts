// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * Regression tests for issue #2704 — driver-sql must give IS NULL / IS NOT NULL
 * filters a real SQL rendering and must NOT forward an unknown operator to Knex
 * verbatim (which silently returned the whole table on a null comparand — a
 * filter-bypass on permission/assignment-scoped list views).
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

  describe('array-format where', () => {
    it('equals + null → IS NULL (baseline that already worked)', async () => {
      const rows = await driver.find('tasks', { object: 'tasks', where: [['assignee', '=', null]] });
      expect(ids(rows)).toEqual(['2', '4']);
    });

    it.each(['is_null', 'isnull', 'is_empty'])('%s → IS NULL', async (op) => {
      const rows = await driver.find('tasks', { object: 'tasks', where: [['assignee', op, true]] });
      expect(ids(rows)).toEqual(['2', '4']);
    });

    it.each(['is_not_null', 'isnotnull', 'is_not_empty'])('%s → IS NOT NULL', async (op) => {
      const rows = await driver.find('tasks', { object: 'tasks', where: [['assignee', op, true]] });
      expect(ids(rows)).toEqual(['1', '3']);
    });

    it('!= null → IS NOT NULL (not a `<> NULL` that matches nothing)', async () => {
      const rows = await driver.find('tasks', { object: 'tasks', where: [['assignee', '!=', null]] });
      expect(ids(rows)).toEqual(['1', '3']);
    });

    it('unknown operator throws instead of returning the whole table', async () => {
      await expect(
        driver.find('tasks', { object: 'tasks', where: [['assignee', 'totally_bogus', null]] }),
      ).rejects.toThrow(/Unsupported filter operator/);
    });

    it('count with is_null is scoped, not the whole table', async () => {
      const count = await driver.count('tasks', { object: 'tasks', where: [['assignee', 'isnull', true]] });
      expect(count).toBe(2);
    });
  });

  describe('object-format where ($-operators)', () => {
    it('$null: true → IS NULL', async () => {
      const rows = await driver.find('tasks', { object: 'tasks', where: { assignee: { $null: true } } });
      expect(ids(rows)).toEqual(['2', '4']);
    });

    it('$null: false → IS NOT NULL', async () => {
      const rows = await driver.find('tasks', { object: 'tasks', where: { assignee: { $null: false } } });
      expect(ids(rows)).toEqual(['1', '3']);
    });

    it('$ne: null → IS NOT NULL', async () => {
      const rows = await driver.find('tasks', { object: 'tasks', where: { assignee: { $ne: null } } });
      expect(ids(rows)).toEqual(['1', '3']);
    });

    it('$startsWith → prefix LIKE', async () => {
      const rows = await driver.find('tasks', { object: 'tasks', where: { assignee: { $startsWith: 'a' } } });
      expect(ids(rows)).toEqual(['1']);
    });

    it('$regex (better-auth contains) → substring LIKE, not exact match', async () => {
      const rows = await driver.find('tasks', { object: 'tasks', where: { assignee: { $regex: 'aro' } } });
      expect(ids(rows)).toEqual(['3']);
    });

    it('$not (CEL `!expr` scope filter) → negated sub-condition, not a bogus "$not" column', async () => {
      // `!(assignee == 'alice')` → { $not: { assignee: { $eq: 'alice' } } }.
      // SQL `NOT (assignee = 'alice')` excludes alice AND is null-safe only for
      // the rows it can evaluate — rows 2/4 have null assignee so `NOT (null = 'alice')`
      // is UNKNOWN and they are excluded, leaving carol.
      const rows = await driver.find('tasks', {
        where: { $not: { assignee: { $eq: 'alice' } } },
      } as any);
      expect(ids(rows)).toEqual(['3']);
    });

    it('unknown $-operator throws instead of a silent equality compare', async () => {
      await expect(
        driver.find('tasks', { object: 'tasks', where: { assignee: { $bogus: 1 } } }),
      ).rejects.toThrow(/Unsupported filter operator/);
    });
  });
});
