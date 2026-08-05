// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5334] The analytics door for a `where` written as a `FilterArray`.
 *
 * `FilterArray` (`['stage', '=', 'won']`, `['and', […], […]]`, `[[…], […]]`) is
 * INPUT-ONLY authoring sugar (#5285); `where` is a `FilterCondition`. #5158's
 * ruling C says every door LOWERS the sugar through the one `parseFilterAST`
 * sink, and #5329 did that for ObjectQL's six entry points while deleting the
 * four drivers' private array dialects.
 *
 * Analytics compiles `where` ITSELF — to SQL (`NativeSQLStrategy`) or to a
 * `FilterCondition` for the engine (`ObjectQLStrategy`) — so no upstream door
 * lowers for it, and `normalizeAnalyticsFilterTree` answered an array with
 * `return null`: the whole `where` vanished and the chart was drawn over the
 * ENTIRE dataset. This file pins the three arrivals the engine door gives,
 * as ROW RESULTS on a real SQLite (`sql.js`) rather than as SQL strings — a
 * dropped predicate leaves the SQL perfectly valid, which is exactly why the
 * defect survived every string assertion in this package.
 *
 * ## The issue's own repro, and why it lands in the refusal arm
 *
 * #5334's body reproduces the drop with `where: [{ stage: 'won' }]`. That
 * literal is NOT a `FilterArray`: `FilterArraySchema`'s list arm is
 * `z.array(FilterArraySchema).min(1)`, so a list's elements must themselves be
 * filter ARRAYS — `isFilterAST([{stage:'won'}])` is `false` and
 * `parseFilterAST` returns `undefined` for it. It is therefore "some other
 * non-empty array" and takes the third answer (loud refusal), the same answer
 * `engine.find('deal', {where: [{stage:'won'}]})` has given since #5329. The
 * lowerable spelling of the same intent is `[['stage','=','won']]`, pinned
 * below with the WHERE clause and the bound value the issue asked for.
 *
 * ## Why `sql.js` and not `better-sqlite3`
 *
 * Same reason as its neighbours (`native-sql-filter-logic-conformance`): the
 * native binding is loadable only by the exact Node ABI it was built for and
 * aborts the vitest worker on CI's Node, taking the file's cases silently with
 * it. `sql.js` is the pure-WASM engine `driver-sql` itself falls back to.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';

/** The fixture, shared by the SQL path (as a table) and the engine path (as rows). */
interface DealRow {
  id: string;
  stage: string;
  owner: string;
  amount: number;
  closed_at: string | null;
}

const DEALS: DealRow[] = [
  { id: 'd1', stage: 'won', owner: 'u1', amount: 10, closed_at: '2026-01-01' },
  { id: 'd2', stage: 'won', owner: 'u2', amount: 20, closed_at: null },
  { id: 'd3', stage: 'lost', owner: 'u1', amount: 30, closed_at: '2026-02-01' },
  { id: 'd4', stage: 'open', owner: 'u1', amount: 40, closed_at: null },
];

const CUBE: Cube = {
  name: 'deals',
  title: 'Deals',
  sql: 'deal',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: Object.fromEntries(
    ['id', 'stage', 'owner', 'amount', 'closed_at'].map((n) => [
      n,
      { name: n, label: n, type: n === 'amount' ? 'number' : 'string', sql: n },
    ]),
  ),
  public: false,
} as unknown as Cube;

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

/** The refused-filter envelope every sibling filter refusal speaks (ADR-0112). */
interface FilterRefusal extends Error {
  code?: string;
  status?: number;
}

/** Run `fn`, requiring it to REFUSE — returns the error so its envelope can be read. */
async function refusalOf(fn: () => Promise<unknown>): Promise<FilterRefusal> {
  try {
    await fn();
  } catch (e) {
    return e as FilterRefusal;
  }
  throw new Error('expected the filter to be refused, but the query ran');
}

/**
 * The equivalence table: one intent, spelled as the canonical `FilterCondition`
 * object and as the `FilterArray` sugar, with the rows it must select.
 *
 * "FilterArray is authoring sugar" is a claim about ROWS — the two spellings
 * must select the same records, not merely both run — so every case carries an
 * explicit expectation as well. A table that only compared the two spellings
 * would pass just as happily if both returned the whole fixture, which is the
 * defect itself.
 */
const EQUIVALENT_SPELLINGS: Array<{
  name: string;
  object: FilterCondition;
  array: unknown[];
  expected: string[];
  /** Ids expected once the `owner = 'u1'` read scope is ANDed in. */
  scoped: string[];
}> = [
  {
    name: 'equality — the issue\'s own filter, in its lowerable spelling',
    object: { stage: 'won' },
    array: [['stage', '=', 'won']],
    expected: ['d1', 'd2'],
    scoped: ['d1'],
  },
  {
    name: 'a bare comparison node, not wrapped in a list',
    object: { stage: 'won' },
    array: ['stage', '=', 'won'],
    expected: ['d1', 'd2'],
    scoped: ['d1'],
  },
  {
    name: 'inequality',
    object: { stage: { $ne: 'won' } },
    array: ['stage', '!=', 'won'],
    expected: ['d3', 'd4'],
    scoped: ['d3', 'd4'],
  },
  {
    name: 'ordered comparison',
    object: { amount: { $gt: 15 } },
    array: ['amount', '>', 15],
    expected: ['d2', 'd3', 'd4'],
    scoped: ['d3', 'd4'],
  },
  {
    name: 'prefix AND group',
    object: { $and: [{ stage: 'won' }, { owner: 'u1' }] },
    array: ['and', ['stage', '=', 'won'], ['owner', '=', 'u1']],
    expected: ['d1'],
    scoped: ['d1'],
  },
  {
    name: 'prefix OR group — the disjunction a flat array could never carry',
    object: { $or: [{ stage: 'won' }, { stage: 'lost' }] },
    array: ['or', ['stage', '=', 'won'], ['stage', '=', 'lost']],
    expected: ['d1', 'd2', 'd3'],
    scoped: ['d1', 'd3'],
  },
  {
    name: 'legacy flat list — implicit AND',
    object: { $and: [{ stage: 'won' }, { owner: 'u2' }] },
    array: [['stage', '=', 'won'], ['owner', '=', 'u2']],
    expected: ['d2'],
    scoped: [],
  },
  {
    name: 'set membership',
    object: { stage: { $in: ['won', 'lost'] } },
    array: ['stage', 'in', ['won', 'lost']],
    expected: ['d1', 'd2', 'd3'],
    scoped: ['d1', 'd3'],
  },
  {
    name: 'null predicate — two-element node, direction from the operator name',
    object: { closed_at: { $null: true } },
    array: ['closed_at', 'is_null'],
    expected: ['d2', 'd4'],
    scoped: ['d4'],
  },
  {
    name: 'not-null predicate',
    object: { closed_at: { $null: false } },
    array: ['closed_at', 'is_not_null'],
    expected: ['d1', 'd3'],
    scoped: ['d1', 'd3'],
  },
  {
    // #5325 crossing: the lowered `{$in: []}` is the boolean CONSTANT FALSE,
    // not an absent predicate. Were the lowering to land in the pre-#5325 tree
    // it would have emitted no clause at all and charted every row.
    name: 'empty set membership — the boolean constant FALSE, not "no filter"',
    object: { stage: { $in: [] } },
    array: ['stage', 'in', []],
    expected: [],
    scoped: [],
  },
  {
    name: 'range — `between` lowers to its two bounds on both spellings',
    object: { amount: { $between: [15, 35] } },
    array: ['amount', 'between', [15, 35]],
    expected: ['d2', 'd3'],
    scoped: ['d3'],
  },
  {
    name: 'nested group — OR of an AND',
    object: {
      $or: [{ $and: [{ stage: 'won' }, { owner: 'u1' }] }, { stage: 'lost' }],
    },
    array: ['or', ['and', ['stage', '=', 'won'], ['owner', '=', 'u1']], ['stage', '=', 'lost']],
    expected: ['d1', 'd3'],
    scoped: ['d1', 'd3'],
  },
];

/** The arrays that CANNOT be lowered — every one of them silently vanished before. */
const UNLOWERABLE: Array<{ name: string; where: unknown[]; matches: RegExp }> = [
  {
    // #5334's own repro literal. A list's elements must be filter ARRAYS.
    name: 'a list of FilterCondition OBJECTS — the shape #5334 reproduced with',
    where: [{ stage: 'won' }],
    matches: /is not a filter/,
  },
  {
    // The dialect four drivers used to compile and no schema ever declared.
    name: 'the INFIX join form',
    where: [['stage', '=', 'won'], 'or', ['stage', '=', 'lost']],
    matches: /Infix joins .* NOT one of the shapes/s,
  },
  {
    name: 'a comparison whose operator is outside the AST vocabulary',
    where: ['stage', 'sounds_like', 'won'],
    matches: /is not a filter/,
  },
  {
    name: 'a logical node with nothing to join',
    where: ['and'],
    matches: /is not a filter/,
  },
  {
    name: 'elements that are neither keyword nor condition',
    where: [42],
    matches: /is not a filter/,
  },
];

// ── The raw-SQL door ─────────────────────────────────────────────────────────

describe('[#5334] NativeSQLStrategy — a `where` FilterArray is lowered, not dropped', () => {
  let db: any;
  let ctx: StrategyContext;
  let scopedCtx: StrategyContext;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`
      CREATE TABLE "deal" (
        "id" TEXT PRIMARY KEY,
        "stage" TEXT,
        "owner" TEXT,
        "amount" INTEGER,
        "closed_at" TEXT
      );
    `);
    const insert = db.prepare(
      `INSERT INTO "deal" ("id","stage","owner","amount","closed_at") VALUES (?,?,?,?,?)`,
    );
    for (const r of DEALS) insert.run([r.id, r.stage, r.owner, r.amount, r.closed_at]);
    insert.free();

    const base = {
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      // The strategy binds `$1`-style placeholders in ascending order, each
      // pushed immediately before it is referenced, so a positional rewrite to
      // SQLite's `?` preserves the pairing.
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
        const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
      },
    };
    ctx = base as StrategyContext;
    // ADR-0021 D-C read scope — the authorisation surface. Lowering happens
    // BEFORE the scope is ANDed in, so the scope must apply identically to both
    // spellings; a door that lowered after (or instead of) scoping would show up
    // here as a row the scope excludes.
    scopedCtx = { ...base, getReadScope: () => ({ owner: 'u1' }) } as StrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  const idsOf = (rows: Record<string, unknown>[]): string[] =>
    rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));

  const run = async (where: unknown, c: StrategyContext = ctx): Promise<string[]> =>
    idsOf(
      (
        await new NativeSQLStrategy().execute(
          { cube: 'deals', measures: ['total'], dimensions: ['id'], where } as AnalyticsQuery,
          c,
        )
      ).rows,
    );

  // ── the issue's acceptance criterion, at the `generateSql` layer ──────────

  it('emits a bound WHERE for the lowerable spelling of #5334\'s filter', async () => {
    const { sql, params } = await new NativeSQLStrategy().generateSql(
      {
        cube: 'deals',
        measures: ['total'],
        dimensions: ['id'],
        where: [['stage', '=', 'won']],
      } as AnalyticsQuery,
      ctx,
    );
    // Before #5334 this statement had NO `WHERE` at all and `params` was empty —
    // the filter was gone and the chart covered the whole table.
    expect(sql).toMatch(/WHERE/);
    expect(sql).toMatch(/stage/);
    expect(params).toEqual(['won']);
    expect(await run([['stage', '=', 'won']])).toEqual(['d1', 'd2']);
  });

  // ── arrival 1: `[]` is "no filter", not a failed filter ───────────────────

  it('`[]` charts every row, with no WHERE and no error', async () => {
    const { sql, params } = await new NativeSQLStrategy().generateSql(
      { cube: 'deals', measures: ['total'], dimensions: ['id'], where: [] } as AnalyticsQuery,
      ctx,
    );
    expect(sql).not.toMatch(/WHERE/);
    expect(params).toEqual([]);
    expect(await run([])).toEqual(['d1', 'd2', 'd3', 'd4']);
  });

  // ── arrival 2: lowered — the two spellings select the SAME rows ───────────

  for (const c of EQUIVALENT_SPELLINGS) {
    it(`lowers: ${c.name}`, async () => {
      const fromObject = await run(c.object);
      const fromArray = await run(c.array);
      expect(fromObject, 'the canonical object spelling').toEqual(c.expected);
      expect(fromArray, 'the FilterArray spelling').toEqual(c.expected);
      expect(fromArray, 'sugar means the same rows').toEqual(fromObject);
    });

    it(`lowers under the read scope: ${c.name}`, async () => {
      const fromObject = await run(c.object, scopedCtx);
      const fromArray = await run(c.array, scopedCtx);
      expect(fromObject, 'object spelling, scoped').toEqual(c.scoped);
      expect(fromArray, 'array spelling, scoped').toEqual(c.scoped);
      expect(fromArray, 'the scope applies to both spellings alike').toEqual(fromObject);
    });
  }

  // ── arrival 3: refused, loudly, in the ADR-0112 envelope ──────────────────

  for (const c of UNLOWERABLE) {
    it(`refuses: ${c.name}`, async () => {
      const err = await refusalOf(() => run(c.where));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toMatch(c.matches);
      // The refusal must name what the alternative would have been — a filter
      // that does not run must not read as a filter that matched everything.
      expect(err.message).toMatch(/UNFILTERED/);
    });
  }

  it('a refused filter runs NOTHING — no SQL reaches the driver', async () => {
    const seen: string[] = [];
    const spy = {
      ...ctx,
      executeRawSql: async (o: string, sql: string, p: unknown[]) => {
        seen.push(sql);
        return ctx.executeRawSql!(o, sql, p);
      },
    } as StrategyContext;
    await refusalOf(() => run([{ stage: 'won' }], spy));
    expect(seen).toEqual([]);
  });

  it('the caller\'s own array is never mutated', async () => {
    const where = [['stage', '=', 'won']];
    await run(where);
    expect(where).toEqual([['stage', '=', 'won']]);
  });
});

// ── The engine door ──────────────────────────────────────────────────────────

/**
 * A small stand-in for `engine.aggregate` over {@link DEALS}.
 *
 * It implements only the `FilterCondition` vocabulary these cases produce, and
 * it exists to answer "does the LOWERED condition select the right records",
 * not to be a second engine. The stronger assertion in each case is the
 * structural one — the condition handed to the engine for the array spelling is
 * the SAME condition the object spelling produces.
 */
function matches(row: DealRow, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object') return false;
  return Object.entries(cond as Record<string, unknown>).every(([key, val]) => {
    if (key === '$and') return (val as unknown[]).every((c) => matches(row, c));
    if (key === '$or') return (val as unknown[]).some((c) => matches(row, c));
    if (key === '$not') return !matches(row, val);
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (val === null) return actual === null || actual === undefined;
    if (val === undefined) return true;
    if (typeof val !== 'object') return actual === val;
    return Object.entries(val as Record<string, unknown>).every(([op, operand]) => {
      switch (op) {
        case '$eq': return actual === operand;
        case '$ne': return actual !== operand;
        case '$gt': return (actual as number) > (operand as number);
        case '$gte': return (actual as number) >= (operand as number);
        case '$lt': return (actual as number) < (operand as number);
        case '$lte': return (actual as number) <= (operand as number);
        case '$in': return (operand as unknown[]).includes(actual);
        case '$nin': return !(operand as unknown[]).includes(actual);
        case '$null':
          return operand === true
            ? actual === null || actual === undefined
            : actual !== null && actual !== undefined;
        default:
          throw new Error(`fixture engine cannot evaluate operator ${op}`);
      }
    });
  });
}

describe('[#5334] ObjectQLStrategy — the lowered FilterCondition reaches the engine', () => {
  const captured: Array<Record<string, unknown> | undefined> = [];

  const ctx = {
    getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (
      _object: string,
      options: { groupBy?: string[]; filter?: Record<string, unknown> },
    ) => {
      captured.push(options.filter);
      return DEALS.filter((r) => matches(r, options.filter ?? {})).map((r) => ({
        id: r.id,
        total: 1,
      }));
    },
  } as unknown as StrategyContext;

  const run = async (where: unknown): Promise<{ ids: string[]; filter: unknown }> => {
    captured.length = 0;
    const result = await new ObjectQLStrategy().execute(
      { cube: 'deals', measures: ['total'], dimensions: ['id'], where } as AnalyticsQuery,
      ctx,
    );
    return {
      ids: result.rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b)),
      filter: captured[0],
    };
  };

  it('`[]` reaches the engine as no filter at all', async () => {
    const { ids, filter } = await run([]);
    // ABSENT, not `{}` — the same reading the engine door gives it, where the
    // `where` key is DELETED rather than lowered to an empty condition.
    expect(filter).toBeUndefined();
    expect(ids).toEqual(['d1', 'd2', 'd3', 'd4']);
  });

  for (const c of EQUIVALENT_SPELLINGS) {
    it(`lowers for the engine: ${c.name}`, async () => {
      const fromObject = await run(c.object);
      const fromArray = await run(c.array);
      // The condition itself, not just the rows: the engine must receive the
      // SAME `FilterCondition` either spelling was written as.
      expect(fromArray.filter, 'the lowered condition').toEqual(fromObject.filter);
      expect(fromObject.ids).toEqual(c.expected);
      expect(fromArray.ids).toEqual(c.expected);
    });
  }

  for (const c of UNLOWERABLE) {
    it(`refuses before the engine is called: ${c.name}`, async () => {
      captured.length = 0;
      const err = await refusalOf(() =>
        new ObjectQLStrategy().execute(
          {
            cube: 'deals',
            measures: ['total'],
            dimensions: ['id'],
            where: c.where,
          } as AnalyticsQuery,
          ctx,
        ),
      );
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(captured).toEqual([]);
    });
  }

  it('the echoed display SQL carries the lowered predicate too', async () => {
    // `generateSql` renders the statement a debugger reads. It compiles the
    // same tree, so an array `where` that vanished from execution vanished from
    // the echo as well — SQL that cannot reproduce the result it explains.
    const { sql, params } = await new ObjectQLStrategy().generateSql(
      {
        cube: 'deals',
        measures: ['total'],
        dimensions: ['id'],
        where: ['stage', '=', 'won'],
      } as AnalyticsQuery,
      ctx,
    );
    expect(sql).toMatch(/WHERE/);
    expect(sql).toMatch(/stage/);
    expect(params).toEqual(['won']);
  });

  it('the display SQL refuses the same arrays execution refuses', async () => {
    const err = await refusalOf(() =>
      new ObjectQLStrategy().generateSql(
        {
          cube: 'deals',
          measures: ['total'],
          dimensions: ['id'],
          where: [{ stage: 'won' }],
        } as AnalyticsQuery,
        ctx,
      ),
    );
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
  });
});
