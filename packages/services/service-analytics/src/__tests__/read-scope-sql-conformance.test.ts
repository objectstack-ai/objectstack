// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for the read-scope SQL lowering,
 * executed against a real SQLite engine (`sql.js`, pure WASM).
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
 * ## Why `sql.js` and not `better-sqlite3`
 *
 * An earlier revision imported `better-sqlite3` here and killed the vitest
 * worker outright on CI — a process-level abort with no JS error to catch, so
 * the 17 cases silently did not run. The same symptom reproduces locally under
 * Node 20 (CI's version); `better-sqlite3@13` declares `engines: >=22`, and a
 * native binding is only loadable by the exact Node ABI it was built for.
 *
 * `driver-sql` can afford the native dependency because it *falls back* to WASM
 * SQLite when the binding fails to load (see the step-down warning in
 * `sql-driver.ts`). A test has no such fallback, so it uses the pure-WASM engine
 * directly — no ABI to match, no build step, identical behaviour on every Node
 * version. `sql.js` is the same engine that fallback lands on.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';

import { compileScopedFilterToSql } from '../read-scope-sql.js';

const ALIAS = 't';

/** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    const dir = dirname(pkgJsonPath);
    return (file: string) => join(dir, 'dist', file);
  } catch {
    return undefined;
  }
}

describe('compileScopedFilterToSql — filter logic conformance', () => {
  let db: any;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`
      CREATE TABLE "t" (
        "id" TEXT PRIMARY KEY,
        "a" TEXT, "b" TEXT, "c" TEXT,
        "owner" TEXT, "status" TEXT,
        "parent_object" TEXT, "parent_id" TEXT
      );
    `);
    const insert = db.prepare(
      `INSERT INTO "t" ("id","a","b","c","owner","status","parent_object","parent_id")
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    for (const r of FILTER_LOGIC_ROWS) {
      insert.run([r.id, r.a, r.b, r.c, r.owner, r.status, r.parent_object, r.parent_id]);
    }
    insert.free();
  });

  afterAll(() => {
    db?.close();
  });

  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, () => {
      const { sql, params } = compileScopedFilterToSql(c.filter, ALIAS);
      // The compiler returns a boolean expression, exactly as the analytics
      // query builder splices it — including the unparenthesized top level.
      // `''` is the compiler's TRUE (#5322: `{$and: []}` and an absorbed `$or`
      // compile to it), the shape for which `applyReadScope` adds no `WHERE`
      // at all — so it executes here as the unconstrained query it stands for.
      const stmt = db.prepare(
        `SELECT "id" FROM "t" AS "${ALIAS}" WHERE ${sql.length > 0 ? sql : '1 = 1'} ORDER BY "id"`,
      );
      stmt.bind(params as any[]);
      const got: string[] = [];
      while (stmt.step()) got.push(String(stmt.get()[0]));
      stmt.free();
      expect(got, c.note).toEqual(c.expected);
    });
  }
});
