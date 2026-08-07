// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every authorable filter operator reaches the query — the closure of #4128.
 *
 * `normalizeAnalyticsFilters` maps the spec's `FilterCondition` vocabulary onto
 * the internal pipeline form. Whatever it fails to map used to be `continue`d,
 * and that is not "unsupported": the predicate DISAPPEARS, the compiled SQL
 * stays valid, and the query returns rows the author excluded. It reads as a
 * chart drawn over the whole dataset (#3650's symptom) and is invisible to a
 * test that asserts the emitted SQL string — which is what every other suite
 * for these strategies does, and why four operators sat broken behind one that
 * had already been found (`$between`, ADR-0053 D-A3.1).
 *
 * So this file asserts ROW IDS, against a real SQLite (`sql.js`, the pure-WASM
 * engine `driver-sql` itself falls back to — see the note in
 * `read-scope-sql-conformance.test.ts` for why not `better-sqlite3`). A dropped
 * predicate cannot hide from it: the row set is simply wrong.
 *
 * The table below is the whole authorable vocabulary of `filter.zod.ts`, so a
 * new operator added to the spec without a home in the pipeline fails here
 * rather than silently widening a customer's dashboard.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, FilterCondition } from '@objectstack/spec/data';
import type { StrategyContext } from '@objectstack/spec/contracts';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';

interface Row {
  id: string;
  name: string | null;
  score: number;
}

/** `n_null` carries a NULL name — the row the null predicates turn on. */
const ROWS: Row[] = [
  { id: 'a_alpha', name: 'alpha-one', score: 10 },
  { id: 'b_alphex', name: 'alphex-two', score: 20 },
  { id: 'c_beta', name: 'beta-one', score: 30 },
  { id: 'd_null', name: null, score: 40 },
];

const CUBE: Cube = {
  name: 'ops',
  title: 'Ops',
  sql: 'ops',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
    score: { name: 'score', label: 'Score', type: 'number', sql: 'score' },
  },
  public: false,
} as unknown as Cube;

/**
 * One case per operator in `filter.zod.ts`'s authorable vocabulary.
 * `expected` is the row ids the filter MUST return — the full row set means
 * the predicate went missing.
 */
const CASES: Array<{ op: string; filter: FilterCondition; expected: string[]; note?: string }> = [
  { op: '$eq', filter: { name: { $eq: 'alpha-one' } }, expected: ['a_alpha'] },
  {
    op: '$ne',
    filter: { name: { $ne: 'alpha-one' } },
    expected: ['b_alphex', 'c_beta', 'd_null'],
    note: '#5298: `d_null` has no `name`, and "has no value" satisfies "is not alpha-one" on every backend. It was excluded while this path emitted a bare `name != ?`, which SQL evaluates UNKNOWN for NULL.',
  },
  { op: '$gt', filter: { score: { $gt: 20 } }, expected: ['c_beta', 'd_null'] },
  { op: '$gte', filter: { score: { $gte: 20 } }, expected: ['b_alphex', 'c_beta', 'd_null'] },
  { op: '$lt', filter: { score: { $lt: 20 } }, expected: ['a_alpha'] },
  { op: '$lte', filter: { score: { $lte: 20 } }, expected: ['a_alpha', 'b_alphex'] },
  { op: '$in', filter: { name: { $in: ['alpha-one', 'beta-one'] } }, expected: ['a_alpha', 'c_beta'] },
  {
    op: '$nin',
    filter: { name: { $nin: ['alpha-one'] } },
    expected: ['b_alphex', 'c_beta', 'd_null'],
    note: '#5298: same ruling as `$ne` — `NOT IN` is UNKNOWN for a NULL column, so `d_null` used to fall out of a set it is not a member of.',
  },
  { op: '$between', filter: { score: { $between: [20, 30] } }, expected: ['b_alphex', 'c_beta'], note: '#4128: was dropped → every row.' },
  { op: '$contains', filter: { name: { $contains: 'one' } }, expected: ['a_alpha', 'c_beta'] },
  {
    op: '$notContains',
    filter: { name: { $notContains: 'one' } },
    expected: ['b_alphex', 'd_null'],
    note: 'On the ObjectQL path this had no arm and fell to the default, compiling "does not contain" as an EQUALITY. #5298 added `d_null`: `NOT LIKE` is UNKNOWN for a NULL column, so a row with no `name` was dropped from "name does not contain one".',
  },
  {
    op: '$startsWith',
    filter: { name: { $startsWith: 'alpha' } },
    expected: ['a_alpha'],
    note: '#4128: was dropped → every row. b_alphex proves the anchor is a prefix, not a substring.',
  },
  {
    op: '$endsWith',
    filter: { name: { $endsWith: '-one' } },
    expected: ['a_alpha', 'c_beta'],
    note: '#4128: was dropped → every row.',
  },
  {
    op: '$null: true',
    filter: { name: { $null: true } },
    expected: ['d_null'],
    note: '#4128: was dropped → every row. This is the shape the console emits for an "is empty" filter.',
  },
  { op: '$null: false', filter: { name: { $null: false } }, expected: ['a_alpha', 'b_alphex', 'c_beta'] },
  { op: '$exists: true', filter: { name: { $exists: true } }, expected: ['a_alpha', 'b_alphex', 'c_beta'] },
  {
    op: '$exists: false',
    filter: { name: { $exists: false } },
    expected: ['d_null'],
    note: 'Was mapped value-INDEPENDENTLY to `set`, so it compiled to IS NOT NULL — the exact inverse of what it asks.',
  },
  { op: 'implicit equality', filter: { name: 'beta-one' }, expected: ['c_beta'] },
  { op: 'bare null', filter: { name: null }, expected: ['d_null'] },
  {
    op: '$and',
    filter: { $and: [{ score: { $gte: 20 } }, { name: { $contains: 'one' } }] },
    expected: ['c_beta'],
  },
];

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

describe('analytics filters — every authorable operator reaches the query (#4128)', () => {
  let db: any;
  let ctx: StrategyContext;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`CREATE TABLE "ops" ("id" TEXT PRIMARY KEY, "name" TEXT, "score" INTEGER);`);
    const insert = db.prepare(`INSERT INTO "ops" ("id","name","score") VALUES (?,?,?)`);
    for (const r of ROWS) insert.run([r.id, r.name, r.score]);
    insert.free();

    ctx = {
      getCube: (name: string) => (name === 'ops' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
        const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
      },
    } as StrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  for (const c of CASES) {
    it(`${c.op} narrows to the rows it names`, async () => {
      const result = await new NativeSQLStrategy().execute(
        { cube: 'ops', measures: ['total'], dimensions: ['id'], where: c.filter } as AnalyticsQuery,
        ctx,
      );
      const got = result.rows.map((r) => String(r.id)).sort();
      expect(got, c.note).toEqual(c.expected);
      // Belt and braces: a predicate that silently vanished returns the whole
      // fixture, which is the one wrong answer that looks like a working query.
      expect(got.length, `${c.op} matched every row — the predicate was dropped`).toBeLessThan(ROWS.length);
    });
  }

  it('an operator outside the vocabulary throws instead of widening the query', () => {
    // The failure mode this whole file exists to prevent: silently returning
    // rows the filter excludes. A typo'd or non-spec operator is a caller
    // error, and a loud one — the same call driver-memory made in #3948.
    expect(() =>
      normalizeAnalyticsFilterTree({ where: { name: { $sortOf: 'alpha' } } }),
    ).toThrow(/Unsupported filter operator "\$sortOf"/);
  });

  it('a malformed $between throws rather than binding a half-open guess', () => {
    expect(() => normalizeAnalyticsFilterTree({ where: { score: { $between: [10] } } })).toThrow(
      /two-element/,
    );
  });
});
