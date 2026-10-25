/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866 — `ObjectCalendar` places a stored date-only day on that day,
 * and writes a `date` field back as a calendar day.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The event mapping read the record's start with the engine's own `Date`
 * parse, which reads a date-only `2026-10-05` as UTC midnight, so every viewer
 * west of UTC saw the event in the October 4th cell. The drop handler and the
 * quick-create dialog then wrote `toISOString()` into the field: a UTC
 * instant stored in a `Field.date`, whose day part names the previous day east
 * of UTC once the read is a local day. The read now goes through
 * `toDisplayDate` (`@object-ui/core`, the objectui#10183 convention), and a
 * write to a field declared `date` sends the LOCAL calendar day as
 * `yyyy-MM-dd`. A `datetime` field keeps its instant: the control rows below.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too: the
 * read cannot tell the repair from its absence there (UTC is the one offset
 * where the two parses agree), but the written SHAPE can.
 *
 * `Asia/Shanghai` is the control zone: east of UTC the UTC-midnight parse
 * already landed on the named day, and `toISOString()` of a local midnight
 * names the day before, which is the write half of the card.
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
/** The same instant two days later: what a two-day move of it must write. */
const INSTANT_PLUS_2 = '2026-10-08T04:00:00.000Z';

const DAY = '2026-10-05';
const TITLE = 'Ship the release';

/** Freeze the clock, moving this forked process into `zone` first when given. */
function enter(zone?: string): void {
  if (zone) process.env.TZ = zone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** `due_date` is a `Field.date` (the showcase task's binding); `starts_at` a `datetime`. */
type Field = 'due_date' | 'starts_at';

function makeDataSource(field: Field, value: string) {
  return {
    getObjectSchema: vi.fn(async () => ({
      name: 'task',
      fields: {
        name: { type: 'text' },
        due_date: { type: 'date' },
        starts_at: { type: 'datetime' },
      },
    })),
    find: vi.fn(async () => ({ value: [{ id: 't1', name: TITLE, [field]: value }] })),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 't2' })),
  };
}

function mount(field: Field, value: string) {
  const ds = makeDataSource(field, value);
  const schema = {
    type: 'object-calendar',
    objectName: 'task',
    calendar: { startDateField: field, titleField: 'name' },
  } as never;
  render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <ObjectCalendar schema={schema} dataSource={ds as never} />
    </LocalizationProvider>,
  );
  return ds;
}

/** `October 5, 2026` out of a month cell's accessible name. */
function dayOf(cell: Element): string {
  const m = (cell.getAttribute('aria-label') ?? '').match(/[A-Z][a-z]+ \d{1,2}, \d{4}/);
  return m ? m[0] : '';
}

function cellFor(day: string): Element {
  const cell = screen.getAllByRole('gridcell').find((c) => dayOf(c) === day);
  expect(cell, `no month cell for ${day}`).toBeDefined();
  return cell!;
}

/** The days whose month cell holds the event. */
async function daysHolding(field: Field, value: string): Promise<string[]> {
  mount(field, value);
  await screen.findAllByLabelText(TITLE);
  const days = screen
    .getAllByRole('gridcell')
    .filter((c) => within(c as HTMLElement).queryAllByLabelText(TITLE).length > 0)
    .map(dayOf);
  cleanup();
  return days;
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

/** Drag the event two days on and hand back the value the patch writes. */
async function movedTwoDays(field: Field, value: string): Promise<unknown> {
  const ds = mount(field, value);
  const [pill] = await screen.findAllByLabelText(TITLE);
  const from = dayOf(pill.closest('[role="gridcell"]')!);
  const target = new Date(Date.parse(`${from} 12:00`) + 2 * 86_400_000);
  const to = target.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  performDnd(pill, cellFor(to));
  await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
  const patch = (ds.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
  cleanup();
  return patch[field];
}

/** Quick-create on the empty October 12th cell and hand back the value it writes. */
async function quickCreated(field: Field, value: string): Promise<unknown> {
  const ds = mount(field, value);
  await screen.findAllByLabelText(TITLE);
  fireEvent.click(cellFor('October 12, 2026'));
  await screen.findByRole('dialog');
  const input = document.getElementById('quick-create-title') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Retro' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  const payload = (ds.create.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
  cleanup();
  return payload[field];
}

describe('ObjectCalendar date-only days, in the suite zone (objectui#10866)', () => {
  it('a date-only value sits on the day it stores', async () => {
    enter();
    expect(await daysHolding('due_date', DAY)).toEqual(['October 5, 2026']);
  });

  it('a move writes a `date` field as the calendar day, never an instant', async () => {
    enter();
    expect(await movedTwoDays('due_date', DAY)).toBe('2026-10-07');
  });

  it('a quick-create writes a `date` field as the calendar day, never an instant', async () => {
    enter();
    expect(await quickCreated('due_date', DAY)).toBe('2026-10-12');
  });

  it('control: a `datetime` field keeps its instant on both writes', async () => {
    enter();
    expect(await movedTwoDays('starts_at', INSTANT)).toBe(INSTANT_PLUS_2);
    expect(await quickCreated('starts_at', INSTANT)).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe.runIf(DRIVEN)('ObjectCalendar date-only days west of UTC (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(21);
  });

  it('fixture validity: the engine parse of the string lands on the day before here', () => {
    enter(WEST);
    // Without this the read case below would be green for free.
    expect(new Date(DAY).getDate()).toBe(4);
  });

  it('`2026-10-05` sits in the October 5th cell', async () => {
    enter(WEST);
    expect(await daysHolding('due_date', DAY)).toEqual(['October 5, 2026']);
  });

  it('a two-day move writes `2026-10-07`', async () => {
    enter(WEST);
    expect(await movedTwoDays('due_date', DAY)).toBe('2026-10-07');
  });

  it('a quick-create on the 12th writes `2026-10-12`', async () => {
    enter(WEST);
    expect(await quickCreated('due_date', DAY)).toBe('2026-10-12');
  });

  it('control: a `datetime` event sits on its local day and keeps its instant', async () => {
    enter(WEST);
    expect(await daysHolding('starts_at', INSTANT)).toEqual(['October 5, 2026']);
    expect(await movedTwoDays('starts_at', INSTANT)).toBe(INSTANT_PLUS_2);
    // Local midnight of the 12th, as the instant it is.
    expect(await quickCreated('starts_at', INSTANT)).toBe('2026-10-12T07:00:00.000Z');
  });
});

describe.runIf(DRIVEN)('ObjectCalendar date-only days east of UTC, the control (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  it('`2026-10-05` sits in the October 5th cell, as it already did', async () => {
    enter(EAST);
    expect(await daysHolding('due_date', DAY)).toEqual(['October 5, 2026']);
  });

  it('a two-day move writes `2026-10-07`, not the instant of the day before', async () => {
    enter(EAST);
    expect(await movedTwoDays('due_date', DAY)).toBe('2026-10-07');
  });

  it('a quick-create on the 12th writes `2026-10-12`', async () => {
    enter(EAST);
    expect(await quickCreated('due_date', DAY)).toBe('2026-10-12');
  });

  it('control: a `datetime` event sits on its local day and keeps its instant', async () => {
    enter(EAST);
    expect(await daysHolding('starts_at', INSTANT)).toEqual(['October 6, 2026']);
    expect(await movedTwoDays('starts_at', INSTANT)).toBe(INSTANT_PLUS_2);
    expect(await quickCreated('starts_at', INSTANT)).toBe('2026-10-11T16:00:00.000Z');
  });
});
