// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for the read-scope SQL lowering,
 * executed against a real SQL engine (in-memory better-sqlite3).
 *
 * The cases come from `@objectstack/spec/data` so this backend, `driver-sql`,
 * `driver-memory` and `formula`'s `matchesFilterCondition` are all held to one
 * standard — see `filter-logic-conformance.ts` for why that standard exists
 * (#3774).
 *
 * ## Why execute, when `read-scope-sql.test.ts` already asserts the SQL string
 *
 * The two answer different questions, and the difference is what each one's
 * correctness *depends on*:
 *
 * - A string assertion checks "does the compiler emit the text I wrote down?"
 *   Its ceiling is the author's own reading of SQL. Write the expected string
 *   with a missing pair of parentheses and the test locks the bug in, green.
 * - This file checks "does the compiler mean the same thing as the other three
 *   backends?" Its ceiling is the database. The expected values are row ids
 *   shared with `driver-sql`, `driver-memory` and `matchesFilterCondition`, so
 *   a divergence shows up as rows, not as a diff against a hand-written string.
 *
 * That matters most where this compiler is subtle: `compileNode` joins a node's
 * own clauses with `' AND '` and returns them **unparenthesized**, so a
 * multi-key node nested inside a `$or` emits `a = ? AND b = ? OR c = ?`. It is
 * correct — SQL binds `AND` tighter than `OR` — but correct by relying on
 * precedence rather than by construction. (Both suites do catch a deleted
 * paren; the string one only because its expectations happen to be written
 * correctly today.)
 *
 * The other half of the value is cheap coverage: a case added to the shared
 * table lands on all four backends at once, with no SQL to hand-write here.
 *
 * This is the compiler that lowers RLS read scopes for the analytics path, so
 * a widening bug here is an unauthorized read, not a wrong chart.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';

import { compileScopedFilterToSql } from '../read-scope-sql.js';

const ALIAS = 't';

describe('compileScopedFilterToSql — filter logic conformance', () => {
  let db: InstanceType<typeof Database>;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE "t" (
        "id" TEXT PRIMARY KEY,
        "a" TEXT, "b" TEXT, "c" TEXT,
        "owner" TEXT, "status" TEXT,
        "parent_object" TEXT, "parent_id" TEXT
      );
    `);
    const insert = db.prepare(
      `INSERT INTO "t" ("id","a","b","c","owner","status","parent_object","parent_id")
       VALUES (@id,@a,@b,@c,@owner,@status,@parent_object,@parent_id)`,
    );
    for (const row of FILTER_LOGIC_ROWS) insert.run(row);
  });

  afterAll(() => {
    db?.close();
  });

  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, () => {
      const { sql, params } = compileScopedFilterToSql(c.filter, ALIAS);
      // The compiler returns a boolean expression, exactly as the analytics
      // query builder splices it — including the unparenthesized top level.
      const rows = db
        .prepare(`SELECT "id" FROM "t" AS "${ALIAS}" WHERE ${sql} ORDER BY "id"`)
        .all(...(params as any[])) as Array<{ id: string }>;
      expect(rows.map((r) => r.id), c.note).toEqual(c.expected);
    });
  }
});
