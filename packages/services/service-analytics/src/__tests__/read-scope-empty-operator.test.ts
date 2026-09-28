// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20445] The read-scope face answers `$empty` by the field's DECLARED type.
 *
 * Ruling A on #20399 gives each compile surface an arm for the operator, and
 * the spec gives every arm one expansion, `expandEmptyOperator(fieldDef)`: the
 * ruled per-type 「is empty」 table (#20311). Text-like: null or `''`.
 * Multi-value: null or `[]`. Every other type: null only. `$empty: false` is
 * the complement.
 *
 * Executed on real SQLite (`sql.js`, the engine `driver-sql` falls back to),
 * over one row per stored state a field can be in: null, `''`, the empty JSON
 * list, a non-list JSON value and a real value. Two fields per scalar row kind
 * — a `select` and a `number` — because the negative pin is the `select`: its
 * column can hold `''`, and `''` is a VALUE on the null-only row.
 *
 * The compiled SQL is pinned only for the two dialects `sql.js` cannot run
 * (Postgres, MySQL): what those strings DO is not measured here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FilterCondition, ValueShapeFieldDef } from '@objectstack/spec/data';

import { compileScopedFilterToSql, type ReadScopeCompileOptions } from '../read-scope-sql.js';

const ALIAS = 't';

/** The declared shape of each fixture column: one per row of the ruled table, plus a second null-only type. */
const SHAPES: Record<string, ValueShapeFieldDef> = {
  id: { type: 'text' },
  name: { type: 'text' },
  tags: { type: 'tags' },
  owners: { type: 'lookup', multiple: true },
  stage: { type: 'select' },
  amount: { type: 'number' },
};

/**
 * One row per stored state. The multi-value columns hold JSON text, as
 * `driver-sql` stores them on SQLite.
 *
 * - `n` — no value anywhere.
 * - `s` — the empty string in every column (a malformed JSON list on the
 *   multi-value columns, `''` on the `select`, and `0` on the number).
 * - `l` — the empty JSON list `[]` (as TEXT on `name` and `stage`, where it is
 *   two characters, not a list).
 * - `o` — a JSON value that is not a list (`{}`, a JSON string).
 * - `v` — a real value in every column.
 */
const ROWS = [
  { id: 'n', name: null, tags: null, owners: null, stage: null, amount: null },
  { id: 's', name: '', tags: '', owners: '', stage: '', amount: 0 },
  { id: 'l', name: '[]', tags: '[]', owners: '[]', stage: '[]', amount: 7 },
  { id: 'o', name: 'o', tags: '{}', owners: '"u1"', stage: 'lost', amount: -1 },
  { id: 'v', name: 'acme', tags: '["a"]', owners: '["u1","u2"]', stage: 'won', amount: 5 },
];
const ALL = ROWS.map((r) => r.id).sort();

const complement = (ids: string[]): string[] => ALL.filter((id) => !ids.includes(id));

/** `$empty: true` per field, by the declared row. */
const EMPTY: Record<string, string[]> = {
  name: ['n', 's'], // text-like: null or ''
  tags: ['l', 'n'], // multi-value: null or []
  owners: ['l', 'n'], // multi-value through `multiple: true`
  stage: ['n'], // null only — '' is a value on this row
  amount: ['n'], // null only — 0 is a value
};

const SQLITE: ReadScopeCompileOptions = { dialect: 'sqlite', declaredValueShape: (field) => SHAPES[field] };

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

interface CodedError extends Error {
  code?: unknown;
  status?: unknown;
}

function refusalOf(fn: () => unknown): CodedError {
  try {
    fn();
  } catch (e) {
    return e as CodedError;
  }
  throw new Error('expected a refusal, and the scope compiled');
}

describe('[#20445] compileScopedFilterToSql — `$empty` by the declared type, executed on SQLite', () => {
  let db: any;

  const run = (scope: FilterCondition, options: ReadScopeCompileOptions = SQLITE): string[] => {
    const { sql, params } = compileScopedFilterToSql(scope, ALIAS, options);
    const stmt = db.prepare(`SELECT "id" FROM "t" AS "${ALIAS}" WHERE ${sql.length > 0 ? sql : '1 = 1'} ORDER BY "id"`);
    stmt.bind(params as any[]);
    const got: string[] = [];
    while (stmt.step()) got.push(String(stmt.get()[0]));
    stmt.free();
    return got;
  };

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
    db = new SQL.Database();
    db.run(`CREATE TABLE "t" ("id" TEXT PRIMARY KEY, "name" TEXT, "tags" TEXT, "owners" TEXT, "stage" TEXT, "amount" REAL);`);
    const insert = db.prepare(`INSERT INTO "t" ("id","name","tags","owners","stage","amount") VALUES (?,?,?,?,?,?)`);
    for (const r of ROWS) insert.run([r.id, r.name, r.tags, r.owners, r.stage, r.amount]);
    insert.free();
  });

  afterAll(() => {
    db?.close();
  });

  for (const [field, expected] of Object.entries(EMPTY)) {
    it(`${field} (${SHAPES[field].type}${SHAPES[field].multiple ? ', multiple' : ''}): $empty: true → ${expected.join(',')}`, () => {
      expect(run({ [field]: { $empty: true } })).toEqual(expected);
    });
    it(`${field}: $empty: false is the exact complement`, () => {
      expect(run({ [field]: { $empty: false } })).toEqual(complement(expected));
    });
  }

  it('the null-only row does NOT count the empty string: a select holding "" is not empty', () => {
    expect(run({ stage: { $empty: true } })).not.toContain('s');
    expect(run({ stage: { $empty: false } })).toContain('s');
  });

  it('a text column holding the two characters "[]" is a value, not an empty list', () => {
    expect(run({ name: { $empty: true } })).not.toContain('l');
  });

  it('on a multi-value column, "" and a non-list JSON value are values, not the empty list', () => {
    expect(run({ tags: { $empty: true } })).not.toContain('s');
    expect(run({ tags: { $empty: true } })).not.toContain('o');
    expect(run({ owners: { $empty: true } })).not.toContain('o');
  });

  describe('nested under $and / $or / $not', () => {
    it('$not over $empty: true is its complement — no NULL guard needed, the arm is total', () => {
      expect(run({ $not: { name: { $empty: true } } })).toEqual(complement(EMPTY.name));
      expect(run({ $not: { tags: { $empty: true } } })).toEqual(complement(EMPTY.tags));
      expect(run({ $not: { amount: { $empty: false } } })).toEqual(EMPTY.amount);
    });

    it('$and of two $empty: false', () => {
      expect(run({ $and: [{ tags: { $empty: false } }, { name: { $empty: false } }] })).toEqual(['o', 'v']);
    });

    it('$or of two $empty: true', () => {
      expect(run({ $or: [{ stage: { $empty: true } }, { tags: { $empty: true } }] })).toEqual(['l', 'n']);
    });

    it('$not over an $or of $empty', () => {
      expect(run({ $not: { $or: [{ name: { $empty: true } }, { owners: { $empty: true } }] } })).toEqual(['o', 'v']);
    });

    it('beside another operator on the same field', () => {
      expect(run({ name: { $empty: false, $ne: 'acme' } })).toEqual(['l', 'o']);
      expect(run({ $not: { name: { $empty: false, $ne: 'acme' } } })).toEqual(['n', 's', 'v']);
    });
  });
});

describe('[#20445] the SQL each dialect is handed (Postgres / MySQL: compiled, not executed here)', () => {
  const sqlOf = (dialect: string, scope: FilterCondition) =>
    compileScopedFilterToSql(scope, ALIAS, { dialect, declaredValueShape: (field) => SHAPES[field] });

  it('text-like and null-only rows are dialect-free, and bind the empty string', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql', 'unknown']) {
      expect(sqlOf(dialect, { name: { $empty: true } })).toEqual({ sql: '("t"."name" IS NULL OR "t"."name" = ?)', params: [''] });
      expect(sqlOf(dialect, { name: { $empty: false } })).toEqual({ sql: '("t"."name" IS NOT NULL AND "t"."name" <> ?)', params: [''] });
      expect(sqlOf(dialect, { stage: { $empty: true } })).toEqual({ sql: '"t"."stage" IS NULL', params: [] });
      expect(sqlOf(dialect, { stage: { $empty: false } })).toEqual({ sql: '"t"."stage" IS NOT NULL', params: [] });
    }
  });

  it('Postgres compares the JSON column as jsonb', () => {
    expect(sqlOf('postgres', { tags: { $empty: true } }).sql).toBe(
      `("t"."tags" IS NULL OR (CAST("t"."tags" AS jsonb) = CAST('[]' AS jsonb)))`,
    );
    expect(sqlOf('postgres', { tags: { $empty: false } }).sql).toBe(
      `("t"."tags" IS NOT NULL AND NOT (CAST("t"."tags" AS jsonb) = CAST('[]' AS jsonb)))`,
    );
  });

  it('MySQL asks the JSON type beside the length', () => {
    expect(sqlOf('mysql', { owners: { $empty: true } }).sql).toBe(
      `("t"."owners" IS NULL OR (JSON_TYPE("t"."owners") = 'ARRAY' AND JSON_LENGTH("t"."owners") = 0))`,
    );
  });
});

describe('[#20445] refusals — READ_SCOPE_COMPILE_FAILED / 500, the module’s one envelope', () => {
  const expectServerFault = (err: CodedError) => {
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.status).toBe(500);
  };

  it('no declared value shape wired: refused, never guessed', () => {
    const err = refusalOf(() => compileScopedFilterToSql({ name: { $empty: true } }, ALIAS, { dialect: 'sqlite' }));
    expectServerFault(err);
    expect(err.message).toContain('needs the field\'s declared type');
  });

  it('a field the host cannot name: refused', () => {
    expectServerFault(refusalOf(() => compileScopedFilterToSql({ ghost: { $empty: false } }, ALIAS, SQLITE)));
  });

  it('a multi-value field on the unknown dialect: refused; the other rows still compile there', () => {
    const options: ReadScopeCompileOptions = { declaredValueShape: (field) => SHAPES[field] };
    const err = refusalOf(() => compileScopedFilterToSql({ owners: { $empty: true } }, ALIAS, options));
    expectServerFault(err);
    expect(err.message).toContain('dialect of this datasource is not known');
    expect(() => compileScopedFilterToSql({ name: { $empty: true }, amount: { $empty: false } }, ALIAS, options)).not.toThrow();
  });

  for (const flag of ['true', 'false', 1, null, [true]]) {
    it(`a non-boolean flag (${JSON.stringify(flag)}) is refused by the boolean-domain gate`, () => {
      const err = refusalOf(() => compileScopedFilterToSql({ name: { $empty: flag } } as FilterCondition, ALIAS, SQLITE));
      expectServerFault(err);
      expect(err.message).toContain('comparand for "$empty" at "name".$empty is not a boolean');
    });
  }

  it('under $not, a non-boolean flag is still refused', () => {
    expectServerFault(refusalOf(() => compileScopedFilterToSql({ $not: { name: { $empty: 'false' } } } as FilterCondition, ALIAS, SQLITE)));
  });

  it('an operator without an arm keeps READ_SCOPE_COMPILE_FAILED / 500, not the where door’s 400 (#5367 stands)', () => {
    const err = refusalOf(() => compileScopedFilterToSql({ name: { $bogus: 1 } } as FilterCondition, ALIAS, SQLITE));
    expectServerFault(err);
    expect(err.code).not.toBe('INVALID_FILTER');
  });
});
