/**
 * objectstack-ai/objectstack#36256 item 3 — a drill's conditions become the
 * standard list's own chips where a chip can say them, and stay its base
 * filter where none can.
 */
import { describe, it, expect } from 'vitest';
import { drillListConditions, measuredFieldsOf } from '../drillConditions';

const rows = (filter: Record<string, unknown>) =>
  drillListConditions(filter).chips.conditions.map(({ field, operator, value }) => ({ field, operator, value }));

describe('drillListConditions', () => {
  it('reads each field compared with a value as one chip row, through $and', () => {
    expect(rows({
      $and: [
        { stage: 'closed_won', close_date: { $gte: '2026-01-01', $lt: '2026-04-01' } },
        { lead_source: { $in: ['web', 'referral'] }, amount: { $null: false } },
      ],
    })).toEqual([
      { field: 'stage', operator: 'equals', value: 'closed_won' },
      { field: 'close_date', operator: 'greater_than_or_equal', value: '2026-01-01' },
      { field: 'close_date', operator: 'less_than', value: '2026-04-01' },
      { field: 'lead_source', operator: 'in', value: ['web', 'referral'] },
      { field: 'amount', operator: 'is_not_null', value: undefined },
    ]);
  });

  it('keeps what no chip can say as the base filter, ANDed', () => {
    const { chips, rest } = drillListConditions({
      stage: { $ne: 'closed_lost' },
      account: { industry: 'tech' },
      $or: [{ a: 1 }, { b: 2 }],
      owner: { $regex: 'x' },
    });
    expect(chips.conditions.map((c) => c.operator)).toEqual(['not_equals']);
    expect(rest).toEqual({ $and: [{ account: { industry: 'tech' } }, { $or: [{ a: 1 }, { b: 2 }] }, { owner: { $regex: 'x' } }] });
  });

  it('answers no rows and no rest for no filter', () => {
    expect(drillListConditions(undefined)).toEqual({ chips: { logic: 'and', conditions: [] }, rest: undefined });
  });
});

describe('measuredFieldsOf', () => {
  it('names the fields a measure scope says hold a value', () => {
    expect(measuredFieldsOf({ $and: [{ stage: 'won' }, { amount: { $null: false } }] })).toEqual(['amount']);
    expect(measuredFieldsOf({})).toEqual([]);
  });
});
