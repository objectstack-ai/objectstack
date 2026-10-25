/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3129 — what ListView hands the timeline renderer.
 *
 * `ListView.test.tsx`'s timeline case only asserts that the Timeline option
 * appears in the view switcher, so the binding it forwards was never checked.
 * These tests register a spy for `object-timeline` and read the resolved props
 * plus the `$select` projection, for each authoring shape the product accepts.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import { ListView, resolveTimelineDateBinding } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const rows = [
  { id: '1', name: 'Spring Launch', start_date: '2099-09-01', end_date: '2099-09-30' },
  { id: '2', name: 'Summer Push', start_date: '2099-10-01', end_date: '2099-10-31' },
];

const objectDef = {
  name: 'crm_campaign',
  label: 'Campaign',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    start_date: { name: 'start_date', type: 'date', label: 'Start Date' },
    end_date: { name: 'end_date', type: 'date', label: 'End Date' },
  },
};

let captured: Array<Record<string, any>> = [];
let findCalls: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-timeline',
  (props: Record<string, any>) => {
    captured.push(props);
    return <div data-testid="timeline-spy" />;
  },
  { namespace: 'test', label: 'Timeline spy', category: 'view' },
);

const makeDataSource = () => ({
  find: vi.fn(async (_object: string, query: Record<string, any>) => {
    findCalls.push(query);
    return rows;
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => objectDef),
});

const BASE = {
  type: 'list-view',
  objectName: 'crm_campaign',
  viewType: 'timeline',
  columns: ['name'],
} as const;

/** Mount ListView on `schema` and return the props the timeline was given. */
async function timelineProps(schema: Record<string, any>) {
  const dataSource = makeDataSource() as any;
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as never} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(captured.length).toBeGreaterThan(0));
  await waitFor(() => expect(findCalls.length).toBeGreaterThan(0));
  return captured[captured.length - 1];
}

describe('ListView — timeline date binding reaches the renderer (objectui#3129)', () => {
  beforeEach(() => {
    captured = [];
    findCalls = [];
  });

  it('forwards the nested spec key `timeline.startDateField`', async () => {
    const props = await timelineProps({
      ...BASE,
      timeline: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' },
    });
    expect(props.schema.timeline.startDateField).toBe('start_date');
    expect(props.schema.startDateField).toBe('start_date');
    expect(findCalls[0].$select).toContain('start_date');
  });

  it('does NOT forward the retired nested alias `timeline.dateField` (objectui#6152 round 14)', async () => {
    // This arm pinned the opposite: `dateField` was once resolved out of
    // `options.timeline` but NOT out of `schema.timeline`, and the fix made both
    // nestings bind (objectui#3129). Every list-view door refuses the alias by
    // name since rounds 11 and 12, and round 14 retired the reads and the core
    // fold, so neither nesting binds an axis: the renderer's refusal answers
    // (objectui#7070 step ③ made that refusal reachable), and nothing is fetched
    // for it.
    const props = await timelineProps({ ...BASE, timeline: { dateField: 'start_date' } });
    expect(props.schema.startDateField).toBeUndefined();
    expect(findCalls[0].$select).not.toContain('start_date');
  });

  it('forwards the legacy `options.timeline` nesting by its spec key; the retired alias binds nothing (objectui#6152 round 14)', async () => {
    const viaStart = await timelineProps({
      ...BASE,
      options: { timeline: { startDateField: 'start_date', endDateField: 'end_date' } },
    });
    expect(viaStart.schema.startDateField).toBe('start_date');

    // This half used to read `start_date` too: the bag's `dateField` was a rung
    // of `resolveTimelineDateBinding`. Round 14 retired it, and no fold reaches
    // into the bag, so the axis is absent and the renderer's refusal answers.
    captured = [];
    findCalls = [];
    const viaAlias = await timelineProps({ ...BASE, options: { timeline: { dateField: 'start_date' } } });
    expect(viaAlias.schema.startDateField).toBeUndefined();
  });

  it('binds to the CALENDAR date axis when the view declares no timeline one', async () => {
    // The gap the report isolated: "the same start_date / end_date fields render
    // correctly in the Calendar and Gantt views". A view whose date axis lives
    // under `calendar` is OFFERED the Timeline visualization — the capability
    // gate has always accepted `options.calendar.startDateField` as a
    // timeline-resolvable axis — but the render branch never read calendar
    // config, so it bucketed every record under "No date" while the calendar
    // rendered the very same field.
    const props = await timelineProps({
      ...BASE,
      options: { calendar: { startDateField: 'start_date', endDateField: 'end_date' } },
    });
    expect(props.schema.startDateField).toBe('start_date');
    expect(props.schema.endDateField).toBe('end_date');
    // Also on the NESTED config: ObjectTimeline prefers it over the flat prop.
    expect(props.schema.timeline?.startDateField).toBe('start_date');
    expect(findCalls[0].$select).toContain('start_date');
  });

  it('binds to the spec-canonical `calendar` nesting too', async () => {
    const props = await timelineProps({ ...BASE, calendar: { startDateField: 'start_date' } });
    expect(props.schema.startDateField).toBe('start_date');
    expect(props.schema.timeline?.startDateField).toBe('start_date');
  });

  it('a timeline config with no date key does not shadow the calendar binding', async () => {
    // app-shell emits an `options.timeline` object for every object view (it
    // carries the object's titleField), so "the config object exists" must not
    // be read as "the axis is bound".
    const props = await timelineProps({
      ...BASE,
      options: { timeline: { titleField: 'name' }, calendar: { startDateField: 'start_date' } },
    });
    expect(props.schema.startDateField).toBe('start_date');
    expect(props.schema.timeline.startDateField).toBe('start_date');
  });

  it('the declared timeline axis still WINS over a calendar one', async () => {
    const props = await timelineProps({
      ...BASE,
      timeline: { startDateField: 'end_date' },
      calendar: { startDateField: 'start_date' },
    });
    expect(props.schema.startDateField).toBe('end_date');
  });

  it('invents NO axis when the view declares no date axis at all', async () => {
    // This case used to assert `startDateField` was `'created_at'`, under the
    // title "keeps the historical fallback". That floor is RETIRED by
    // objectui#7070 step ③ (maintainer ruling 2026-09-01, 总监批 #28) — the
    // dedicated block at the foot of this file carries the reasoning. Kept here
    // and inverted rather than deleted: this is the objectui#3129 case that
    // measured the floor, so it is where the retirement has to become visible.
    const props = await timelineProps({ ...BASE, timeline: { titleField: 'name' } });
    expect(props.schema.startDateField).toBeUndefined();
    expect(props.schema.timeline.startDateField).toBeUndefined();
  });

  it('the capability gate and the render branch read ONE resolution', () => {
    // The gate used to be the wider of the two: it accepted a calendar binding
    // the renderer could not use. Same function now answers both questions.
    expect(resolveTimelineDateBinding({ options: { calendar: { startDateField: 'start_date' } } }))
      .toEqual({ startDateField: 'start_date', endDateField: undefined, titleField: undefined });
    // The timeline's own axis wins over the calendar's. Re-spelled from the
    // retired `timeline.dateField` (objectui#6152 round 14): the precedence was
    // the subject, the alias only the spelling it was written in.
    expect(resolveTimelineDateBinding({ timeline: { startDateField: 'a' }, calendar: { startDateField: 'b' } }).startDateField)
      .toBe('a');
    expect(resolveTimelineDateBinding({}).startDateField).toBeUndefined();
  });

  it('does NOT offer the Timeline visualization for a config using only the retired alias (objectui#6152 round 14)', async () => {
    // The gate once had the same vocabulary gap the arm above describes, and
    // this arm pinned that it learned the alias. The alias retired with the
    // reads, so the gate must not offer a Timeline nothing would bind.
    const dataSource = makeDataSource() as any;
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView
          schema={{ ...WIDE_TOOLBAR, ...BASE, viewType: 'grid', timeline: { dateField: 'start_date' } } as never}
          dataSource={dataSource}
          showViewSwitcher
        />
      </SchemaRendererProvider>,
    );
    const trigger = screen.queryByTestId('view-switcher-dropdown');
    if (trigger) fireEvent.click(trigger);
    const option =
      screen.queryByRole('tab', { name: 'Timeline' }) ?? screen.queryByRole('button', { name: 'Timeline' });
    expect(option).toBeFalsy();
  });
});

/**
 * objectui#7070 step ③ — this face stops flooring the timeline axis at
 * `'created_at'`.
 *
 * Maintainer ruling 2026-09-01 (总监批 #28, objectui#7070): house posture
 * 日期轴永不虚构 — a date axis is never fabricated. The ruling sequenced three
 * steps and forbade reordering them:
 *
 *   ① `ObjectTimeline` gains a refusal screen for an absent date axis;
 *   ② the renderer's own `|| 'date'` floor is retired;
 *   ③ — THIS — the two plugin faces stop supplying `'created_at'`.
 *
 * ①② landed as `20cb8db9b` (PR #7467) and changed nothing a user could see,
 * precisely because this floor still stood: `ObjectTimeline` reads the FLAT
 * `schema.startDateField` at the tail of its resolver chain, so this branch
 * answered "the axis is bound" for every view and the screen ① installed was
 * unreachable from here. The ruling also names the two lines of prose that used
 * to sit on the deleted line ("`created_at` stays the last resort for a view
 * that declares no date axis anywhere") as a written decision it EXPLICITLY
 * replaces — a second, de-facto contract held at one face only, on the very
 * literal objectui#3129 retired at app-shell.
 *
 * ⭐ What the floor actually produced, measured rather than assumed: the axis it
 * invented was never even FETCHED. The `$select` projection is collected from
 * the DECLARED `schema.timeline` / `schema.options.timeline` blocks (see
 * `collectViewFields`), never from this flat prop — so an undeclared view got a
 * timeline bound to a column the query did not request and bucketed every record
 * into "No date". That is the outcome the refusal replaces.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `|| 'created_at'` on the single line step ③ deletes and the three
 * "invents NO axis" cases (one of them above, in the objectui#3129 block) go
 * RED, while every CONTROL here stays GREEN in both worlds.
 */
describe('ListView timeline branch — the date-axis floor is retired (objectui#7070 step ③)', () => {
  beforeEach(() => {
    captured = [];
    findCalls = [];
  });

  it('RENDER PROOF: the timeline branch is reached and forwards a declared axis', async () => {
    // First, and deliberately. Every "is undefined" below reads a key off the
    // props the spy captured, and an absent key is indistinguishable from a
    // branch that never ran — a render failure would satisfy the negative cases
    // for the wrong reason. This row fails loudly instead.
    const props = await timelineProps({ ...BASE, timeline: { startDateField: 'start_date' } });
    expect(props.schema.type).toBe('object-timeline');
    expect(props.schema.startDateField).toBe('start_date');
  });

  it('invents NO axis for a timeline view that declares nothing at all', async () => {
    // THE DEFECT, at this face. `'created_at'` is a name the view never wrote —
    // and one nearly every object DOES carry, which is what made it read as a
    // real binding to everything downstream and made it never resolve to
    // nothing. Absence is the only route to the renderer's refusal.
    const props = await timelineProps({ ...BASE });
    expect(props.schema.startDateField).toBeUndefined();
  });

  it('invents no axis for the empty `options.timeline` bag the object page emits', async () => {
    // app-shell's `timelineViewOptions` emits a bag carrying only the title for
    // a view that declared no axis. "The config object exists" is not "the axis
    // is bound" — the same distinction the objectui#3129 block above pins for
    // the NESTED config, asked here of the flat prop.
    const props = await timelineProps({ ...BASE, options: { timeline: { titleField: 'name' } } });
    expect(props.schema.startDateField).toBeUndefined();
  });

  it('CONTROL: `titleField` is NOT a date axis and keeps its `name` floor', async () => {
    // ⛔ Scope, made visible. The ruling retires fabricated DATE AXES. `'name'`
    // is the display-name rung every sibling branch on this face carries, and
    // the one `timelineViewOptions` carries at app-shell. A later card retiring
    // it declares so here.
    const props = await timelineProps({ ...BASE });
    expect(props.schema.titleField).toBe('name');
  });

  it('CONTROL: a declared axis still reaches BOTH the flat prop and the nested config', async () => {
    // The half that must not change. `ObjectTimeline` prefers the nested key, so
    // a fix that only emptied the flat prop would look right here and still
    // break a correctly authored view.
    const props = await timelineProps({
      ...BASE,
      options: { calendar: { startDateField: 'start_date', endDateField: 'end_date' } },
    });
    expect(props.schema.startDateField).toBe('start_date');
    expect(props.schema.timeline.startDateField).toBe('start_date');
    expect(props.schema.endDateField).toBe('end_date');
    expect(findCalls[0].$select).toContain('start_date');
  });
});

/**
 * The ADR-0047 capability gate, asked in both directions.
 *
 * ⚠️ Read this block for what it is: a pair of CONTROLS, not a claim about
 * step ③. The gate reads `resolveTimelineDateBinding`, which never consulted
 * the flat floor, so both cases hold identically before and after the deletion.
 * That is the finding worth recording — unlike the gantt face (objectui#7070
 * flavour 1), where the object page's fabricated `options.gantt.startDateField`
 * kept the toggle live for every view in the product, the Timeline toggle was
 * ALREADY correct here. So the deletion changes what a view RENDERS, and
 * changes nothing about what the switcher OFFERS.
 */
describe('ListView capability gate — unchanged by step ③, in both directions (objectui#7070)', () => {
  const GRID = { ...BASE, viewType: 'grid' } as const;

  beforeEach(() => {
    captured = [];
    findCalls = [];
  });

  /**
   * The switcher has two forms — an inline segmented control (role="tab") and a
   * collapsed dropdown (plain buttons behind a trigger) — so the trigger has to
   * be opened before querying and both roles accepted. Querying without opening
   * returns null in BOTH worlds, which would make the negative case pass while
   * measuring nothing.
   */
  const mountSwitcher = async (schema: Record<string, any>) => {
    const dataSource = makeDataSource() as any;
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as never} dataSource={dataSource} showViewSwitcher />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const trigger = screen.queryByTestId('view-switcher-dropdown');
    if (trigger) fireEvent.click(trigger);
  };

  const queryViewOption = (name: string) =>
    screen.queryByRole('tab', { name }) ?? screen.queryByRole('button', { name });

  it('CONTROL: offers Timeline to a view that declared an axis', async () => {
    // The positive control comes FIRST: it proves this harness can see the
    // option at all, so the negative case below is a measurement rather than a
    // query that never had anything to find.
    await mountSwitcher({ ...GRID, timeline: { startDateField: 'start_date' } });
    await waitFor(() => expect(queryViewOption('Timeline')).toBeInTheDocument());
  });

  it('CONTROL: does NOT offer Timeline to a view that declared no axis', async () => {
    await mountSwitcher({ ...GRID, appearance: { allowedVisualizations: ['grid', 'timeline'] } });
    expect(queryViewOption('Timeline')).not.toBeInTheDocument();
  });
});
