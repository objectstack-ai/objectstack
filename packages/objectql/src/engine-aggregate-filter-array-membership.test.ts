// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20873] A per-aggregation `filter` answers `$contains` / `$notContains` on a
// DECLARED multi-valued field by MEMBERSHIP — the reading `FILTER_OPERATORS`'
// `$contains` docblock (`@objectstack/spec`) declares for a JSON-stored column,
// and the one `where` gives on every SQL dialect — while a scalar string column
// keeps the substring test.
//
// Measured on the base (`origin/main` `212d613c`) through `engine.aggregate`,
// on a real InMemoryDriver, a real SqlDriver over SQLite and the same over a
// live PostgreSQL 16.14, the six rows below (`owners` a `multiple: true` lookup,
// `tags` a `tags` field, `title` text):
//
// | per-aggregation `filter` | base `m`, all three | SQLite / PostgreSQL `where` | `m` now |
// |:--|:--|:--|:--|
// | `owners $contains 'u1'` (the card) | 0 | 2 (d1, d3) | 2 |
// | `owners $contains 'u10'` | 0 | 1 (d5) | 1 |
// | `owners $notContains 'u1'` | 6 | 4 (d2, d4, d5, d6) | 4 |
// | `tags $contains 'red'` | 0 | 2 (d1, d5) | 2 |
// | `$or` of `$contains` (the any-of spelling) | 0 | 2 | 2 |
// | `$not` of `$contains` | 6 | 4 | 4 |
// | `title $contains 'u1'` (the control) | 3 | 3 | 3 |
//
// `d5` holds `['u10']` and `d3` `['redwood']`: the rows on which membership and
// a substring disagree. `driver-memory`'s own `where` answered 3 for the card
// on that base, by a per-element substring; that face is not this file's (it
// is moving to membership on its own card), and the `where` numbers this file
// holds the evaluator to are the SQL family's. The rows are in the read shape
// `find()` presents on all three backends — measured identical on each: an
// array, or `null`.
//
// The SQLite and PostgreSQL cells run through the public door, beside a live
// `where` twin, in `packages/rest`'s `aggregation-filter-array-membership.test.ts`.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { declaredJsonStoredFields, matchesAggregationFilter } from './having-filter.js';

const OBJECT = 'os20873_doc';

const FIELDS = {
  title: { type: 'text' },
  owners: { type: 'lookup', reference: 'os20873_user', multiple: true },
  tags: { type: 'tags' },
};

const ROWS = [
  { id: 'd1', title: 'u1 memo', owners: ['u1', 'u2'], tags: ['red', 'blue'] },
  { id: 'd2', title: 'none', owners: ['u2'], tags: ['blue'] },
  { id: 'd3', title: 'about u10', owners: ['u3', 'u1'], tags: ['redwood'] },
  { id: 'd4', title: 'x', owners: [], tags: [] },
  { id: 'd5', title: 'u1', owners: ['u10'], tags: ['red'] },
  { id: 'd6', title: null, owners: null, tags: null },
];

/** A driver WITHOUT `aggregate()`: the engine reads rows and lowers in memory, where the filter is evaluated. */
function makeRowsDriver(rows: readonly Record<string, unknown>[]) {
  return {
    name: 'rows-mock',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return rows.map((row) => ({ ...row })); },
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
  const engine = new ObjectQL();
  engine.registerDriver(makeRowsDriver(rows) as any, true);
  await engine.init();
  (engine.registry as any).registerObject({ name: OBJECT, fields: FIELDS });
  return engine;
}

/** filter · the rows the SQL family's `where` answers for it, on this fixture. */
const CASES: ReadonlyArray<readonly [string, Record<string, unknown>, readonly string[]]> = [
  ['the card — $contains a member id', { owners: { $contains: 'u1' } }, ['d1', 'd3']],
  ['$contains an id another stored id has as a prefix', { owners: { $contains: 'u10' } }, ['d5']],
  ['$notContains — the exact complement, the null row included (#5298)', { owners: { $notContains: 'u1' } }, ['d2', 'd4', 'd5', 'd6']],
  ['$contains on a tags field — a member, not a substring of one', { tags: { $contains: 'red' } }, ['d1', 'd5']],
  ['$notContains on a tags field', { tags: { $notContains: 'red' } }, ['d2', 'd3', 'd4', 'd6']],
  ['an $or of $contains — the any-of spelling', { $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u3' } }] }, ['d1', 'd3']],
  ['$not over $contains', { $not: { owners: { $contains: 'u1' } } }, ['d2', 'd4', 'd5', 'd6']],
  ['control — $contains on a text field stays a substring', { title: { $contains: 'u1' } }, ['d1', 'd3', 'd5']],
  ['control — $notContains on a text field stays a substring', { title: { $notContains: 'u1' } }, ['d2', 'd4', 'd6']],
];

describe('[#20873] engine.aggregate — a per-aggregation filter counts a declared multi-valued field by membership', () => {
  for (const [name, filter, rows] of CASES) {
    it(`${name}: m = ${rows.length}, the rows the SQL where answers`, async () => {
      const engine = await makeEngine(ROWS);
      const out = await engine.aggregate(OBJECT, {
        aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: filter as never }],
      });
      expect(out).toEqual([{ n: 6, m: rows.length }]);
      // The same rows, not only the same count.
      const fields = FIELDS as Record<string, unknown>;
      const kept = ROWS.filter((row) => matchesAggregationFilter(row, filter as never, 1, undefined, declaredJsonStoredFields(fields)));
      expect(kept.map((row) => row.id)).toEqual(rows);
    });
  }

  it('an empty table counts 0 for each, and n is 0 beside it', async () => {
    for (const [, filter] of CASES) {
      const engine = await makeEngine([]);
      const out = await engine.aggregate(OBJECT, {
        aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: filter as never }],
      });
      expect(out).toEqual([{ n: 0, m: 0 }]);
    }
  });

  it('per group: each group counts the rows whose array holds the member', async () => {
    const engine = await makeEngine([
      { id: 'g1', title: 'a', owners: ['u1'] },
      { id: 'g2', title: 'a', owners: ['u10'] },
      { id: 'g3', title: 'b', owners: ['u2', 'u1'] },
      { id: 'g4', title: 'b', owners: null },
    ]);
    const out = await engine.aggregate(OBJECT, {
      groupBy: ['title'],
      aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: { owners: { $contains: 'u1' } } as never }],
    });
    expect([...out].sort((a, b) => String(a.title).localeCompare(String(b.title)))).toEqual([
      { title: 'a', n: 2, m: 1 },
      { title: 'b', n: 2, m: 1 },
    ]);
  });
});

describe('[#20873] having — the shared walker keeps the substring reading on an aggregated text column', () => {
  it('a $contains over a groupBy text projection keeps the groups whose label holds the text', async () => {
    const engine = await makeEngine(ROWS);
    const out = await engine.aggregate(OBJECT, {
      groupBy: ['title'],
      aggregations: [{ function: 'count', alias: 'n' }],
      having: { title: { $contains: 'u1' } } as never,
    });
    expect(out.map((row: any) => row.title).sort()).toEqual(['about u10', 'u1', 'u1 memo']);
  });
});

describe('[#20873] the member reading — the comparand names a member by its text, as on every SQL dialect', () => {
  const NUMS = { nums: { type: 'select', multiple: true } };
  const holds = (stored: unknown, comparand: string) =>
    matchesAggregationFilter({ nums: stored }, { nums: { $contains: comparand } } as never, 0, undefined, declaredJsonStoredFields(NUMS));

  it.each([
    ['a string member', ['a', 'b'], 'a', true],
    ['a number member, named by its text', [1, 2], '1', true],
    ['a number member, named by a non-canonical JSON number', [1.5, 0], '1.50', true],
    ['a number member, named by an exponent', [100], '1e2', true],
    ['a boolean member', [true, false], 'true', true],
    ['a null member', [null], 'null', true],
    ['a string member that reads as a number', ['1'], '1', true],
    ['no member: a leading zero is not a JSON number', [1], '01', false],
    ['no member: a padded number is not a JSON number', [1], ' 1', false],
    ['no member: a hex spelling is not a JSON number', [16], '0x10', false],
    ['no member: a substring of a member', ['redwood'], 'red', false],
    ['no member: a nested array', [['u1']], 'u1', false],
    ['no member: an object element', [{ k: 'u1' }], 'u1', false],
    ['no member: a stored scalar string', 'u1 memo', 'u1', false],
    ['no member: an empty array', [], 'u1', false],
  ] as const)('%s', (_name, stored, comparand, expected) => {
    expect(holds(stored, comparand)).toBe(expected);
  });

  it('$notContains is the exact complement on every one of those, and holds for a null or absent value', () => {
    const notHolds = (row: Record<string, unknown>, comparand: string) =>
      matchesAggregationFilter(row, { nums: { $notContains: comparand } } as never, 0, undefined, declaredJsonStoredFields(NUMS));
    expect(notHolds({ nums: [1, 2] }, '1')).toBe(false);
    expect(notHolds({ nums: ['redwood'] }, 'red')).toBe(true);
    expect(notHolds({ nums: null }, '1')).toBe(true);
    expect(notHolds({}, '1')).toBe(true);
  });

  it('the fork is the DECLARATION: an undeclared column holding an array keeps the substring reading', () => {
    const row = { owners: ['u1'] };
    expect(matchesAggregationFilter(row, { owners: { $contains: 'u1' } } as never, 0)).toBe(false);
    expect(matchesAggregationFilter(row, { owners: { $contains: 'u1' } } as never, 0, undefined, declaredJsonStoredFields(FIELDS))).toBe(true);
  });

  it('the declared population is the spec\'s JSON-stored classes: multi-valued fields and structured-JSON types', () => {
    expect([...declaredJsonStoredFields({
      title: { type: 'text' },
      one_owner: { type: 'lookup' },
      owners: { type: 'lookup', multiple: true },
      picks: { type: 'multiselect' },
      tags: { type: 'tags' },
      choice: { type: 'select' },
      choices: { type: 'select', multiple: true },
      meta: { type: 'json' },
      ship_to: { type: 'address' },
      broken: null,
      untyped: {},
    })].sort()).toEqual(['choices', 'meta', 'owners', 'picks', 'ship_to', 'tags']);
    expect(declaredJsonStoredFields(undefined).size).toBe(0);
  });
});
