/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866, slice 4 — zone pins for two calendar paths slice 1 repaired
 * and no zone pin covered: the `endDateField` write, and the fallback a
 * calendar with no object schema takes.
 *
 * ── The `endDateField` write ─────────────────────────────────────────────────
 * A move, a drag of the span's end and a quick-create each write the end field
 * too. Declared `date`, it is written as the calendar day, `yyyy-MM-dd`; a
 * `datetime` end keeps its instant.
 *
 * ── No object schema ─────────────────────────────────────────────────────────
 * An adapter with no `getObjectSchema` gives no declared type to ask, so the
 * stored value's own shape answers (`toStoredDateValue`): a stored
 * `YYYY-MM-DD` is written back as a day and a stored instant as an instant, the
 * same split the read made. A quick-create has no stored value and no type, so
 * it writes the instant of the clicked day's local midnight: the limit slice 1
 * recorded in its changeset, pinned here so it cannot change unnoticed.
 *
 * Every case here passed on the base of this slice: these pins cover paths,
 * they do not repair them.
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

/** UTC-7 in October — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** Frozen inside October 2026 in both zones, so the month grid opens on October. */
const CLOCK = '2026-10-10T12:00:00.000Z';
/** A fixed instant: 21:00 on the 5th in the west, 12:00 on the 6th in the east. */
const INSTANT = '2026-10-06T04:00:00.000Z';
const INSTANT_END = '2026-10-07T04:00:00.000Z';

const TITLE = 'Ship the release';

type Kind = 'date' | 'datetime';

/** `starts_on` / `ends_on` are `Field.date`; `starts_at` / `ends_at` are `datetime`. */
const FIELDS: Record<Kind, { start: string; end: string }> = {
  date: { start: 'starts_on', end: 'ends_on' },
  datetime: { start: 'starts_at', end: 'ends_at' },
};

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Freeze the clock, moving this forked process into `zone` first when given. */
function enter(zone?: string): void {
  if (zone) process.env.TZ = zone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
}

interface Mount {
  kind: Kind;
  start: string;
  end: string;
  /** `false`: the adapter has no `getObjectSchema`, so no field declares a type. */
  schema: boolean;
}

function mount(m: Mount) {
  const f = FIELDS[m.kind];
  const ds: Record<string, unknown> = {
    find: vi.fn(async () => ({ value: [{ id: 't1', name: TITLE, [f.start]: m.start, [f.end]: m.end }] })),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 't2' })),
  };
  if (m.schema) ds.getObjectSchema = vi.fn(async () => OBJECT_SCHEMA);
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
  return ds as { update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
}

/** `October 5, 2026` out of a month cell's accessible name. */
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

/** The days whose month cell holds the event. */
async function daysHolding(m: Mount): Promise<string[]> {
  mount(m);
  await screen.findAllByLabelText(TITLE);
  const days = screen
    .getAllByRole('gridcell')
    .filter((c) => within(c as HTMLElement).queryAllByLabelText(TITLE).length > 0)
    .map(dayOf);
  cleanup();
  return days;
}

/** The start and end the update writes. */
async function written(m: Mount, ds: { update: ReturnType<typeof vi.fn> }) {
  await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
  const patch = (ds.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
  cleanup();
  const f = FIELDS[m.kind];
  return { start: patch[f.start], end: patch[f.end] };
}

/** Grab the event on its first cell and drop it on `drop`. */
async function moved(m: Mount, drop: string) {
  const ds = mount(m);
  const [pill] = await screen.findAllByLabelText(TITLE);
  performDnd(pill, cellFor(drop));
  return written(m, ds);
}

/** Drag the end handle in the span's last cell, `endCell`, onto `drop`. */
async function endDraggedTo(m: Mount, endCell: string, drop: string) {
  const ds = mount(m);
  await screen.findAllByLabelText(TITLE);
  const handle = within(cellFor(endCell)).getByRole('separator');
  performDnd(handle, cellFor(drop));
  return written(m, ds);
}

/** Quick-create on the empty October 12th cell and hand back what it writes. */
async function quickCreated(m: Mount) {
  const ds = mount(m);
  await screen.findAllByLabelText(TITLE);
  fireEvent.click(cellFor('October 12, 2026'));
  await screen.findByRole('dialog');
  const input = document.getElementById('quick-create-title') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Retro' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  const payload = (ds.create.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
  cleanup();
  const f = FIELDS[m.kind];
  return { start: payload[f.start], end: payload[f.end] };
}

const DAYS = { kind: 'date', start: '2026-10-05', end: '2026-10-06' } as const;
const INSTANTS = { kind: 'datetime', start: INSTANT, end: INSTANT_END } as const;

/**
 * The cases for one zone. `instantCell` is the cell the instant pair starts in
 * there; `localMidnight12th` is the instant of October 12th's local midnight.
 */
function zoneCases(zone: string | undefined, instantCell: string, localMidnight12th: string) {
  for (const schema of [true, false]) {
    const label = schema ? 'a declared `date` pair' : 'no object schema, a stored `YYYY-MM-DD` pair';

    it(`${label}: sits on October 5th and 6th`, async () => {
      enter(zone);
      expect(await daysHolding({ ...DAYS, schema })).toEqual(['October 5, 2026', 'October 6, 2026']);
    });

    it(`${label}: a two-day move writes both days`, async () => {
      enter(zone);
      expect(await moved({ ...DAYS, schema }, 'October 7, 2026')).toEqual({ start: '2026-10-07', end: '2026-10-08' });
    });

    it(`${label}: dragging its end onto the 9th writes the end day`, async () => {
      enter(zone);
      expect(await endDraggedTo({ ...DAYS, schema }, 'October 6, 2026', 'October 9, 2026')).toEqual({
        start: '2026-10-05',
        end: '2026-10-09',
      });
    });

    const instantLabel = schema ? 'control: a declared `datetime` pair' : 'control: no object schema, a stored instant pair';
    it(`${instantLabel}: a two-day move keeps both instants`, async () => {
      enter(zone);
      const cell = cellAfter(instantCell, 2);
      expect(await moved({ ...INSTANTS, schema }, cell)).toEqual({
        start: '2026-10-08T04:00:00.000Z',
        end: '2026-10-09T04:00:00.000Z',
      });
    });
  }

  it('a quick-create writes a declared `date` end as the clicked day', async () => {
    enter(zone);
    expect(await quickCreated({ ...DAYS, schema: true })).toEqual({ start: '2026-10-12', end: '2026-10-12' });
  });

  it('control: a quick-create writes a declared `datetime` end as the instant', async () => {
    enter(zone);
    expect(await quickCreated({ ...INSTANTS, schema: true })).toEqual({
      start: localMidnight12th,
      end: localMidnight12th,
    });
  });

  it('no object schema: a quick-create has no stored value to ask, so it writes the instant', async () => {
    enter(zone);
    expect(await quickCreated({ ...DAYS, schema: false })).toEqual({
      start: localMidnight12th,
      end: localMidnight12th,
    });
  });
}

/** `October 5, 2026` → the accessible day name `days` later. */
function cellAfter(day: string, days: number): string {
  const d = new Date(`${day} 12:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

describe('ObjectCalendar end-date and no-schema writes, in the suite zone (objectui#10866)', () => {
  zoneCases(undefined, 'October 6, 2026', '2026-10-12T00:00:00.000Z');
});

describe.runIf(DRIVEN)('ObjectCalendar end-date and no-schema writes west of UTC (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(21);
  });

  it('fixture validity: the engine parse of a stored day lands on the day before here', () => {
    enter(WEST);
    expect(new Date(DAYS.start).getDate()).toBe(4);
  });

  zoneCases(WEST, 'October 5, 2026', '2026-10-12T07:00:00.000Z');
});

describe.runIf(DRIVEN)('ObjectCalendar end-date and no-schema writes east of UTC, the control (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  zoneCases(EAST, 'October 6, 2026', '2026-10-11T16:00:00.000Z');
});
