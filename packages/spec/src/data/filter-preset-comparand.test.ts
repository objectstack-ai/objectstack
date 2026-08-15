// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8793] Bare date-range preset names are refused from ordering comparands at
 * the schema door — the ruled C half of #8690 (maintainer ruling 5299879288).
 *
 * Measured defect (#8690, 51 rows seeded / 38 in-window):
 *
 * ```
 * $gte "last_30_days"   HTTP 200  count=0    <- silent zero
 * $gte "{30_days_ago}"  HTTP 200  count=38   <- positive control
 * ```
 *
 * Every refusal pin here keeps a discriminating positive control beside it —
 * a refusal pin with no positive control cannot show the gate is selective
 * rather than blanket (the #8690 reverse-verification requirement, carried
 * onto this card by its "Suggested verification").
 */

import { describe, it, expect } from 'vitest';
import { FilterConditionSchema } from './filter.zod';
import { DATE_RANGE_PRESETS } from './date-range-presets';
import { DashboardSchema } from '../ui/dashboard.zod';

/** The issues a parse failed with, or `null` when it parsed clean. */
function refusal(input: unknown) {
  const r = FilterConditionSchema.safeParse(input);
  return r.success ? null : r.error.issues;
}

describe('[#8793] FilterConditionSchema — bare preset names in ordering comparands', () => {
  it('refuses every declared preset under every ordering operator, with code + path + prescription', () => {
    for (const preset of DATE_RANGE_PRESETS) {
      for (const op of ['$gt', '$gte', '$lt', '$lte'] as const) {
        const issues = refusal({ created_at: { [op]: preset } });
        expect(issues, `${op} ${preset} must be refused`).not.toBeNull();
        const issue = issues![0];
        // The zod issue triple the pin asserts: code, path, message shape.
        expect(issue.code).toBe('custom');
        expect(issue.path).toEqual(['created_at', op]);
        expect(issue.message).toContain(preset);
        expect(issue.message).toContain('PRESET');
        expect(issue.message).toContain('#8793');
      }
    }
  });

  it('names the macro spelling that works — {30_days_ago} for the measured defect row', () => {
    const issues = refusal({ created_at: { $gte: 'last_30_days' } });
    expect(issues![0].message).toContain('{30_days_ago}');
    // ...and the ISO alternative, so a caller with a concrete instant in hand
    // is not funneled into macros it does not want.
    expect(issues![0].message).toContain('2026-01-15');
  });

  it('refuses a preset $between endpoint, naming the endpoint index', () => {
    const issues = refusal({ created_at: { $between: ['last_90_days', '2026-01-01'] } });
    expect(issues).not.toBeNull();
    expect(issues![0].path).toEqual(['created_at', '$between', 0]);
    const upper = refusal({ created_at: { $between: ['2026-01-01', 'this_month'] } });
    expect(upper![0].path).toEqual(['created_at', '$between', 1]);
  });

  it('refuses through $and / $or / $not with correctly nested paths', () => {
    expect(refusal({ $and: [{ created_at: { $gte: 'last_7_days' } }] })![0].path)
      .toEqual(['$and', 0, 'created_at', '$gte']);
    expect(refusal({ $or: [{ status: 'open' }, { created_at: { $lt: 'last_week' } }] })![0].path)
      .toEqual(['$or', 1, 'created_at', '$lt']);
    expect(refusal({ $not: { created_at: { $gte: 'this_year' } } })![0].path)
      .toEqual(['$not', 'created_at', '$gte']);
  });

  it('refuses inside a nested relation subtree, which the schema does not re-parse', () => {
    expect(refusal({ account: { created_at: { $gte: 'last_30_days' } } })![0].path)
      .toEqual(['account', 'created_at', '$gte']);
  });

  it('POSITIVE CONTROLS: legitimate temporal comparands still publish cleanly', () => {
    // The platform's own correct spellings, same positions, same field.
    expect(refusal({ created_at: { $gte: '{30_days_ago}' } })).toBeNull();
    expect(refusal({ created_at: { $gte: '2026-01-15' } })).toBeNull();
    expect(refusal({ created_at: { $gte: '2026-01-15T08:30:00Z' } })).toBeNull();
    expect(refusal({ created_at: { $between: ['{week_start}', '{week_end}'] } })).toBeNull();
    expect(refusal({ created_at: { $lt: new Date('2026-01-15') } })).toBeNull();
    expect(refusal({ amount: { $gte: 100 } })).toBeNull();
    expect(refusal({ created_at: { $gte: { $field: 'updated_at' } } })).toBeNull();
  });

  it('does NOT judge equality or membership — a picklist value may collide with a preset name', () => {
    // The select-filter philosophy GlobalFilterSchema pins: an author's own
    // vocabulary is none of this check's business. On a declared temporal
    // field the ENGINE door still refuses these at query time, field type in
    // hand (#8808).
    expect(refusal({ period: 'this_quarter' })).toBeNull();
    expect(refusal({ period: { $eq: 'this_quarter' } })).toBeNull();
    expect(refusal({ period: { $ne: 'last_30_days' } })).toBeNull();
    expect(refusal({ period: { $in: ['last_7_days', 'last_30_days'] } })).toBeNull();
    expect(refusal({ period: { $nin: ['this_week'] } })).toBeNull();
  });

  it('does NOT judge undeclared strings — the field-typed engine door owns those', () => {
    // "not-a-date-at-all" is uninterpretable too, but judging it needs the
    // field's declared type, which this field-agnostic schema cannot see.
    // Refusing only the DECLARED vocabulary is the ruled boundary.
    expect(refusal({ created_at: { $gte: 'not-a-date-at-all' } })).toBeNull();
    expect(refusal({ created_at: { $gte: 'last_60_days' } })).toBeNull();
  });

  it('does NOT decide the empty-string cell — its own card, by ruling', () => {
    expect(refusal({ created_at: { $gte: '' } })).toBeNull();
    expect(refusal({ created_at: { $gte: '   ' } })).toBeNull();
  });
});

describe('[#8793] the refusal reaches the authored surfaces that embed FilterConditionSchema', () => {
  const widget = (filter: unknown) => ({
    name: 'sales',
    label: 'Sales',
    widgets: [{
      id: 'won_deals',
      type: 'metric',
      dataset: 'deals',
      values: ['total'],
      filter,
    }],
  });

  it('a dashboard widget filter carrying a bare preset comparand is refused at parse', () => {
    const r = DashboardSchema.safeParse(widget({ closed_at: { $gte: 'last_30_days' } }));
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.message.includes('last_30_days'));
      expect(issue, 'the preset refusal must surface through the embedding').toBeTruthy();
      expect(issue!.path).toEqual(['widgets', 0, 'filter', 'closed_at', '$gte']);
      expect(issue!.message).toContain('{30_days_ago}');
    }
  });

  it('POSITIVE CONTROL: the same widget with the macro window publishes cleanly', () => {
    const r = DashboardSchema.safeParse(widget({ closed_at: { $gte: '{30_days_ago}' } }));
    expect(r.success).toBe(true);
  });
});
