import { describe, it, expect } from 'vitest';

import { CalendarConfigSchema, ListViewSchema } from './view.zod';
import { ComponentPropsMap } from './component.zod';
import { zodIssuesToFields } from '../api/zod-issues-to-fields';
import { ErrorHttpStatusMap } from '../api/errors.zod';

/**
 * `calendar.initialDate` — the date a calendar opens on.
 *
 * Without it every calendar opened on the current month, so one whose records
 * all fall months ahead opened on an empty grid. The key is OPTIONAL and has no
 * spec-side default: absence means today, which is what every calendar stored
 * before the key did, so the parsed output of an existing view is unchanged.
 *
 * Pinned here: the three accepted values on both doors that carry the block
 * (the list view's `calendar` and the `object-calendar` node's `calendar`,
 * which is the same member by reference), the absence behaviour, and the
 * refusal of a value outside the closed set — a fixed calendar date included,
 * which the set leaves out on purpose.
 */

const ACCEPTED = ['today', 'first_record', 'next_record'] as const;

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
    ['a near-miss spelling', 'first'],
    ['the camelCase spelling of a member', 'firstRecord'],
    ['an upper-cased member', 'TODAY'],
    ['a date-macro token', '{today}'],
  ])('%s (%s) is refused with invalid_value at calendar.initialDate', (_label, value) => {
    const view = calendarView({ ...binding, initialDate: value });
    const r = ListViewSchema.safeParse(view);
    expect(r.success).toBe(false);
    const issues = r.error!.issues;
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue.code).toBe('invalid_value');
    expect(issue.path).toEqual(['calendar', 'initialDate']);
    // The message names every accepted value, so the author's next move is a member.
    for (const member of ACCEPTED) expect(issue.message).toContain(`"${member}"`);

    // The wire envelope a save door answers with: the field and its catalog code,
    // under the validation class's HTTP status.
    const fields = zodIssuesToFields(issues, view);
    expect(fields).toEqual([
      expect.objectContaining({ field: 'calendar.initialDate', code: 'invalid_option' }),
    ]);
    expect(ErrorHttpStatusMap.validation).toBe(400);
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
});
