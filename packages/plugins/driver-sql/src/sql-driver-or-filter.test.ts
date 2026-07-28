// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `$or` filter semantics on a real SQL engine (in-memory better-sqlite3).
 *
 * The invariant this file defends is the Filter Protocol's (Mongo's) core rule:
 *
 *   **Everything inside ONE filter object is AND-ed, at every nesting depth** —
 *   both its field keys and the operators of a single field. A `$or` array
 *   OR-s its BRANCHES together; it does not change how the contents *within* a
 *   branch combine.
 *
 * `applyFilterCondition` used to pass `logicalOp='or'` down into each `$or`
 * branch's recursive call, so the branch's own contents were joined with
 * `orWhere` too: `{$or:[{a,b}]}` compiled to `a = ? OR b = ?`, and
 * `{$or:[{d:{$gte:X,$lt:Y}}]}` to `d >= ? OR d < ?` (which matches every row).
 *
 * Every such miscompile *widens* the result set, never narrows it, which is
 * why it matters beyond tidiness: these shapes are how scoping filters and
 * scheduled-flow windows are written. The last two describe blocks pin the two
 * that occur in real metadata — a parent-scope branch (`{parent_object,
 * parent_id:{$in}}`) and the abutting `$gte`/`$lt` window the automation skill
 * docs and the CLI flow linter both tell authors to write.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver $or filter semantics (SQLite)', () => {
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
    });

    // The 2x2 truth table over (a, b) — every combination appears exactly once,
    // so a wrongly-OR-ed pair of predicates is always visible as extra rows.
    await knexInstance('t').insert([
      { id: '1', a: 'x', b: 'y', c: 'z' },
      { id: '2', a: 'x', b: 'zz', c: 'z' },
      { id: '3', a: 'qq', b: 'y', c: 'z' },
      { id: '4', a: 'qq', b: 'zz', c: 'z' },
    ]);
  });

  afterEach(async () => {
    await knexInstance.destroy();
  });

  const ids = async (where: any): Promise<string[]> =>
    (await driver.find('t', { where })).map((r: any) => r.id).sort();

  describe('keys within a $or branch are AND-ed', () => {
    it('ANDs the keys of a single multi-key branch', async () => {
      // Was: `a = 'x' OR b = 'y'` → ['1','2','3'].
      expect(await ids({ $or: [{ a: 'x', b: 'y' }] })).toEqual(['1']);
    });

    it('ANDs the keys of each branch independently', async () => {
      expect(await ids({ $or: [{ a: 'x', b: 'y' }, { a: 'qq', b: 'zz' }] })).toEqual(['1', '4']);
    });

    it('ANDs operator-object keys within a branch', async () => {
      // Exercises the `{ field: { $op: v } }` path rather than the bare-value one.
      expect(await ids({ $or: [{ a: { $eq: 'x' }, b: { $ne: 'zz' } }] })).toEqual(['1']);
    });

    it('ANDs keys inside a $or nested in a $or branch', async () => {
      expect(await ids({ $or: [{ $or: [{ a: 'x', b: 'zz' }] }] })).toEqual(['2']);
    });

    it('ANDs multiple operators on ONE field within a branch', async () => {
      // A single-key branch is still miscompilable: the operator map is looped
      // with the same `logicalOp`, so `{a:{$ne,$ne}}` became `OR` of the two.
      expect(await ids({ $or: [{ a: { $ne: 'qq', $eq: 'x' }, b: 'y' }] })).toEqual(['1']);
    });

    it('ANDs a $not with its sibling keys inside a branch', async () => {
      // (a <> 'x' AND b = 'zz') → row 4 only.
      expect(await ids({ $or: [{ c: 'nope' }, { $not: { a: 'x' }, b: 'zz' }] })).toEqual(['4']);
    });
  });

  describe('$and nested inside $or', () => {
    it('OR-s a $and branch against a sibling multi-key branch', async () => {
      expect(
        await ids({ $or: [{ $and: [{ a: 'x' }, { b: 'y' }] }, { a: 'qq', b: 'zz' }] }),
      ).toEqual(['1', '4']);
    });

    it('OR-s a multi-key branch against a sibling $and branch', async () => {
      expect(
        await ids({ $or: [{ a: 'x', b: 'y' }, { $and: [{ a: 'qq' }, { b: 'zz' }] }] }),
      ).toEqual(['1', '4']);
    });

    it('ANDs a $and with a key that FOLLOWS it in the same branch', async () => {
      // Key order must not matter: `$and` first, plain key second.
      expect(await ids({ $or: [{ c: 'nope' }, { $and: [{ a: 'qq' }], b: 'y' }] })).toEqual(['3']);
    });

    it('ANDs a $and with a key that PRECEDES it in the same branch', async () => {
      // The mirror of the above — this ordering was already correct; it stays a
      // regression guard so a future refactor cannot flip only one of the two.
      expect(await ids({ $or: [{ c: 'nope' }, { b: 'y', $and: [{ a: 'qq' }] }] })).toEqual(['3']);
    });
  });

  describe('unaffected shapes stay unaffected (controls)', () => {
    it('keeps single-key $or branches as a plain OR', async () => {
      expect(await ids({ $or: [{ a: 'x' }, { b: 'y' }] })).toEqual(['1', '2', '3']);
    });

    it('keeps top-level multi-key AND', async () => {
      expect(await ids({ a: 'x', b: 'y' })).toEqual(['1']);
    });

    it('keeps a $or nested under a top-level $and', async () => {
      expect(await ids({ $and: [{ $or: [{ a: 'x' }, { b: 'y' }] }, { b: 'y' }] })).toEqual(['1', '3']);
    });

    it('keeps a $or sibling of a top-level field key AND-ed', async () => {
      expect(await ids({ $or: [{ a: 'x' }, { b: 'y' }], b: 'zz' })).toEqual(['2']);
    });
  });

  /**
   * Read scopes are ordinary FilterConditions, and the shapes that express
   * "rows I own, or rows shared with me" and "rows under a parent I can see"
   * both put a multi-key object inside a `$or` branch. A widening miscompile
   * there returns rows the scope was written to exclude, so these shapes get
   * their own explicit guards rather than relying on the abstract cases above.
   */
  describe('read-scope shapes', () => {
    beforeEach(async () => {
      await knexInstance.schema.createTable('doc', (t: any) => {
        t.string('id').primary();
        t.string('owner');
        t.string('status');
        t.string('shared_with');
      });
      await knexInstance('doc').insert([
        { id: 'own-active', owner: 'u1', status: 'active', shared_with: null },
        { id: 'own-archived', owner: 'u1', status: 'archived', shared_with: null },
        { id: 'other-active', owner: 'u2', status: 'active', shared_with: null },
        { id: 'shared', owner: 'u2', status: 'active', shared_with: 'u1' },
      ]);
    });

    it('does not widen an "own AND active, OR shared" scope', async () => {
      const scope = { $or: [{ owner: 'u1', status: 'active' }, { shared_with: 'u1' }] };
      const rows = await driver.find('doc', { where: scope });
      // Was: `owner='u1' OR status='active' OR shared_with='u1'` — which also
      // returned `own-archived` (excluded by the scope's AND) and
      // `other-active` (another user's row).
      expect(rows.map((r: any) => r.id).sort()).toEqual(['own-active', 'shared']);
    });

    it('does not widen a scope whose branch uses $in + status', async () => {
      const scope = { $or: [{ owner: { $in: ['u1'] }, status: 'active' }, { shared_with: 'u1' }] };
      const rows = await driver.find('doc', { where: scope });
      expect(rows.map((r: any) => r.id).sort()).toEqual(['own-active', 'shared']);
    });

    it('keeps a multi-parent-type scope pinned to its own parent ids', async () => {
      // "Rows under parent c1 of type case, or under parent t1 of type todo" —
      // one branch per parent type, each pairing a type with its own id list.
      // The pairing is the whole point of the branch and must survive compile.
      await knexInstance.schema.createTable('att', (t: any) => {
        t.string('id').primary();
        t.string('parent_object');
        t.string('parent_id');
      });
      await knexInstance('att').insert([
        { id: 'ok-case', parent_object: 'case', parent_id: 'c1' },
        { id: 'ok-todo', parent_object: 'todo', parent_id: 't1' },
        { id: 'other-case', parent_object: 'case', parent_id: 'c2' },
        { id: 'cross-type', parent_object: 'todo', parent_id: 'c1' },
      ]);

      const scope = {
        $or: [
          { parent_object: 'case', parent_id: { $in: ['c1'] } },
          { parent_object: 'todo', parent_id: { $in: ['t1'] } },
        ],
      };
      const rows = await driver.find('att', { where: scope });
      expect(rows.map((r: any) => r.id).sort()).toEqual(['ok-case', 'ok-todo']);
    });
  });

  /**
   * The abutting-window pattern the automation skill docs recommend and the CLI
   * flow linter blesses (`lint-flow-patterns`): each tier is one field carrying
   * two operators. "Windows tile the timeline so each record matches exactly
   * one tier" only holds if those operators AND — under the old compile every
   * tier degenerated to `d >= lo OR d < hi`, i.e. matched every row.
   */
  describe('multi-operator date windows inside $or', () => {
    beforeEach(async () => {
      await knexInstance.schema.createTable('task', (t: any) => {
        t.string('id').primary();
        t.string('end_date');
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
        where: { $or: [{ id: 'nope' }, { end_date: { $gte: '2026-08-07', $lt: '2026-08-31' }, id: 'd15' }] },
      });
      expect(rows.map((r: any) => r.id)).toEqual(['d15']);
    });
  });
});
