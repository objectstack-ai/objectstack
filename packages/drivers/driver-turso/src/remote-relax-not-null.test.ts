// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33724 — `planRelaxedColumnDefinition`: the definition the Turso REMOTE face
 * sends after `ALTER TABLE t ALTER COLUMN c TO`, cut out of the table's stored
 * `CREATE TABLE` with only its NOT NULL clause removed (ruling 6915086281,
 * parameter 5: only nullability changes).
 *
 * The driver-level pins, over a real libSQL connection, are in
 * `turso-remote-migration-entries.test.ts`; these hold the planner to the
 * stored text shapes a hosted table can carry.
 */

import { describe, expect, it } from 'vitest';
import { planRelaxedColumnDefinition, type RelaxedColumnPlan } from './remote-relax-not-null.js';

const plan = (sql: string, column: string): RelaxedColumnPlan => {
  const out = planRelaxedColumnDefinition(sql, column);
  if ('refusal' in out) throw new Error(`expected a plan, got the refusal: ${out.refusal}`);
  return out;
};
const refusal = (sql: string, column: string): string => {
  const out = planRelaxedColumnDefinition(sql, column);
  if (!('refusal' in out)) throw new Error(`expected a refusal, got the plan: ${JSON.stringify(out)}`);
  return out.refusal;
};

describe('the relaxed definition keeps every byte but the NOT NULL clause', () => {
  it('the shape this face creates: type and NOT NULL', () => {
    const sql = 'CREATE TABLE "p" ("id" TEXT PRIMARY KEY, "price" REAL NOT NULL, "name" TEXT)';
    expect(plan(sql, 'price')).toEqual({
      definition: '"price" REAL NOT NULL',
      relaxed: '"price" REAL',
      expectedTableSql: 'CREATE TABLE "p" ("id" TEXT PRIMARY KEY, "price" REAL, "name" TEXT)',
    });
  });

  it('the DEFAULT, a parenthesised one included, and the clauses after it stay as written', () => {
    const sql = `CREATE TABLE p (id TEXT PRIMARY KEY, c datetime NOT NULL DEFAULT (strftime('%Y', 'now')) CHECK (c IS NOT NULL OR 1) COLLATE NOCASE)`;
    expect(plan(sql, 'c').relaxed).toBe(`c datetime DEFAULT (strftime('%Y', 'now')) CHECK (c IS NOT NULL OR 1) COLLATE NOCASE`);
  });

  it('a named constraint and its ON CONFLICT go with it; a lower-case spelling is found', () => {
    const sql = 'CREATE TABLE t (a TEXT CONSTRAINT nn_a not null on conflict ABORT UNIQUE, b TEXT)';
    expect(plan(sql, 'a').relaxed).toBe('a TEXT UNIQUE');
  });

  it('NOT DEFERRABLE and SET NULL in a REFERENCES clause are not the constraint', () => {
    const sql = 'CREATE TABLE t (a TEXT NOT NULL REFERENCES o(id) ON DELETE SET NULL NOT DEFERRABLE)';
    expect(plan(sql, 'a').relaxed).toBe('a TEXT REFERENCES o(id) ON DELETE SET NULL NOT DEFERRABLE');
  });

  it('the last column, a width with a comma, and a comment are handled by the lexer, not by commas', () => {
    const sql = 'CREATE TABLE t (id TEXT, /* note, here */ amount NUMERIC(10, 2) NOT NULL -- money, really\n)';
    const p = plan(sql, 'amount');
    expect(p.definition).toBe('amount NUMERIC(10, 2) NOT NULL');
    expect(p.relaxed).toBe('amount NUMERIC(10, 2)');
    expect(p.expectedTableSql).toBe('CREATE TABLE t (id TEXT, /* note, here */ amount NUMERIC(10, 2) -- money, really\n)');
  });

  it('every quoting SQLite accepts names the column, matched as SQLite matches names: without regard to case', () => {
    expect(plan('CREATE TABLE t ("we""ird" TEXT NOT NULL)', 'we"ird').relaxed).toBe('"we""ird" TEXT');
    expect(plan('CREATE TABLE t ([Mixed] TEXT NOT NULL)', 'mixed').relaxed).toBe('[Mixed] TEXT');
    expect(plan('CREATE TABLE t (`b` TEXT NOT NULL)', 'b').relaxed).toBe('`b` TEXT');
  });

  it('a table constraint is never taken for a column, and a string holding NOT NULL is not a clause', () => {
    const sql = `CREATE TABLE t (code TEXT NOT NULL DEFAULT 'NOT NULL', UNIQUE (code), CONSTRAINT pk PRIMARY KEY (code))`;
    expect(plan(sql, 'code').relaxed).toBe(`code TEXT DEFAULT 'NOT NULL'`);
  });
});

describe('a refusal names what the stored SQL lacks, and nothing is planned', () => {
  it('no NOT NULL clause at the definition\'s own depth', () => {
    expect(refusal('CREATE TABLE t (a TEXT CHECK (a IS NOT NULL))', 'a')).toMatch(/carries no NOT NULL clause/);
  });

  it('no such column, or the name twice', () => {
    expect(refusal('CREATE TABLE t (a TEXT NOT NULL)', 'b')).toMatch(/has 0 definitions of column "b"/);
    expect(refusal('CREATE TABLE t (a TEXT NOT NULL, "A" TEXT)', 'a')).toMatch(/has 2 definitions/);
  });

  it('an unterminated quote or an unbalanced list', () => {
    expect(refusal(`CREATE TABLE t (a TEXT NOT NULL DEFAULT 'x)`, 'a')).toMatch(/unterminated/);
    expect(refusal('CREATE TABLE t (a TEXT NOT NULL', 'a')).toMatch(/unbalanced/);
  });
});
