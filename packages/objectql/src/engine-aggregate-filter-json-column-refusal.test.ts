// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21007] A per-aggregation `filter` REFUSES a scalar comparison on a field the
// object declares JSON-stored — the equality and ordering family, `$between`,
// `$in` / `$nin` and implicit equality — with `where`'s code and words, before
// any driver is asked. `$contains` / `$notContains` (membership), `$exists`,
// `$null` and `$empty` keep answering, and a scalar column is untouched.
//
// Measured before this change (`origin/main` `d1f8ce865`)
// through `POST /data/:object/query` on SQLite and a live PostgreSQL 16.14, on
// the six rows below: `where` refused every one of these 400 `INVALID_FILTER` on
// both dialects, while the per-aggregation `filter` answered 200 with a count
// the stored arrays cannot support —
//
// | per-aggregation `filter` | base `m` (SQLite = PostgreSQL = this engine) |
// |:--|:--|
// | `owners $in ['u1','u9']` (the card) | 0 |
// | `owners $nin ['u1','u9']` (the card) | 6 — `d1` and `d3`, the rows it was asked to exclude |
// | `owners $eq 'u1'` / `{ owners: 'u1' }` | 0 |
// | `owners $ne 'u1'` | 6 |
// | `owners $gt 'u1'` / `$lte 'u1'` / `$between ['u1','u9']` | 4 / 1 / 5 |
// | `tags $eq 'red'` | 1 — `d5`'s `['red']` loosely `==` `'red'` |
// | `meta $eq 'a'` / `$in ['a']` | 0 |
//
// This file is the engine-level cell, over the read shape `find()` presents (a
// driver without `aggregate()`, so the engine reads rows and lowers in memory —
// the one face that evaluates `aggregations[i].filter`); the SQLite and
// PostgreSQL cells, each beside its live `where` twin, are `packages/rest`'s
// `aggregation-filter-json-column-refusal.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine.js';
import { declaredJsonStoredFields, matchesAggregationFilter } from './having-filter.js';

const OBJECT = 'os21007_doc';

const FIELDS = {
  title: { type: 'text' },
  owners: { type: 'lookup', reference: 'os21007_user', multiple: true },
  tags: { type: 'tags' },
  meta: { type: 'json' },
};

const ROWS = [
  { id: 'd1', title: 'u1 memo', owners: ['u1', 'u2'], tags: ['red', 'blue'], meta: null },
  { id: 'd2', title: 'none', owners: ['u2'], tags: ['blue'], meta: null },
  { id: 'd3', title: 'about u10', owners: ['u3', 'u1'], tags: ['redwood'], meta: null },
  { id: 'd4', title: 'x', owners: [], tags: [], meta: null },
  { id: 'd5', title: 'u1', owners: ['u10'], tags: ['red'], meta: null },
  { id: 'd6', title: null, owners: null, tags: null, meta: null },
];

/** A driver WITHOUT `aggregate()`: the engine reads rows and lowers in memory, where the filter is evaluated. */
function makeRowsDriver(rows: readonly Record<string, unknown>[]) {
  const find = vi.fn(async () => rows.map((row) => ({ ...row })));
  return {
    name: 'rows-mock',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    find,
    async findOne() { return null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return 0; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
}

async function makeEngine(rows: readonly Record<string, unknown>[]) {
  const driver = makeRowsDriver(rows);
  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  (engine.registry as any).registerObject({ name: OBJECT, fields: FIELDS });
  const warn = vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  return { engine, driver, warn };
}

const perAggregation = (filter: unknown) => ({
  aggregations: [
    { function: 'count' as const, alias: 'n' },
    { function: 'count' as const, alias: 'm', filter: filter as never },
  ],
});

/** Each field's member and a non-member, so every comparand is one a real author could write. */
const VALUES: Record<string, readonly [string, string]> = {
  owners: ['u1', 'u9'],
  tags: ['red', 'green'],
  meta: ['a', 'b'],
};

/** field → [name, filter, the operator the refusal is about, bare?] */
function family(field: string): Array<readonly [string, Record<string, unknown>, string, boolean]> {
  const [a, b] = VALUES[field];
  return [
    ['implicit equality', { [field]: a }, '=', true],
    ['implicit equality with null', { [field]: null }, '=', true],
    ['$eq', { [field]: { $eq: a } }, '$eq', false],
    ['$eq null', { [field]: { $eq: null } }, '$eq', false],
    ['$ne', { [field]: { $ne: a } }, '$ne', false],
    ['$ne null', { [field]: { $ne: null } }, '$ne', false],
    ['$gt', { [field]: { $gt: a } }, '$gt', false],
    ['$gte', { [field]: { $gte: a } }, '$gte', false],
    ['$lt', { [field]: { $lt: a } }, '$lt', false],
    ['$lte', { [field]: { $lte: a } }, '$lte', false],
    ['$between', { [field]: { $between: [a, b] } }, '$between', false],
    ['$in (the card)', { [field]: { $in: [a, b] } }, '$in', false],
    ['$nin (the card)', { [field]: { $nin: [a, b] } }, '$nin', false],
    ['$in []', { [field]: { $in: [] } }, '$in', false],
    ['$nin []', { [field]: { $nin: [] } }, '$nin', false],
    ['$in under $not', { $not: { [field]: { $in: [a] } } }, '$in', false],
    ['$nin in an $or branch after one that holds', { $or: [{ title: 'x' }, { [field]: { $nin: [a] } }] }, '$nin', false],
    ['$in beside $exists', { [field]: { $exists: true, $in: [a] } }, '$in', false],
  ];
}

async function refusalOf(run: () => Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  try {
    await run();
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
  throw new Error('expected engine.aggregate to refuse this filter, but it answered');
}

/**
 * The refusal, as `where` gives it: the ADR-0112 identity, the statement that
 * the filter was not applied, and the prescription — with the field and the
 * operator withheld from the message and named in the logged diagnostic.
 */
function expectWhereRefusal(
  err: Error & { code?: string; status?: number },
  warn: ReturnType<typeof vi.spyOn>,
  field: string,
  op: string,
  bare: boolean,
): void {
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
  expect(err.message).toContain('WAS NOT APPLIED');
  expect(err.message).toContain('{ "FIELD": { "$contains": "a" } }');
  expect(err.message).toContain('{ "$or": [{ "FIELD": { "$contains": "a" } }, { "FIELD": { "$contains": "b" } }] }');
  expect(err.message).not.toContain(`"${field}"`);
  const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
  expect(logged).toContain('INVALID_FILTER — refusal detail withheld from the response');
  expect(logged).toContain(bare
    ? `The bare equality spelling { "${field}": value } WAS NOT APPLIED`
    : `Operator "${op}" on field "${field}" WAS NOT APPLIED`);
  expect(logged).toContain(`{ "${field}": { "$contains": "a" } }`);
}

describe('[#21007] engine.aggregate — a per-aggregation filter refuses a scalar comparison on a declared JSON-stored field, as where does', () => {
  for (const field of ['owners', 'tags', 'meta']) {
    for (const [name, filter, op, bare] of family(field)) {
      it(`${field} ${name}: 400 INVALID_FILTER in where's words, and no row is read`, async () => {
        const { engine, driver, warn } = await makeEngine(ROWS);
        const err = await refusalOf(() => engine.aggregate(OBJECT, perAggregation(filter)));
        expectWhereRefusal(err, warn, field, op, bare);
        // Judged on the FILTER, before the driver is asked for a row.
        expect(driver.find).not.toHaveBeenCalled();
      });
    }
  }

  it('the card on an EMPTY table: refused too — the verdict is the filter\'s, not the data\'s', async () => {
    for (const filter of [{ owners: { $in: ['u1', 'u9'] } }, { owners: { $nin: ['u1', 'u9'] } }]) {
      const { engine, warn } = await makeEngine([]);
      expectWhereRefusal(await refusalOf(() => engine.aggregate(OBJECT, perAggregation(filter))), warn, 'owners',
        Object.keys(filter.owners)[0], false);
      const grouped = await makeEngine([]);
      const err = await refusalOf(() => grouped.engine.aggregate(OBJECT, {
        groupBy: ['title'],
        aggregations: [{ function: 'count', alias: 'm', filter: filter as never }],
      }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    }
  });

  it('the logged diagnostic names the aggregation position the filter sits at', async () => {
    const { engine, warn } = await makeEngine(ROWS);
    await refusalOf(() => engine.aggregate(OBJECT, {
      aggregations: [
        { function: 'count', alias: 'n' },
        { function: 'count', alias: 'k', filter: { title: { $eq: 'x' } } as never },
        { function: 'count', alias: 'm', filter: { owners: { $nin: ['u1'] } } as never },
      ],
    }));
    expect(warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')).toContain('At aggregations[2].filter.owners.$nin:');
  });
});

describe('[#21007] what still answers — the membership spelling, the null predicates, and every scalar column', () => {
  const ANSWERED: ReadonlyArray<readonly [string, Record<string, unknown>, number]> = [
    ['owners $contains — the prescribed spelling', { owners: { $contains: 'u1' } }, 2],
    ['owners $notContains', { owners: { $notContains: 'u1' } }, 4],
    ['owners an $or of $contains — the any-of spelling', { $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u3' } }] }, 2],
    ['owners $exists', { owners: { $exists: true } }, 5],
    ['owners $null', { owners: { $null: true } }, 1],
    ['owners $empty', { owners: { $empty: true } }, 2],
    ['control — title $in', { title: { $in: ['u1', 'x'] } }, 2],
    ['control — title $nin', { title: { $nin: ['u1', 'x'] } }, 4],
    ['control — title $eq', { title: { $eq: 'x' } }, 1],
    ['control — title implicit equality', { title: 'x' }, 1],
    ['control — title $gt', { title: { $gt: 'u1' } }, 2],
  ];
  for (const [name, filter, m] of ANSWERED) {
    it(`${name}: m = ${m}`, async () => {
      const { engine, warn } = await makeEngine(ROWS);
      expect(await engine.aggregate(OBJECT, perAggregation(filter))).toEqual([{ n: 6, m }]);
      expect(warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')).not.toContain('INVALID_FILTER');
    });
  }
});

describe('[#21007] the per-row floor — a caller evaluating rows directly meets the same refusal', () => {
  const jsonStored = declaredJsonStoredFields(FIELDS);

  it.each([
    ['$in', { owners: { $in: ['u1'] } }],
    ['$nin', { owners: { $nin: ['u1'] } }],
    ['$eq', { tags: { $eq: 'red' } }],
    ['implicit equality', { tags: 'red' }],
    ['$between', { meta: { $between: ['a', 'b'] } }],
  ] as const)('%s', (_name, filter) => {
    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      matchesAggregationFilter(ROWS[0], filter as never, 0, undefined, jsonStored);
    } catch (e) {
      thrown = e as Error & { code?: string; status?: number };
    }
    expect(thrown?.code).toBe('INVALID_FILTER');
    expect(thrown?.status).toBe(400);
    expect(thrown?.message).toContain('{ "FIELD": { "$contains": "a" } }');
  });

  it('a row with NO value refuses too: the verdict is above the no-value exit', () => {
    expect(() => matchesAggregationFilter(ROWS[5], { owners: { $in: ['u1'] } } as never, 0, undefined, jsonStored))
      .toThrow(/WAS NOT APPLIED/);
  });

  it('undeclared (no jsonStored set): the walker answers as it always did', () => {
    expect(matchesAggregationFilter(ROWS[0], { owners: { $in: ['u1'] } } as never, 0)).toBe(false);
  });
});
