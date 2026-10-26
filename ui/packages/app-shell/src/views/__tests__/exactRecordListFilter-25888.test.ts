// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25888 — `exactRecordListFilter`, the write-side gate that lets a
 * related list's "View all" carry the list's own filter: every condition the
 * list route can spell is written, and anything it cannot spell refuses the
 * whole destination (`null`) rather than opening a wider list.
 *
 * The oracle is the route's READ side (`parseUrlFilterTriples`, what
 * `ObjectDataPage` parses), so these pins hold the round trip, not a spelling.
 */

import { describe, it, expect } from 'vitest';
import { exactRecordListFilter, recordListPath } from '../useOpenRecordList';
import { parseUrlFilterTriples } from '../drillUrlFilters';

const readAll = () => true;
const PARENT = { record_id: 'C-1' };

/** The triples the list route reads back from what the function wrote. */
function roundTrip(filter: Record<string, unknown> | null) {
  expect(filter).not.toBeNull();
  const search = recordListPath('app', 'obj', filter!).split('?')[1] ?? '';
  return parseUrlFilterTriples(new URLSearchParams(search));
}

describe('exactRecordListFilter — the AND of the sources, written exactly or not at all', () => {
  it('writes the parent relationship and an authored rule array as one conjunction', () => {
    const filter = exactRecordListFilter(
      [PARENT, [{ field: 'object_name', operator: 'equals', value: 'contract' }]],
      readAll,
    );
    expect(roundTrip(filter)).toEqual([
      ['record_id', '=', 'C-1'],
      ['object_name', '=', 'contract'],
    ]);
  });

  it('an absent or empty list filter adds nothing', () => {
    expect(roundTrip(exactRecordListFilter([PARENT, undefined], readAll))).toEqual([['record_id', '=', 'C-1']]);
    expect(roundTrip(exactRecordListFilter([PARENT, []], readAll))).toEqual([['record_id', '=', 'C-1']]);
  });

  it('writes every spelling the route has: equality, the four bounds, is-null both ways, is-empty', () => {
    const filter = exactRecordListFilter(
      [
        PARENT,
        {
          amount: { $gte: 10, $lt: 100 },
          score: { $gt: 1, $lte: 9 },
          closed_at: { $null: true },
          owner: { $exists: true },
          notes: { $empty: false },
          stage: { $eq: 'won' },
        },
      ],
      readAll,
    );
    expect(roundTrip(filter)).toEqual([
      ['record_id', '=', 'C-1'],
      ['amount', '>=', '10'],
      ['amount', '<', '100'],
      ['score', '>', '1'],
      ['score', '<=', '9'],
      ['closed_at', 'is_null', true],
      ['owner', 'is_not_null', true],
      ['notes', 'is_not_empty', true],
      ['stage', '=', 'won'],
    ]);
  });

  it('a repeated condition that agrees is written once', () => {
    const filter = exactRecordListFilter([PARENT, [['record_id', '=', 'C-1']]], readAll);
    expect(roundTrip(filter)).toEqual([['record_id', '=', 'C-1']]);
  });

  it.each([
    ['an `or`', ['or', ['status', '=', 'a'], ['status', '=', 'b']]],
    ['a set operator', [['status', 'in', ['a', 'b']]]],
    ['a negation', [['status', '!=', 'a']]],
    ['a text operator', [['name', 'contains', 'x']]],
    ['a boolean comparand', [['done', '=', true]]],
    ['an empty-string comparand', [['status', '=', '']]],
    ['a field-reference comparand', { amount: { $eq: { $field: 'budget' } } }],
    ['a second, different comparand for the relationship', [['record_id', '=', 'C-2']]],
    ['two different comparands in one bound', { $and: [{ amount: { $gte: 1 } }, { amount: { $gte: 2 } }] }],
  ])('refuses %s: the route cannot say it, and dropping it would widen the list', (_label, scope) => {
    expect(exactRecordListFilter([PARENT, scope], readAll)).toBeNull();
  });

  it('refuses a condition on a field `canRead` denies — the relationship included', () => {
    const scope = [{ field: 'object_name', operator: 'equals', value: 'contract' }];
    expect(exactRecordListFilter([PARENT, scope], (f) => f !== 'object_name')).toBeNull();
    expect(exactRecordListFilter([PARENT, scope], (f) => f !== 'record_id')).toBeNull();
    // CONTROL: denying a field neither source names changes nothing.
    expect(exactRecordListFilter([PARENT, scope], (f) => f !== 'owner')).not.toBeNull();
  });

  it('refuses a filter the lowering itself refuses, instead of reading it as "no filter"', () => {
    expect(exactRecordListFilter([PARENT, [{ field: 'name', operator: 'no_such_op', value: 'x' }]], readAll)).toBeNull();
  });
});
