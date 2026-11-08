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
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { toast } from '@object-ui/components';
import { normaliseClientError } from '@object-ui/data-objectstack';
import { I18nProvider } from '@object-ui/i18n';
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
 * The current-month grid cell of a day, found by its day number rather than
 * by its spoken label, so a render under a non-`en` `I18nProvider` (whose
 * resolved locale spells the label differently) finds it too.
 */
const monthCell = (d: Date): HTMLElement => {
  const cells = screen.getAllByRole('gridcell').filter(
    (cell) => !cell.className.includes('opacity-50') && cell.firstElementChild?.textContent === String(d.getDate()),
  );
  expect(cells).toHaveLength(1);
  return cells[0];
};

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

function makeDataSource(rejectWith: unknown, label?: string) {
  return {
    getObjectSchema: vi.fn(async () => ({
      name: 'visit',
      ...(label ? { label } : {}),
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
async function rescheduleAndReadToast(
  rejectWith: unknown,
  { label, wrap }: { label?: string; wrap?: (ui: React.ReactElement) => React.ReactElement } = {},
): Promise<unknown> {
  const ds = makeDataSource(rejectWith, label);
  const ui = <ObjectCalendar schema={schema} dataSource={ds as never} />;
  render(wrap ? wrap(ui) : ui);

  const pill = await screen.findByLabelText(TITLE);
  performDnd(pill, monthCell(TARGET_DAY));

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

/**
 * A reschedule the server refuses with `404 RECORD_NOT_FOUND` (the record was
 * deleted, or row-level security no longer shows it to this user) toasts a
 * translated sentence naming the object by its LABEL, never the server's
 * `Record ID not found in OBJECT_NAME` (objectstack#31494), and the event still
 * snaps back to its day.
 */
const notFound = () =>
  normaliseClientError(
    Object.assign(new Error('Record v1 not found in visit'), {
      code: 'RECORD_NOT_FOUND',
      httpStatus: 404,
      details: { code: 'RECORD_NOT_FOUND', error: 'Record v1 not found in visit' },
    }),
  );

const externalRefusal = () =>
  normaliseClientError(
    Object.assign(new Error('EXTERNAL_WRITE_FORBIDDEN: visit is read-only'), {
      code: 'EXTERNAL_WRITE_FORBIDDEN',
      httpStatus: 403,
    }),
  );

/** The server's sentence leaks none of its machine parts: id, object name. */
function expectNoServerParts(said: unknown) {
  expect(String(said)).not.toContain('v1');
  expect(String(said)).not.toMatch(/\bvisit\b/);
  expect(String(said)).not.toContain('not found in');
}

describe('ObjectCalendar — a reschedule of a record gone for this session (#31494)', () => {
  it('names the object by its served label, with no id or machine name, and rolls back', async () => {
    const said = await rescheduleAndReadToast(notFound(), { label: 'Appointment' });
    expect(said).toBe('This Appointment record no longer exists, or you no longer have access to it.');
    expectNoServerParts(said);
    // The optimistic move is undone: the event is back on its own day.
    await waitFor(() => expect(within(monthCell(SOURCE_DAY)).getByLabelText(TITLE)).toBeTruthy());
    expect(within(monthCell(TARGET_DAY)).queryByLabelText(TITLE)).toBeNull();
  });

  it('speaks the session language: a zh session reads the zh sentence with the zh label', async () => {
    const said = await rescheduleAndReadToast(notFound(), {
      label: '任务',
      wrap: (ui) => (
        <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, warnMissingKeys: false }}>
          {ui}
        </I18nProvider>
      ),
    });
    expect(said).toBe('这条任务记录已不存在，或者您已无权访问它。');
    expectNoServerParts(said);
  });

  it('with no label to show, says the generic sentence rather than the machine name', async () => {
    const said = await rescheduleAndReadToast(notFound());
    expect(said).toBe("This record doesn't exist, or you don't have access to it.");
    expectNoServerParts(said);
  });

  it('a 404 marked for the user still renders the marking', async () => {
    const marked = normaliseClientError(
      Object.assign(new Error('Record v1 not found in visit'), {
        code: 'RECORD_NOT_FOUND',
        httpStatus: 404,
        userMessage: MARKED,
      }),
    );
    expect(await rescheduleAndReadToast(marked, { label: 'Appointment' })).toBe(MARKED);
  });

  it('leaves the external-source refusal its own read-only sentence', async () => {
    expect(await rescheduleAndReadToast(externalRefusal(), { label: 'Appointment' })).toBe(
      'This table is read-only. Its records come from an external data source that does not accept changes.',
    );
  });

  it('leaves an unmarked 403 its localized permission substitution', async () => {
    expect(await rescheduleAndReadToast(forbidden(), { label: 'Appointment' })).toBe(
      'You are not authorized to perform this action.',
    );
  });
});
