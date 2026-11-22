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

  it('draws a condition stated twice as one chip', () => {
    expect(rows({
      $and: [{ close_date: { $gte: '2026-10-01' } }, { close_date: { $gte: '2026-10-01', $lt: '2027-01-01' } }],
    })).toEqual([
      { field: 'close_date', operator: 'greater_than_or_equal', value: '2026-10-01' },
      { field: 'close_date', operator: 'less_than', value: '2027-01-01' },
    ]);
  });

  it("words a date field's open bounds as the list's date filter does", () => {
    const { chips } = drillListConditions(
      { close_date: { $gt: '2026-09-30', $lt: '2027-01-01' }, amount: { $lt: 5 } },
      { dateFields: new Set(['close_date']) },
    );
    expect(chips.conditions.map((c) => [c.field, c.operator])).toEqual([
      ['close_date', 'after'],
      ['close_date', 'before'],
      ['amount', 'less_than'],
    ]);
  });

  it("lowers a page block's rule array, and an AST node, to chips", () => {
    // HotCRM's 销售主页 KPI tile: the spec's rule-array form, handed as written.
    expect(drillListConditions([{ field: 'stage', operator: 'equals', value: 'closed_won' }]).chips.conditions
      .map(({ field, operator, value }) => ({ field, operator, value })))
      .toEqual([{ field: 'stage', operator: 'equals', value: 'closed_won' }]);
    expect(drillListConditions([['stage', '=', 'closed_won'], ['amount', '>', 5]]).chips.conditions
      .map(({ field, operator, value }) => ({ field, operator, value })))
      .toEqual([
        { field: 'stage', operator: 'equals', value: 'closed_won' },
        { field: 'amount', operator: 'greater_than', value: 5 },
      ]);
  });

  it('keeps a filter it cannot lower as the base filter, exactly as it arrived', () => {
    // A scalar on a list operator: the spec's lowering refuses it.
    const refused = [['stage', 'in', 'won']];
    expect(drillListConditions(refused)).toEqual({ chips: { logic: 'and', conditions: [] }, rest: refused });
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
