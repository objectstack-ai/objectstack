// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0053 D-D1, amended 2026-09-30 — #5930 step 3] The analytics `where` and
 * draft-preview door's placement of the shared `FilterCondition →
 * FilterCondition` lowering (`lowerFilterCondition`, `@objectstack/spec/data`):
 * run on what the door admitted — after both shared comparand faces
 * (`normalizeWhereComparands`, or `parseFilterAST` for the array spelling) —
 * before any face reads the condition. Filter tokens resolve upstream of this
 * door on every path that reaches it (`AnalyticsService.resolveQueryTokens`,
 * the per-request dataset-scope getter, `DatasetExecutor`'s selection tokens),
 * so the lowering reads the comparand the comparison will run with (the
 * amendment's item 3).
 *
 * Two faces consume the door, and each is pinned at its own entry:
 *
 * - **F10**, the `where` → tree face (`normalizeAnalyticsFilterTree`), which
 *   both strategies compile: `NativeSQLStrategy`'s SQL, `ObjectQLStrategy`'s
 *   `/analytics/sql` echo, and `ObjectQLStrategy`'s hand-off to the engine.
 * - **F11**, the draft-preview evaluator (`evaluateAnalyticsQueryOverRows`).
 *
 * ## Column-type scope (item 7)
 *
 * F10 can read declared types through the strategy context's
 * `declaredFieldType` hook, so it rewrites the whole-day bound on a member
 * whose column is declared `datetime` and nowhere else — the engine seam's
 * scope, which is what the ObjectQL hand-off meets next. [#5930 step 4] A
 * column the hook cannot name a type for is read per strategy
 * (`declaredDatetimeLowering`'s `undeclared` argument): type-blind on the
 * native strategy, the last seam before its statement runs, and as written on
 * the ObjectQL strategy, whose engine seam reads the declaration.
 *
 * F11 evaluates drafted rows, which carry no schema of their own. [#5930 step
 * 4] Its reader is the drafted object's declared types, which `queryDataset`'s
 * preview branch hands it from `sourceFieldMeta`
 * (`declaredPreviewLowering`): a declared `datetime` is rewritten, any other
 * declared column is compared as written, and a column with no declared type
 * (or a caller that hands none, as below) reads type-blind. Its own bound copy
 * (`lteBound`) is deleted. The NULL-polarity guards apply on both faces
 * whatever the type.
 */

import { describe, it, expect } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS, type Cube, type FilterCondition, type FilterLoweringOptions } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { collectFilterLeaves, normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';

const OBJECT = 'contract';

/** Each member names a column whose DECLARED type differs from its member name's hint. */
const DECLARED_TYPES: Record<string, string> = {
  signed_at: 'datetime',
  due_on: 'date',
  stage: 'text',
};

const CUBE: Cube = {
  name: 'contracts',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: {
    signed: { label: 'Signed', type: 'time', sql: 'signed_at' },
    due: { label: 'Due', type: 'time', sql: 'due_on' },
    stage: { label: 'Stage', type: 'string', sql: 'stage' },
  },
  public: true,
} as unknown as Cube;

/** The strategies' reader, by hand: `signed` is the one member whose column is declared `datetime`. */
const TYPED: FilterLoweringOptions = { isDatetimeColumn: (member: string) => member === 'signed' };
const UNTYPED: FilterLoweringOptions = { isDatetimeColumn: () => false };

const leaf = (member: string, operator: string, values: unknown[]) => ({ kind: 'leaf', member, operator, values });

describe('[ADR-0053 D-D1 amended — #5930 step 3] F10: the where → tree face compiles the lowered condition', () => {
  const tree = (where: FilterCondition, lowering = TYPED) =>
    (normalizeAnalyticsFilterTree as (q: unknown, l: unknown) => unknown)({ where }, lowering);

  it('a bare-day $lte on a datetime member becomes lt the next day', () => {
    expect(tree({ signed: { $lte: '2026-07-28' } })).toEqual(leaf('signed', 'lt', ['2026-07-29']));
  });

  it('the last supported day keeps only "has a value"', () => {
    expect(tree({ signed: { $lte: '9999-12-31' } })).toEqual(leaf('signed', 'set', []));
  });

  it('a bare-day $between on a datetime member becomes gte its minimum and lt the next day', () => {
    expect(tree({ signed: { $between: ['2026-07-27', '2026-07-28'] } })).toEqual({
      kind: 'and',
      children: [leaf('signed', 'gte', ['2026-07-27']), leaf('signed', 'lt', ['2026-07-29'])],
    });
  });

  it('a date member keeps its bound as written (item 7)', () => {
    expect(tree({ due: { $lte: '2026-07-28' } })).toEqual(leaf('due', 'lte', ['2026-07-28']));
  });

  it('with no declared-type reader, no member reads as datetime', () => {
    expect(tree({ signed: { $lte: '2026-07-28' } }, UNTYPED)).toEqual(leaf('signed', 'lte', ['2026-07-28']));
  });

  it('a negative-polarity leaf reaches the tree inside the NULL escape the seam emits, whatever the type', () => {
    // The disjunction is the seam's `{ $or: [{ stage: { $null: true } },
    // { stage: { $ne: 'won' } }] }`. [#5930 step 4] It is the guard's one
    // source: this face's own interim copy (`fieldLeaves`' #5298 wrap, which
    // nested a second disjunction inside it) is deleted.
    expect(tree({ stage: { $ne: 'won' } }, UNTYPED)).toEqual({
      kind: 'or',
      children: [leaf('stage', 'notSet', []), leaf('stage', 'notEquals', ['won'])],
    });
  });

  it('a nested relation under $not travels as written and unguarded: the engine guards what it lowers it to', () => {
    // [#20887] REPLACED. This case pinned the door spelling the nested form
    // dotted (`account.region`) before the lowering read it, so the guard landed
    // on the joined member — the reading of a door that compiled the form into a
    // JOIN. The form is the ENGINE's now (#20802's ruling: served in `where` by
    // reading the related object as the caller, capped), carried as written and
    // held out of the shared lowering: the engine lowers it to `account IN
    // (ids)` and puts the NULL guard on that `$in` itself.
    expect(tree({ $not: { account: { region: 'NA' } } })).toEqual({
      kind: 'not',
      child: { kind: 'relation', member: 'account', condition: { region: 'NA' } },
    });
    // A second level is carried as written too: the engine refuses it (one level).
    expect(tree({ $not: { account: { owner: { name: 'x' } } } })).toEqual({
      kind: 'not',
      child: { kind: 'relation', member: 'account', condition: { owner: { name: 'x' } } },
    });
    // Beside a guarded leaf, only the leaf is guarded.
    const members = (where: FilterCondition) =>
      [...new Set(collectFilterLeaves(tree(where) as never).map((l) => l.member))].sort();
    expect(members({ $not: { $and: [{ account: { region: 'NA' } }, { stage: 'won' }] } })).toEqual(['account', 'stage']);
  });

  it('an instant is never widened', () => {
    expect(tree({ signed: { $lte: '2026-07-28T12:00:00.000Z' } })).toEqual(
      leaf('signed', 'lte', ['2026-07-28T12:00:00.000Z']),
    );
  });
});

describe('[ADR-0053 D-D1 amended — #5930 step 3] F10 through ObjectQLStrategy: the engine hand-off and the echo', () => {
  /** A context whose engine bridge records the filter the strategy hands it. */
  const ctxWith = (handed: Array<Record<string, unknown>>, typed = true): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'contracts' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      ...(typed ? { declaredFieldType: (object: string, field: string) => (object === OBJECT ? DECLARED_TYPES[field] : undefined) } : {}),
      executeAggregate: async (_object: string, options: { filter?: Record<string, unknown> }) => {
        handed.push(options.filter ?? {});
        return [];
      },
    }) as unknown as StrategyContext;

  const query = (where: FilterCondition): AnalyticsQuery => ({ cube: 'contracts', measures: ['n'], where }) as AnalyticsQuery;

  it('the engine receives the lowered bound for a datetime member', async () => {
    const handed: Array<Record<string, unknown>> = [];
    await new ObjectQLStrategy().execute(query({ signed: { $lte: '2026-07-28' } }), ctxWith(handed));
    expect(handed).toEqual([{ signed_at: { $lt: '2026-07-29' } }]);
  });

  it('the engine receives a date member\'s bound as written', async () => {
    const handed: Array<Record<string, unknown>> = [];
    await new ObjectQLStrategy().execute(query({ due: { $lte: '2026-07-28' } }), ctxWith(handed));
    expect(handed).toEqual([{ due_on: { $lte: '2026-07-28' } }]);
  });

  it('with no declared-type hook on the context, the engine receives the bound as written', async () => {
    const handed: Array<Record<string, unknown>> = [];
    await new ObjectQLStrategy().execute(query({ signed: { $lte: '2026-07-28' } }), ctxWith(handed, false));
    expect(handed).toEqual([{ signed_at: { $lte: '2026-07-28' } }]);
  });

  it('the /analytics/sql echo prints the half-open bound the engine executes', async () => {
    const { sql, params } = await new ObjectQLStrategy().generateSql(
      query({ signed: { $lte: '2026-07-28' } }),
      ctxWith([]),
    );
    expect(sql).toContain('signed_at < $1');
    expect(params).toEqual(['2026-07-29']);
  });
});

describe('[ADR-0053 D-D1 amended — #5930 step 3] F11: the draft preview evaluates the lowered condition', () => {
  const PREVIEW_CUBE = {
    name: 'rows',
    sql: 'row',
    measures: { n: { sql: '*', type: 'count', title: 'n' } },
    dimensions: { id: { label: 'id', type: 'string', sql: 'id' } },
    public: true,
  } as unknown as Cube;

  const previewIds = (where: FilterCondition, rows: ReadonlyArray<object>): string[] =>
    evaluateAnalyticsQueryOverRows(
      { cube: 'rows', dimensions: ['id'], measures: ['n'], where } as AnalyticsQuery,
      PREVIEW_CUBE,
      rows.map((r) => ({ ...(r as Record<string, unknown>) })),
    ).rows.map((r) => String(r.id)).sort();

  /** `stage` holds a value on p1, is null on p2, and is absent on p3. */
  const ROWS = [{ id: 'p1', stage: 'won' }, { id: 'p2', stage: null }, { id: 'p3' }];

  it('a row with no value satisfies $ne, even against the text "null" (every driver\'s answer)', () => {
    expect(previewIds({ stage: { $ne: 'null' } }, ROWS)).toEqual(['p1', 'p2', 'p3']);
  });

  it('a row with no value satisfies $nin, even when a member is the text "undefined"', () => {
    expect(previewIds({ stage: { $nin: ['undefined'] } }, ROWS)).toEqual(['p1', 'p2', 'p3']);
  });

  it('a row with no value satisfies the negation of an equality it cannot hold', () => {
    expect(previewIds({ $not: { stage: { $eq: 'null' } } }, ROWS)).toEqual(['p1', 'p2', 'p3']);
  });

  it('$null is evaluated: true selects the rows with no value, false the rows with one', () => {
    expect(previewIds({ stage: { $null: true } }, ROWS)).toEqual(['p2', 'p3']);
    expect(previewIds({ stage: { $null: false } }, ROWS)).toEqual(['p1']);
  });

  it('a bare-day bound is answered through the whole named day — the lowering\'s, read type-blind with no declared type', () => {
    const rows = [{ id: 'd27', at: '2026-07-27T10:00:00.000Z' }, { id: 'd28', at: '2026-07-28T10:00:00.000Z' }, { id: 'd29', at: '2026-07-29T10:00:00.000Z' }];
    expect(previewIds({ at: { $lte: '2026-07-28' } }, rows)).toEqual(['d27', 'd28']);
    expect(previewIds({ at: { $between: ['2026-07-28', '2026-07-28'] } }, rows)).toEqual(['d28']);
  });

  it('FILTER_LOGIC_CASES: the preview agrees with the shared table on every case it evaluates, and refuses the rest', () => {
    const answered: string[] = [];
    for (const c of FILTER_LOGIC_CASES) {
      let ids: string[] | undefined;
      try {
        ids = previewIds(c.filter, FILTER_LOGIC_ROWS);
      } catch (e) {
        expect((e as { code?: unknown }).code, `${c.name}: a refusal must be the INVALID_FILTER envelope`).toBe('INVALID_FILTER');
        expect((e as { status?: unknown }).status).toBe(400);
        continue;
      }
      expect(ids, `${c.name}: ${c.note ?? ''}`).toEqual(c.expected);
      answered.push(c.name);
    }
    // The two `$null` rows are answered now, not refused.
    expect(answered).toContain('$null true selects exactly the no-value rows');
    expect(answered).toContain('$null false selects exactly the valued rows');
  });
});
