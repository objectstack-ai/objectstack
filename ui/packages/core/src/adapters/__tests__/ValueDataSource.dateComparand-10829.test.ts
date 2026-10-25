/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10829 — a `Date` comparand on `ValueDataSource.find` matches the
 * rows holding the same instant as a `Date`, in both arms.
 *
 * ## What was wrong — two defects, one answer each
 *
 * 1. The object arm sent any object condition that is not an array to its
 *    operator branch. A `Date` has no own keys, so the operator loop ran zero
 *    times and the field added NO constraint: `{ status: 'a', created: d }`
 *    answered the same rows as `{ status: 'a' }`. `convertFiltersToAST` lowers
 *    the same filter to `['created', '=', d]` (objectui#8555).
 * 2. Every equality and membership position compared with `===` (membership
 *    with `includes`), which compares a `Date` by IDENTITY. The constructor
 *    `structuredClone`s the rows it is given, so none of them holds the
 *    comparand's instance (only `create` / `update`, which copy shallowly, can
 *    store the caller's own), and a `Date` equality matched none of them, not
 *    even the one holding that exact instant, while `>=` and `<=` both matched
 *    it.
 *
 * ## What the repair is (triage 5858941931, seat ruling 5859397811)
 *
 * The object arm reads a `Date` condition as implicit equality (the gate is
 * the spec's `isAcceptedFilterComparand`), and ONE module-private helper,
 * `comparandEquals`, compares two `Date`s by `getTime()` in the AST arm's
 * `=` / `!=` / `in` / `nin` and the object arm's implicit equality, `$eq` /
 * `$ne` / `$in` / `$nin`. An invalid `Date` equals nothing. An ISO string or an
 * epoch-milliseconds number is NOT coerced: `@objectstack/spec`'s
 * `FILTER_COMPARAND_TYPE_CASES` declines to assert a `Date` row set, because
 * what it matches "legitimately differs per storage form (ADR-0053)".
 *
 * ## What the assertions are
 *
 * - §1 — the object filter and its lowered array answer the same rows, read
 *   live, and that row set is written down: over one row per stored shape, only
 *   the row holding the instant as a `Date` matches.
 * - §2 — every equality and membership position, in both dialects, compares
 *   the instant: `$eq` / `$ne` / `$in` / `$nin` and `=` / `!=` / `in` / `nin`.
 * - §3 — an invalid `Date` is lowered by the converter, and equals nothing,
 *   itself included: `=` / `$eq` / `in` / `$in` never match a stored invalid
 *   `Date`, and `!=` / `nin` / `$nin` keep it.
 * - §4 — controls: `{ status: 'a' }`, a string and a number equality, and the
 *   ordering operators, which this card does not touch.
 * - §5 — membership reads `===`, so a stored `NaN` is not a member of `[NaN]`
 *   (`$in` / `in` answer none) and `$nin` / `nin` keep it, agreeing with
 *   `{ x: NaN }` and `$eq`.
 *
 * RED LEGS — directions predicted BEFORE running, from the committed fix:
 * - the base `ValueDataSource.ts` (before this card): §1, §2 and the §3
 *   implicit-equality case go RED; §4 stays GREEN;
 * - the round-1 head, which read the `Date` as equality but compared it with
 *   `===`: the same-instant cases in §1 and §2 go RED; the other stored shapes
 *   in §1, §3 and §4 stay GREEN;
 * - an ablation that restores `===` inside `comparandEquals`: exactly the
 *   round-1 set goes RED;
 * - an ablation that reverts membership to `includes`: §5's four `NaN`
 *   membership cases go RED, and so do §2's four `Date` membership cases
 *   (`$in` / `$nin` / `in` / `nin`), because `includes` compares a `Date` by
 *   identity too; nothing else. The first prediction named only §5 and was
 *   wrong: the run showed the §2 half.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { QueryParams } from '@object-ui/types';
import { ValueDataSource } from '../ValueDataSource';
import { convertFiltersToAST, toFilterNodeSafely } from '../../utils/filter-converter';

/** The instant the card filters on. Each use is a fresh instance on purpose. */
const instant = () => new Date(0);

/** A row: an id, a status, and `created` in one of the stored shapes. */
type Row = { id: string; status: string; created?: unknown };

/** One row per stored shape. Every row but `b` has status `'a'`. */
const ROWS: Row[] = [
  { id: 'date', status: 'a', created: new Date(0) },
  { id: 'iso', status: 'a', created: new Date(0).toISOString() },
  { id: 'ms', status: 'a', created: 0 },
  { id: 'other', status: 'a', created: new Date(1000) },
  { id: 'missing', status: 'a' },
  { id: 'b', status: 'b', created: new Date(0) },
];

/** The rows that hold the instant as a `Date`, and every other row. */
const SAME_INSTANT = ['date', 'b'];
const NOT_SAME_INSTANT = ['iso', 'ms', 'other', 'missing'];

async function query(filter: unknown, items: Row[] = ROWS) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const ds = new ValueDataSource<Row>({ items });
    const result = await ds.find('rows', { $filter: filter as QueryParams['$filter'] });
    return {
      ids: result.data.map((r) => r.id),
      total: result.total,
      warns: warn.mock.calls.map((c) => String(c[0])),
    };
  } finally {
    warn.mockRestore();
  }
}

/** The lowered array form of an object filter, as `find`'s array arm receives it. */
function lowered(filter: Record<string, unknown>): unknown {
  const result = toFilterNodeSafely(filter);
  if (!result.ok) throw new Error(`the converter refused ${String(Object.keys(filter))}`);
  return result.node;
}

/** What `find` answers with no warning and exactly these rows. */
function rows(ids: string[]) {
  return { ids, total: ids.length, warns: [] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('objectui#10829 §1 — a Date condition answers the rows holding that instant, like its lowered array', () => {
  it('the converter lowers the card filter to an equality on the Date instance', () => {
    const ast = convertFiltersToAST({ status: 'a', created: instant() });
    expect(ast).toEqual(['and', ['status', '=', 'a'], ['created', '=', instant()]]);
    expect((ast as unknown[][])[2][2]).toBeInstanceOf(Date);
  });

  it('{ status: a, created: Date } answers the same-instant Date row, on both arms', async () => {
    const filter = { status: 'a', created: instant() };
    const objectAnswer = await query(filter);
    expect(objectAnswer).toEqual(await query(lowered(filter)));
    expect(objectAnswer).toEqual(rows(['date']));
  });

  it('{ created: Date } alone answers every same-instant Date row, on both arms', async () => {
    const filter = { created: instant() };
    const objectAnswer = await query(filter);
    expect(objectAnswer).toEqual(await query(lowered(filter)));
    expect(objectAnswer).toEqual(rows(SAME_INSTANT));
  });

  it.each<[string, string[]]>([
    ['date', ['date']],
    ['iso', []],
    ['ms', []],
    ['other', []],
    ['missing', []],
  ])('the %s row alone answers %j, on both arms', async (id, expected) => {
    const filter = { status: 'a', created: instant() };
    const only = ROWS.filter((row) => row.id === id);
    const objectAnswer = await query(filter, only);
    expect(objectAnswer).toEqual(await query(lowered(filter), only));
    expect(objectAnswer).toEqual(rows(expected));
  });
});

describe('objectui#10829 §2 — every equality and membership position compares the instant', () => {
  it.each<[string, string[]]>([
    ['$eq', SAME_INSTANT],
    ['$ne', NOT_SAME_INSTANT],
  ])('{ created: { %s: Date } } answers %j', async (operator, expected) => {
    expect(await query({ created: { [operator]: instant() } })).toEqual(rows(expected));
  });

  it('{ created: { $in: [Date] } } answers the same-instant Date rows', async () => {
    expect(await query({ created: { $in: [instant()] } })).toEqual(rows(SAME_INSTANT));
  });

  it('{ created: { $nin: [Date] } } answers every other row', async () => {
    expect(await query({ created: { $nin: [instant()] } })).toEqual(rows(NOT_SAME_INSTANT));
  });

  it.each<[string, string[]]>([
    ['=', SAME_INSTANT],
    ['!=', NOT_SAME_INSTANT],
  ])('[created, %s, Date] answers %j', async (operator, expected) => {
    expect(await query(['created', operator, instant()])).toEqual(rows(expected));
  });

  it('[created, in, [Date]] answers the same-instant Date rows', async () => {
    expect(await query(['created', 'in', [instant()]])).toEqual(rows(SAME_INSTANT));
  });

  it('[created, nin, [Date]] answers every other row', async () => {
    expect(await query(['created', 'nin', [instant()]])).toEqual(rows(NOT_SAME_INSTANT));
  });
});

describe('objectui#10829 §3 — an invalid Date is lowered, and equals nothing', () => {
  it('the converter lowers new Date(NaN) rather than refusing it', () => {
    const result = toFilterNodeSafely({ status: 'a', created: new Date(NaN) });
    expect(result.ok).toBe(true);
    const leaf = (result.ok ? (result.node as unknown[][])[2] : [])[2];
    expect(leaf).toBeInstanceOf(Date);
    expect(Number.isNaN((leaf as Date).getTime())).toBe(true);
  });

  it('{ status: a, created: Invalid Date } answers no rows, on both arms', async () => {
    const filter = { status: 'a', created: new Date(NaN) };
    const objectAnswer = await query(filter);
    expect(objectAnswer).toEqual(await query(lowered(filter)));
    expect(objectAnswer).toEqual(rows([]));
  });

  it('{ created: { $ne: Invalid Date } } answers every row', async () => {
    expect(await query({ created: { $ne: new Date(NaN) } }))
      .toEqual(rows([...ROWS.map((row) => row.id)]));
  });

  /** A stored invalid `Date` beside a valid one: the invalid one equals nothing, itself included. */
  const WITH_INVALID: Row[] = [
    { id: 'bad', status: 'a', created: new Date(NaN) },
    { id: 'date', status: 'a', created: new Date(0) },
  ];

  it.each<[string, unknown]>([
    ['!= Invalid Date', ['created', '!=', new Date(NaN)]],
    ['nin [Invalid Date]', ['created', 'nin', [new Date(NaN)]]],
    ['$nin: [Invalid Date]', { created: { $nin: [new Date(NaN)] } }],
    ['!= Date', ['created', '!=', new Date(0)]],
    ['$nin: [Date]', { created: { $nin: [new Date(0)] } }],
  ])('a stored invalid Date is kept by %s', async (_label, filter) => {
    const answer = await query(filter, WITH_INVALID);
    expect(answer.ids).toContain('bad');
    expect(answer.warns).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['= Invalid Date', ['created', '=', new Date(NaN)]],
    ['in [Invalid Date]', ['created', 'in', [new Date(NaN)]]],
    ['$eq: Invalid Date', { created: { $eq: new Date(NaN) } }],
    ['$in: [Invalid Date]', { created: { $in: [new Date(NaN)] } }],
  ])('a stored invalid Date is not matched by %s', async (_label, filter) => {
    expect(await query(filter, WITH_INVALID)).toEqual(rows([]));
  });
});

describe('objectui#10829 §4 — controls: the same answer on every leg', () => {
  it('{ status: a } answers every status-a row', async () => {
    expect(await query({ status: 'a' })).toEqual(rows(['date', 'iso', 'ms', 'other', 'missing']));
  });

  it('a string equality matches the ISO row only, on both arms', async () => {
    const filter = { status: 'a', created: new Date(0).toISOString() };
    const objectAnswer = await query(filter);
    expect(objectAnswer).toEqual(rows(['iso']));
    expect(objectAnswer).toEqual(await query(lowered(filter)));
  });

  it('a number equality matches the epoch-milliseconds row only, on both arms', async () => {
    const filter = { status: 'a', created: 0 };
    const objectAnswer = await query(filter);
    expect(objectAnswer).toEqual(rows(['ms']));
    expect(objectAnswer).toEqual(await query(lowered(filter)));
  });

  it.each([
    ['$gt', '>'],
    ['$gte', '>='],
    ['$lt', '<'],
    ['$lte', '<='],
  ])('{ created: { %s: Date } } answers what its AST twin %s answers', async (dollar, ast) => {
    expect(await query({ created: { [dollar]: instant() } }))
      .toEqual(await query(['created', ast, instant()]));
  });

  it('$gte and $lte on one instant both hold for the rows $eq matches', async () => {
    const both = await query({ created: { $gte: instant(), $lte: instant() } });
    expect(both.ids).toEqual(expect.arrayContaining(SAME_INSTANT));
  });
});

describe('objectui#10829 §5 — membership reads ===, so a stored NaN is not a member of [NaN]', () => {
  /**
   * `includes` read SameValueZero, which finds `NaN` in `[NaN]`; `===` never
   * equals `NaN`. Membership now agrees with `{ x: NaN }` and `$eq`. One `NaN`
   * row is stored by the constructor (`structuredClone` keeps `NaN`), and one is
   * written through `create`, which copies the record shallowly.
   */
  async function queryNaN(filter: unknown) {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ds = new ValueDataSource<{ id: string; x: unknown }>({
        items: [{ id: 'nan', x: NaN }, { id: 'one', x: 1 }],
      });
      await ds.create('rows', { id: 'created-nan', x: NaN });
      const result = await ds.find('rows', { $filter: filter as QueryParams['$filter'] });
      return { ids: result.data.map((r) => r.id), warns: warn.mock.calls.length };
    } finally {
      warn.mockRestore();
    }
  }

  it.each<[string, unknown]>([
    ['{ x: { $in: [NaN] } }', { x: { $in: [NaN] } }],
    ["['x', 'in', [NaN]]", ['x', 'in', [NaN]]],
  ])('%s answers no row', async (_label, filter) => {
    expect(await queryNaN(filter)).toEqual({ ids: [], warns: 0 });
  });

  it.each<[string, unknown]>([
    ['{ x: { $nin: [NaN] } }', { x: { $nin: [NaN] } }],
    ["['x', 'nin', [NaN]]", ['x', 'nin', [NaN]]],
  ])('%s keeps every row, the NaN rows included', async (_label, filter) => {
    expect(await queryNaN(filter)).toEqual({ ids: ['nan', 'one', 'created-nan'], warns: 0 });
  });

  it('{ x: NaN } and $eq agree: no row', async () => {
    expect(await queryNaN({ x: NaN })).toEqual({ ids: [], warns: 0 });
    expect(await queryNaN({ x: { $eq: NaN } })).toEqual({ ids: [], warns: 0 });
  });
});
