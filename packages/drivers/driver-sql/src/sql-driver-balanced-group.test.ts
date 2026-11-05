// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29888] A large `$or` / `$and` compiles to a shallow expression tree.
 *
 * SQLite refuses a WHERE whose expression tree is deeper than its
 * `SQLITE_LIMIT_EXPR_DEPTH` at prepare time. A hosted libSQL server runs with
 * 100; the better-sqlite3 build here runs with the default 1000 and exposes no
 * way to lower it. So the budget is measured the way SQLite counts it: the
 * statement the driver actually compiled is re-prepared with its WHERE as the
 * left operand of a chain of {@link SPINE} `AND 1` terms. Each term adds one
 * level above the WHERE, so the re-prepared statement fits under 1000 exactly
 * when the WHERE alone fits under 1000 - SPINE = {@link BUDGET}. The harness
 * proves that calibration on raw SQL before measuring anything.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { FLAT_GROUP_MAX_MEMBERS } from './sql-driver-balanced-group.js';

const TABLE = 'os29888_balanced_group';
const ROWS = 200;
/** The depth a hosted libSQL server allows. */
const BUDGET = 100;
/** SQLite's default `SQLITE_MAX_EXPR_DEPTH`, the one this build runs with. */
const NATIVE_LIMIT = 1000;
const SPINE = NATIVE_LIMIT - BUDGET;
const TOO_DEEP = /Expression tree is too large/;

const idOf = (i: number) => `r${String(i).padStart(3, '0')}`;
const tagOf = (i: number) => `t${i}`;

describe('[#29888] SqlDriver emits large $or / $and groups as balanced halves', () => {
  let driver: SqlDriver;
  let knex: any;
  /** Every statement the driver sent, with its bindings. */
  const sent: Array<{ sql: string; bindings: unknown[] }> = [];

  /** Prepare `where` (SQL text) under the depth budget: refused when it is deeper than BUDGET. */
  const prepareUnderBudget = async (where: string, bindings: readonly unknown[]) =>
    knex.raw(`select \`id\` from \`${TABLE}\` where (${where})${' and 1'.repeat(SPINE)}`, [...bindings]);

  /** The WHERE of the one select the driver sent for `run`, and its bindings. */
  const compiledWhere = async (run: () => Promise<unknown>) => {
    sent.length = 0;
    await run();
    const selects = sent.filter((q) => /^select\b/i.test(q.sql) && q.sql.includes(`from \`${TABLE}\` where `));
    expect(selects.length, 'one select of the fixture table').toBe(1);
    const [{ sql, bindings }] = selects;
    // The fixture reads carry no ORDER BY, LIMIT or tenant wall: the WHERE runs to the end.
    return { where: sql.slice(sql.indexOf(' where ') + ' where '.length), bindings };
  };

  const find = async (where: Record<string, unknown>) =>
    ((await driver.find(TABLE, { where: where as any })) as Array<{ id: string }>).map((r) => r.id).sort();

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    knex = (driver as any).knex;
    await knex.schema.createTable(TABLE, (t: any) => {
      t.string('id').primary();
      t.string('tag');
    });
    await knex(TABLE).insert(Array.from({ length: ROWS }, (_, i) => ({ id: idOf(i), tag: tagOf(i) })));
    driver.registerObjectMetadata([{ name: TABLE, fields: { tag: { type: 'text' } } }]);
    knex.on('query', (q: { sql: string; bindings?: unknown[] }) => sent.push({ sql: q.sql, bindings: q.bindings ?? [] }));
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('the harness: a flat OR chain fits the budget at BUDGET levels and is refused one level deeper', async () => {
    // `x = ?` is two levels and each OR above it one more, so k terms are k + 1 deep.
    const chain = (k: number) => Array.from({ length: k }, () => '`tag` = ?').join(' or ');
    const values = (k: number) => Array.from({ length: k }, (_, i) => tagOf(i));
    await expect(prepareUnderBudget(chain(BUDGET - 1), values(BUDGET - 1))).resolves.toBeDefined();
    await expect(prepareUnderBudget(chain(BUDGET), values(BUDGET))).rejects.toThrow(TOO_DEEP);
  });

  it(`a group of at most ${FLAT_GROUP_MAX_MEMBERS} members compiles flat, as it always did`, async () => {
    const members = Array.from({ length: FLAT_GROUP_MAX_MEMBERS }, (_, i) => ({ tag: tagOf(i) }));
    const { where } = await compiledWhere(() => find({ $or: members }));
    expect(where).toBe(`(${members.map(() => '(`tag` = ?)').join(' or ')})`);
    expect(await find({ $or: members })).toEqual(members.map((_, i) => idOf(i)).sort());
  });

  for (const members of [FLAT_GROUP_MAX_MEMBERS + 1, 130, 1_200]) {
    it(`an $or of ${members} branches selects the same rows and fits the budget`, async () => {
      // Every third row, and a branch that matches nothing at the end.
      const picked = Array.from({ length: members - 1 }, (_, i) => (i * 3) % ROWS);
      const where = { $or: [...picked.map((i) => ({ tag: tagOf(i) })), { tag: 'no-such-tag' }] };
      expect(await find(where)).toEqual([...new Set(picked)].map(idOf).sort());
      const compiled = await compiledWhere(() => find(where));
      await expect(prepareUnderBudget(compiled.where, compiled.bindings)).resolves.toBeDefined();
    });
  }

  it('an $and of 130 members selects the same rows and fits the budget', async () => {
    // Each member excludes one row; the conjunction keeps the rest.
    const excluded = Array.from({ length: 130 }, (_, i) => i);
    const where = { $and: excluded.map((i) => ({ tag: { $ne: tagOf(i) } })) };
    expect(await find(where)).toEqual(
      Array.from({ length: ROWS }, (_, i) => i)
        .filter((i) => i >= 130)
        .map(idOf)
        .sort(),
    );
    const compiled = await compiledWhere(() => find(where));
    await expect(prepareUnderBudget(compiled.where, compiled.bindings)).resolves.toBeDefined();
  });

  it('a large $or nested in $and and $not keeps its answer', async () => {
    const branches = Array.from({ length: 60 }, (_, i) => ({ tag: tagOf(i) }));
    // NOT (any of the first 60) AND (one of rows 50..69): rows 60..69.
    const where = {
      $and: [{ $not: { $or: branches } }, { $or: Array.from({ length: 20 }, (_, i) => ({ tag: tagOf(50 + i) })) }],
    };
    expect(await find(where)).toEqual(Array.from({ length: 10 }, (_, i) => idOf(60 + i)).sort());
  });
});
