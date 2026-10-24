/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectCalendar` reads its `find()` answer as `QueryResult` DECLARES it — and
 * does NOT read `records` (objectui#6839).
 *
 * ⭐ This module reaches the shared reader INDIRECTLY: it does not call
 * `extractRecords` at all, it hands its `find()` answer to
 * `applyNonGridRowCeiling` (`@object-ui/react`), which unwraps it. A card
 * enumerating the helper's direct callers would not list this file, and a
 * repo-wide "nothing reads `records`" assertion would pass over it in silence.
 * The route is what is measured here, at the events.
 *
 * ## This module is one of the two where the `value` arm is LIVE
 *
 * TWO `find()` doubles in this package answer `{ value: [...] }` today, and
 * objectui#6840 — which deleted the `value` arm from `ObjectView`'s own ladder
 * on a measured zero at THAT seam — said in as many words that its zero must
 * not be carried to this one. So the `value` case below is a NON-REGRESSION
 * case: it is what refuses an `extractRecords` that answers `[]` for
 * everything, an implementation strictly worse than the bug.
 *
 * MEASURED for this module: no `find()` in `plugin-calendar`, nor in any app or
 * example mounting a calendar, emits a `records` envelope — the package's two
 * `records:` occurrences are a doc comment and a record-VISIBILITY batch route
 * stub (`fetch`, not `find`). CONTROL, so the zero is a reading: the same sweep
 * finds a live `find()` double emitting `{ records: [...] }` at `plugin-list`'s
 * ObjectGallery, a consumer with its own unwrap ladder.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

// The month grid draws at most four events per day cell, so it cannot report a
// count. Stubbing the child puts the number on an attribute an assertion can
// reach — the same idiom `ObjectCalendar.rowCeiling-7210.test.tsx` uses, and
// `importOriginal` keeps the module's other exports live.
vi.mock('./CalendarView', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    CalendarView: ({ events }: any) => (
      <div data-testid="calendar-view" data-event-count={String(events.length)} />
    ),
  };
});

import { ObjectCalendar } from './ObjectCalendar';

const NOW = new Date();

/** Events inside the month the calendar opens on, so they are drawable at all. */
const ROWS = [1, 2].map((n) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), n);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  return { id: String(n), subject: `Event ${n}`, start_at: iso, end_at: iso };
});

const schema: any = {
  type: 'calendar',
  objectName: 'event',
  calendar: { titleField: 'subject', startDateField: 'start_at', endDateField: 'end_at' },
  data: { provider: 'object', object: 'event' },
};

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asValue: Envelope = (rows) => ({ value: rows, total: rows.length });
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

/**
 * Mount the calendar over a `find()` answering `envelope`, return events drawn.
 *
 * ⛔ Call ONCE per case, never inside a `waitFor` predicate (objectui#7802):
 * it renders, and `waitFor` re-runs its callback on DOM mutations, so a
 * predicate that renders feeds itself and leaks a container div per run.
 */
async function eventsThrough(envelope: Envelope): Promise<number> {
  const find = vi.fn(async () => envelope(ROWS));
  const ds: any = {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'event',
      fields: {
        id: { name: 'id', type: 'text' },
        subject: { name: 'subject', type: 'text' },
        start_at: { name: 'start_at', type: 'date' },
        end_at: { name: 'end_at', type: 'date' },
      },
    })),
  };
  render(<ObjectCalendar schema={schema} dataSource={ds} />);
  await waitFor(() => expect(find).toHaveBeenCalled());
  // `find`'s OWN answer, settled — a pure read of the mock's call record that
  // touches no DOM. Without it "no events" is satisfied by the mount's initial
  // empty state, which every arm renders identically.
  await find.mock.results[0].value;
  // The stubbed grid mounts on every arm, refused or not — a mount signal
  // rather than a rows signal, which is what makes it the one wait shared by
  // the live cases and the refusal case.
  await waitFor(() => expect(screen.queryByTestId('calendar-view')).toBeTruthy());
  return Number(screen.getByTestId('calendar-view').getAttribute('data-event-count'));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ObjectCalendar — the find() envelope it reads (objectui#6839)', () => {
  it("still reads the contract's `data` member", async () => {
    expect(await eventsThrough(asData), 'the declared rows member must still draw').toBe(2);
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    expect(await eventsThrough(asBareArray), 'the bare-array arm must still draw').toBe(2);
  });

  it('still reads `value` — LIVE at this seam, two doubles in this package emit it', async () => {
    expect(
      await eventsThrough(asValue),
      'objectui#6840 refused to transfer its `ObjectView` zero here; deleting this arm would '
        + 'break two doubles in this package',
    ).toBe(2);
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    // Before the fix these two events drew off a key `QueryResult` does not
    // declare, and did so AHEAD of `data`.
    expect(
      await eventsThrough(asRecords),
      'a `records` envelope must reach the grid as zero events, not as the rows it names',
    ).toBe(0);
  });
});
