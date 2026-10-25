/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7070 — the object page must not invent a GANTT date binding.
 *
 * The sibling of `ObjectView.calendarBinding-7029` next door, and the half PR
 * #7062 fenced out and reported separately. This face floored
 * `startDateField` at `'start_date'` and `endDateField` at `'end_date'` for
 * EVERY object view, declared or not. Downstream that is indistinguishable
 * from a real binding: `ObjectGantt.getGanttConfig` takes its flat branch as
 * soon as BOTH date props are present, so the fabrication made the renderer's
 * own "Gantt configuration required" screen unreachable from this route, and it
 * answered ADR-0047's capability gate (`options.gantt.startDateField`) so the
 * Gantt toggle was live on every object view in the product.
 *
 * ⚠️ THE PREMISE WAS MEASURED BEFORE THE DELETION. #7029's mechanic — delete the
 * literal, let the renderer's own refusal answer — is only correct where a
 * refusal path exists, and that had never been established for gantt. It was,
 * on the unmodified tree, before this file's fix was written: `ObjectGantt`
 * REFUSES an absent binding (it does not render empty, and does not throw). The
 * seam is pinned in `plugin-gantt/src/ObjectGantt.unconfiguredRefusal-7070`.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `startDateField: viewDef.gantt?.startDateField || 'start_date'` and
 * its `endDateField` twin, and the "invents NO date field" cases below go RED
 * (they read the fabricated names) while every declared-config CONTROL stays
 * GREEN in either world — the fabricated value is only ever observable when the
 * view declared nothing. That asymmetry is the point: a fix that emitted an
 * empty config for EVERY view would also pass a refusal-only test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ganttViewOptions } from './ObjectView';

describe('ganttViewOptions — the object page forwards, it does not invent (objectui#7070)', () => {
  it('invents NO date field for a view that declares no gantt config', () => {
    // THE DEFECT. This used to return `{ startDateField: 'start_date',
    // endDateField: 'end_date', titleField: 'name' }` — a complete-looking axis
    // for a view that configured nothing, which is what short-circuited the
    // renderer's refusal screen and lit the Gantt toggle everywhere.
    expect(ganttViewOptions({})).toEqual({ titleField: 'name' });
    expect(ganttViewOptions(undefined)).toEqual({ titleField: 'name' });
    expect(ganttViewOptions({ label: 'All', columns: ['name'] })).toEqual({ titleField: 'name' });
  });

  it('invents no date field for a view whose neighbouring blocks ARE declared', () => {
    // A view bound for kanban/calendar must not acquire a gantt axis by
    // proximity — the Gantt toggle it would light up has nothing behind it.
    const out = ganttViewOptions({
      kanban: { groupByField: 'stage' },
      calendar: { startDateField: 'start_date' },
    });
    expect(out).not.toHaveProperty('startDateField');
    expect(out).not.toHaveProperty('endDateField');
  });

  it('invents no date field for an EMPTY gantt block', () => {
    // The half-written declaration: `allowedVisualizations: ['gantt']` with
    // nothing under `gantt:`. It must stay half-written all the way down.
    const out = ganttViewOptions({ gantt: {} });
    expect(out).not.toHaveProperty('startDateField');
    expect(out).not.toHaveProperty('endDateField');
  });

  it('CONTROL: forwards a fully declared block verbatim — every spec key survives', () => {
    // A bare whitelist here once dropped every field past `colorField` and
    // flattened the chart, so the spread is load-bearing, not incidental.
    const out = ganttViewOptions({
      gantt: {
        startDateField: 'planned_start',
        endDateField: 'planned_end',
        titleField: 'subject',
        parentField: 'parent',
        typeField: 'node_type',
        baselineStartField: 'bl_start',
        groupByField: 'owner',
        tooltipFields: [{ field: 'owner' }],
      },
    });
    expect(out).toMatchObject({
      startDateField: 'planned_start',
      endDateField: 'planned_end',
      titleField: 'subject',
      parentField: 'parent',
      typeField: 'node_type',
      baselineStartField: 'bl_start',
      groupByField: 'owner',
      tooltipFields: [{ field: 'owner' }],
    });
  });

  it('CONTROL: a HALF-declared axis keeps its declared rung and only that', () => {
    // One date field is not a gantt: `getGanttConfig`'s flat branch needs BOTH,
    // so this shape reaches the refusal screen rather than rendering on a name
    // nobody wrote.
    const out = ganttViewOptions({ gantt: { startDateField: 'planned_start' } });
    expect(out.startDateField).toBe('planned_start');
    expect(out).not.toHaveProperty('endDateField');
  });

  it('keeps the `name` title floor — a display default is not a date axis', () => {
    // Deliberately NOT removed by this card, and the same rung
    // `timelineViewOptions` carries. `ObjectGantt` floors the title itself too.
    expect(ganttViewOptions({}).titleField).toBe('name');
    expect(ganttViewOptions({ gantt: { titleField: 'subject' } }).titleField).toBe('subject');
  });
});

describe('no invented gantt date name survives in the source (objectui#7070)', () => {
  const SOURCE = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ObjectView.tsx'),
    'utf8',
  );

  /**
   * Executable lines only. The prose above this file's own seams names
   * `'start_date'` / `'end_date'` repeatedly — that is the record of what was
   * deleted, and a scan that counted it would be red on a correct tree. Same
   * filter, and same reason, as the objectui#7029 scan next door.
   */
  const CODE = SOURCE.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l));

  it("the fabricated 'start_date' / 'end_date' floors are gone from this face's CODE", () => {
    // A structural tripwire, not a restatement of the cases above: these are
    // what a future copy-paste from a sibling branch would reintroduce, and they
    // are invisible to a behavioural test on any object that happens to carry
    // real `start_date` / `end_date` fields — which is exactly how the defect
    // survived (hotcrm's `crm_leave_request` carries both).
    expect(CODE.filter((l) => l.includes("'start_date'"))).toEqual([]);
    expect(CODE.filter((l) => l.includes("'end_date'"))).toEqual([]);
  });

  it('CONTROL: the scan can still see a literal that IS there', () => {
    // Without this the case above is green on any tree where the filter simply
    // matches nothing.
    //
    // RE-ANCHORED twice, each time following this control's own instruction.
    // It sat on the gallery branch's `imageField … || 'image'` floor until
    // objectui#7547 retired that literal, then on the chart branch's measure
    // floor (`chartConfig.yAxisFields[0] || 'value'`) until objectui#6152
    // round 15 retired that one with the legacy chart axes. No fabricated
    // binding floor remains in this face (the case below asserts that), so the
    // anchor is now `'name'`, the display-name floor the twins in
    // `ObjectView.calendarBinding-7029.test.tsx` and
    // `ObjectView.galleryBinding-7547.test.tsx` already use for their machinery
    // control: deliberately permanent, so this cannot go red as a side effect.
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

  it('CONTROL: the scan reads CODE, not the prose that records the deletion', () => {
    // The filter's own correctness. The seam comments above `ganttViewOptions`
    // name both deleted literals; if the filter ever stopped stripping comment
    // lines, the case above would go red on a CORRECT tree and invite someone to
    // weaken it.
    expect(SOURCE.includes("`'start_date'`")).toBe(true);
    expect(CODE.filter((l) => l.includes("'start_date'"))).toEqual([]);
  });
});
