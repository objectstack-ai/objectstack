// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20981] A per-aggregation `filter` and a `having` REFUSE a non-boolean
// `$exists` / `$null` with `INVALID_FILTER` / 400, in the words every driver's
// `where` refuses it in, before any driver is asked. `true` / `false` answer
// exactly as before.
//
// Measured before this change (`origin/main` `7a606a9a3`) through
// `engine.aggregate` on driver-memory AND driver-sql (better-sqlite3), over a
// text column `name` holding `'won'` on one row (amount 10) and no value on two
// (amounts 1 and 100). The engine evaluates both clauses itself, so the two
// drivers answered identically:
//
// | clause · comparand | `$exists` | `$null` |
// |:--|:--|:--|
// | filter · `"yes"` / `1` / `"false"` | sum 10 (the valued row) | sum 111 (every row) |
// | filter · `0` / `null` | sum 101 (the no-value rows) | sum 111 (every row) |
// | having · `"yes"` / `1` / `"false"` | the `won` group | both groups |
// | having · `0` / `null` | the null group | both groups |
//
// while the same flag in a `where` is refused 400 on both drivers. After it,
// every cell above is that 400, and the `true` / `false` control keeps the
// numbers below.
//
// This file is the engine-level cell, over a driver of each `having` path's
// shape — `rows` (no `aggregate()`: the engine reads rows and lowers in memory,
// the face that evaluates `aggregations[i].filter`) and `native` (the driver
// aggregates, the engine applies `having`). Every refusal precedes the driver,
// so the backend does not enter into it; the same answers were measured on
// driver-memory and driver-sql above. This package does not depend on either
// driver, and the in-memory driver's test consumers are a closed census
// (`check:driver-memory-census`), so the SQLite cell — beside its live `where`
// twin, through `POST /data/:object/query` — is `packages/rest`'s
// `aggregation-flag-comparand-refusal.test.ts`.

import { describe, it, expect } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applyHaving, matchesAggregationFilter } from './having-filter.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';

const OBJECT = 'os20981_deal';

const FIELDS = {
  name: { type: 'text' },
  amount: { type: 'number' },
};

// `a` holds a value; `b` holds null and `c` does not carry the column — both
// have NO value, the reading `$exists` and `$null` share (#5298).
const ROWS = [
  { id: 'a', name: 'won', amount: 10 },
  { id: 'b', name: null, amount: 1 },
  { id: 'c', amount: 100 },
];

type Path = 'native' | 'rows';

/** A driver of one `having` path's shape, counting every read of the object. */
function makeDriver(path: Path, rows: ReadonlyArray<Record<string, unknown>>) {
  const reads = { aggregate: 0, find: 0 };
  const driver: any = {
    name: `${path}-recorder`,
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { reads.find += 1; return rows.map((r) => ({ ...r })); },
    async findOne() { return null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  if (path === 'native') {
    driver.aggregate = async (_o: string, ast: any) => { reads.aggregate += 1; return applyInMemoryAggregation([...rows], ast); };
  }
  return { driver, reads };
}

async function makeEngine(path: Path, rows: ReadonlyArray<Record<string, unknown>> = ROWS) {
  const { driver, reads } = makeDriver(path, rows);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  (engine.registry as any).registerObject({ name: OBJECT, fields: FIELDS });
  return { engine, reads };
}

/** `s` sums `amount` over the rows `filter` selects; `n` counts every row. Always the rows path. */
const filterQuery = (filter: unknown): EngineAggregateOptions => ({
  aggregations: [
    { function: 'count', alias: 'n' },
    { function: 'sum', field: 'amount', alias: 's', filter: filter as FilterCondition },
  ],
});

/** Groups by `name`; on the rows path a filtered aggregation forces the engine's own lowering. */
const havingQuery = (path: Path, having: unknown): EngineAggregateOptions => ({
  groupBy: ['name'],
  aggregations: path === 'native'
    ? [{ function: 'count', alias: 'n' }]
    : [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'all', filter: { amount: { $gte: 0 } } }],
  having: having as FilterCondition,
});

interface Refusal extends Error { code?: unknown; status?: unknown }

async function refusalOf(run: () => Promise<unknown>): Promise<Refusal> {
  try {
    await run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error('expected engine.aggregate to refuse this clause, but it answered');
}

function syncRefusalOf(run: () => unknown): Refusal {
  try {
    run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error('expected a refusal, but the clause was answered');
}

/**
 * The comparand doors' refusal: the ADR-0112 identity, then the drivers' first
 * three sentences — the operator, the field, what arrived (in the drivers'
 * `describeFilterOperand (safeShapePreview)` rendering) and where, and the
 * declaration — then the reason that names the backends.
 */
function expectFlagRefusal(err: Refusal, op: '$exists' | '$null', received: string, at: string): void {
  expect(err.code, err.message).toBe('INVALID_FILTER');
  expect(err.status, err.message).toBe(400);
  expect(err.message.startsWith(
    `Operator "${op}" on field "name" requires a boolean comparand (true or false). `
    + `Received ${received} at ${at}. `
    + `@objectstack/spec FieldOperatorsSchema declares ${op} as a boolean. It is refused rather than coerced `,
  ), err.message).toBe(true);
  expect(err.message).toContain('OPPOSITE directions');
  expect(err.message).toContain('Note "false" the STRING is truthy');
}

const OPS = ['$exists', '$null'] as const;

/** The card's five non-booleans, each with the rendering the drivers give it. */
const NON_BOOLEANS: ReadonlyArray<readonly [string, unknown, string]> = [
  ['"yes"', 'yes', 'string ("yes")'],
  ['1', 1, 'number (1)'],
  ['"false" (truthy)', 'false', 'string ("false")'],
  ['0', 0, 'number (0)'],
  ['null', null, 'null (null)'],
  // [#21448] `[true] (a list)` stood here, reaching this gate because no
  // earlier door refused a list at a flag. The shared comparand-shape face
  // does now, one door earlier, in its own words — pinned in the block below.
];

describe('[#20981] a non-boolean $exists / $null — refused before any driver read, on both positions', () => {
  for (const op of OPS) {
    for (const [label, comparand, received] of NON_BOOLEANS) {
      it(`aggregations[1].filter ${op}: ${label} — 400, the drivers' words, on an empty and a populated table`, async () => {
        for (const rows of [[], ROWS]) {
          const { engine, reads } = await makeEngine('rows', rows);
          const err = await refusalOf(() => engine.aggregate(OBJECT, filterQuery({ name: { [op]: comparand } })));
          expectFlagRefusal(err, op, received, `aggregations[1].filter.name.${op}`);
          expect(reads, 'the verdict is the filter\'s: no row was read').toEqual({ aggregate: 0, find: 0 });
        }
      });

      it(`having ${op}: ${label} — 400, the drivers' words, on both having paths`, async () => {
        for (const path of ['native', 'rows'] as const) {
          for (const rows of [[], ROWS]) {
            const { engine, reads } = await makeEngine(path, rows);
            const err = await refusalOf(() => engine.aggregate(OBJECT, havingQuery(path, { name: { [op]: comparand } })));
            expectFlagRefusal(err, op, received, `having.name.${op}`);
            expect(reads, `${path}: no row was read`).toEqual({ aggregate: 0, find: 0 });
          }
        }
      });
    }
  }

  it('[#21448] a LIST flag is the shared comparand-shape face\'s refusal, one door earlier, at both positions — no read', async () => {
    for (const op of OPS) {
      const sentence = `Operator "${op}" on field "name" requires a single comparable value, but received an array ([true])`;
      const { engine, reads } = await makeEngine('rows', ROWS);
      const filtered = await refusalOf(() => engine.aggregate(OBJECT, filterQuery({ name: { [op]: [true] } })));
      expect({ code: filtered.code, status: filtered.status }, op).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(filtered.message, op).toContain(`${sentence} at aggregations[1].filter.name.${op}.`);
      expect(filtered.message, op).not.toContain('requires a boolean comparand');
      expect(reads, `${op}: no row was read`).toEqual({ aggregate: 0, find: 0 });
      for (const path of ['native', 'rows'] as const) {
        const grouped = await makeEngine(path, ROWS);
        const having = await refusalOf(() => grouped.engine.aggregate(OBJECT, havingQuery(path, { name: { [op]: [true] } })));
        expect({ code: having.code, status: having.status }, `${op} ${path}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
        expect(having.message, `${op} ${path}`).toContain(`${sentence} at having.name.${op}.`);
        expect(grouped.reads, `${op} ${path}: no row was read`).toEqual({ aggregate: 0, find: 0 });
      }
    }
  });

  // Where the flag sits must not change the verdict: the walk is row-independent,
  // so a branch the per-row walk would short-circuit past is judged too.
  const POSITIONS: ReadonlyArray<readonly [string, (flag: Record<string, unknown>) => Record<string, unknown>, string]> = [
    ['nested in $and', (flag) => ({ $and: [{ amount: { $gte: 0 } }, { name: flag }] }), '.$and[1].name'],
    ['behind a $or branch that already holds', (flag) => ({ $or: [{ amount: { $gte: 0 } }, { name: flag }] }), '.$or[1].name'],
    ['under $not', (flag) => ({ $not: { name: flag } }), '.$not.name'],
    ['beside a boolean sibling flag', (flag) => ({ name: { $empty: false, ...flag } }), '.name'],
  ];

  for (const [name, wrap, tail] of POSITIONS) {
    it(`${name}: refused at that position, in the per-aggregation filter and in having`, async () => {
      const filterEngine = await makeEngine('rows');
      expectFlagRefusal(
        await refusalOf(() => filterEngine.engine.aggregate(OBJECT, filterQuery(wrap({ $exists: 'yes' })))),
        '$exists', 'string ("yes")', `aggregations[1].filter${tail}.$exists`,
      );
      // `having` reads the aggregated row, which carries `name` (the groupBy)
      // but not `amount` — so its wrapper's other branch tests `n` instead.
      const having = JSON.parse(JSON.stringify(wrap({ $null: 1 })).replaceAll('"amount"', '"n"'));
      const havingEngine = await makeEngine('native');
      expectFlagRefusal(
        await refusalOf(() => havingEngine.engine.aggregate(OBJECT, havingQuery('native', having))),
        '$null', 'number (1)', `having${tail}.$null`,
      );
      expect(filterEngine.reads.find + havingEngine.reads.aggregate).toBe(0);
    });
  }

  it('a { $field } reference in a flag\'s slot is a non-boolean first, as in $empty\'s', async () => {
    const { engine } = await makeEngine('rows');
    expectFlagRefusal(
      await refusalOf(() => engine.aggregate(OBJECT, filterQuery({ name: { $exists: { $field: 'amount' } } }))),
      '$exists', 'object ({"$field":"amount"})', 'aggregations[1].filter.name.$exists',
    );
    const native = await makeEngine('native');
    expectFlagRefusal(
      await refusalOf(() => native.engine.aggregate(OBJECT, havingQuery('native', { name: { $null: { $field: 'n' } } }))),
      '$null', 'object ({"$field":"n"})', 'having.name.$null',
    );
  });
});

describe('[#20981] the control — true / false answer exactly as before, on both positions and both paths', () => {
  // `a` (10) has a value; `b` (1) and `c` (100) have none.
  const SUMS: ReadonlyArray<readonly [string, Record<string, unknown>, number]> = [
    ['$exists: true', { $exists: true }, 10],
    ['$exists: false', { $exists: false }, 101],
    ['$null: true', { $null: true }, 101],
    ['$null: false', { $null: false }, 10],
  ];

  for (const [name, flag, sum] of SUMS) {
    it(`aggregations[1].filter ${name} sums ${sum}`, async () => {
      const { engine, reads } = await makeEngine('rows');
      expect(await engine.aggregate(OBJECT, filterQuery({ name: flag }))).toEqual([{ n: 3, s: sum }]);
      expect(reads.find).toBe(1);
    });

    const kept = sum === 10 ? ['won'] : ['null'];
    it(`having ${name} keeps the ${kept[0]} group on both paths`, async () => {
      for (const path of ['native', 'rows'] as const) {
        const { engine } = await makeEngine(path);
        const groups = await engine.aggregate(OBJECT, havingQuery(path, { name: flag }));
        expect(groups.map((g: any) => String(g.name)), path).toEqual(kept);
      }
    });
  }
});

describe('[#20981] the published row evaluators refuse per row — the floor for a caller that evaluates rows itself', () => {
  it('applyInMemoryAggregation with fields: $exists "yes" and $null 1 are refused, true / false answer', () => {
    for (const [op, comparand, received] of [['$exists', 'yes', 'string ("yes")'], ['$null', 1, 'number (1)']] as const) {
      const err = syncRefusalOf(() => applyInMemoryAggregation(
        ROWS.map((r) => ({ ...r })),
        filterQuery({ name: { [op]: comparand } }),
        undefined,
        FIELDS,
      ));
      expectFlagRefusal(err, op, received, `aggregations[1].filter.name.${op}`);
    }
    expect(applyInMemoryAggregation(ROWS.map((r) => ({ ...r })), filterQuery({ name: { $exists: true } }), undefined, FIELDS))
      .toEqual([{ n: 3, s: 10 }]);
    expect(applyInMemoryAggregation(ROWS.map((r) => ({ ...r })), filterQuery({ name: { $null: true } }), undefined, FIELDS))
      .toEqual([{ n: 3, s: 101 }]);
  });

  it('applyHaving and matchesAggregationFilter refuse a row that reaches the flag, with or without a value', () => {
    const groups = [{ name: 'won', n: 1 }, { name: null, n: 2 }];
    for (const row of groups) {
      expectFlagRefusal(syncRefusalOf(() => applyHaving([row], { name: { $exists: 'false' } } as never)),
        '$exists', 'string ("false")', 'having.name.$exists');
      expectFlagRefusal(syncRefusalOf(() => matchesAggregationFilter(row, { name: { $null: 0 } } as never, 2)),
        '$null', 'number (0)', 'aggregations[2].filter.name.$null');
    }
    expect(applyHaving(groups, { name: { $null: false } })).toEqual([{ name: 'won', n: 1 }]);
    expect(applyHaving(groups, { name: { $exists: false } })).toEqual([{ name: null, n: 2 }]);
  });
});
