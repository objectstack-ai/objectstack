// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21177] The CALLER-CONTENT admission — the door refuses, for every caller and
 * with no security provider wired, a member a caller supplied at query time whose
 * text is not a plain column reference the admission can judge. The envelope is
 * `INVALID_FIELD` / 400 (the invalid-member envelope), not the field gate's
 * `PERMISSION_DENIED` / 403: caller text that names no attributable field is an
 * invalid request, not a permission verdict.
 *
 * These are the module's own unit tests. The door-level pins — both doors, both
 * roles, nothing evaluated — live in `caller-content-admission-door.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { Dataset } from '@objectstack/spec/ui';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import {
  COLUMN_REFERENCE,
  isColumnReference,
  assertDatasetContentJudgeable,
  assertQueryMembersJudgeable,
} from '../caller-content-admission.js';

const BASE = 'line_item';

/** The same grammar `@objectstack/spec`'s `CUBE_MEMBER_SQL` enforces on authored cube members. */
const CUBE_MEMBER_SQL = /^(?:\*|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/;

describe('[#21177] caller-content-admission — the grammar', () => {
  it('matches the authored-cube column-reference grammar byte for byte', () => {
    expect(COLUMN_REFERENCE.source).toBe(CUBE_MEMBER_SQL.source);
  });

  it.each([
    ['a bare field', 'amount'],
    ['a snake_case field', 'created_at'],
    ['a relationship path', 'account.region'],
    ['a multi-hop path', 'account.owner.region'],
    ['the count wildcard', '*'],
    ['a field with surrounding whitespace', '  amount  '],
  ])('admits %s', (_label, value) => {
    expect(isColumnReference(value)).toBe(true);
  });

  it.each([
    ['an arithmetic expression', 'amount * 2'],
    ['an aggregate ratio', 'SUM(amount) / COUNT(*)'],
    ['a CASE expression', "CASE WHEN status = 'x' THEN 1 ELSE 0 END"],
    ['a parenthesised subquery', '(SELECT value FROM other_object)'],
    ['a quoted identifier', '"amount"'],
    ['a dotted path ending in a wildcard', 'account.*'],
    ['an empty string', ''],
    ['a comma list', 'a, b'],
    ['a non-string', 42 as unknown],
    ['null', null as unknown],
    ['undefined', undefined as unknown],
  ])('refuses %s', (_label, value) => {
    expect(isColumnReference(value)).toBe(false);
  });
});

describe('[#21177] caller-content-admission — an inline dataset', () => {
  const ok = (overrides: Partial<Dataset>): Dataset => ({
    name: 'ds',
    label: 'DS',
    object: BASE,
    dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
    measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
    ...overrides,
  } as Dataset);

  it('admits dimensions and measures on declared fields, and a plain count', () => {
    expect(() => assertDatasetContentJudgeable(ok({
      dimensions: [{ name: 'region', field: 'account.region', type: 'string' }, { name: 'status', field: 'status', type: 'string' }],
      measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }, { name: 'n', aggregate: 'count' } as never],
    }))).not.toThrow();
  });

  it('admits a derived measure (it references other measures by name, carries no field)', () => {
    expect(() => assertDatasetContentJudgeable(ok({
      measures: [
        { name: 'won', aggregate: 'count', filter: { status: 'won' } } as never,
        { name: 'all', aggregate: 'count' } as never,
        { name: 'rate', derived: { op: 'ratio', of: ['won', 'all'] } } as never,
      ],
    }))).not.toThrow();
  });

  it('refuses a dimension whose field is an expression, naming the member, not the field text', () => {
    const err = catchErr(() => assertDatasetContentJudgeable(ok({
      dimensions: [{ name: 'leaked', field: '(SELECT value FROM other_object)', type: 'string' }],
    })));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'leaked', param: 'dimensions', cube: 'ds' });
    expect(String(err?.message)).not.toContain('SELECT');
    expect(String(err?.message)).not.toContain('other_object');
  });

  it('refuses a measure whose field is an expression', () => {
    const err = catchErr(() => assertDatasetContentJudgeable(ok({
      measures: [{ name: 'derived_total', aggregate: 'sum', field: 'amount * rate' } as never],
    })));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'derived_total', param: 'measures' });
  });

  it('refuses an expression hidden in the dataset filter', () => {
    const err = catchErr(() => assertDatasetContentJudgeable(ok({
      filter: { '(SELECT value FROM other_object)': 'x' } as never,
    })));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'where', cube: 'ds' });
  });

  it('refuses an expression hidden in the selection runtimeFilter', () => {
    const err = catchErr(() => assertDatasetContentJudgeable(
      ok({}),
      { dimensions: ['region'], measures: ['total'], runtimeFilter: { 'amount > (SELECT max(value) FROM other_object)': 1 } } as never,
    ));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'where' });
  });

  it('admits a dataset filter and runtimeFilter over declared fields', () => {
    expect(() => assertDatasetContentJudgeable(
      ok({ filter: { status: 'open' } as never }),
      { dimensions: ['region'], measures: ['total'], runtimeFilter: { 'account.region': 'west' } } as never,
    )).not.toThrow();
  });
});

describe('[#21177] caller-content-admission — a /analytics/query member', () => {
  const cube: Cube = {
    name: 'authored',
    title: 'Authored',
    sql: BASE,
    public: true,
    measures: { total: { type: 'sum', sql: 'amount', label: 'Total' }, count: { type: 'count', sql: '*', label: 'Count' } },
    dimensions: { region: { type: 'string', sql: 'account.region', label: 'Region' } },
  } as Cube;

  it('admits declared members and plain field spellings', () => {
    for (const query of [
      { cube: 'authored', measures: ['total'], dimensions: ['region'] },
      { cube: 'authored', measures: ['count'], dimensions: ['status'] }, // undeclared but a bare field
      { cube: 'authored', measures: ['count'], where: { 'account.region': 'west' } },
      { cube: 'authored', measures: ['count'], dimensions: ['region'], order: { total: 'desc' } },
    ] as AnalyticsQuery[]) {
      expect(() => assertQueryMembersJudgeable(query, cube)).not.toThrow();
    }
  });

  it('refuses an undeclared dimension spelled as an expression', () => {
    const err = catchErr(() => assertQueryMembersJudgeable(
      { cube: 'authored', measures: ['count'], dimensions: ['(SELECT value FROM other_object)'] } as AnalyticsQuery,
      cube,
    ));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'dimensions', cube: 'authored' });
  });

  it('refuses an expression in where and in order', () => {
    const whereErr = catchErr(() => assertQueryMembersJudgeable(
      { cube: 'authored', measures: ['count'], where: { 'amount * 2': 1 } } as AnalyticsQuery, cube,
    ));
    expect(whereErr).toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'where' });
    const orderErr = catchErr(() => assertQueryMembersJudgeable(
      { cube: 'authored', measures: ['count'], dimensions: ['region'], order: { 'amount * 2': 'asc' } } as AnalyticsQuery, cube,
    ));
    expect(orderErr).toMatchObject({ code: 'INVALID_FIELD', status: 400 });
  });

  it('refuses an undeclared time dimension spelled as an expression', () => {
    const err = catchErr(() => assertQueryMembersJudgeable(
      { cube: 'authored', measures: ['count'], timeDimensions: [{ dimension: '(SELECT created_at FROM other_object)', granularity: 'month' }] } as AnalyticsQuery,
      cube,
    ));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'timeDimensions' });
  });

  it('leaves a DECLARED member whose sql is an expression to the field gate (does not refuse it here)', () => {
    const authoredExpr: Cube = {
      ...cube,
      dimensions: { ...(cube.dimensions as object), flag: { type: 'number', sql: "CASE WHEN status = 'x' THEN 1 ELSE 0 END", label: 'Flag' } },
    } as Cube;
    expect(() => assertQueryMembersJudgeable(
      { cube: 'authored', measures: ['count'], dimensions: ['flag'] } as AnalyticsQuery, authoredExpr,
    )).not.toThrow();
  });
});

function catchErr(fn: () => void): (Record<string, unknown> & { message?: string }) | null {
  try { fn(); return null; } catch (e) { return e as Record<string, unknown> & { message?: string }; }
}
