// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32279] A long spec refusal carries a one-line head beside its full
 * prescription: the data doors answer the head as the message and the
 * prescription as the hint, while every authoring surface keeps printing the
 * prescription byte for byte.
 *
 * The wire end of the same pins, over real routes, is
 * `packages/rest/src/data-refusal-head-hint-door.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { FieldErrorSchema, FindDataRequestSchema, zodIssuesToFields, refusalHeadOf, REFUSAL_HEAD_MAX } from '../api';
import { QuerySchema, QUERY_CURSOR_REMOVED, QUERY_DISTINCT_REMOVED, FilterConditionSchema } from '../data';
import { assertListComparandShapes } from '../data/filter-comparand-shape';
import { formatZodIssue } from './error-map.zod';
import { withRefusalHead, assertRefusalHead, headFieldName } from './refusal-head';

/** The issues a parse of `query` raises, as the `POST /query` door parses it. */
function findIssues(query: Record<string, unknown>) {
  const input = { object: 'deal', query: { object: 'deal', ...query } };
  const parsed = FindDataRequestSchema.safeParse(input);
  expect(parsed.success).toBe(false);
  return { input, issues: parsed.error!.issues };
}

/** The refusal the comparand-shape face throws for `node`, as the engine calls it. */
function faceRefusal(node: unknown, context?: string): Error & { refusalHead?: string; code?: string; status?: number } {
  try {
    assertListComparandShapes(node, context);
  } catch (error) {
    return error as Error & { refusalHead?: string };
  }
  throw new Error(`the face accepted ${JSON.stringify(node)}`);
}

describe('the listed query refusals carry a head', () => {
  const CASES: ReadonlyArray<{ name: string; query: Record<string, unknown>; names: string; code: string }> = [
    { name: 'array_agg', query: { aggregations: [{ function: 'array_agg', field: 'x', alias: 'a' }] }, names: '`array_agg`', code: 'invalid_option' },
    { name: 'string_agg', query: { aggregations: [{ function: 'string_agg', field: 'x', alias: 'a' }] }, names: '`string_agg`', code: 'invalid_option' },
    { name: 'aggregations[].distinct', query: { aggregations: [{ function: 'sum', field: 'x', alias: 'a', distinct: true }] }, names: '`query.aggregations[].distinct`', code: 'invalid_type' },
    { name: 'joins', query: { joins: [] }, names: '`query.joins`', code: 'invalid_type' },
    { name: 'cursor', query: { cursor: { id: 1 } }, names: '`query.cursor`', code: 'invalid_type' },
    { name: 'distinct', query: { distinct: true }, names: '`query.distinct`', code: 'invalid_type' },
  ];

  for (const c of CASES) {
    it(`${c.name}: fields[].message is a head ≤ ${REFUSAL_HEAD_MAX} naming the key, fields[].hint the whole prescription`, () => {
      const { input, issues } = findIssues(c.query);
      expect(issues).toHaveLength(1);
      const [entry] = zodIssuesToFields(issues, input);
      expect(entry.code).toBe(c.code);
      expect(entry.message.length).toBeLessThanOrEqual(REFUSAL_HEAD_MAX);
      expect(entry.message).not.toContain('\n');
      expect(entry.message).toContain(c.names);
      expect(entry.message).toMatch(/: (delete|read|page)/);
      // The hint is the issue's own message: the prescription, unchanged.
      expect(entry.hint).toBe(issues[0].message);
      expect(entry.hint!.length).toBeGreaterThan(600);
    });
  }

  it('CONTROL — the authoring surface (`os compile` renders through `formatZodIssue`) prints the whole prescription, byte for byte', () => {
    const cursor = QuerySchema.safeParse({ object: 'deal', cursor: { id: 1 } });
    expect(cursor.error!.issues[0].message).toBe(QUERY_CURSOR_REMOVED);
    expect(formatZodIssue(cursor.error!.issues[0] as never)).toContain(QUERY_CURSOR_REMOVED);
    const distinct = QuerySchema.safeParse({ object: 'deal', distinct: true });
    expect(distinct.error!.issues[0].message).toBe(QUERY_DISTINCT_REMOVED);
    expect(formatZodIssue(distinct.error!.issues[0] as never)).not.toContain(refusalHeadOf(distinct.error!.issues[0])!);
  });

  it('CONTROL — an issue without a head maps as before: its own message, no `hint` member', () => {
    const { input, issues } = findIssues({ windowFunctions: [] });
    const [entry] = zodIssuesToFields(issues, input);
    expect(entry.message).toBe(issues[0].message);
    expect(entry).not.toHaveProperty('hint');
  });
});

describe('the comparand refusals carry a head', () => {
  it('the save door (`FilterConditionSchema`): the issue keeps the prescription, `params.refusalHead` carries the head', () => {
    const parsed = FilterConditionSchema.safeParse({ title: { $in: 'x' } });
    const issue = parsed.error!.issues[0] as { message: string; params?: { refusalHead?: string } };
    expect(issue.message).toContain('requires an ARRAY of values');
    expect(issue.message).toContain('Authoring spellings: in.');
    expect(issue.params?.refusalHead).toBe('Operator "$in" on field "title" requires an array of values: wrap a single value in a list, or use "=" ($eq).');
    expect(formatZodIssue(issue as never)).toContain(issue.message);
  });

  it('the save door\'s flag arm writes its own head', () => {
    const { input, issues } = findIssues({ where: { done: { $null: 'yes' } } });
    const [entry] = zodIssuesToFields(issues, input);
    expect(entry.message).toBe('Operator "$null" on field "done" requires a boolean comparand: write true or false.');
    expect(entry.hint).toContain('read one in OPPOSITE directions');
  });

  it('the face: the error keeps its message, `refusalHead` carries the head, led by the caller context when both fit', () => {
    const bare = faceRefusal({ title: { $in: 'x' } });
    const led = faceRefusal({ title: { $in: 'x' } }, "find('deal')");
    expect(led.message).toBe(`find('deal'): ${bare.message}`);
    expect(bare.refusalHead).toBe('Operator "$in" on field "title" requires an array of values: wrap a single value in a list, or use "=" ($eq).');
    expect(led.refusalHead).toBe(`find('deal'): ${bare.refusalHead}`);
    expect({ code: led.code, status: led.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    // A context that would push the head past the bound is left out of it;
    // the message keeps it.
    const longContext = `find('${'o'.repeat(80)}')`;
    const unled = faceRefusal({ title: { $in: 'x' } }, longContext);
    expect(unled.refusalHead).toBe(bare.refusalHead);
    expect(unled.message.startsWith(`${longContext}: `)).toBe(true);
  });

  it(`every face arm writes a head ≤ ${REFUSAL_HEAD_MAX} naming its operator, whatever the field name`, () => {
    const field = 'f'.repeat(200);
    const nodes: Array<[string, Record<string, unknown>]> = [
      ['$in', { $in: 'x' }],
      ['$between', { $between: [1] }],
      ['$in', { $in: [1, null] }],
      ['$between', { $between: [null, 2] }],
      ['$between', { $between: ['', 2] }],
      ['$between', { $between: [{ $field: 'a' }, 2] }],
      ['$gt', { $gt: null }],
      ['$eq', { $eq: [1, 2] }],
      ['$ne', { $ne: [1, 2] }],
      ['$gt', { $gt: [1, 2] }],
      // The longest operator a list arm names.
      ['$notContains', { $notContains: [1, 2] }],
    ];
    const heads = new Set<string>();
    for (const [op, spec] of nodes) {
      const err = faceRefusal({ [field]: spec }, "find('deal')");
      expect(err.refusalHead, JSON.stringify(spec)).toBeDefined();
      expect(err.refusalHead!.length, err.refusalHead).toBeLessThanOrEqual(REFUSAL_HEAD_MAX);
      expect(err.refusalHead).toContain(`Operator "${op}" on field "${headFieldName(field)}"`);
      expect(err.message).toContain(`"${field}"`);
      heads.add(err.refusalHead!.replace(/^find\('deal'\): /, ''));
    }
    // The implicit-equality arm names the field, not an operator.
    const implicit = faceRefusal({ [field]: [1, 2] });
    expect(implicit.refusalHead).toContain(`field "${headFieldName(field)}"`);
    expect(implicit.refusalHead!.length).toBeLessThanOrEqual(REFUSAL_HEAD_MAX);
    // Each arm wrote its own head: no two conditions share one.
    expect(heads.size).toBe(nodes.length);
  });
});

describe('the head contract', () => {
  it('a head that is blank, two lines or past the bound is refused where it is declared', () => {
    expect(() => assertRefusalHead('')).toThrow(/one non-blank line/);
    expect(() => assertRefusalHead('a\nb')).toThrow(/one non-blank line/);
    expect(() => assertRefusalHead('x'.repeat(REFUSAL_HEAD_MAX + 1))).toThrow(/at most 160/);
    expect(() => withRefusalHead('prescription 32279', 'x'.repeat(REFUSAL_HEAD_MAX + 1))).toThrow();
    expect(() => assertRefusalHead('x'.repeat(REFUSAL_HEAD_MAX))).not.toThrow();
  });

  it('`refusalHeadOf` reads the three carriers and ignores a carrier that is not a head', () => {
    expect(refusalHeadOf({ refusalHead: 'own', params: { refusalHead: 'param' } })).toBe('own');
    expect(refusalHeadOf({ params: { refusalHead: 'param' } })).toBe('param');
    expect(refusalHeadOf({ message: withRefusalHead('registered prescription 32279', 'registered head') })).toBe('registered head');
    expect(refusalHeadOf({ message: 'an unregistered message' })).toBeUndefined();
    expect(refusalHeadOf({ refusalHead: 'a\nb' })).toBeUndefined();
    expect(refusalHeadOf({ refusalHead: 'x'.repeat(REFUSAL_HEAD_MAX + 1) })).toBeUndefined();
    expect(refusalHeadOf({ refusalHead: 42 })).toBeUndefined();
    expect(refusalHeadOf(null)).toBeUndefined();
    expect(refusalHeadOf('a string')).toBeUndefined();
  });
});

describe('FieldErrorSchema.hint', () => {
  it('parses an entry with and without `hint`, and keeps it', () => {
    const base = { field: 'query.cursor', code: 'invalid_type', message: 'head' };
    expect(FieldErrorSchema.parse(base)).toEqual(base);
    expect(FieldErrorSchema.parse({ ...base, hint: 'the prescription' })).toEqual({ ...base, hint: 'the prescription' });
    expect(FieldErrorSchema.safeParse({ ...base, hint: 42 }).success).toBe(false);
  });
});
