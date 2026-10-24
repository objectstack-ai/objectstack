// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import { groupToCondition, conditionToGroup } from './datasetFilterCondition';

describe('datasetFilterCondition', () => {
  it('serializes a single condition without an $and wrapper', () => {
    expect(groupToCondition({ logic: 'and', conditions: [{ field: 'status', operator: 'equals', value: 'won' }] }))
      .toEqual({ status: { $eq: 'won' } });
  });

  it('serializes multiple conditions as a flat $and', () => {
    expect(groupToCondition({ logic: 'and', conditions: [
      { field: 'stage', operator: 'equals', value: 'won' },
      { field: 'amount', operator: 'greater_than', value: 1000 },
    ] })).toEqual({ $and: [{ stage: { $eq: 'won' } }, { amount: { $gt: 1000 } }] });
  });

  it('maps is_empty / is_not_empty to the spec\'s one 「is empty」 operator, `$empty` (objectui#10813)', () => {
    // They wrote `$exists` until objectui#10813 — the has-a-value test, which
    // never counted `''` or `[]`. The per-type meaning is the spec's expansion,
    // so the SAME token is written whatever the column's type.
    expect(groupToCondition({ logic: 'and', conditions: [{ field: 'closed_at', operator: 'is_not_empty' }] }))
      .toEqual({ closed_at: { $empty: false } });
    expect(groupToCondition({ logic: 'and', conditions: [{ field: 'closed_at', operator: 'is_empty' }] }))
      .toEqual({ closed_at: { $empty: true } });
  });

  it('a stored `$exists` is no longer read back as the empty pair — it opens in the Source tab, bytes untouched (objectui#10813)', () => {
    // Read back as `is_empty`, a sibling edit would rewrite it to `$empty` and
    // move `''` / `[]` across the line. This inspector offers no `exists` row,
    // so the filter goes to the Source tab rather than opening as a row the
    // next commit would change.
    for (const stored of [{ closed_at: { $exists: false } }, { closed_at: { $exists: true } }]) {
      expect(conditionToGroup(stored).representable, JSON.stringify(stored)).toBe(false);
      expect(conditionToGroup({ $and: [{ stage: { $eq: 'won' } }, stored] }).representable).toBe(false);
    }
    // CONTROL: the `$empty` pair this bridge writes opens as the rows.
    expect(conditionToGroup({ closed_at: { $empty: true } }).group.conditions.map((c) => c.operator))
      .toEqual(['is_empty']);
    expect(conditionToGroup({ closed_at: { $empty: false } }).group.conditions.map((c) => c.operator))
      .toEqual(['is_not_empty']);
  });

  it('a non-boolean `$empty` flag is not opened as a row (objectui#10813)', () => {
    // `$empty` is declared `z.boolean()` and every evaluator refuses another
    // flag; opened as a row, the next commit would make it runnable.
    for (const flag of ['yes', 1, null]) {
      expect(conditionToGroup({ closed_at: { $empty: flag } } as never).representable, JSON.stringify(flag)).toBe(false);
    }
  });

  it('drops unmapped operators rather than emitting a bad filter', () => {
    // The claim is unchanged; the FIXTURE moved, twice. `notContains` stopped
    // being unmapped in objectui#9372 and `between` in objectui#10062 (both
    // asserted as EMITTED in `datasetFilterCondition.unmappedInert-9372`), so
    // keeping either here would pin a branch it no longer reaches — an
    // assertion that passes because nothing is produced. `exists` is an opt-in
    // operator this bridge does not map (the fixture was
    // `containsCaseInsensitive` until objectui#9306 made that one ordinary and
    // mapped it).
    expect(groupToCondition({ logic: 'and', conditions: [{ field: 'x', operator: 'exists', value: '' }] }))
      .toBeUndefined();
  });

  it('empty group → undefined', () => {
    expect(groupToCondition({ logic: 'and', conditions: [] })).toBeUndefined();
  });

  it('drops incomplete rows (empty/blank value) instead of emitting {field:{$op:""}}', () => {
    // a row whose value hasn't been typed yet must NOT become a garbage filter
    expect(groupToCondition({ logic: 'and', conditions: [{ field: 'organization_id', operator: 'equals', value: '' }] })).toBeUndefined();
    expect(groupToCondition({ logic: 'and', conditions: [{ field: 'x', operator: 'equals', value: undefined }] })).toBeUndefined();
    expect(groupToCondition({ logic: 'and', conditions: [{ field: 'x', operator: 'in', value: [] }] })).toBeUndefined();
    // a complete row alongside an incomplete one keeps only the complete one
    expect(groupToCondition({ logic: 'and', conditions: [
      { field: 'stage', operator: 'equals', value: 'won' },
      { field: 'amount', operator: 'greater_than', value: '' },
    ] })).toEqual({ stage: { $eq: 'won' } });
    // value-less operators are still kept
    expect(groupToCondition({ logic: 'and', conditions: [{ field: 'closed_at', operator: 'is_not_empty', value: '' }] }))
      .toEqual({ closed_at: { $empty: false } });
  });

  it('round-trips representable conditions (condition → group → condition)', () => {
    for (const c of [
      { status: { $eq: 'won' } },
      { $and: [{ stage: { $eq: 'won' } }, { amount: { $gt: 1000 } }] },
      { region: { $in: ['NA', 'EU'] } },
      { closed_at: { $empty: true } },
      { closed_at: { $empty: false } },
    ]) {
      const { group, representable } = conditionToGroup(c);
      expect(representable).toBe(true);
      expect(groupToCondition(group)).toEqual(c);
    }
  });

  it('parses implicit equality {field: scalar}', () => {
    const { group, representable } = conditionToGroup({ status: 'active' });
    expect(representable).toBe(true);
    expect(group.conditions).toEqual([{ id: 'c0', field: 'status', operator: 'equals', value: 'active' }]);
  });

  it('flags non-representable shapes (nested $or / multi-op) for the source editor', () => {
    expect(conditionToGroup({ $or: [{ a: { $eq: 1 } }] }).representable).toBe(false);
    expect(conditionToGroup({ amount: { $gt: 1, $lt: 9 } }).representable).toBe(false);
    expect(conditionToGroup({ $and: [{ $or: [{ a: { $eq: 1 } }] }] }).representable).toBe(false);
  });
});
