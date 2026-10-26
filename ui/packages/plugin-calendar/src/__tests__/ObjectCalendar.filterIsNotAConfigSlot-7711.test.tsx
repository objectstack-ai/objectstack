/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7711 — `filter` is the query filter and NOTHING else.
 *
 * `getCalendarConfig` used to probe `schema.filter` for a `calendar` key and,
 * on a hit, return that value as the `CalendarConfig`. The same object went to
 * `$filter` on the wire regardless, so ONE authored key was read twice with two
 * incompatible meanings. `calendar` is the canonical container
 * (`@objectstack/spec`'s `ComponentPropsMap['object-calendar']`); the
 * `filter.calendar` spelling is retired outright, with no compatibility rung
 * and no deprecation window (AGENTS.md #0.1, and the standing maintainer ruling
 * of 2026-08-27 on staged migrations).
 *
 * The calendar twin of objectui#4034, which retired the identical `filter.map`
 * shape on `ObjectMap`. Two things differ HERE, both measured on this branch,
 * and together they are why this retirement carries no dev-time diagnostic
 * rider like plugin-map's `warnOnLegacyFilterMapConfig`:
 *
 *   1. There is no `Array.prototype.calendar`. `'map' in schema.filter` was
 *      TRUE for every array-shaped filter — the inherited method, the empty
 *      array, and the `and` node a dataSource binding merges — which is what
 *      upgraded #4034 from an observation to a live defect that broke authors
 *      writing the CORRECT shape. `'calendar' in schema.filter` is false for
 *      all three. Only an object-shaped filter with an OWN `calendar` key ever
 *      reached the retired arm. Pinned as a mechanism below, because it is the
 *      ground on which the rider was omitted.
 *   2. When the retired spelling is the only place a config was written, this
 *      component returns null and the early return renders the existing
 *      "Calendar configuration required" screen. The map fell back to DEFAULT
 *      field names — an empty map that looks like bad data — which is exactly
 *      why it had to warn. The calendar already says what is missing, by name,
 *      on screen. (objectui#8170 reworded that screen's SECOND clause; the
 *      `REFUSAL` matcher below reads the first clause only, which is why this
 *      file is unaffected by it and why this citation is clipped to it.)
 *
 * BOTH DIRECTIONS ARE PINNED, because a fix that simply stopped reading the
 * filter would also pass a retirement-only file: the second group asserts that
 * a legitimate `FilterCondition` on a field literally NAMED `calendar` reaches
 * `$filter` untouched and is never mistaken for configuration. That case is the
 * whole point of the card.
 *
 * The last group covers the `calendarConfig` memo's dependency list, which this
 * card edits: `schema.filter` left it (the function no longer reads it) and the
 * three flat keys the function reads but the list never named were added.
 * Removing `filter` removes an accidental co-trigger, so `startDateField` had
 * to become a real dependency rather than one that happened to be picked up
 * whenever the filter changed alongside it.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// The month grid is orthogonal to everything this file observes (which config
// won, and what reached `$filter`), and rendering it costs a month of DOM per
// case. Same stub idiom as `ObjectCalendar.rowCeiling-7210`.
vi.mock('../CalendarView', () => ({
  CalendarView: ({ events }: any) => (
    <div
      data-testid="calendar-view"
      data-event-count={String(events.length)}
      data-event-titles={events.map((e: any) => e.title).join('|')}
    />
  ),
}));

import { ObjectCalendar } from '../ObjectCalendar';

afterEach(cleanup);

const REFUSAL = /Calendar configuration required/i;
const OBJECT = 'visit';

const today = new Date();
const inThisMonth = (d: number) =>
  new Date(today.getFullYear(), today.getMonth(), Math.min(d, 28), 9, 0, 0, 0).toISOString();

/**
 * Two rows carrying their date under DIFFERENT field names, so which field the
 * resolved config names is legible from the rendered event titles alone.
 */
const ROWS = [
  { id: 'r1', name: 'Placed by starts_at', starts_at: inThisMonth(10) },
  { id: 'r2', name: 'Placed by other_at', other_at: inThisMonth(12) },
];

const CANONICAL = { startDateField: 'starts_at', titleField: 'name' };

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        starts_at: { type: 'datetime' },
        other_at: { type: 'datetime' },
        calendar: { type: 'text' },
      },
    }),
  } as any;
}

const view = () => screen.getByTestId('calendar-view');
const titles = () => (view().getAttribute('data-event-titles') ?? '').split('|').filter(Boolean);

/** The parameters of the most recent `find` call. */
const lastFindParams = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

describe('objectui#7711 — the retired `filter.calendar` spelling yields NO configuration', () => {
  it('refuses a schema whose only calendar config is stashed under `filter.calendar`', async () => {
    const dataSource = makeDataSource();
    const schema: any = {
      type: 'object-calendar',
      objectName: OBJECT,
      filter: { calendar: CANONICAL },
    };

    render(<ObjectCalendar schema={schema} dataSource={dataSource} />);

    // RED before the fix: the retired arm returned `CANONICAL` here, so the
    // calendar rendered its events and no refusal ever appeared.
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
    expect(screen.queryByTestId('calendar-view')).toBeNull();
  });

  it('does not let `filter.calendar` shadow the canonical `calendar` container', async () => {
    const dataSource = makeDataSource();
    const schema: any = {
      type: 'object-calendar',
      objectName: OBJECT,
      calendar: CANONICAL,
      // A DIFFERENT config under the retired spelling. Before the fix this arm
      // sat ABOVE the canonical read and won, so the events were placed by
      // `other_at`; the declared container was unreachable whenever a filter
      // happened to carry a `calendar` key.
      filter: { calendar: { startDateField: 'other_at', titleField: 'name' } },
    };

    render(<ObjectCalendar schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(screen.getByTestId('calendar-view')).toBeTruthy());
    expect(titles()).toEqual(['Placed by starts_at']);
  });
});

describe('objectui#7711 — a legitimate filter on a field NAMED `calendar` stays a filter', () => {
  it('passes `filter: { calendar: ... }` to `$filter` untouched and reads config from `calendar`', async () => {
    const dataSource = makeDataSource();
    const authoredFilter = { calendar: 'team' };
    const schema: any = {
      type: 'object-calendar',
      objectName: OBJECT,
      calendar: CANONICAL,
      filter: authoredFilter,
    };

    render(<ObjectCalendar schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const params = lastFindParams(dataSource);

    // The filter half: byte-for-byte what the author wrote, and the SAME
    // object — nothing on this path may rewrite or re-key it.
    expect(params.$filter).toEqual({ calendar: 'team' });
    expect(params.$filter).toBe(authoredFilter);

    // The configuration half: RED before the fix, where the retired arm
    // returned the STRING `'team'` as the `CalendarConfig`. `'team'` is truthy,
    // so the refusal screen never fired either; `startDateField` destructured
    // off a string is `undefined`, every record fell into "unscheduled", and
    // the grid rendered empty while the author's declared `calendar` block sat
    // unread. A silent wrong answer, which is why this is the card's core case.
    await waitFor(() => expect(screen.getByTestId('calendar-view')).toBeTruthy());
    expect(titles()).toEqual(['Placed by starts_at']);
  });

  it('leaves an array-shaped filter untouched — the shape #4034 measured on the map', async () => {
    const dataSource = makeDataSource();
    const authoredFilter = [['calendar', '=', 'team']];
    const schema: any = {
      type: 'object-calendar',
      objectName: OBJECT,
      calendar: CANONICAL,
      filter: authoredFilter,
    };

    render(<ObjectCalendar schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(lastFindParams(dataSource).$filter).toBe(authoredFilter);
    await waitFor(() => expect(screen.getByTestId('calendar-view')).toBeTruthy());
    expect(titles()).toEqual(['Placed by starts_at']);
  });

  it('MECHANISM: `calendar` is not on `Array.prototype`, unlike `map`', () => {
    // The ground on which this retirement omits plugin-map's dev warning. If a
    // future `Array.prototype.calendar` ever existed, the retired probe would
    // have had #4034's much wider blast radius and this file's reasoning about
    // the rider would need re-opening — so the asymmetry is asserted, not
    // assumed. The `map` half is the control that proves the probe can fire.
    const arrayShapes: unknown[][] = [[], [['a', '=', 1]], [['a', '=', 1], 'and', ['b', '=', 2]]];
    for (const f of arrayShapes) {
      expect('calendar' in (f as object)).toBe(false);
      expect('map' in (f as object)).toBe(true);
    }
    expect('calendar' in ({ calendar: 'team' } as object)).toBe(true);
  });
});

describe('objectui#7711 — the `calendarConfig` memo depends on every key the config can come from', () => {
  it('recomputes when only `startDateField` changes', async () => {
    const dataSource = makeDataSource();
    const base = { type: 'object-calendar', objectName: OBJECT, titleField: 'name' };
    const schemaA: any = { ...base, startDateField: 'starts_at' };
    const schemaB: any = { ...base, startDateField: 'other_at' };

    const { rerender } = render(<ObjectCalendar schema={schemaA} dataSource={dataSource} />);
    await waitFor(() => expect(screen.getByTestId('calendar-view')).toBeTruthy());
    expect(titles()).toEqual(['Placed by starts_at']);

    rerender(<ObjectCalendar schema={schemaB} dataSource={dataSource} />);

    // RED before the dependency-list edit: `startDateField` was never a
    // dependency, so this memo kept its cached config and the grid went on
    // placing records by the OLD field.
    await waitFor(() => expect(titles()).toEqual(['Placed by other_at']));
  });

  it('no longer recomputes on a filter change alone — `filter` is not a config key', async () => {
    const dataSource = makeDataSource();
    const base = { type: 'object-calendar', objectName: OBJECT, calendar: CANONICAL };

    const { rerender } = render(
      <ObjectCalendar schema={{ ...base, filter: [['a', '=', 1]] } as any} dataSource={dataSource} />,
    );
    await waitFor(() => expect(screen.getByTestId('calendar-view')).toBeTruthy());
    expect(titles()).toEqual(['Placed by starts_at']);

    // A new filter still reaches the wire — the fetch effect keeps its own
    // `schema.filter` dependency, which this card does NOT touch.
    const nextFilter = [['a', '=', 2]];
    rerender(<ObjectCalendar schema={{ ...base, filter: nextFilter } as any} dataSource={dataSource} />);

    await waitFor(() => expect(lastFindParams(dataSource).$filter).toBe(nextFilter));
    expect(titles()).toEqual(['Placed by starts_at']);
  });
});
