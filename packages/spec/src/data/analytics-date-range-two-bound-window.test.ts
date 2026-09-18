// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17598] `timeDimensions[].dateRange`'s ARRAY arm is EXACTLY two string
 * bounds, and the one shared refusal sentence names its ORIGIN — maintainer
 * ruling A, decision batch #117 item 3 (2026-09-12), re-affirmed 2026-09-13.
 *
 * ## The negative control is the refusal itself
 *
 * On `origin/main` the arm is `z.array(z.string())` with no length constraint,
 * so every `refuses …` case in the first describe below PARSES CLEAN there and
 * goes red — measured, not assumed: `['2026-01-01']`, `[]` and
 * `['a', 'b', 'c']` were schema-valid and were then refused by all four of
 * `service-analytics`' analytics faces (#17593). The door was looser than
 * everything it guarded. An accept-assertion alone would prove nothing here,
 * exactly as the sibling `analytics-date-range-closed-vocabulary.test.ts`
 * records for the string arm.
 *
 * ## What the second describe is for
 *
 * Item ② of the same card: the shared sentence used to end
 * "Refused at the schema" and to describe EVERY refused array as
 * "an array with a non-string bound". For `['2026-01-01']` refused by a face,
 * BOTH clauses were false — every bound present is a string, and it was
 * refused past the schema, not at it. The ruling's acceptance criterion is
 * that the wording be true for each origin BOTH BEFORE AND AFTER this arm
 * narrows, so the assertions below judge the sentence against the input and
 * the origin rather than pinning prose for its own sake.
 *
 * [#18278] The same criterion, one value deeper: the arm judges a bound's TYPE
 * and never its VALUE, so `['', '']` is ACCEPTED here and refused past the
 * door by every face. Its author was told "received a two-element array" — the
 * shape they had just written — so that description is now the LIT control for
 * a window with nothing else wrong, and the empty bound is named at the bound
 * that is empty.
 */

import { describe, it, expect } from 'vitest';
import {
  AnalyticsDateRangeSchema,
  AnalyticsQuerySchema,
  analyticsDateRangeRefusalMessage,
  isAnalyticsDateRangeRefusalIssue,
  type AnalyticsQuery,
} from './analytics.zod';
import { AnalyticsQueryRequestSchema } from '../api/analytics.zod';

const QUERY = { measures: ['orders.count'] };
const withRange = (dateRange: unknown) => ({
  ...QUERY,
  timeDimensions: [{ dimension: 'orders.created_at', granularity: 'day', dateRange }],
});
const RANGE_PATH = ['timeDimensions', 0, 'dateRange'];

/** Arities the contract's own prose and #16322's shipped table already excluded. */
const REFUSED_ARITIES: ReadonlyArray<readonly unknown[]> = [
  [],                                        // no window at all
  ['2026-01-01'],                            // the shape #17124 measured three ways
  ['2026-01-01', '2026-01-31', '2026-02-28'], // three bounds
  ['{7_days_ago}'],                          // one macro token is a bound, not a window
];

describe('AnalyticsDateRangeSchema — the array arm is exactly two string bounds (#17598 ①)', () => {
  it('accepts the two-bound windows the contract has always prescribed', () => {
    // The control. Without it a narrowing that refused EVERY array would pass
    // every refusal assertion below.
    for (const window of [
      ['2026-01-01', '2026-01-31'],
      ['{7_days_ago}', '{today}'],
      ['2026-01-20', '2026-01-20'], // #16322's shipped single-day prescription
    ]) {
      expect(AnalyticsQuerySchema.safeParse(withRange(window)).success, JSON.stringify(window)).toBe(true);
      expect(AnalyticsDateRangeSchema.safeParse(window).success, JSON.stringify(window)).toBe(true);
    }
  });

  it.each(REFUSED_ARITIES.map((r) => [JSON.stringify(r), r] as const))(
    'refuses %s with ONE prescriptive issue at the field\'s own path',
    (_label, range) => {
      // Negative control: on the base commit's `z.array(z.string())` this parse
      // SUCCEEDS and every assertion below is red. See the file header.
      const parsed = AnalyticsQuerySchema.safeParse(withRange(range));
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues).toHaveLength(1);
      const [issue] = parsed.error.issues;
      expect(issue.path).toEqual(RANGE_PATH);
      expect(issue.code).toBe('invalid_union');
      expect(issue.message).toBe(analyticsDateRangeRefusalMessage(range, 'schema'));
      // The structural handle the runtime door lifts into the registered code,
      // so an arity refusal answers the SAME ADR-0112 envelope as every other
      // dateRange refusal rather than a bare 400.
      expect(isAnalyticsDateRangeRefusalIssue(issue)).toBe(true);
    },
  );

  it('refuses the same arities identically through the /analytics/query body schema', () => {
    for (const range of REFUSED_ARITIES) {
      const parsed = AnalyticsQueryRequestSchema.safeParse({ cube: 'orders', ...withRange(range) });
      expect(parsed.success, JSON.stringify(range)).toBe(false);
      if (parsed.success) continue;
      expect(parsed.error.issues).toHaveLength(1);
      expect(parsed.error.issues[0].path).toEqual(RANGE_PATH);
      expect(isAnalyticsDateRangeRefusalIssue(parsed.error.issues[0])).toBe(true);
    }
  });

  it('carries the migration prescription in the refusal itself — a single day is both bounds', () => {
    // The ADR-0087 semantic entry tells an upgrading author the same thing;
    // this is the sentence the author gets without reading it.
    const message = analyticsDateRangeRefusalMessage(['2026-01-20'], 'schema');
    expect(message).toContain('["2026-01-20", "2026-01-20"]');
    expect(message).toContain('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
  });

  it('narrows the authored TYPE too — a one-element window no longer compiles', () => {
    const accepted: NonNullable<AnalyticsQuery['timeDimensions']> = [
      { dimension: 'created_at', dateRange: ['2026-01-20', '2026-01-20'] },
      { dimension: 'created_at', dateRange: 'last_7_days' },
    ];
    const refused: NonNullable<AnalyticsQuery['timeDimensions']> = [
      // @ts-expect-error — one bound is not a window; write the day twice
      { dimension: 'created_at', dateRange: ['2026-01-20'] },
    ];
    expect(accepted).toHaveLength(2);
    expect(refused).toHaveLength(1);
  });
});

describe('analyticsDateRangeRefusalMessage — each ORIGIN gets a true sentence (#17598 ②)', () => {
  it('states the schema origin only when the schema is where it was refused', () => {
    for (const input of [...REFUSED_ARITIES, 'Last 7 days', 42, null]) {
      const atSchema = analyticsDateRangeRefusalMessage(input, 'schema');
      const atRuntime = analyticsDateRangeRefusalMessage(input, 'runtime');
      expect(atSchema).toContain('Refused at the schema');
      // The clause that was false for every face-side refusal since #17593.
      expect(atRuntime).not.toContain('Refused at the schema');
      expect(atRuntime).toContain('past the schema door');
      // One condition, one wording (#5240): only the origin clause differs.
      expect(atRuntime.replace('Refused past the schema door, by the analytics reader that received it', 'Refused at the schema'))
        .toBe(atSchema);
    }
  });

  it('⭐ does not claim a non-string bound when every bound IS a string', () => {
    // The exact sentence #17598 ② was filed about: `['2026-01-01']` refused by
    // a face was told "received an array with a non-string bound".
    for (const origin of ['schema', 'runtime'] as const) {
      const message = analyticsDateRangeRefusalMessage(['2026-01-01'], origin);
      expect(message).toContain('received a 1-element array, not the two bounds [start, end]');
      expect(message).not.toContain('non-string bound');
    }
    expect(analyticsDateRangeRefusalMessage([], 'runtime'))
      .toContain('received an empty array, not the two bounds [start, end]');
    expect(analyticsDateRangeRefusalMessage(['a', 'b', 'c'], 'runtime'))
      .toContain('received a 3-element array, not the two bounds [start, end]');
  });

  it('still names a bad bound when there is one, and names both faults together', () => {
    // ⛔ Not a replacement of the old clause — a two-bound array with a
    // non-string bound keeps exactly the description it had, because it was
    // true. The arity clause is added for the shapes it was false for.
    expect(analyticsDateRangeRefusalMessage(['2026-01-01', 3], 'schema'))
      .toContain('received an array with a non-string bound');
    expect(analyticsDateRangeRefusalMessage(['2026-01-01', 3, null], 'schema'))
      .toContain('received a 3-element array with a non-string bound, not the two bounds [start, end]');
    // And the non-array descriptions are untouched.
    expect(analyticsDateRangeRefusalMessage(null, 'schema')).toContain('received null');
    expect(analyticsDateRangeRefusalMessage(42, 'schema')).toContain('received number');
    expect(analyticsDateRangeRefusalMessage({ start: '2026-01-01' }, 'schema')).toContain('received object');
  });

  it('⭐ names the EMPTY bound the arm cannot refuse, at the bound that is empty (#18278)', () => {
    // The premise, asserted rather than assumed: the tuple arm judges arity and
    // bound TYPE, never a bound's VALUE, so this window is ACCEPTED at the
    // schema door and refused PAST it — the residue
    // `analyticsDateRangeUnrecognizedError`'s header names. ⛔ This card does
    // not move that accept set; it makes the sentence true.
    expect(AnalyticsDateRangeSchema.safeParse(['', '']).success).toBe(true);
    for (const origin of ['schema', 'runtime'] as const) {
      const message = analyticsDateRangeRefusalMessage(['', ''], origin);
      expect(message).toContain('received a two-element array whose bounds are both empty strings');
      // ⛔ The DARK control — the description this card was filed about, which
      // handed the author back the shape they had just written.
      expect(message).not.toContain('received a two-element array.');
      expect(message).not.toContain('non-string bound');
    }
    // One empty bound is named AT the bound that is empty: the sentence never
    // echoes the value, so "which one" is a clause only this function can give.
    expect(analyticsDateRangeRefusalMessage(['', '2026-01-31'], 'runtime'))
      .toContain('received a two-element array whose start bound is an empty string');
    expect(analyticsDateRangeRefusalMessage(['2026-01-01', ''], 'runtime'))
      .toContain('received a two-element array whose end bound is an empty string');
    // A bound that is not a string keeps its TYPE description — `['', 3]` has
    // both faults, and the one the arm itself refuses is named first.
    expect(analyticsDateRangeRefusalMessage(['', 3], 'runtime'))
      .toContain('received an array with a non-string bound');
    // ⭐ The LIT control: a two-bound window with nothing this clause can name
    // keeps the bare shape description, so the empty-bound clause is not
    // claimed when it is not true.
    expect(analyticsDateRangeRefusalMessage(['2026-01-01', '2026-01-31'], 'runtime'))
      .toContain('received a two-element array.');
  });

  it('is true both BEFORE and AFTER the arm narrows — the ruling\'s acceptance criterion', () => {
    // Before ① lands, `['2026-01-01']` is refused only at RUNTIME (the faces);
    // after ① it is refused at the SCHEMA too. Both sentences describe the
    // same input correctly, so answering ① did not falsify ②'s wording — which
    // is the hazard the retriage named when it asked for the two to be split.
    const runtime = analyticsDateRangeRefusalMessage(['2026-01-01'], 'runtime');
    const schema = analyticsDateRangeRefusalMessage(['2026-01-01'], 'schema');
    for (const message of [runtime, schema]) {
      expect(message).toContain('1-element array');
      expect(message).not.toContain('non-string bound');
      expect(message).toContain('ANALYTICS_DATE_RANGE_UNRECOGNIZED / 400');
    }
    expect(runtime).not.toBe(schema);
  });
});
