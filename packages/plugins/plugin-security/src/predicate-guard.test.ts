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

/**
 * A cross-field comparand names a field exactly as a condition key does: the
 * comparison reads that field's value, so it is collected by the same walk and
 * judged by the same rule. The positions below are every one the filter
 * grammar admits for a comparand (`FieldReferenceSchema`, `data/filter.zod.ts`):
 * the whole comparand of the six scalar comparisons, the whole-day offset
 * wrapper (its base and its offset column), under any logical nesting, in each
 * clause that carries a condition.
 */
describe('a cross-field comparand is collected and judged like a condition key', () => {
  const SEALED = { sealed_n: { readable: false, editable: false } };
  const ref = (field: string, extra: Record<string, unknown> = {}) => ({ $field: field, ...extra });

  it.each(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'])(
    'collects the field a %s comparand names',
    (op) => {
      expect([...collectConditionFields({ seen_a: { [op]: ref('seen_b') } })].sort()).toEqual(['seen_a', 'seen_b']);
    },
  );

  it('collects a comparand under every logical nesting', () => {
    const fields = collectConditionFields({
      $and: [
        { $or: [{ seen_a: 1 }, { seen_b: { $gt: ref('seen_c') } }] },
        { $not: { seen_d: { $lte: ref('seen_e') } } },
      ],
    });
    expect([...fields].sort()).toEqual(['seen_a', 'seen_b', 'seen_c', 'seen_d', 'seen_e']);
  });

  it('collects both fields a whole-day offset comparand names: its base and its offset column', () => {
    expect([...collectConditionFields({ seen_day: { $lte: ref('base_day', { addDays: 3 }) } })].sort())
      .toEqual(['base_day', 'seen_day']);
    expect([...collectConditionFields({ seen_day: { $lte: ref('base_day', { addDays: ref('offset_n') }) } })].sort())
      .toEqual(['base_day', 'offset_n', 'seen_day']);
  });

  it('gates a dotted comparand on its first segment, as it gates a dotted key', () => {
    expect([...collectConditionFields({ seen_a: { $gt: ref('link.seen_b') } })].sort()).toEqual(['link', 'seen_a']);
  });

  it('collects comparands in where, having and a per-aggregation filter', () => {
    const fields = collectQueryFields({
      where: { seen_a: { $gt: ref('in_where') } },
      having: { total: { $lt: ref('in_having') } },
      aggregations: [{ function: 'count', alias: 'n', filter: { seen_b: { $ne: ref('in_agg_filter') } } }],
    });
    expect(['in_where', 'in_having', 'in_agg_filter'].filter((f) => !fields.has(f))).toEqual([]);
  });

  /** The refusal a query gets, or `undefined` when it is admitted. */
  function refusalOf(ast: Record<string, unknown>): { code?: unknown; statusCode?: unknown; message?: unknown; details?: unknown } | undefined {
    try {
      assertReadableQueryFields(ast, SEALED, 'probe_object');
    } catch (e) {
      return e as { code?: unknown; statusCode?: unknown; message?: unknown; details?: unknown };
    }
    return undefined;
  }

  /** The hidden field named as a KEY — the reference answer every comparand position is held to. */
  const KEY_FORM = refusalOf({ where: { sealed_n: { $gt: 1 } } });

  it('the key form is refused 403 PERMISSION_DENIED (the reference)', () => {
    expect(isPermissionDeniedError(KEY_FORM)).toBe(true);
    expect({ code: KEY_FORM?.code, status: KEY_FORM?.statusCode }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
  });

  const POSITIONS: Array<[string, Record<string, unknown>]> = [
    ...['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'].map(
      (op): [string, Record<string, unknown>] => [`the whole comparand of ${op}`, { where: { seen_a: { [op]: ref('sealed_n') } } }],
    ),
    ['a comparand under $and', { where: { $and: [{ seen_b: 'x' }, { seen_a: { $gt: ref('sealed_n') } }] } }],
    ['a comparand under $or', { where: { $or: [{ seen_b: 'x' }, { seen_a: { $gt: ref('sealed_n') } }] } }],
    ['a comparand under $not', { where: { $not: { seen_a: { $gt: ref('sealed_n') } } } }],
    ['the base of a whole-day offset comparand', { where: { seen_day: { $lte: ref('sealed_n', { addDays: 1 }) } } }],
    ['the offset column of a whole-day offset comparand', { where: { seen_day: { $lte: ref('base_day', { addDays: ref('sealed_n') }) } } }],
    ['a comparand in having', { having: { total: { $gt: ref('sealed_n') } } }],
    ['a comparand in a per-aggregation filter', { aggregations: [{ function: 'count', alias: 'n', filter: { seen_a: { $gt: ref('sealed_n') } } }] }],
  ];

  it.each(POSITIONS)('a hidden field as %s answers the key form\'s refusal', (_position, ast) => {
    const refusal = refusalOf(ast);
    expect(isPermissionDeniedError(refusal)).toBe(true);
    expect({ code: refusal?.code, status: refusal?.statusCode, message: refusal?.message, details: refusal?.details })
      .toEqual({ code: KEY_FORM?.code, status: KEY_FORM?.statusCode, message: KEY_FORM?.message, details: KEY_FORM?.details });
  });

  it('CONTROL a readable comparand in the same positions is admitted', () => {
    for (const [, ast] of POSITIONS) {
      const readable = JSON.parse(JSON.stringify(ast).replaceAll('sealed_n', 'seen_c')) as Record<string, unknown>;
      expect(refusalOf(readable)).toBeUndefined();
    }
  });
});
