// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Ask data tools' `source` block.
 *
 * What is pinned: the two shapes the producer answers (a `get_record` read and
 * an aggregate) round-trip; an optional key sent as `null` is refused; `scope`
 * and the aggregation function are closed; a key a newer producer adds is
 * stripped, not refused; a `line` past the producer's 280-character budget
 * still parses; the tool roster is the five tools.
 */

import { describe, expect, it } from 'vitest';
import {
  OBJECT_QUERY_SOURCE_TOOL_NAMES,
  ObjectQuerySourceSchema,
  type ObjectQuerySource,
} from './object-query-source.zod';

const getRecordBlock: ObjectQuerySource = {
  object: 'project',
  label: 'Projects',
  filter: { id: 'p_001' },
  scope: 'visible_to_you',
  records: 1,
  line: 'From Projects, record p_001, only records visible to you.',
};

const aggregateBlock: ObjectQuerySource = {
  object: 'opportunity',
  filter: {
    stage: { $ne: 'lost' },
    close_date: { $gte: '{current_year_start}' },
    project: { client: 'c_042' },
  },
  scope: 'visible_to_you',
  groupBy: ['owner'],
  aggregations: [{ function: 'count' }, { function: 'sum', field: 'amount' }],
  orderBy: [{ field: 'amount', order: 'desc' }],
  limit: 5,
  related: ['client.relationship_manager'],
  latestPer: { groupBy: 'owner', orderField: 'close_date' },
  records: 37,
  line: 'Top 5 owners by total amount over 37 open opportunities this year, only records visible to you.',
};

const paths = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  (r.error?.issues ?? []).map((i) => i.path.join('.'));

describe('ObjectQuerySourceSchema', () => {
  it('round-trips the get_record block', () => {
    const r = ObjectQuerySourceSchema.safeParse(getRecordBlock);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(getRecordBlock);
  });

  it('round-trips an aggregate block with every optional key', () => {
    const r = ObjectQuerySourceSchema.safeParse(aggregateBlock);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(aggregateBlock);
  });

  it('refuses an optional key sent as null', () => {
    for (const key of ['label', 'filter', 'groupBy', 'aggregations', 'orderBy', 'limit', 'records'] as const) {
      const r = ObjectQuerySourceSchema.safeParse({ ...getRecordBlock, [key]: null });
      expect(r.success, key).toBe(false);
      expect(paths(r), key).toContain(key);
    }
  });

  it('refuses a scope other than visible_to_you', () => {
    const r = ObjectQuerySourceSchema.safeParse({ ...getRecordBlock, scope: 'all' });
    expect(r.success).toBe(false);
    expect(paths(r)).toEqual(['scope']);
  });

  it('refuses an unknown aggregation function', () => {
    const r = ObjectQuerySourceSchema.safeParse({
      ...aggregateBlock,
      aggregations: [{ function: 'median', field: 'amount' }],
    });
    expect(r.success).toBe(false);
    expect(paths(r)).toEqual(['aggregations.0.function']);
  });

  it('strips an unknown key instead of refusing it', () => {
    const r = ObjectQuerySourceSchema.safeParse({ ...getRecordBlock, confidence: 'high' });
    expect(r.success).toBe(true);
    expect(r.data).toEqual(getRecordBlock);
    expect(r.data).not.toHaveProperty('confidence');
  });

  it('parses a line longer than the producer\'s 280-character budget', () => {
    const line = 'x'.repeat(400);
    const r = ObjectQuerySourceSchema.safeParse({ ...getRecordBlock, line });
    expect(r.success).toBe(true);
    expect(r.data?.line).toBe(line);
  });

  it('refuses a records list and a non-positive limit', () => {
    expect(paths(ObjectQuerySourceSchema.safeParse({ ...getRecordBlock, records: [{ id: 'p_001' }] })))
      .toEqual(['records']);
    expect(paths(ObjectQuerySourceSchema.safeParse({ ...aggregateBlock, limit: 0 }))).toEqual(['limit']);
  });
});

describe('OBJECT_QUERY_SOURCE_TOOL_NAMES', () => {
  it('names the five tools that answer the block', () => {
    expect(OBJECT_QUERY_SOURCE_TOOL_NAMES).toEqual([
      'query_records',
      'query_data',
      'get_record',
      'aggregate_data',
      'visualize_data',
    ]);
  });
});
