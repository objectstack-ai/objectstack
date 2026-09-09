// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16041] `timeDimensions[].dateRange`'s string arm is the CLOSED date-range
 * preset vocabulary, derived from `data/date-range-presets.ts`, and any other
 * string is refused at the schema — maintainer ruling, decision batch #57
 * (option A, contract first).
 *
 * The negative control is the refusal itself: on the unfixed schema the arm
 * was a bare `z.string()`, so every `refuses …` case below parsed CLEAN there
 * — measured by ablation (the arm restored to `z.string()` from the base
 * commit): those cases go red, the acceptance cases stay green. An
 * accept-assertion alone would have proved nothing against `z.string()`.
 *
 * What the closing fixes is a SILENT WIDENING, not a crash: driver-memory fell
 * an unparseable range through to `[range, range]`, a pseudo-window every
 * `Date`-typed row satisfied (a `Date` compares above a `String` under BSON
 * cross-type ordering), so `"Last 7 days"` — the schema comment's own example
 * — returned all of history at HTTP 200. The assertions therefore pin the
 * refusal's SHAPE (path, single issue, prescriptive text, the structural
 * predicate the runtime door lifts into `ANALYTICS_DATE_RANGE_UNRECOGNIZED`),
 * not merely `success === false`.
 */

import { describe, it, expect } from 'vitest';
import {
  AnalyticsDateRangePresetSchema,
  AnalyticsDateRangeSchema,
  AnalyticsQuerySchema,
  analyticsDateRangeRefusalMessage,
  isAnalyticsDateRangeRefusalIssue,
  type AnalyticsQuery,
} from './analytics.zod';
import { AnalyticsQueryRequestSchema } from '../api/analytics.zod';
import { DATE_RANGE_PRESETS } from './date-range-presets';
import { ERROR_CODE_LEDGER, ErrorCode } from '../api/error-code-ledger.zod';

const QUERY = { measures: ['orders.count'] };
const withRange = (dateRange: unknown) => ({
  ...QUERY,
  timeDimensions: [{ dimension: 'orders.created_at', granularity: 'day', dateRange }],
});
const RANGE_PATH = ['timeDimensions', 0, 'dateRange'];

/** The spellings the platform used to accept and could not resolve. */
const RETIRED_SPELLINGS = [
  'Last 7 days',   // the schema comment's own example — capital L, spaces
  'Last 30 days',
  'last 7 days',   // the driver-memory dialect (case-sensitive `last N <unit>`)
  'last 3 months',
  '2026-01-20',    // the SQL strategies' single-day dialect
  'LAST_7_DAYS',   // case — the vocabulary is snake_case, case-sensitive
  'last_60_days',  // an undeclared sibling
  'This week',
  'custom',        // the dashboard defaultRange-only sentinel
  '{7_days_ago}',  // the OTHER vocabulary: a macro token is a bound, not a window
  '',
];

describe('AnalyticsQuerySchema.timeDimensions[].dateRange — closed vocabulary (#16041)', () => {
  it('derives the string arm from date-range-presets.ts — no fourth copy of the list', () => {
    // The module header records the vocabulary once existed in three drifting
    // copies. The enum's options ARE the module's tuple, in its order.
    expect(AnalyticsDateRangePresetSchema.options).toEqual([...DATE_RANGE_PRESETS]);
    // The ruling's "presets plus `today`": `today` is the vocabulary's first
    // member, so the enum needs no second source to carry it.
    expect(AnalyticsDateRangePresetSchema.options[0]).toBe('today');
  });

  it('accepts every declared preset name as a bare string, on the schema and on the /analytics/query body', () => {
    for (const preset of DATE_RANGE_PRESETS) {
      const parsed = AnalyticsQuerySchema.safeParse(withRange(preset));
      expect(parsed.success, `AnalyticsQuerySchema accepts ${preset}`).toBe(true);
      const request = AnalyticsQueryRequestSchema.safeParse({ cube: 'orders', ...withRange(preset) });
      expect(request.success, `AnalyticsQueryRequestSchema accepts ${preset}`).toBe(true);
    }
  });

  it('keeps the array arm exactly as it was — ISO dates or date-macro tokens', () => {
    for (const window of [
      ['2023-01-01', '2023-01-31'],
      ['{7_days_ago}', '{today}'],
      ['2026-01-20', '2026-01-20'], // the replacement for the retired bare-ISO spelling
    ]) {
      const parsed = AnalyticsQuerySchema.safeParse(withRange(window));
      expect(parsed.success, JSON.stringify(window)).toBe(true);
    }
    // Absent stays absent — the field is optional.
    expect(AnalyticsQuerySchema.safeParse({ ...QUERY, timeDimensions: [{ dimension: 'x' }] }).success).toBe(true);
  });

  it('REFUSES "Last 7 days" — the value the schema comment used to document — with ONE issue at the field\'s own path', () => {
    // Negative control: on the base commit's bare `z.string()` this parse
    // SUCCEEDS and the assertion below is red. See the file header.
    const parsed = AnalyticsQuerySchema.safeParse(withRange('Last 7 days'));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toHaveLength(1);
    const [issue] = parsed.error.issues;
    expect(issue.path).toEqual(RANGE_PATH);
    expect(issue.code).toBe('invalid_union');
    // The prescription: the value, the spelling that works, the wire code.
    expect(issue.message).toContain('"Last 7 days"');
    expect(issue.message).toContain('last_7_days');
    expect(issue.message).toContain('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
    expect(issue.message).toContain('silently widen');
    // The structural handle the runtime door lifts into the registered code.
    expect(isAnalyticsDateRangeRefusalIssue(issue)).toBe(true);
  });

  it('refuses every retired spelling — driver-memory\'s, SQL\'s single-day, case and near-miss variants', () => {
    for (const spelling of RETIRED_SPELLINGS) {
      const parsed = AnalyticsQuerySchema.safeParse(withRange(spelling));
      expect(parsed.success, `refuses ${JSON.stringify(spelling)}`).toBe(false);
      if (parsed.success) continue;
      expect(parsed.error.issues, JSON.stringify(spelling)).toHaveLength(1);
      expect(parsed.error.issues[0].path).toEqual(RANGE_PATH);
      expect(parsed.error.issues[0].message).toBe(analyticsDateRangeRefusalMessage(spelling));
      expect(isAnalyticsDateRangeRefusalIssue(parsed.error.issues[0])).toBe(true);
    }
  });

  it('refuses the same spellings identically through the /analytics/query body schema', () => {
    const parsed = AnalyticsQueryRequestSchema.safeParse({ cube: 'orders', ...withRange('Last 7 days') });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toHaveLength(1);
    expect(parsed.error.issues[0].path).toEqual(RANGE_PATH);
    expect(isAnalyticsDateRangeRefusalIssue(parsed.error.issues[0])).toBe(true);
  });

  it('refuses a value that is neither arm, described by type — still one issue, still the same path', () => {
    for (const [value, received] of [
      [42, 'number'],
      [null, 'null'],
      [{ start: '2026-01-01' }, 'object'],
      [['2026-01-01', 3], 'an array with a non-string bound'],
    ] as const) {
      const parsed = AnalyticsQuerySchema.safeParse(withRange(value));
      expect(parsed.success, JSON.stringify(value)).toBe(false);
      if (parsed.success) continue;
      expect(parsed.error.issues).toHaveLength(1);
      expect(parsed.error.issues[0].path).toEqual(RANGE_PATH);
      expect(parsed.error.issues[0].message).toContain(`received ${received}`);
      expect(isAnalyticsDateRangeRefusalIssue(parsed.error.issues[0])).toBe(true);
    }
  });

  it('spells the vocabulary in the refusal from the module, so the prescription cannot drift from the enum', () => {
    const message = analyticsDateRangeRefusalMessage('Last 7 days');
    for (const preset of DATE_RANGE_PRESETS) expect(message).toContain(preset);
    // And the standalone union reports the same wording as the nested field.
    const bare = AnalyticsDateRangeSchema.safeParse('Last 7 days');
    expect(bare.success).toBe(false);
    if (!bare.success) expect(bare.error.issues[0].message).toBe(message);
  });

  it('the predicate is structural and fires on nothing else', () => {
    // A different refusal on the same item: an undeclared key.
    const unknownKey = AnalyticsQuerySchema.safeParse({
      ...QUERY,
      timeDimensions: [{ dimension: 'x', granuarity: 'day', dateRange: 'last_7_days' }],
    });
    expect(unknownKey.success).toBe(false);
    if (!unknownKey.success) {
      expect(unknownKey.error.issues.some(isAnalyticsDateRangeRefusalIssue)).toBe(false);
    }
    // A different refusal on a sibling field.
    const badGranularity = AnalyticsQuerySchema.safeParse({
      ...QUERY,
      timeDimensions: [{ dimension: 'x', granularity: 'fortnight', dateRange: 'last_7_days' }],
    });
    expect(badGranularity.success).toBe(false);
    if (!badGranularity.success) {
      expect(badGranularity.error.issues.some(isAnalyticsDateRangeRefusalIssue)).toBe(false);
    }
    // The same key name outside the declared position is not this refusal.
    expect(isAnalyticsDateRangeRefusalIssue({ code: 'invalid_union', path: ['dateRange'] })).toBe(false);
    expect(isAnalyticsDateRangeRefusalIssue({ code: 'invalid_union', path: ['filters', 0, 'dateRange'] })).toBe(false);
    expect(isAnalyticsDateRangeRefusalIssue({ code: 'invalid_type', path: RANGE_PATH })).toBe(false);
  });

  it('the wire code is a registered ADR-0112 ledger member, owned by the runtime door that emits it', () => {
    expect(ERROR_CODE_LEDGER['@objectstack/runtime']).toContain('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
    expect(ErrorCode.safeParse('ANALYTICS_DATE_RANGE_UNRECOGNIZED').success).toBe(true);
  });

  it('narrows the authored TYPE too — a retired spelling no longer compiles', () => {
    const accepted: NonNullable<AnalyticsQuery['timeDimensions']> = [
      { dimension: 'created_at', dateRange: 'last_7_days' },
      { dimension: 'created_at', dateRange: ['2023-01-01', '2023-01-31'] },
    ];
    const retired: NonNullable<AnalyticsQuery['timeDimensions']> = [
      // @ts-expect-error — the display spelling is outside the closed vocabulary
      { dimension: 'created_at', dateRange: 'Last 7 days' },
    ];
    expect(accepted).toHaveLength(2);
    expect(retired).toHaveLength(1);
  });
});
