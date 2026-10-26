/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7029 — what ListView hands the calendar renderer, and which views it
 * offers the Calendar toggle to.
 *
 * Ruled on objectstack#13748 (director batch #19, option A): no invented
 * calendar field names, anywhere on the route. `ObjectView` was one half (it
 * fabricated `startDateField: 'due_date'`); this branch was the other, and it
 * is the half that decides whether the fix is observable at all — with
 * `ObjectView` fixed and this branch untouched, `'start_date'` / `'end_date'`
 * simply take over as the fabricated names one layer down, and the renderer
 * still never sees an absent binding.
 *
 * Two read-sites are pinned because they answer two different questions and
 * both used to be answered by the fabrication:
 *
 *   - the RENDER branch — which field does the calendar bucket by?
 *   - the CAPABILITY gate (`availableViews`) — may this view offer Calendar at
 *     all? ADR-0047: a visualization is offered only when its binding resolves.
 *     A view that declared no calendar block resolved one anyway, so the
 *     toggle was live on every object view in the product.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `|| 'start_date'` / `|| 'end_date'` on the two lines this card
 * deletes and the "invents NO binding" case goes RED (the spy reads the
 * fabricated names) while every declared-config case here stays GREEN.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { render, waitFor, screen, cleanup, fireEvent } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const rows = [
  { id: '1', name: 'Ada out', start_date: '2099-09-01', end_date: '2099-09-03' },
  { id: '2', name: 'Grace out', start_date: '2099-10-01', end_date: '2099-10-02' },
];

const objectDef = {
  name: 'crm_leave_request',
  label: 'Leave Request',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    start_date: { name: 'start_date', type: 'date', label: 'Start Date' },
    end_date: { name: 'end_date', type: 'date', label: 'End Date' },
  },
};

let captured: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-calendar',
  (props: Record<string, any>) => {
    captured.push(props);
    return <div data-testid="calendar-spy" />;
  },
  { namespace: 'test', label: 'Calendar spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async () => rows),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  }) as any;

const BASE = {
  type: 'list-view',
  objectName: 'crm_leave_request',
  viewType: 'calendar',
  columns: ['name'],
} as const;

/** Mount ListView on `schema` and return the props the calendar was given. */
async function calendarProps(schema: Record<string, any>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as never} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(captured.length).toBeGreaterThan(0));
  return captured[captured.length - 1].schema;
}

const queryViewOption = (name: string) =>
  screen.queryByRole('tab', { name }) ?? screen.queryByRole('button', { name });

beforeEach(() => {
  captured = [];
});
afterEach(cleanup);

describe('ListView calendar branch — only ever restates a DECLARED binding (objectui#7029)', () => {
  it('invents NO binding for a calendar view that declares no config', async () => {
    // THE DEFECT, at this layer. `startDateField` used to read 'start_date' and
    // `endDateField` 'end_date' here — names this view never wrote. Absent
    // bindings are what let `getCalendarConfig` return null downstream, which is
    // the only route to the renderer's refusal screen.
    const props = await calendarProps({ ...BASE });
    expect(props.startDateField).toBeUndefined();
    expect(props.endDateField).toBeUndefined();
    expect(props.titleField).toBeUndefined();
  });

  it('invents no binding when the view carries an EMPTY calendar block', async () => {
    // The half-written declaration the spec half (objectstack#13817) closes:
    // `allowedVisualizations: ['calendar']` with nothing under `calendar:`.
    const props = await calendarProps({ ...BASE, calendar: {} });
    expect(props.startDateField).toBeUndefined();
    expect(props.endDateField).toBeUndefined();
  });

  it('CONTROL: forwards the spec-canonical `calendar` block unchanged', async () => {
    const props = await calendarProps({
      ...BASE,
      calendar: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' },
    });
    expect(props.startDateField).toBe('start_date');
    expect(props.endDateField).toBe('end_date');
    expect(props.titleField).toBe('name');
  });

  it('CONTROL: forwards the legacy `options.calendar` nesting unchanged', async () => {
    // The nesting app-shell's object page emits. A correctly configured view
    // renders exactly as it did before this card.
    const props = await calendarProps({
      ...BASE,
      options: { calendar: { startDateField: 'start_date', endDateField: 'end_date', colorField: 'status' } },
    });
    expect(props.startDateField).toBe('start_date');
    expect(props.endDateField).toBe('end_date');
    expect(props.colorField).toBe('status');
  });

  it('CONTROL: a partially declared block keeps its declared half and only that', async () => {
    const props = await calendarProps({ ...BASE, calendar: { startDateField: 'start_date' } });
    expect(props.startDateField).toBe('start_date');
    expect(props.endDateField).toBeUndefined();
  });
});

describe('ListView capability gate — the Calendar toggle follows the binding (objectui#7029)', () => {
  const GRID = { ...BASE, viewType: 'grid' } as const;

  /**
   * The switcher has two forms — an inline segmented control (role="tab") and a
   * collapsed dropdown (plain buttons behind a trigger) — so the trigger has to
   * be opened before querying, and both roles have to be accepted. Copied from
   * `ListView.test.tsx`'s own helpers on purpose: querying without opening
   * returns null for BOTH worlds, which would make the negative case below pass
   * while measuring nothing (measured: it did, on the first run of this file).
   */
  const mountSwitcher = async (schema: Record<string, any>) => {
    const dataSource = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as never} dataSource={dataSource} showViewSwitcher />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const trigger = screen.queryByTestId('view-switcher-dropdown');
    if (trigger) fireEvent.click(trigger);
  };

  it('CONTROL: offers Calendar to a view that declared a binding', async () => {
    // The positive control comes FIRST here: it proves this harness can see the
    // option at all, so the negative case below is a measurement rather than a
    // query that never had anything to find.
    await mountSwitcher({ ...GRID, calendar: { startDateField: 'start_date' } });
    await waitFor(() => expect(queryViewOption('Calendar')).toBeInTheDocument());
  });

  it('does NOT offer Calendar to a view that declared no calendar binding', async () => {
    // ADR-0047: offered only when the binding resolves. Before this card the
    // object page's fabricated `options.calendar.startDateField` resolved for
    // every view in the product, so this toggle was always live — the "disable
    // the calendar toggle for such views" half of the ruling, obtained here by
    // deleting the fabrication rather than by adding a second mechanism.
    await mountSwitcher({ ...GRID, appearance: { allowedVisualizations: ['grid', 'calendar'] } });
    // (No `Grid` sanity assertion here: the switcher TRIGGER also carries
    // aria-label="Grid", so querying that name matches two elements and throws.
    // The positive control above is what proves this harness can see options.)
    expect(queryViewOption('Calendar')).not.toBeInTheDocument();
  });
});
