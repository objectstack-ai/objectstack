import { describe, it, expect } from 'vitest';

import { CalendarConfigSchema, ListViewSchema } from './view.zod';
import { ComponentPropsMap } from './component.zod';

/**
 * [#17054] Two faces of THIS package disagreed about whether `allDayField` is a
 * member of the calendar config, and the disagreement was a class-(c) authoring
 * trap: the `object-calendar` door refused a flat `allDayField` and prescribed
 * `calendar: { startDateField, endDateField, titleField, colorField,
 * allDayField }`, a shape `CalendarConfigSchema` refused BY NAME. An author who
 * followed the prescription on a stored view was refused a second time, by a
 * different schema, with a different message, and nothing in either message
 * said the key was not a member at all — so the natural next move is to assume
 * a typo and try more spellings.
 *
 * The round measured that the key is honoured, not inert, so the schema was the
 * wrong half: at the objectui pin `53ded82b` this repo builds against,
 * `ListView`'s `collectViewFields` reads `calendar.allDayField` into the fetch
 * projection and its calendar branch forwards the authored block onto the
 * `object-calendar` node, where `getCalendarConfig` resolves it; objectui#8026
 * makes it load-bearing in the render. `CalendarConfigSchema` now declares it.
 *
 * ⭐ Both directions are pinned. The first block proves the prescribed shape is
 * accepted; the second proves what the widening did NOT cost — the flat
 * spelling is still refused, `defaultView` (the neighbouring objectui-LOCAL
 * knob, a UI preference rather than a field binding) is still refused, and an
 * unknown key is still refused in the same shape as before.
 */

/** The four keys that were declared before this card, in the prescription's own order. */
const FOUR = {
  startDateField: 'start_date',
  endDateField: 'end_date',
  titleField: 'subject',
  colorField: 'status',
} as const;

/** A list view that parses clean apart from whatever the case under test adds. */
const baseView = (calendar: Record<string, unknown>) => ({
  type: 'calendar' as const,
  name: 'my_cal',
  columns: ['subject'],
  calendar,
});

const objectCalendar = ComponentPropsMap['object-calendar'];

/** The `object-calendar` refusal that carries the flat-key prescription. */
const flatRefusalMessage = (): string => {
  const r = objectCalendar.safeParse({ objectName: 'events', allDayField: 'is_all_day' });
  expect(r.success).toBe(false);
  const issue = r.success === false
    ? r.error.issues.find((i) => i.code === 'unrecognized_keys')
    : undefined;
  expect(issue).toBeDefined();
  return String(issue?.message ?? '');
};

describe('[#17054] the `object-calendar` prescription names only keys `CalendarConfigSchema` accepts', () => {
  /**
   * ⭐ The pin for the DEFECT CLASS, not for one key. It reads the key list out
   * of the prescription the runtime actually prints and asks the config schema
   * to accept each one, so any future edit that makes the diagnostic name a
   * non-member goes red here — including a key nobody has thought of yet.
   */
  it('every key the prescription names inside `calendar: { … }` is accepted by CalendarConfigSchema', () => {
    const message = flatRefusalMessage();
    const named = /calendar:\s*\{([^}]*)\}/.exec(message);
    expect(named, `the prescription no longer spells a \`calendar: { … }\` shape: ${message}`).not.toBeNull();

    const keys = String(named?.[1] ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    // Control: the extraction found a real list, not an empty one that would
    // make the assertion below vacuously true.
    expect(keys.length).toBeGreaterThanOrEqual(5);
    expect(keys).toContain('allDayField');

    for (const key of keys) {
      const r = CalendarConfigSchema.safeParse({ startDateField: 'start_date', [key]: 'some_field' });
      expect(
        r.success,
        `the prescription names \`${key}\`, which CalendarConfigSchema refuses`,
      ).toBe(true);
    }
  });

  it('ACCEPTS the prescribed shape verbatim — the four declared keys plus `allDayField`', () => {
    const r = CalendarConfigSchema.safeParse({ ...FOUR, allDayField: 'is_all_day' });
    expect(r.success).toBe(true);
  });

  it('ACCEPTS the prescribed shape through the stored-view door, where the second refusal used to land', () => {
    const r = ListViewSchema.safeParse(baseView({ ...FOUR, allDayField: 'is_all_day' }));
    expect(r.success).toBe(true);
  });

  it('control: the same view without `allDayField` parses too — the door was never the problem', () => {
    const r = ListViewSchema.safeParse(baseView({ ...FOUR }));
    expect(r.success).toBe(true);
  });
});

describe('[#17054] what the widening did NOT open', () => {
  /**
   * The flat spelling stays refused. `allDayField` became a member of the
   * `calendar` config object, ⛔ not a second authorable spelling on the block
   * (one key per concept, Prime Directive #12) — and the refusal keeps carrying
   * the prescription that now points somewhere real.
   */
  it('REFUSES a flat `allDayField` on `object-calendar`, still, and still prescribes the nested shape', () => {
    const r = objectCalendar.safeParse({ objectName: 'events', allDayField: 'is_all_day' });
    expect(r.success).toBe(false);
    const issue = r.success === false
      ? r.error.issues.find((i) => i.code === 'unrecognized_keys')
      : undefined;
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['allDayField']);
    expect(issue?.message).toContain('Write this as a key of the `calendar` config object instead');
  });

  /**
   * `defaultView` is the neighbour that proves the opening is one key wide. It
   * is honoured by the same renderer and declared in objectui's own
   * sanctioned-local list, and it stays refused here because it is a UI
   * preference, not a field binding — and it already has a declared spec home
   * as an `object-calendar` component prop.
   */
  it('REFUSES `defaultView` on the calendar config, still — the opening is exactly one key wide', () => {
    const r = CalendarConfigSchema.safeParse({ ...FOUR, defaultView: 'month' });
    expect(r.success).toBe(false);
    const issue = r.success === false
      ? r.error.issues.find((i) => i.code === 'unrecognized_keys')
      : undefined;
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['defaultView']);
  });

  it('REFUSES an unknown key on the calendar config, still, in the same shape as before', () => {
    const r = CalendarConfigSchema.safeParse({ ...FOUR, bogusKeyXy: 'x' });
    expect(r.success).toBe(false);
    const issue = r.success === false
      ? r.error.issues.find((i) => i.code === 'unrecognized_keys')
      : undefined;
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['bogusKeyXy']);
    expect(issue?.message).toContain('Unrecognized key(s) on this calendar configuration');
  });

  it('REFUSES an unknown key through the stored-view door, reported at `calendar`', () => {
    const r = ListViewSchema.safeParse(baseView({ ...FOUR, bogusKeyXy: 'x' }));
    expect(r.success).toBe(false);
    const issue = r.success === false
      ? r.error.issues.find((i) => i.code === 'unrecognized_keys')
      : undefined;
    expect(issue?.path.join('.')).toBe('calendar');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['bogusKeyXy']);
  });

  it('still REQUIRES `startDateField` — `allDayField` alone is not a calendar binding', () => {
    const r = CalendarConfigSchema.safeParse({ allDayField: 'is_all_day' });
    expect(r.success).toBe(false);
    expect(
      r.success === false && r.error.issues.some((i) => i.path.join('.') === 'startDateField'),
    ).toBe(true);
  });
});
