// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_MAX_RELATED_ROWS,
  AI_CONTEXT_WHERE_OPERATORS,
  AiContextRelatedSchema,
  AiContextSchema,
  aiContextWhereFields,
} from './ai-context.zod';
import { FILTER_OPERATORS } from '../data/filter.zod';

/**
 * [ADR-0160 D1, second amendment] A `related` entry's `where`, `orderBy` and
 * `limit`, as the parse admits and refuses them. The render service's reader
 * is pinned in `@objectstack/service-record-context`.
 */
const entry = (extra: Record<string, unknown>) => ({ object: 'policy_revision', field: 'policy', ...extra });
const parse = (extra: Record<string, unknown>) => AiContextRelatedSchema.safeParse(entry(extra));
const messages = (extra: Record<string, unknown>): string => {
  const parsed = parse(extra);
  expect(parsed.success).toBe(false);
  return parsed.success ? '' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
};

describe('ai_context related — where, orderBy and limit (ADR-0160 D1, second amendment)', () => {
  it('admits the ten operators, joined by $and / $or, with literal comparands', () => {
    expect(AI_CONTEXT_WHERE_OPERATORS).toEqual(['$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte', '$null', '$exists']);
    for (const op of AI_CONTEXT_WHERE_OPERATORS) expect(FILTER_OPERATORS).toContain(op);
    const where = {
      is_current: { $eq: true },
      $or: [
        { status: { $in: ['active', 'draft'] }, sort_no: { $gte: 1, $lt: 10 } },
        { $and: [{ note: { $ne: 'x' } }, { archived_at: { $null: true } }, { tag: { $exists: false } }] },
        { kind: { $nin: ['a', 'b'] }, score: { $gt: 0.5, $lte: 99 } },
      ],
    };
    const parsed = parse({ where, orderBy: [{ field: 'sort_no', order: 'asc' }], limit: 5 });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.where).toEqual(where);
  });

  it('a bare value is admitted (read as $eq), and a string that only contains braces is a literal', () => {
    expect(parse({ where: { is_current: true, title: 'a {b} c', owner_id: null } }).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ['an operator outside the set', { status: { $contains: 'act' } }, /`\$contains` is not admitted on 'status'/],
    ['$between', { sort_no: { $between: [1, 2] } }, /`\$between` is not admitted/],
    ['$not', { $not: { status: 'x' } }, /`\$not` is not admitted here/],
    ['a dotted path', { 'account.industry': 'tech' }, /'account\.industry' is a dotted path/],
    ['a condition on a lookup\'s target', { account: { industry: 'tech' } }, /condition on the record its lookup points at/],
    ['a field-to-field comparand', { sort_no: { $gt: { $field: 'version' } } }, /field-to-field comparand/],
    ['a bare field-to-field comparand', { sort_no: { $field: 'version' } }, /field-to-field comparand/],
    ['a $now anchor', { effective_at: { $lt: { $now: { offset: '-P1D' } } } }, /\$now anchor is not admitted/],
    ['a whole {token} comparand', { owner_id: '{current_user_id}' }, /whole \{…\} placeholder/],
    ['a whole ${token} comparand', { effective_at: { $lt: '${today}' } }, /whole \{…\} placeholder/],
    ['a whole token the platform does not know', { status: { $eq: '{nope}' } }, /whole \{…\} placeholder/],
    ['a whole token in an $in list', { status: { $in: ['a', '{record_id}'] } }, /whole \{…\} placeholder/],
    ['a formula comparand', { sort_no: { $gt: { $expr: 'a + b' } } }, /a comparand is a literal value/],
    ['$null with a non-boolean', { note: { $null: 'yes' } }, /takes true or false/],
    ['$in with a non-list', { status: { $in: 'a' } }, /takes a list of literal values/],
  ])('refuses at parse: %s', (_label, where, expected) => {
    expect(messages({ where })).toMatch(expected);
  });

  it('orderBy is SortNodeSchema[]: { field, order }, `direction` refused by name, the child\'s own fields only', () => {
    const parsed = parse({ orderBy: [{ field: 'sort_no' }, { field: 'version', order: 'desc' }] });
    expect(parsed.data?.orderBy).toEqual([{ field: 'sort_no', order: 'asc' }, { field: 'version', order: 'desc' }]);
    expect(messages({ orderBy: [{ field: 'sort_no', direction: 'desc' }] })).toMatch(/direction/);
    expect(messages({ orderBy: [{ field: 'account.name', order: 'asc' }] })).toMatch(/not one of the child's own fields/);
    expect(messages({ orderBy: [] })).toMatch(/orderBy/);
  });

  it('limit is a positive integer, at most the row cap; over the cap it is refused, never lowered', () => {
    expect(AI_CONTEXT_MAX_RELATED_ROWS).toBe(20);
    expect(parse({ limit: AI_CONTEXT_MAX_RELATED_ROWS }).success).toBe(true);
    expect(messages({ limit: AI_CONTEXT_MAX_RELATED_ROWS + 1 })).toMatch(/at most 20 rows/);
    expect(parse({ limit: 0 }).success).toBe(false);
    expect(parse({ limit: 2.5 }).success).toBe(false);
  });

  it('points the near-miss spellings at the declared keys', () => {
    expect(messages({ filter: { status: 'x' } })).toMatch(/where/);
    expect(messages({ sort: [{ field: 'sort_no' }] })).toMatch(/orderBy/);
  });

  it('a whole pack carrying the three keys parses', () => {
    const parsed = AiContextSchema.safeParse({
      name: 'policy_document',
      label: 'Policy document',
      object: 'policy',
      related: [entry({ where: { is_current: { $eq: true } }, orderBy: [{ field: 'sort_no', order: 'asc' }], limit: 5 })],
    });
    expect(parsed.success).toBe(true);
  });

  it('aiContextWhereFields names each field once, through $and / $or, and nothing for a non-condition', () => {
    expect(aiContextWhereFields({ a_1: 1, $or: [{ b_2: { $gt: 1 } }, { $and: [{ a_1: 2 }, { c_3: null }] }] })).toEqual([
      'a_1',
      'b_2',
      'c_3',
    ]);
    expect(aiContextWhereFields(undefined)).toEqual([]);
    expect(aiContextWhereFields('x')).toEqual([]);
  });
});
