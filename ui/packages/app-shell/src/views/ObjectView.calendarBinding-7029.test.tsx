/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7029 — the object page must not invent a calendar field binding.
 *
 * Ruled on objectstack#13748 (director batch #19, option A). This face used to
 * emit `startDateField: 'due_date'` and `titleField: 'name'` into
 * `options.calendar` for EVERY object view, declared or not. Downstream that is
 * indistinguishable from a real binding, and it is what made
 * `ObjectCalendar`'s own refusal screen ("Calendar configuration required.
 * Please specify startDateField and titleField.") unreachable from this route:
 * the renderer decides by asking whether a start-date binding is PRESENT, and
 * this face always said yes. Measured on hotcrm's `crm_leave_request` (real
 * fields `start_date` / `end_date`, no `calendar:` block): nine records piled
 * onto today's cell under titles resolved through the display-name chain.
 *
 * The exact shape objectui#3129 already gave the timeline face one branch up
 * (`timelineViewOptions`), and ADR-0085 gave the kanban lane ("never invents a
 * field the object doesn't have"), and `InterfaceListPage.defaultCalendarFromObject`
 * has always had (a binding, or `undefined` — never a guess).
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `startDateField: viewDef.calendar?.startDateField || 'due_date'` /
 * `titleField: … || 'name'` and the "invents NO field names" cases below go RED
 * (they read the fabricated names), while the "forwards what the author
 * declared" cases stay GREEN in either world — the fabricated value is only
 * ever observable when the view declared nothing. That asymmetry is the point:
 * a fix that refused EVERY view would also pass a refusal-only test, so the
 * declared-config cases are carried here as the control.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calendarViewOptions } from './ObjectView';

describe('calendarViewOptions — the object page forwards, it does not invent (objectui#7029)', () => {
  it('invents NO calendar config for a view that declares none', () => {
    // THE DEFECT. This used to be
    // `{ startDateField: 'due_date', titleField: 'name', … }` — a complete-looking
    // config for a view that configured nothing, which is precisely what
    // short-circuited the renderer's refusal screen.
    expect(calendarViewOptions({})).toBeUndefined();
    expect(calendarViewOptions({ label: 'All', columns: ['name'] })).toBeUndefined();
    expect(calendarViewOptions(undefined)).toBeUndefined();
  });

  it('invents no config for a view whose neighbouring blocks ARE declared', () => {
    // A view bound for kanban/timeline must not acquire a calendar binding by
    // proximity — the calendar toggle it would light up has nothing behind it.
    expect(
      calendarViewOptions({ kanban: { groupByField: 'stage' }, timeline: { startDateField: 'start_date' } }),
    ).toBeUndefined();
  });

  it('CONTROL: forwards a fully declared block verbatim — every spec key survives', () => {
    const out = calendarViewOptions({
      calendar: {
        startDateField: 'start_date',
        endDateField: 'end_date',
        titleField: 'subject',
        colorField: 'status',
        allDayField: 'all_day',
      },
    });
    // The spec block's five keys. Re-spelled by objectui#6152 round 14: this
    // fixture also carried `defaultView`, which is not a member of a list view's
    // calendar block (every door refuses it, and `ListView` no longer lifts it).
    expect(out).toEqual({
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'subject',
      colorField: 'status',
      allDayField: 'all_day',
    });
  });

  it('CONTROL: a key the old whitelist would have dropped survives the spread', () => {
    // The gallery and gantt branches next door each had to learn this the hard
    // way: a bare whitelist silently drops every spec key it does not name.
    const out = calendarViewOptions({ calendar: { startDateField: 'start_date', scale: 'month' } });
    expect(out).toMatchObject({ startDateField: 'start_date', scale: 'month' });
  });

  it('forwards a HALF-declared block as-is — the missing rung stays missing', () => {
    // `calendar: { titleField }` with no date binding is the half-written
    // declaration objectstack#13817 closes in the spec. At runtime it must stay
    // half-written all the way down, so the renderer refuses instead of
    // rendering on a name nobody wrote.
    const out = calendarViewOptions({ calendar: { titleField: 'subject' } });
    expect(out).toEqual({ titleField: 'subject' });
    expect(out).not.toHaveProperty('startDateField');
  });

  it('ignores a non-object `calendar` value rather than forwarding garbage', () => {
    expect(calendarViewOptions({ calendar: true })).toBeUndefined();
    expect(calendarViewOptions({ calendar: 'start_date' })).toBeUndefined();
  });
});

describe('no invented calendar field name survives in the source (objectui#7029)', () => {
  const SOURCE = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ObjectView.tsx'),
    'utf8',
  );

  /**
   * Executable lines only. The prose above this file's own seams names
   * `'due_date'` repeatedly — that is the record of what was deleted, and a
   * scan that counted it would be red on a correct tree (measured: it was, on
   * the first run of this file).
   */
  const CODE = SOURCE.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l));

  it("the fabricated 'due_date' binding is gone from this face's CODE entirely", () => {
    // A structural tripwire, not a restatement of the cases above: the literal
    // is what a future copy-paste from a sibling branch would reintroduce, and
    // it is invisible to a behavioural test on any object that happens to carry
    // a real `due_date` field.
    expect(CODE.filter((l) => l.includes("'due_date'"))).toEqual([]);
  });

  it('the calendar seam no longer floors its title at a name the view never wrote', () => {
    expect(CODE.filter((l) => /calendar\?\.titleField \|\| 'name'/.test(l))).toEqual([]);
  });

  /**
   * ⭐ THE POSITIVE CONTROL — read this before changing either case below.
   *
   * Without a control the two cases above are green on any tree where the filter
   * simply matches nothing: the failure mode that made the first spelling of
   * this scan a phantom check. This control was originally a single case
   * anchored on the gantt branch's own `'start_date'` floor ("same class,
   * separately reported, deliberately NOT touched by this card").
   *
   * objectui#7070 is that separate report, and fixing it deleted the anchor —
   * `'start_date'` is now absent from this face's CODE, so the original control
   * would have gone red. ⛔ It was NOT simply removed: a scan whose last live
   * control is dropped becomes a test that passes over nothing, which is the
   * exact class this whole card family is about. It is re-expressed as TWO
   * controls that answer two different questions:
   */

  it('CONTROL (machinery): the scan can see a literal that IS there', () => {
    // Can this filter return a non-empty result at all? Anchored on `'name'`,
    // which is DELIBERATELY permanent here — the display-name floor the
    // objectui#3129 note above the seams describes as what stays. It is not a
    // fabricated field name, so no future card of this family retires it, and
    // this control cannot go red as a side effect of the next fix.
    expect(CODE.filter((l) => l.includes("'name'")).length).toBeGreaterThan(0);
  });

  it('CONVERTED (objectui#6152 round 15): NO fabricated field-name floor remains in this face', () => {
    // This case read "the scan still sees a REMAINING fabricated field name",
    // anchored on the chart branch's measure floor
    // (`chartConfig.yAxisFields[0] || 'value'`). objectui#6152 round 15 retired
    // that floor with the legacy chart axes, and with it the last one-rung
    // `|| 'literal'` binding floor in this file: what is left floors a display
    // title or label at `'name'` (the machinery control's anchor, not a
    // fabrication), a view `type` at `'grid'` or a chart family at `'bar'`.
    // So, as this case instructed, it now asserts that NONE remains — the scan
    // keeps making a claim about the tree, and a floor copied back in reds here.
    expect(CODE.filter((l) => /\|\| 'value'/.test(l))).toEqual([]);
    expect(CODE.filter((l) => /\b(?!titleField\b|labelField\b)\w*Field\b[^|\n]*\|\| '[A-Za-z_]+'/.test(l))).toEqual([]);
  });
});
