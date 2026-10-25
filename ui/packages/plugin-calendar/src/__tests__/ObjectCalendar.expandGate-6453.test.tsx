/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6453 — the object schema GATES `ObjectCalendar`'s standalone record
 * query.
 *
 * ## What this replaces
 *
 * The fetch effect built its expand set from a REF (`objectSchemaRef.current`)
 * assigned in the render body, and deliberately omitted `objectSchema` from its
 * dependency list. That bought exactly one effect run per mount — and paid for
 * it with the expansion, permanently: on that one run the ref was still `null`,
 * `buildExpandFields` saw no fields, and the query went out with no `$expand`
 * at all. Nothing re-ran the effect when the schema landed, so every
 * lookup / master_detail / user / tree field of a standalone `object-calendar`
 * rendered from its raw foreign-key id, forever.
 *
 * Only the STANDALONE calendar reaches this path. One hosted by `ObjectView` or
 * `ListView` receives its rows as `data` and never fetches — objectui#6419
 * already covers that composition (and the last test here pins that the gate
 * did not turn a hosted calendar into a fetching one).
 *
 * ## Why gating, measured on THIS component
 *
 * objectui#6271 (kanban) and objectui#6419 (view) settled the same trade, but
 * this effect's dependency set is different again (`dataConfig`,
 * `hasInlineData`, `schema.filter`, `schema.sort`, `refreshKey`), so what an
 * extra re-run costs HERE was measured separately. Instrumented adapter, rows
 * carrying a `_from` tag, three latency profiles, observations read from the
 * DOM and from real child commits:
 *
 *   before             1 find, `$expand` NEVER present, in all three profiles.
 *                      The calendar paints raw ids and keeps them.
 *   `objectSchema`     2 finds, `[no-expand, $expand:[…]]`. Visible cost varies
 *   added to the deps  with which read is slower:
 *                        schema slower  raw ids paint at 30ms, the calendar
 *                                       reverts to "Loading calendar..." at
 *                                       71ms, expanded rows land at 94ms — a
 *                                       THREE-step paint.
 *                        equal          raw commits, but coalesces with the
 *                                       loading commit — a coin flip.
 *                        schema faster  the first response is discarded on
 *                                       arrival; a round trip bought and
 *                                       thrown away.
 *   gated (this file)  1 find, carrying `$expand` the first time, in all three
 *                      profiles. One delivery, expanded, at 107/88/78ms versus
 *                      108/94/79ms for the dependency version — the correct
 *                      rows land at the same wall clock, with half the queries
 *                      and nothing wrong painted in between.
 *
 * The three-step paint is this component's own finding: `loading` is an early
 * return that replaces the whole grid, and the re-run calls `setLoading(true)`,
 * so the calendar does not merely swap ids for names the way `ObjectView` does
 * — it drops back to its placeholder first.
 *
 * ## ⚠️ What "gated" must mean — the trap this file exists to hold shut
 *
 * The gate is on the schema read having **settled**, NOT on `objectSchema`
 * being truthy. Those differ for exactly the calendars least able to report it:
 * an adapter exposing no `getObjectSchema`, and a read that throws. Under a
 * truthy-value gate both wait forever and the calendar renders its spinner with
 * no error and no request.
 *
 * ## Which pins discriminate, measured against the base commit
 *
 * Reverse-verified by restoring this component to the commit this branch left:
 * SIX of the nine go red (the four above, plus the REJECTS pin and the object
 * switch), THREE stay green in both directions. Stated so nobody mistakes a
 * standing green for coverage:
 *
 *   - "no `getObjectSchema`" is green before and after — `origin/main` has no
 *     gate at all, so it queries here anyway. It guards a FUTURE wrong shape:
 *     it is the test that goes red the moment anyone "simplifies" the gate to
 *     `if (!objectSchema) return;`.
 *   - the REJECTS pin looks like the same class but is NOT: its ordering
 *     assertion is discriminating, and against the base it reads
 *     `['find', 'schema:issued']` — the query went out before the schema was
 *     even requested. It is a truthy-gate pin AND a red one.
 *   - the inline-`value` and hosted-parent tests are green in both directions
 *     by construction: they are the controls proving this change did not turn
 *     either composition into a fetching one, and that the gate — scoped to the
 *     `object` provider because a `value` provider issues no metadata read —
 *     does not hold a query open on a resolution nothing was going to produce.
 *
 * ## ⚠️ Ghost-assertion guard
 *
 * A query count, or an `$expand` presence check, would ALSO pass if the
 * calendar stopped fetching altogether. So: every count is reached only after
 * waiting for a real call; the first test's `waitFor` targets the EXPANDED call
 * specifically, so zero fetches times out rather than reading as success;
 * `$expand` is asserted against the expandable fields DERIVED FROM THE FIXTURE
 * through core's own `EXPANDABLE_FIELD_TYPES`, in both directions; and the
 * delivery test asserts rows actually reach `CalendarView` rather than the
 * query merely being counted.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';

/**
 * Every non-empty event array `ObjectCalendar` hands `CalendarView`, in order,
 * tagged with the query that produced the underlying rows. `loading` is an
 * early return above `CalendarView`, so an entry here is a real paint.
 */
const deliveries: string[][] = [];

vi.mock('../CalendarView', () => ({
  CalendarView: ({ events }: any) => {
    if (Array.isArray(events) && events.length > 0) {
      deliveries.push(events.map((e: any) => e?.data?._from ?? '?'));
    }
    return (
      <div data-testid="calendar-view">
        {(events ?? []).map((e: any) => (
          <span key={e.id} data-testid="event">{`${e.title}|${e.data?._from}`}</span>
        ))}
      </div>
    );
  },
}));

import { ObjectCalendar } from '../ObjectCalendar';

/**
 * One field of every expandable type, plus non-expandable neighbours. The
 * expectation below is DERIVED from this map rather than written out, so a
 * field added here with an expandable type must show up in the query or the
 * test fails.
 */
const VISIT_FIELDS: Record<string, { type: string; label: string; reference?: string }> = {
  name: { type: 'text', label: 'Name' },
  starts_at: { type: 'datetime', label: 'Start' },
  amount: { type: 'currency', label: 'Amount' },
  owner: { type: 'user', label: 'Owner' },
  account: { type: 'lookup', label: 'Account', reference: 'account' },
  // No target key. It carried the retired snake_case spelling, which
  // `FieldSchema` refuses BY NAME, so the line annotated nothing and the
  // `$expand` expectation is derived from the declared TYPE. On a `tree` the
  // target is optional; this map's object is `visit` and the value named it,
  // so renaming would turn a refused key into an accepted self-annotation
  // this fixture never made (objectui#8031).
  parent_visit: { type: 'tree', label: 'Parent' },
  line_item: { type: 'master_detail', label: 'Line item', reference: 'line_item' },
};

const VISIT_SCHEMA = { name: 'visit', label: 'Visit', fields: VISIT_FIELDS };

/** The four expandable types, read from core's own set — not a copy of it. */
const EXPECTED_EXPAND = Object.entries(VISIT_FIELDS)
  .filter(([, def]) => EXPANDABLE_FIELD_TYPES.has(def.type))
  .map(([fieldName]) => fieldName);

const NON_EXPANDABLE = Object.entries(VISIT_FIELDS)
  .filter(([, def]) => !EXPANDABLE_FIELD_TYPES.has(def.type))
  .map(([fieldName]) => fieldName);

/** Anchor the event inside the month the calendar opens on. */
const today = new Date();
const IN_MONTH = new Date(today.getFullYear(), today.getMonth(), 8, 9, 0, 0, 0);

const ROW = { id: 'v1', name: 'Site visit', starts_at: IN_MONTH.toISOString(), account: 'acc-1' };

/**
 * `getObjectSchema` deliberately resolves a tick LATER than a bare
 * `mockResolvedValue` would, so a calendar that queries before the schema
 * settles is caught rather than passing on scheduling luck.
 */
function makeAdapter(getObjectSchema?: () => Promise<unknown>): Record<string, any> {
  const order: string[] = [];
  const adapter: Record<string, any> = {
    order,
    find: vi.fn(async (_object: string, params: any) => {
      order.push('find');
      // A FRESH array per response, as the wire produces, tagged with the query
      // that produced it. Returning one shared array would make `setData` a
      // reference-equal no-op and hide every extra delivery.
      const tag = Array.isArray(params?.$expand) && params.$expand.length > 0 ? 'expanded' : 'raw';
      return { value: [{ ...ROW, _from: tag }] };
    }),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
  if (getObjectSchema) {
    adapter.getObjectSchema = vi.fn(async (objectName: string) => {
      order.push('schema:issued');
      try {
        return await getObjectSchema();
      } finally {
        order.push('schema:settled');
        void objectName;
      }
    });
  }
  return adapter;
}

const resolvesSchema = () =>
  makeAdapter(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return VISIT_SCHEMA;
  });

const calendarSchema = (extra: Record<string, unknown> = {}) => ({
  type: 'object-calendar',
  objectName: 'visit',
  calendar: { startDateField: 'starts_at', titleField: 'name' },
  ...extra,
}) as never;

function renderCalendar(adapter: Record<string, any>, extra: Record<string, unknown> = {}) {
  return render(<ObjectCalendar schema={calendarSchema(extra)} dataSource={adapter as never} />);
}

const paramsOf = (adapter: Record<string, any>) =>
  adapter.find.mock.calls.map((c: any[]) => c[1] ?? {});
const expandedCalls = (adapter: Record<string, any>) =>
  paramsOf(adapter).filter((p: any) => Array.isArray(p.$expand) && p.$expand.length > 0);
const unexpandedCalls = (adapter: Record<string, any>) =>
  paramsOf(adapter).filter((p: any) => !Array.isArray(p.$expand) || p.$expand.length === 0);

beforeEach(() => {
  deliveries.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Timers and pending promises survive between cases otherwise.
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('ObjectCalendar gates its standalone query on the object schema (objectui#6453)', () => {
  it('issues ONE query, and it carries the object’s `$expand`', async () => {
    const adapter = resolvesSchema();
    renderCalendar(adapter);

    // Control — this `waitFor` targets the EXPANDED call, not "any call" and
    // not "the mock exists". If the gate ever stops opening, no such call is
    // recorded, this times out, and the file goes red: "0 queries" can never
    // read as success here.
    await waitFor(() => expect(expandedCalls(adapter)).toHaveLength(1));

    // RED before the fix: this read `[{ $filter: undefined, $orderby: … }]` —
    // the query that never carried an expansion at all.
    expect(unexpandedCalls(adapter)).toEqual([]);
    expect(adapter.find).toHaveBeenCalledTimes(1);
    expect(adapter.find.mock.calls[0][0]).toBe('visit');
  });

  it('sends exactly the schema’s expandable fields — asserted against the fixture, not merely present', async () => {
    const adapter = resolvesSchema();
    renderCalendar(adapter);

    await waitFor(() => expect(expandedCalls(adapter)).toHaveLength(1));
    const $expand: string[] = expandedCalls(adapter)[0].$expand;

    // Contents, both directions. `EXPECTED_EXPAND` is derived from the fixture
    // through core's own `EXPANDABLE_FIELD_TYPES`, so this covers all four
    // relation types (`user`, `lookup`, `tree`, `master_detail`) and fails if
    // one stops being expanded.
    expect(EXPECTED_EXPAND).toHaveLength(4);
    expect([...$expand].sort()).toEqual([...EXPECTED_EXPAND].sort());
    for (const plain of NON_EXPANDABLE) {
      expect($expand).not.toContain(plain);
    }
  });

  it('issues that query only AFTER the schema read settles', async () => {
    const adapter = resolvesSchema();
    renderCalendar(adapter);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // Ordering, not just counting: a fix that merely deduplicated a second
    // query would satisfy the count above while still querying too early.
    expect(adapter.order).toEqual(['schema:issued', 'schema:settled', 'find']);
  });

  it('paints ONCE, and what it paints is the expanded rows', async () => {
    // The measured user-visible cost of an extra re-run on THIS effect: with
    // `objectSchema` in the dependency list the calendar painted raw ids, then
    // reverted to its "Loading calendar..." placeholder, then swapped in the
    // expanded rows. This pins the single-delivery outcome, and doubles as the
    // control that rows really reach `CalendarView` rather than the query
    // vanishing.
    const adapter = resolvesSchema();
    const { findAllByTestId } = renderCalendar(adapter);

    const events = await findAllByTestId('event');
    expect(events).toHaveLength(1);
    expect(events[0].textContent).toBe('Site visit|expanded');
    expect(deliveries).toEqual([['expanded']]);
  });

  it('still queries — and paints — when the adapter exposes NO `getObjectSchema`', async () => {
    // The gate is on the read having settled, not on a truthy schema. An
    // adapter without the method settles with nothing to report, and the
    // calendar must fall through to an unexpanded query rather than wait
    // forever.
    //
    // Honest note: this cannot discriminate against `origin/main`, which has no
    // gate and queries here anyway. It exists to go red if the gate is ever
    // "simplified" to a truthy check.
    const adapter = makeAdapter();
    const { findAllByTestId } = renderCalendar(adapter);

    const events = await findAllByTestId('event');
    expect(events[0].textContent).toBe('Site visit|raw');
    expect(adapter.find).toHaveBeenCalledTimes(1);
    // Nothing declared any field, so there is no expand set to derive.
    expect(unexpandedCalls(adapter)).toHaveLength(1);
  });

  it('still queries — and paints — when the schema read REJECTS', async () => {
    // Same class of pin as the test above, but — measured — NOT the same
    // caveat: the ordering assertion at the end discriminates. Against the base
    // commit `adapter.order` reads `['find', 'schema:issued']`, i.e. the query
    // went out before the schema was even requested.
    const adapter = makeAdapter(async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('metadata endpoint down');
    });
    const { findAllByTestId } = renderCalendar(adapter);

    const events = await findAllByTestId('event');
    expect(events[0].textContent).toBe('Site visit|raw');
    expect(adapter.find).toHaveBeenCalledTimes(1);
    expect(unexpandedCalls(adapter)).toHaveLength(1);
    expect(adapter.order).toEqual(['schema:issued', 'schema:settled', 'find']);
  });

  it('re-gates when the object changes, so no query carries the previous object’s expand set', async () => {
    // The resolution is KEYED by the object the QUERY will use, and compared
    // during render, so switching objects closes the gate in the same commit
    // that changes it.
    const adapter = resolvesSchema();
    const { rerender } = renderCalendar(adapter);
    await waitFor(() => expect(expandedCalls(adapter)).toHaveLength(1));

    adapter.getObjectSchema.mockImplementation(async () => {
      adapter.order.push('schema:issued');
      await new Promise((r) => setTimeout(r, 10));
      adapter.order.push('schema:settled');
      return { name: 'note', label: 'Note', fields: { body: { type: 'text', label: 'Body' } } };
    });

    rerender(
      <ObjectCalendar
        schema={{
          type: 'object-calendar',
          objectName: 'note',
          calendar: { startDateField: 'starts_at', titleField: 'name' },
        } as never}
        dataSource={adapter as never}
      />,
    );

    await waitFor(() => expect(adapter.find.mock.calls.length).toBeGreaterThan(1));
    const noteCalls = adapter.find.mock.calls.filter((c: any[]) => c[0] === 'note');
    expect(noteCalls).toHaveLength(1);
    // `note` declares no expandable field. A stale resolution would have sent
    // `visit`'s expand set against `note`.
    const noteParams = noteCalls[0][1] ?? {};
    expect(noteParams.$expand === undefined || noteParams.$expand.length === 0).toBe(true);
  });

  it('an inline `value` data set still paints, and asks for no metadata at all', async () => {
    // The gate is scoped to the `object` provider on purpose. An inline data
    // set issues no `getObjectSchema` read — it did not before this change and
    // must not now — so a whole-effect gate would hold this render open on a
    // resolution nothing was going to produce. This is the deadlock pin.
    const adapter = resolvesSchema();
    const { findAllByTestId } = renderCalendar(adapter, {
      // `staticData` since objectui#8348 — this block's published `data` row is
      // `z.array(...)`, so `{ provider: 'value', items }` is no longer a record
      // source here. Rung 2 wraps `staticData` into that same config, so the
      // inline-`value` branch this test is about is reached exactly as before.
      staticData: [{ ...ROW, _from: 'inline' }],
    });

    const events = await findAllByTestId('event');
    expect(events[0].textContent).toBe('Site visit|inline');
    expect(adapter.find).not.toHaveBeenCalled();
    expect(adapter.getObjectSchema).not.toHaveBeenCalled();
  });

  it('a hosted calendar still takes its rows from the parent — the gate started no query', async () => {
    // Control in the other direction: a calendar hosted by ObjectView/ListView
    // receives `data` and must not have been turned into a fetching one.
    const adapter = resolvesSchema();
    const { findAllByTestId } = render(
      <ObjectCalendar
        schema={calendarSchema()}
        dataSource={adapter as never}
        data={[{ ...ROW, _from: 'from-parent' }]}
      />,
    );

    const events = await findAllByTestId('event');
    expect(events[0].textContent).toBe('Site visit|from-parent');
    expect(adapter.find).not.toHaveBeenCalled();
  });
});
