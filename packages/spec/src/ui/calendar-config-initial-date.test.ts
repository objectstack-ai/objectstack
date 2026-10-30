import { describe, it, expect } from 'vitest';

import { CalendarConfigSchema, ListViewSchema } from './view.zod';
import { ComponentPropsMap } from './component.zod';
import { zodIssuesToFields } from '../api/zod-issues-to-fields';
import { ErrorHttpStatusMap } from '../api/errors.zod';
import { DATE_MACRO_TOKENS, DATE_MACRO_WRAPPED_RE, isDateMacroToken } from '../data/date-macros.zod';

/**
 * `calendar.initialDate` — the date a calendar opens on.
 *
 * Without it every calendar opened on the current month, so one whose records
 * all fall months ahead opened on an empty grid. The key is OPTIONAL and has no
 * spec-side default: absence means today, which is what every calendar stored
 * before the key did, so the parsed output of an existing view is unchanged.
 *
 * Two forms are accepted: a record anchor (`first_record`, `next_record`), or a
 * wrapped, KNOWN date-macro token — the formula vocabulary of
 * `date-macros.zod.ts`, fixed, period and parameterised tokens alike, so a
 * stored value is resolved when the calendar opens and never goes stale.
 *
 * Pinned here: the accepted values on both doors that carry the block (the
 * list view's `calendar` and the `object-calendar` node's `calendar`, which is
 * the same member by reference), the absence behaviour, and the refusal of
 * everything else — a fixed calendar date included, which is left out on
 * purpose because it goes stale.
 */

const ACCEPTED = [
  'first_record',
  'next_record',
  '{today}',
  '{next_month_start}',
  '{current_quarter_start}',
  '{3_months_from_now}',
  '{2_weeks_ago}',
] as const;

const binding = { startDateField: 'renewal_date', titleField: 'name' } as const;

/** A list view that parses clean apart from whatever the case under test adds. */
const calendarView = (calendar: Record<string, unknown>) => ({
  type: 'calendar' as const,
  name: 'renewals',
  columns: ['name'],
  calendar,
});

const objectCalendar = ComponentPropsMap['object-calendar'];

describe('calendar.initialDate — accepted values', () => {
  it.each(ACCEPTED)('%s parses clean on CalendarConfigSchema and keeps its value', (value) => {
    const r = CalendarConfigSchema.safeParse({ ...binding, initialDate: value });
    expect(r.success).toBe(true);
    expect(r.data?.initialDate).toBe(value);
  });

  it.each(ACCEPTED)('%s parses clean on a whole stored list view', (value) => {
    const r = ListViewSchema.safeParse(calendarView({ ...binding, initialDate: value }));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(r.data?.calendar?.initialDate).toBe(value);
  });

  it.each(ACCEPTED)('%s parses clean on the `object-calendar` node\'s `calendar` block', (value) => {
    const r = objectCalendar.safeParse({ objectName: 'contract', calendar: { ...binding, initialDate: value } });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});

describe('calendar.initialDate — absent', () => {
  it('an omitted key stays omitted: no default is materialized onto the parsed block', () => {
    const r = CalendarConfigSchema.safeParse({ ...binding });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty('initialDate');
    // The parse of a calendar stored before the key existed is byte-identical.
    expect(r.data).toEqual(binding);
  });

  it('a stored list view without the key parses to exactly the block it stored', () => {
    const r = ListViewSchema.safeParse(calendarView({ ...binding }));
    expect(r.success).toBe(true);
    expect(r.data?.calendar).toEqual(binding);
  });
});

describe('calendar.initialDate — refused values', () => {
  it.each([
    ['a fixed ISO calendar date', '2026-11-01'],
    ['a fixed ISO timestamp', '2026-11-01T00:00:00Z'],
    ['the bare `today` (its one spelling is `{today}`)', 'today'],
    ['a bare known period token', 'next_month_start'],
    ['an unknown wrapped token', '{next_moon}'],
    ['a malformed parameterised token', '{3_fortnights_from_now}'],
    ['a near-miss anchor spelling', 'first'],
    ['the camelCase spelling of an anchor', 'firstRecord'],
    ['an upper-cased anchor', 'NEXT_RECORD'],
  ])('%s (%s) is refused at calendar.initialDate, naming both forms', (_label, value) => {
    const view = calendarView({ ...binding, initialDate: value });
    const r = ListViewSchema.safeParse(view);
    expect(r.success).toBe(false);
    const issues = r.error!.issues;
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue.code).toBe('invalid_format');
    expect(issue.path).toEqual(['calendar', 'initialDate']);
    // The message names the value, both accepted forms and the vocabulary to read.
    expect(issue.message.startsWith(`${JSON.stringify(value)} is not a calendar \`initialDate\`.`)).toBe(true);
    expect(issue.message).toContain('`first_record` or `next_record`');
    expect(issue.message).toContain('`{today}`');
    expect(issue.message).toContain('`DATE_MACRO_TOKENS`');

    // The wire envelope a save door answers with: the field and its catalog code,
    // under the validation class's HTTP status.
    const fields = zodIssuesToFields(issues, view);
    expect(fields).toEqual([
      expect.objectContaining({ field: 'calendar.initialDate', code: 'invalid_format' }),
    ]);
    expect(ErrorHttpStatusMap.validation).toBe(400);
  });

  it.each([
    ['today', '{today}'],
    ['next_month_start', '{next_month_start}'],
    ['3_months_from_now', '{3_months_from_now}'],
  ])('a bare known token (%s) is told the wrapped spelling to write, %s', (bare, wrapped) => {
    const r = CalendarConfigSchema.safeParse({ ...binding, initialDate: bare });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toContain(`write \`${wrapped}\``);
  });

  it('a value that is no token at all gets no wrapped-spelling hint', () => {
    const r = CalendarConfigSchema.safeParse({ ...binding, initialDate: '2026-11-01' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).not.toContain('without its braces');
  });

  it('a non-string value is refused at the same path', () => {
    const r = CalendarConfigSchema.safeParse({ ...binding, initialDate: new Date('2026-11-01') });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path)).toEqual([['initialDate']]);
  });

  it('the widening did not open the block: an unknown key is still refused by name', () => {
    const r = CalendarConfigSchema.safeParse({ ...binding, initialView: 'month' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('a flat `initialDate` on `object-calendar` is refused with the nested-shape prescription', () => {
    const r = objectCalendar.safeParse({ objectName: 'renewals', calendar: binding, initialDate: '{today}' });
    expect(r.success).toBe(false);
    const issue = r.success === false
      ? r.error.issues.find((i) => i.code === 'unrecognized_keys')
      : undefined;
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['initialDate']);
    expect(issue?.message).toContain('Write this as a key of the `calendar` config object instead');
    expect(issue?.message).toContain('`initialDate`, the date it opens on, in the same block');
  });
});

describe('calendar.initialDate — one vocabulary with the date macros', () => {
  /** The verdict the date-macro vocabulary's own predicate pair gives, plus the two anchors. */
  const vocabularyVerdict = (value: string): boolean => {
    if (value === 'first_record' || value === 'next_record') return true;
    const m = value.match(DATE_MACRO_WRAPPED_RE);
    return !!m && isDateMacroToken(m[1]);
  };
  const accepts = (value: string): boolean =>
    CalendarConfigSchema.safeParse({ ...binding, initialDate: value }).success;

  it('every fixed DATE_MACRO_TOKENS member is accepted wrapped, in both wrappings, and refused bare', () => {
    // Control: the vocabulary is the real list, not an empty one.
    expect(DATE_MACRO_TOKENS.length).toBeGreaterThan(30);
    for (const token of DATE_MACRO_TOKENS) {
      expect(accepts(`{${token}}`), `{${token}}`).toBe(true);
      expect(accepts(`\${${token}}`), `\${${token}}`).toBe(true);
      expect(accepts(token), token).toBe(false);
    }
  });

  it.each([
    '{1_day_ago}', '{30_days_ago}', '{90_days_from_now}', '{1_year_ago}', '{15_minutes_ago}', '{2_hours_from_now}',
    '{0_days_ago}', '{3_fortnights_from_now}', '{3_days}', '{days_ago}', '{-3_days_ago}', '{3_Days_ago}',
    '{today', 'today}', '{{today}}', '{ today }', '{today}x', 'x{today}', '{}', '', '\${}', '{first_record}',
    'first_record ', ' next_record', 'first_record|{today}',
  ])('%s gets the verdict the date-macro predicate pair gives', (value) => {
    expect(accepts(value)).toBe(vocabularyVerdict(value));
  });
});
