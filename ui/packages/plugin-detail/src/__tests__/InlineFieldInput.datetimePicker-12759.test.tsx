/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12759 — an inline edit of a `datetime` field on the record page
 * keeps the time the record holds.
 *
 * ── What was wrong ─────────────────────────────────────────────────────────
 * `InlineFieldInput` (the editor the record highlights and the details body
 * share) edited `date` AND `datetime` fields with `DateField`, an
 * `<input type="date">`. A `datetime` could show no time there, and the
 * picked day was re-emitted as `new Date(day + 'T00:00:00').toISOString()`:
 * local midnight. One inline edit of the day dropped the stored time.
 *
 * Both now edit through `FieldEditWidget`, which draws the platform date
 * picker the grid cell, the forms and the dialogs draw (objectui#12664). A
 * `datetime` reads the instant as the local wall clock; a day picked in the
 * calendar keeps that time; typed text carries the time the user typed.
 *
 * The cases drive the whole record-page write, as the objectui#12206 pins do:
 * the highlights strip's inline editor stages into the shared draft, and
 * `<InlineEditSaveBar>` hands that draft to `dataSource.update`.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * The suite runs in UTC (`vitest.config.mts`), where local midnight and a
 * dropped time are both still visible but the zone is not. The zone cases set
 * `process.env.TZ` per case, which only moves the zone in a forked worker, so
 * `scripts/__tests__/date-only-zone-pins-10183.test.ts` runs them and fails
 * unless every one ran and passed. Each zone opens with a rig case.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import type { HighlightField } from '@object-ui/types';
import { HeaderHighlight } from '../HeaderHighlight';
import { InlineEditSaveBar } from '../InlineEditSaveBar';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC+8, no DST. */
const EAST = 'Asia/Taipei';
/** UTC-5, no DST. */
const WEST = 'America/Bogota';
/** A fixed instant: 20:00 in the east, 07:00 in the west. */
const INSTANT = '2026-10-15T12:00:00.000Z';

beforeAll(() => {
  // Radix popover uses pointer capture; jsdom lacks these.
  const proto = Element.prototype as any;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
});

/** Opens the shared edit session the way the strip's pencil does. */
function EnterEdit({ field }: { field: string }) {
  const inline = useInlineEdit()!;
  return (
    <button type="button" onClick={() => inline.enter(field)}>
      enter-edit
    </button>
  );
}

/** Mounts the highlights strip + save bar for one field and enters edit mode. */
async function openInline(type: 'date' | 'datetime', name: string, stored: string) {
  const update = vi.fn().mockResolvedValue({});
  const fields: HighlightField[] = [{ name, label: 'When', type }];
  const { container } = render(
    <InlineEditProvider canEdit>
      <EnterEdit field={name} />
      <HeaderHighlight fields={fields} data={{ [name]: stored }} objectSchema={{ fields: { [name]: { type } } }} />
      <InlineEditSaveBar
        dataSource={{ update }}
        objectName="crm_task"
        recordId="t1"
        data={{ updated_at: 'v1' }}
        refresh={vi.fn().mockResolvedValue(undefined)}
      />
    </InlineEditProvider>,
  );
  fireEvent.click(screen.getByText('enter-edit'));
  const input = await waitFor(() => {
    const el = container.querySelector('[data-slot="date-picker"] input');
    if (!el) throw new Error('the strip opened no date picker');
    return el as HTMLInputElement;
  });
  return { container, input, update };
}

/** Click a day in the picker's calendar (the value's month is the one shown). */
async function pickCalendarDay(year: number, monthIndex: number, day: number) {
  fireEvent.click(screen.getByTestId('date-picker-trigger'));
  const button = await waitFor(() => {
    const el = document.body.querySelector(
      `button[data-day="${new Date(year, monthIndex, day).toLocaleDateString()}"]`,
    );
    if (!el) throw new Error('calendar not open');
    return el as HTMLButtonElement;
  });
  act(() => {
    fireEvent.click(button);
  });
}

/** Press Save the way a pointer does: the button takes focus, then is clicked. */
async function save(update: ReturnType<typeof vi.fn>): Promise<unknown> {
  const button = screen.getByRole('button', { name: 'Save' });
  act(() => {
    button.focus();
  });
  fireEvent.click(button);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  const [objectName, recordId, patch] = update.mock.calls[0];
  expect([objectName, recordId]).toEqual(['crm_task', 't1']);
  return patch;
}

describe('record page inline `datetime` edit keeps the time (objectui#12759)', () => {
  it('draws the platform picker with date AND time, not `input[type=date]`', async () => {
    const { container, input } = await openInline('datetime', 'due_at', '2026-10-14T14:30:00.000Z');
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(input.type).toBe('text');
    // The console locale's pattern (`en` here): the date and the time.
    expect(input.placeholder).toMatch(/^MM\/DD\/YYYY, HH:mm\s?AM\/PM$/);
    expect(input.value).toMatch(/^10\/14\/2026, 0?2:30\s?PM$/);
  });

  it('a record at 14:30, moved to another day in the calendar, saves that day at 14:30', async () => {
    const { update } = await openInline('datetime', 'due_at', '2026-10-14T14:30:00.000Z');
    await pickCalendarDay(2026, 9, 16);
    // Never local midnight (`2026-10-16T00:00:00.000Z` in this UTC suite).
    expect(await save(update)).toEqual({ due_at: '2026-10-16T14:30:00.000Z' });
  });

  it('a typed day and time save that instant (read on the blur the Save press causes)', async () => {
    const { input, update } = await openInline('datetime', 'due_at', '2026-10-14T14:30:00.000Z');
    input.focus();
    fireEvent.change(input, { target: { value: '10/16/2026 09:05' } });
    expect(await save(update)).toEqual({ due_at: '2026-10-16T09:05:00.000Z' });
  });

  it('CONTROL: a `date` field still writes the plain `YYYY-MM-DD` (objectui#12206)', async () => {
    const { container, input, update } = await openInline('date', 'due_date', '2026-10-14');
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(input.placeholder).toBe('MM/DD/YYYY');
    expect(input.value).toBe('10/14/2026');
    await pickCalendarDay(2026, 9, 16);
    expect(await save(update)).toEqual({ due_date: '2026-10-16' });
  });
});

/** The same calendar move in a zone that is not UTC. */
async function moveInZone(stored: string): Promise<unknown> {
  const { update } = await openInline('datetime', 'due_at', stored);
  await pickCalendarDay(2026, 9, 16);
  return save(update);
}

describe.runIf(DRIVEN)('inline `datetime` move east of UTC, at UTC+8 (objectui#12759)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = EAST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(20);
  });

  it('14:30 Taipei on the 14th, moved to the 16th, saves 14:30 Taipei on the 16th', async () => {
    process.env.TZ = EAST;
    // Local midnight of the 16th would be `2026-10-15T16:00:00.000Z`.
    expect(await moveInZone('2026-10-14T06:30:00.000Z')).toEqual({ due_at: '2026-10-16T06:30:00.000Z' });
  });
});

describe.runIf(DRIVEN)('inline `datetime` move west of UTC, at UTC-5 (objectui#12759)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = WEST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(7);
  });

  it('14:30 Bogota on the 14th, moved to the 16th, saves 14:30 Bogota on the 16th', async () => {
    process.env.TZ = WEST;
    // Local midnight of the 16th would be `2026-10-16T05:00:00.000Z`.
    expect(await moveInZone('2026-10-14T19:30:00.000Z')).toEqual({ due_at: '2026-10-16T19:30:00.000Z' });
  });
});
