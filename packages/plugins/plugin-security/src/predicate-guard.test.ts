// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/** Field-level predicate guard — anti filter-oracle (objectui#2251). */

import { describe, it, expect } from 'vitest';
import {
  collectConditionFields,
  collectQueryFields,
  assertReadableQueryFields,
} from './predicate-guard.js';
import { isPermissionDeniedError } from './errors.js';

const HIDDEN_SALARY = { salary: { readable: false, editable: false } };

describe('collectConditionFields', () => {
  it('collects implicit equality, operators, and logical nesting', () => {
    const fields = collectConditionFields({
      status: 'open',
      salary: { $gte: 100000 },
      $or: [{ priority: 'high' }, { $not: { archived: true } }],
      $and: [{ due_date: { $lte: '2026-12-31' } }],
    });
    expect([...fields].sort()).toEqual(['archived', 'due_date', 'priority', 'salary', 'status']);
  });

  it('gates dotted paths on the first segment', () => {
    expect([...collectConditionFields({ 'owner.name': 'x' })]).toEqual(['owner']);
  });
});

describe('collectQueryFields', () => {
  // `windowFunctions` left this walk with the `QueryAST` key (#4286) — the
  // tombstone refuses it wherever the schema parses, and no executor ever ran
  // one off the query path, so there is no clause left to leak through.
  it('covers where / orderBy / groupBy / having / aggregations', () => {
    const fields = collectQueryFields({
      where: { status: 'open' },
      orderBy: [{ field: 'salary', order: 'desc' }],
      groupBy: ['department', { field: 'hired_at', dateGranularity: 'month' }],
      having: { headcount: { $gt: 3 } },
      aggregations: [{ function: 'sum', field: 'bonus', alias: 'total', filter: { region: 'emea' } }],
    });
    expect([...fields].sort()).toEqual([
      'bonus', 'department', 'headcount', 'hired_at', 'region', 'salary', 'status',
    ]);
  });

  it('does NOT collect the projection — masked selects are harmless', () => {
    const fields = collectQueryFields({ fields: ['salary', 'name'], where: { status: 'open' } });
    expect(fields.has('salary')).toBe(false);
  });
});

describe('assertReadableQueryFields', () => {
  it('rejects a where predicate on a hidden field (the oracle)', () => {
    expect(() =>
      assertReadableQueryFields({ where: { salary: { $gte: 100000 } } }, HIDDEN_SALARY, 'employee'),
    ).toThrowError(/salary/);
  });

  it('rejects sorting by a hidden field and reports it as a 403 sentinel', () => {
    try {
      assertReadableQueryFields({ orderBy: [{ field: 'salary', order: 'desc' }] }, HIDDEN_SALARY, 'employee');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(isPermissionDeniedError(e)).toBe(true);
      expect((e as { details?: { fields?: string[] } }).details?.fields).toEqual(['salary']);
    }
  });

  it('rejects hidden fields buried in $or branches', () => {
    expect(() =>
      assertReadableQueryFields(
        { where: { $or: [{ status: 'open' }, { salary: { $gt: 1 } }] } },
        HIDDEN_SALARY,
        'employee',
      ),
    ).toThrow();
  });

  it('passes queries touching only readable fields', () => {
    expect(() =>
      assertReadableQueryFields(
        { where: { status: 'open' }, orderBy: [{ field: 'due_date', order: 'asc' }] },
        HIDDEN_SALARY,
        'employee',
      ),
    ).not.toThrow();
  });

  it('passes when field permissions grant read (readable !== false)', () => {
    expect(() =>
      assertReadableQueryFields(
        { where: { salary: { $gte: 1 } } },
        { salary: { readable: true } },
        'employee',
      ),
    ).not.toThrow();
  });

  it('no-ops when no field permissions are configured', () => {
    expect(() => assertReadableQueryFields({ where: { salary: 1 } }, {}, 'employee')).not.toThrow();
  });
});
