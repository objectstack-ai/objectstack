/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7243 — the same `colorField` used to mean three different things
 * across gantt / calendar / timeline. This file pins the calendar's half.
 *
 * BEFORE: `ObjectCalendar` handed `CalendarView` the RAW record value, so an
 * authored option colour never reached the event — `"open"` fell through to
 * `resolveEventColor`'s deterministic 8-stop hash and produced a palette class
 * unrelated to the colour the author declared on the field's option.
 *
 * AFTER: the shared ladder (`@object-ui/core#createFieldColorResolver`) runs
 * first, so a select field's option colour arrives as a hex and
 * `resolveEventColor` paints THAT.
 *
 * The hash is NOT retired — it stays as the last rung, unchanged, for values
 * no option colours it (a category label on a schemaless / inline-data
 * calendar). That is deliberate: retiring it would repaint every existing
 * calendar whose `colorField` points at a plain categorical field, which is a
 * behaviour change well beyond this card, and `CalendarView`'s soft-tint class
 * pairs are theme-aware where a derived solid hex would not be.
 *
 * ---
 *
 * objectui#7828 — HARNESS GUARDS, ported from the timeline fixture
 * (objectui#7527 `c2fc261f5`) together with PR #7826's bound capture. Four
 * changes, none of them about the ladder: the readiness predicate identifies
 * WHICH render wrote (a title token this call owns) instead of counting
 * arity; the value returned is the array that predicate accepted, not a
 * second read of the module global; the render is torn down in a `finally`;
 * and no renderer may be alive when one is mounted.
 *
 * ⚠️ WHAT WAS MEASURED, because "it stopped failing" is not a mechanism and a
 * green loop is not evidence — objectui#7466 paid for that reading: on an
 * idle box the broken timeline harness passed 32/32, the same 32/32 the fixed
 * one gets. The lever is the METADATA fetch, not machine load, so the lever
 * was swept. Instrument: the PRE-PORT harness shape (module global,
 * arity-only predicate, no unmount, re-read of the global) driving two
 * renders inside one `it` — the objectui#7466 exposure shape — with
 * `getObjectSchema` held by 0/1/2/3/4/5/6/7/8/9/10/12/15/20/25/35/50 ms,
 * three runs at each hold, all three components in the SAME vitest runs:
 *
 *   ObjectTimeline (ungated CONTROL)   20 fail / 60 runs
 *   ObjectCalendar                      0 fail / 60 runs
 *   ObjectGantt                         0 fail / 60 runs
 *
 * The control is what makes those zeroes readable at all: the instrument DOES
 * fire, in this container, on that day, in those same runs — with the card's
 * exact signature: the second render reads the FIRST render's colour back out
 * of the global (`second=["#abc"]` where `["#123456"]` was authored).
 *
 * Note WHERE it fires: every timeline failure sits at a hold of 1-9ms, and the
 * coarse grid alone caught it at ONE hold out of eight. That is why the grid
 * was refined instead of repeated — repetition at a hold outside the window is
 * exactly the 32/32 that taught objectui#7466 nothing.
 *
 * The mechanism, measured the same way — writes into the module global AFTER
 * the readiness predicate went green, with the render left mounted exactly as
 * the pre-port harness left it:
 *
 *   ObjectTimeline, getObjectSchema +25ms    1 paint at green, 3 LATE writes
 *   ObjectCalendar, +0 / +25 / +100ms        1 paint, 0 late writes
 *   ObjectGantt,    +0 / +25 / +100ms        1 paint, 0 late writes
 *
 * `ObjectTimeline`'s data effect lists `objectDef`, so it paints once before
 * the metadata lands and again after. `ObjectCalendar` GATES its record query
 * on the SETTLED schema (objectui#6453, today the shared `useSettledSchema`
 * of objectui#7225), so its first paint arrives only after the metadata read
 * — the measured paint time tracks the hold, 34ms at +25 and 104ms at +100 —
 * and no schema-triggered second paint follows it.
 *
 * ⛔ So this file does NOT claim the timeline's two-paint behaviour for
 * `ObjectCalendar`: it was looked for, with a lit instrument, and it is not
 * there. **No failure was reproducible on this file today.** What is ported
 * is the HARNESS half, which does not depend on that behaviour — a module
 * global plus an arity-only predicate cannot say WHICH component wrote,
 * whatever the component does. The guards are here so that the ordinary next
 * edit to a ladder fixture — a second assertion inside one of these `it`
 * blocks, which is precisely the edit that made objectui#7466 — cannot
 * reintroduce one.
 */

import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectCalendar } from './ObjectCalendar';
import { __resolveEventColorForTest as resolveEventColor } from './CalendarView';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

let lastEvents: any[] = [];

vi.mock('./CalendarView', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    CalendarView: ({ events }: any) => {
      lastEvents = events;
      return <div data-testid="calendar-view" data-event-count={String(events.length)} />;
    },
  };
});

/** The authored option colours — identical to the gantt and timeline fixtures. */
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open', color: '#7c3aed' },
  { value: 'done', label: 'Done', color: '#059669' },
];

const OBJECT_SCHEMA = {
  name: 'duly_task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    starts_at: { name: 'starts_at', type: 'datetime' },
    ends_at: { name: 'ends_at', type: 'datetime' },
    status: { name: 'status', type: 'select', options: STATUS_OPTIONS },
    category: { name: 'category', type: 'text' },
  },
};

const ROWS = [
  {
    id: '1',
    subject: 'Ship it',
    status: 'open',
    category: 'email',
    starts_at: '2026-01-01T09:00:00Z',
    ends_at: '2026-01-01T10:00:00Z',
  },
];

function makeDataSource(rows: any[] = ROWS, objectSchema: any = OBJECT_SCHEMA) {
  return {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectSchema),
  } as any;
}

/** Distinguishes one `colorsFor` render from the next. See `token` below. */
let renderSeq = 0;

async function colorsFor(colorField: string, rows: any[] = ROWS, objectSchema: any = OBJECT_SCHEMA) {
  // objectui#7828 (objectui#7521's guard) — a STRUCTURAL check, deliberately
  // not a timing one. RTL's auto-cleanup runs in `afterEach`, never between
  // two renders inside one `it`, so a render this helper failed to tear down
  // is observable HERE, at a synchronous point, rather than as a race someone
  // has to catch in the act.
  expect(screen.queryAllByTestId('calendar-view')).toHaveLength(0);

  // A token this call OWNS. `ObjectCalendar` resolves an event's `title` from
  // the configured `titleField` when the record carries it, so the token
  // rides through to `lastEvents` untouched — and it is NOT the value under
  // test, so the predicate below can tell "THIS render is ready" from
  // "something else wrote again" without asserting the colour the caller is
  // about to assert.
  const token = `render-${++renderSeq}`;
  const stampedRows = rows.map((row, i) => ({ ...row, subject: `${token}-${i}` }));

  lastEvents = [];
  const schema: any = {
    type: 'object-calendar',
    objectName: 'duly_task',
    calendar: {
      startDateField: 'starts_at',
      endDateField: 'ends_at',
      titleField: 'subject',
      colorField,
    },
  };
  const { unmount } = render(
    <ObjectCalendar schema={schema} dataSource={makeDataSource(stampedRows, objectSchema)} />,
  );
  try {
    // Identify the AUTHOR, not just the arity. `lastEvents.length` alone
    // cannot separate "the component I just mounted has painted" from "an
    // earlier one painted again": both leave length === rows.length.
    //
    // And RETURN THE ARRAY THE PREDICATE ACCEPTED (PR #7826). `lastEvents` is
    // module-level and mutable, so reading it again on the next line asks a
    // SECOND question — after `act` has yielded on its way out of `waitFor`,
    // a real window in which a still-live writer can answer it. Capturing
    // inside the predicate makes "the value asserted" and "the value
    // validated" the same object by construction.
    let settled: typeof lastEvents = [];
    await waitFor(() => {
      const events = lastEvents;
      expect(events.map((e) => e.title)).toEqual(stampedRows.map((r) => r.subject));
      settled = events;
    });
    return settled.map((e) => e.color);
  } finally {
    // Tear THIS render down before returning, so nothing this helper mounted
    // can still be writing to `lastEvents` during the NEXT call — after that
    // call has reset it. Measured above: `ObjectCalendar` emits no late write
    // today, which is why this is a guard and not a fix.
    unmount();
  }
}

describe('objectui#7243 — calendar colorField ladder', () => {
  it('rung 1: a select field paints the AUTHORED option colour', async () => {
    expect(await colorsFor('status')).toEqual(['#7c3aed']);
  });

  it('the authored colour reaches the DOM as a real colour, not a hashed class', () => {
    expect(resolveEventColor('#7c3aed')).toEqual({ className: 'text-white', inlineColor: '#7c3aed' });
    // What the pre-fix raw value produced instead: a palette class, no colour.
    expect(resolveEventColor('open').inlineColor).toBeUndefined();
  });

  it('last rung: a value no option colours still reaches the hash unchanged', async () => {
    expect(await colorsFor('category')).toEqual(['email']);
    expect(resolveEventColor('email').className).toMatch(/^bg-/);
  });
});
