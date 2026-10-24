/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866, slice 4 — a day event moved across a DST change in the
 * month grid writes the days it was dropped on.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * At slice 4 the month grid moved each date of an event by the milliseconds
 * between the grabbed cell's local midnight and the drop cell's. A date-only
 * value is read at local midnight of its day (`toDisplayDate`), so when a DST
 * change lay between one of the event's dates and where it landed, but not
 * between the two cells (or the other way round), that date came back an hour
 * off local midnight. Under `America/Los_Angeles` the clocks fall back on
 * November 1st, 2026 and spring forward on March 8th, 2026, and before slice 4
 * four of the ten day moves below wrote a day one short: the `Date` came back
 * at 23:00 of the day before, and the write takes its local day. Slice 4
 * repaired that in `ObjectCalendar`, from the stored day.
 *
 * ── Since objectui#11005 (ruled B) ──────────────────────────────────────────
 * The month grid moves a value by calendar days and keeps its time of day
 * (the grid's own zone pins are `CalendarView.monthMoveCalendarDays-11005`).
 * A day read at local midnight now comes back at local midnight of the day it
 * was dropped on, so its local day is the day to write, and the slice-4
 * repair is gone. These ten day moves are how it was measured redundant: they
 * write exactly the days they wrote with it. The `datetime` controls keep
 * their wall-clock time across the DST change; the first Los Angeles one ends
 * at 10:00 on November 2nd, where the elapsed-time arithmetic put it at 09:00.
 * The mixed rows (one `date` field, one `datetime`) are slice 5's: the slice-4
 * repair never reached their `date` half, and the grid's calendar-day move
 * writes it right with no repair (`MIXED_MOVES`).
 *
 * `Asia/Shanghai` keeps no DST, so every day move there is the control zone.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { ObjectCalendar } from '../ObjectCalendar';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** Falls back on November 1st, 2026 and springs forward on March 8th, 2026. */
const WEST = 'America/Los_Angeles';
/** No DST — the control. */
const EAST = 'Asia/Shanghai';

/** Frozen inside each month in both zones, so the month grid opens on it. */
const OCTOBER = '2026-10-10T12:00:00.000Z';
const MARCH = '2026-03-10T12:00:00.000Z';

const TITLE = 'Span';

/** `starts_on` / `ends_on` are `Field.date`; `starts_at` / `ends_at` are `datetime`. */
const OBJECT_SCHEMA = {
  name: 'task',
  fields: {
    name: { type: 'text' },
    starts_on: { type: 'date' },
    ends_on: { type: 'date' },
    starts_at: { type: 'datetime' },
    ends_at: { type: 'datetime' },
  },
};

/** `datetime-date` and `date-datetime` are a MIXED event: one field of each type. */
type Kind = 'date' | 'datetime' | 'datetime-date' | 'date-datetime';
const FIELDS: Record<Kind, { start: string; end: string }> = {
  date: { start: 'starts_on', end: 'ends_on' },
  datetime: { start: 'starts_at', end: 'ends_at' },
  'datetime-date': { start: 'starts_at', end: 'ends_on' },
  'date-datetime': { start: 'starts_on', end: 'ends_at' },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Freeze the clock, moving this forked process into `zone` first when given. */
function enter(clock: string, zone?: string): void {
  if (zone) process.env.TZ = zone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(clock));
}

function mount(kind: Kind, start: string, end: string) {
  const f = FIELDS[kind];
  const ds = {
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
    find: vi.fn(async () => ({ value: [{ id: 't1', name: TITLE, [f.start]: start, [f.end]: end }] })),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 't2' })),
  };
  const schema = {
    type: 'object-calendar',
    objectName: 'task',
    calendar: { startDateField: f.start, endDateField: f.end, titleField: 'name' },
  } as never;
  render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <ObjectCalendar schema={schema} dataSource={ds as never} />
    </LocalizationProvider>,
  );
  return ds;
}

/** `November 2, 2026` out of a month cell's accessible name. */
function dayOf(cell: Element): string {
  const m = (cell.getAttribute('aria-label') ?? '').match(/[A-Z][a-z]+ \d{1,2}, \d{4}/);
  return m ? m[0] : '';
}

function cellFor(day: string): HTMLElement {
  const cell = screen.getAllByRole('gridcell').find((c) => dayOf(c) === day);
  expect(cell, `no month cell for ${day}`).toBeDefined();
  return cell as HTMLElement;
}

/** jsdom has no DataTransfer round-trip; carry the payload in a synthetic one. */
function performDnd(source: Element, target: Element) {
  const store: Record<string, string> = {};
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? '',
    setDragImage: () => {},
    types: ['text/plain'],
  };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
}

interface Move {
  clock: string;
  kind: Kind;
  start: string;
  end: string;
  /** The cell the event is grabbed in: a later cell of the span grabs there. */
  grab: string;
  drop: string;
}

/** Grab the event in `grab`, drop it on `drop`, and hand back what the patch writes. */
async function moved(m: Move, zone?: string): Promise<{ start: unknown; end: unknown }> {
  enter(m.clock, zone);
  const ds = mount(m.kind, m.start, m.end);
  await screen.findAllByLabelText(TITLE);
  const [pill] = within(cellFor(m.grab)).getAllByLabelText(TITLE);
  performDnd(pill, cellFor(m.drop));
  await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
  const patch = (ds.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
  cleanup();
  vi.useRealTimers();
  const f = FIELDS[m.kind];
  return { start: patch[f.start], end: patch[f.end] };
}

/** The day moves: each writes the days it was dropped on, in every zone. */
const DAY_MOVES: Array<[string, Move, { start: string; end: string }]> = [
  [
    'October 29th to 31st, grabbed on its start and moved two days: its end crosses November 1st',
    { clock: OCTOBER, kind: 'date', start: '2026-10-29', end: '2026-10-31', grab: 'October 29, 2026', drop: 'October 31, 2026' },
    { start: '2026-10-31', end: '2026-11-02' },
  ],
  [
    'November 1st to 3rd, grabbed on the 2nd and moved one day: its start leaves the 25-hour day',
    { clock: OCTOBER, kind: 'date', start: '2026-11-01', end: '2026-11-03', grab: 'November 2, 2026', drop: 'November 3, 2026' },
    { start: '2026-11-02', end: '2026-11-04' },
  ],
  [
    'October 31st to November 2nd, grabbed on the 2nd and moved back one day',
    { clock: OCTOBER, kind: 'date', start: '2026-10-31', end: '2026-11-02', grab: 'November 2, 2026', drop: 'November 1, 2026' },
    { start: '2026-10-30', end: '2026-11-01' },
  ],
  [
    'March 5th to 9th, grabbed on its start and moved back one day: its end crosses March 8th',
    { clock: MARCH, kind: 'date', start: '2026-03-05', end: '2026-03-09', grab: 'March 5, 2026', drop: 'March 4, 2026' },
    { start: '2026-03-04', end: '2026-03-08' },
  ],
  [
    'control: October 30th to November 2nd, grabbed on its start and moved one day',
    { clock: OCTOBER, kind: 'date', start: '2026-10-30', end: '2026-11-02', grab: 'October 30, 2026', drop: 'October 31, 2026' },
    { start: '2026-10-31', end: '2026-11-03' },
  ],
  [
    'control: November 2nd to 3rd, grabbed on the 3rd and moved back two days',
    { clock: OCTOBER, kind: 'date', start: '2026-11-02', end: '2026-11-03', grab: 'November 3, 2026', drop: 'November 1, 2026' },
    { start: '2026-10-31', end: '2026-11-01' },
  ],
  [
    'control: a one-day event on October 31st moved two days, across November 1st',
    { clock: OCTOBER, kind: 'date', start: '2026-10-31', end: '2026-10-31', grab: 'October 31, 2026', drop: 'November 2, 2026' },
    { start: '2026-11-02', end: '2026-11-02' },
  ],
  [
    'control: March 8th to 10th, grabbed on the 9th and moved one day',
    { clock: MARCH, kind: 'date', start: '2026-03-08', end: '2026-03-10', grab: 'March 9, 2026', drop: 'March 10, 2026' },
    { start: '2026-03-09', end: '2026-03-11' },
  ],
  [
    'control: March 6th to 9th, grabbed on the 9th and moved back one day',
    { clock: MARCH, kind: 'date', start: '2026-03-06', end: '2026-03-09', grab: 'March 9, 2026', drop: 'March 8, 2026' },
    { start: '2026-03-05', end: '2026-03-08' },
  ],
  [
    'control: March 7th to 8th, grabbed on its start and moved two days',
    { clock: MARCH, kind: 'date', start: '2026-03-07', end: '2026-03-08', grab: 'March 7, 2026', drop: 'March 9, 2026' },
    { start: '2026-03-09', end: '2026-03-10' },
  ],
];

/**
 * `datetime` controls under `America/Los_Angeles`: each keeps its wall-clock
 * time on the days it was dropped on (objectui#11005). Before that change the
 * first one wrote its end as `2026-11-02T17:00:00.000Z`, 09:00; the other two
 * wrote what they write now.
 */
const WEST_INSTANT_MOVES: Array<[string, Move, { start: string; end: string }]> = [
  [
    'control: a `datetime` span grabbed on its start and moved two days keeps its wall-clock time',
    {
      clock: OCTOBER,
      kind: 'datetime',
      start: '2026-10-29T17:00:00.000Z',
      end: '2026-10-31T17:00:00.000Z',
      grab: 'October 29, 2026',
      drop: 'October 31, 2026',
    },
    // October 31st 10:00 PDT to November 2nd 10:00 PST.
    { start: '2026-10-31T17:00:00.000Z', end: '2026-11-02T18:00:00.000Z' },
  ],
  [
    'control: a `datetime` span grabbed on a later cell and moved one day keeps its wall-clock time',
    {
      clock: OCTOBER,
      kind: 'datetime',
      start: '2026-11-01T17:00:00.000Z',
      end: '2026-11-03T18:00:00.000Z',
      grab: 'November 2, 2026',
      drop: 'November 3, 2026',
    },
    { start: '2026-11-02T17:00:00.000Z', end: '2026-11-04T18:00:00.000Z' },
  ],
  [
    'control: a `datetime` span moved back one day across March 8th keeps its wall-clock time',
    {
      clock: MARCH,
      kind: 'datetime',
      start: '2026-03-05T18:00:00.000Z',
      end: '2026-03-09T17:00:00.000Z',
      grab: 'March 5, 2026',
      drop: 'March 4, 2026',
    },
    { start: '2026-03-04T18:00:00.000Z', end: '2026-03-08T17:00:00.000Z' },
  ],
];

/**
 * A MIXED event, one `date` field and one `datetime` field, moved across
 * November 1st (objectui#10866, slice 5). The slice-4 repair gated a whole
 * event, so a mixed event took the elapsed-time path for its `date` half too,
 * and under `America/Los_Angeles` that half was written a day short: the first
 * move below wrote its end `2026-11-02`, the second its start `2026-11-01`
 * (review of PR objectui#10994, measured on that head and on its base). Since
 * objectui#11005 the grid moves each value by calendar days, so the `date`
 * half comes back at local midnight of the day it was dropped on, with no
 * repair in `ObjectCalendar`. These rows record that; the `datetime` half keeps
 * its wall-clock time, as the grid's own pins rule.
 *
 * The grab cell is the start's LOCAL day in each zone: 10:00 on October 29th in
 * Los Angeles is 01:00 on October 30th in Shanghai.
 */
const MIXED_MOVES: Record<'west' | 'east', Array<[string, Move, { start: string; end: string }]>> = {
  west: [
    [
      'a `datetime` start with a `date` end `2026-10-31`, moved three days across November 1st, writes its end `2026-11-03`',
      {
        clock: OCTOBER,
        kind: 'datetime-date',
        start: '2026-10-29T17:00:00.000Z',
        end: '2026-10-31',
        grab: 'October 29, 2026',
        drop: 'November 1, 2026',
      },
      // October 29th 10:00 PDT to November 1st 10:00 PST.
      { start: '2026-11-01T18:00:00.000Z', end: '2026-11-03' },
    ],
    [
      'a `date` start `2026-11-01` with a `datetime` end, grabbed on the 2nd and dropped on the 3rd, writes its start `2026-11-02`',
      {
        clock: OCTOBER,
        kind: 'date-datetime',
        start: '2026-11-01',
        end: '2026-11-03T18:00:00.000Z',
        grab: 'November 2, 2026',
        drop: 'November 3, 2026',
      },
      // November 3rd 10:00 PST to November 4th 10:00 PST.
      { start: '2026-11-02', end: '2026-11-04T18:00:00.000Z' },
    ],
  ],
  east: [
    [
      'a `datetime` start with a `date` end `2026-10-31`, moved three days, writes its end `2026-11-03`',
      {
        clock: OCTOBER,
        kind: 'datetime-date',
        start: '2026-10-29T17:00:00.000Z',
        end: '2026-10-31',
        grab: 'October 30, 2026',
        drop: 'November 2, 2026',
      },
      { start: '2026-11-01T17:00:00.000Z', end: '2026-11-03' },
    ],
    [
      'a `date` start `2026-11-01` with a `datetime` end, grabbed on the 2nd and dropped on the 3rd, writes its start `2026-11-02`',
      {
        clock: OCTOBER,
        kind: 'date-datetime',
        start: '2026-11-01',
        end: '2026-11-03T18:00:00.000Z',
        grab: 'November 2, 2026',
        drop: 'November 3, 2026',
      },
      { start: '2026-11-02', end: '2026-11-04T18:00:00.000Z' },
    ],
  ],
};

describe('ObjectCalendar day moves, in the suite zone (objectui#10866)', () => {
  it('a day span moved two days writes both of its days', async () => {
    const [, move, want] = DAY_MOVES[0];
    expect(await moved(move)).toEqual(want);
  });
});

describe.runIf(DRIVEN)('ObjectCalendar day moves across a DST change, west of UTC (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(OCTOBER, WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date('2026-10-06T04:00:00.000Z').getHours()).toBe(21);
  });

  it('fixture validity: November 1st is 25 hours long here and March 8th is 23', () => {
    enter(OCTOBER, WEST);
    const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;
    expect(hours(new Date(2026, 10, 1), new Date(2026, 10, 2))).toBe(25);
    expect(hours(new Date(2026, 2, 8), new Date(2026, 2, 9))).toBe(23);
  });

  it.each(DAY_MOVES)('%s', async (_name, move, want) => {
    expect(await moved(move, WEST)).toEqual(want);
  });

  it.each(WEST_INSTANT_MOVES)('%s', async (_name, move, want) => {
    expect(await moved(move, WEST)).toEqual(want);
  });

  it.each(MIXED_MOVES.west)('mixed: %s', async (_name, move, want) => {
    expect(await moved(move, WEST)).toEqual(want);
  });
});

describe.runIf(DRIVEN)('ObjectCalendar day moves east of UTC, the control (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(OCTOBER, EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date('2026-10-06T04:00:00.000Z').getHours()).toBe(12);
  });

  it.each(DAY_MOVES)('%s', async (_name, move, want) => {
    expect(await moved(move, EAST)).toEqual(want);
  });

  it('control: a `datetime` span keeps its wall-clock time', async () => {
    expect(
      await moved(
        {
          clock: OCTOBER,
          kind: 'datetime',
          start: '2026-11-01T17:00:00.000Z',
          end: '2026-11-03T18:00:00.000Z',
          grab: 'November 3, 2026',
          drop: 'November 4, 2026',
        },
        EAST,
      ),
    ).toEqual({ start: '2026-11-02T17:00:00.000Z', end: '2026-11-04T18:00:00.000Z' });
  });

  it.each(MIXED_MOVES.east)('mixed: %s', async (_name, move, want) => {
    expect(await moved(move, EAST)).toEqual(want);
  });
});
