/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A rejected drag-to-reschedule must render the refusal text the PRODUCER
 * marked as user-facing, instead of substituting a generic string for it.
 * objectui#5902 — the calendar half of the same defect the kanban card-move
 * toast carries, inheriting the objectui#5210 ruling.
 *
 * Same structure, and the same reasons, as
 * `plugin-kanban/src/ObjectKanban.markedRefusalToast.test.tsx`: fixtures are
 * built wire-shaped and pushed through the real `normaliseClientError`
 * boundary, three MARKED arms are RED before the fix, three UNMARKED arms are
 * GREEN before and after and exist so a fix that just printed `String(error)`
 * cannot pass (objectstack#3821).
 *
 * The drop is driven through `CalendarView`'s real MonthView drag handlers —
 * the same synthetic `DataTransfer` `CalendarView.dnd.test.tsx` uses, because
 * jsdom does not round-trip a real one. `ObjectCalendar` is mounted WITHOUT an
 * `onEventDrop` prop, which is precisely the condition that routes the drop
 * into `handleEventDropDefault` — the persist path under test.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { toast } from '@object-ui/components';
import { normaliseClientError } from '@object-ui/data-objectstack';
import { ObjectCalendar } from './ObjectCalendar';

const MARKED = 'This visit cannot move outside the technician’s on-call window.';

const TITLE = 'Site visit';

/**
 * Anchor both the record and the drop target inside the CURRENT month, so the
 * month grid `ObjectCalendar` opens on always contains them — day 1 and day 8
 * are in every month's grid, whatever today's date is when the suite runs.
 */
const today = new Date();
const dayInThisMonth = (d: number) =>
  new Date(today.getFullYear(), today.getMonth(), d, 9, 0, 0, 0);
const SOURCE_DAY = dayInThisMonth(1);
const TARGET_DAY = dayInThisMonth(8);

/**
 * The cell's own aria-label, as THIS render produces it.
 *
 * ⚠️ Not "the way `MonthView` builds it" any more: `MonthView` formats that name
 * with its RESOLVED locale (objectui#10144), which this rebuild does not have in
 * hand. The two agree here only for as long as this provider-less render's
 * resolved locale and the runtime default render a date identically — mount a
 * non-`en` `I18nProvider` in this file and this helper has to be re-derived
 * rather than trusted.
 */
const cellLabel = (d: Date) =>
  d.toLocaleDateString('default', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

const record = () => ({
  id: 'v1',
  name: TITLE,
  starts_at: SOURCE_DAY.toISOString(),
});

const schema = {
  type: 'object-calendar',
  objectName: 'visit',
  calendar: { startDateField: 'starts_at', titleField: 'name' },
} as never;

const conflict = (userMessage?: string) =>
  normaliseClientError(
    Object.assign(new Error('Record was modified by another user'), {
      code: 'CONCURRENT_UPDATE',
      httpStatus: 409,
      details: {
        currentVersion: '2026-05-22T07:14:00.000Z',
        ...(userMessage ? { userMessage } : {}),
      },
    }),
  );

const validation = (userMessage?: string) =>
  normaliseClientError(
    Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_FAILED',
      httpStatus: 400,
      details: {
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'starts_at', message: 'Outside the allowed window' }],
        ...(userMessage ? { userMessage } : {}),
      },
    }),
  );

const forbidden = (userMessage?: string) =>
  normaliseClientError(
    Object.assign(new Error('FORBIDDEN: insufficient privileges to update visit v1'), {
      code: 'FORBIDDEN',
      httpStatus: 403,
      ...(userMessage ? { userMessage } : {}),
    }),
  );

function makeDataSource(rejectWith: unknown) {
  return {
    getObjectSchema: vi.fn(async () => ({
      name: 'visit',
      fields: { name: { type: 'text' }, starts_at: { type: 'datetime' } },
    })),
    find: vi.fn(async () => ({ value: [record()] })),
    update: vi.fn(async () => {
      throw rejectWith;
    }),
  };
}

/** jsdom has no DataTransfer round-trip; carry the payload in a synthetic one. */
function performDnd(source: Element, target: Element) {
  const store: Record<string, string> = {};
  const dataTransfer = {
    effectAllowed: '' as string,
    dropEffect: '' as string,
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

/**
 * Mount the calendar on its OWN data (no `data` prop, no `onEventDrop`), drag
 * the event a week forward, and return the single toast text.
 */
async function rescheduleAndReadToast(rejectWith: unknown): Promise<unknown> {
  const ds = makeDataSource(rejectWith);
  render(<ObjectCalendar schema={schema} dataSource={ds as never} />);

  const pill = await screen.findByLabelText(TITLE);
  const targetCell = screen.getByLabelText(new RegExp(`^${cellLabel(TARGET_DAY)}`));
  performDnd(pill, targetCell);

  await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  return (toast.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
}

beforeEach(() => {
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never);
  // The surface logs the raw error for the console; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectCalendar — a marked refusal reaches the reschedule toast (#5902)', () => {
  it('renders the marking on a 409 CONCURRENT_UPDATE (typed top-level member)', async () => {
    expect(await rescheduleAndReadToast(conflict(MARKED))).toBe(MARKED);
  });

  it('renders the marking on a 400 VALIDATION_FAILED (details bag)', async () => {
    expect(await rescheduleAndReadToast(validation(MARKED))).toBe(MARKED);
  });

  it('renders the marking on a 403, ahead of the "not authorized" substitution', async () => {
    expect(await rescheduleAndReadToast(forbidden(MARKED))).toBe(MARKED);
  });

  it('keeps the generic string for an UNMARKED 409', async () => {
    const said = await rescheduleAndReadToast(conflict());
    expect(said).not.toBe(MARKED);
    expect(said).toBe('Record was modified by another user');
  });

  it('keeps the generic string for an UNMARKED 400', async () => {
    const said = await rescheduleAndReadToast(validation());
    expect(said).not.toBe(MARKED);
    expect(said).toBe('Validation failed');
  });

  it('keeps the localized substitution for an UNMARKED 403', async () => {
    // objectstack#3821: an unmarked permission denial must NOT dump the server
    // text ("…insufficient privileges to update visit v1") at the user.
    const said = await rescheduleAndReadToast(forbidden());
    expect(said).toBe('You are not authorized to perform this action.');
    expect(String(said)).not.toContain('insufficient privileges');
  });
});
