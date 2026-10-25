/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10767 — an `object-calendar` with inline rows draws the events a
 * spec `ViewFilterRule[]` `filter` selects.
 *
 * ## What was wrong
 *
 * The inline arm hands `schema.filter` to an in-memory `ValueDataSource`
 * unlowered (objectui#9061 routed it there so `filter` / `sort` / the ceiling
 * are honoured). That adapter read a MongoDB-style record and an AST array,
 * but refused a rule OBJECT node by node — so the one filter form the spec's
 * converged `filter` doors accept (objectui#6206 B) drew NO events, with one
 * `console.warn` as the only signal. The record form and the AST form drew the
 * three; they are the controls here.
 *
 * The repair is in `@object-ui/core`'s `ValueDataSource` (the array arm lowers
 * through `toFilterNode`), so this file changes nothing in `ObjectCalendar.tsx`;
 * it pins the consequence on THIS block, through its own inline spelling.
 *
 * ## HOW THE INLINE ROWS ARE SPELLED HERE
 *
 * `staticData`, on every row. `object-calendar`'s published `data` row is an
 * ARRAY, so a `{ provider, items }` config under `data` is refused by kind on
 * this block and `staticData` is the one rung that wraps into
 * `{ provider: 'value', items }` (objectui#8348, decision batch #83);
 * `ObjectCalendar.inlineQueryKeys-9061.test.tsx` pins the refused spelling.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the unlowered array arm in `ValueDataSource.find`:
 * `ruleArrayFilter` goes RED; `recordFormControl` and `astControl` stay GREEN —
 * they draw the same three either way, which is what makes them controls.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectCalendar } from './ObjectCalendar';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

// The month grid is irrelevant here — every assertion is about WHICH records
// reached the view layer, and the grid deliberately hides that (at most four
// events per day cell, then a "+N more"). Same stub the sibling
// `ObjectCalendar.inlineQueryKeys-9061` pin uses.
vi.mock('./CalendarView', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    CalendarView: ({ events }: any) => (
      <div
        data-testid="calendar-view"
        data-event-count={String(events.length)}
        data-event-ids={events.map((e: any) => String(e.id)).join(',')}
      />
    ),
  };
});

afterEach(cleanup);

const NOW = new Date();

/** A date inside the month the calendar opens on, so the row is drawable. */
function dayOfThisMonth(i: number) {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), (i % 28) + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const ROWS = [
  { id: '1', subject: 'Alpha', status: 'open', start_at: dayOfThisMonth(0), end_at: dayOfThisMonth(0) },
  { id: '2', subject: 'Bravo', status: 'closed', start_at: dayOfThisMonth(1), end_at: dayOfThisMonth(1) },
  { id: '3', subject: 'Charlie', status: 'open', start_at: dayOfThisMonth(2), end_at: dayOfThisMonth(2) },
  { id: '4', subject: 'Delta', status: 'closed', start_at: dayOfThisMonth(3), end_at: dayOfThisMonth(3) },
  { id: '5', subject: 'Echo', status: 'open', start_at: dayOfThisMonth(4), end_at: dayOfThisMonth(4) },
];

/** The three rows a `status = open` filter declares, in every spelling. */
const OPEN_IDS = '1,3,5';
const RULE_ARRAY_FILTER = [{ field: 'status', operator: 'equals', value: 'open' }];
const RECORD_FORM_FILTER = { status: 'open' };
const AST_FILTER = [['status', '=', 'open']];

const base: any = {
  type: 'calendar',
  calendar: { titleField: 'subject', startDateField: 'start_at', endDateField: 'end_at' },
};

function drawn() {
  const el = screen.getByTestId('calendar-view');
  return {
    count: el.getAttribute('data-event-count'),
    ids: el.getAttribute('data-event-ids'),
  };
}

describe('objectui#10767 — the calendar draws the rows a rule-array `filter` selects on inline `value` data', () => {
  it('ruleArrayFilter: the spec’s rule array draws the three declared rows', async () => {
    render(<ObjectCalendar schema={{ ...base, staticData: ROWS, filter: RULE_ARRAY_FILTER }} />);
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().ids).toBe(OPEN_IDS);
  });

  it('recordFormControl: the record form draws the same three (green on both trees)', async () => {
    render(<ObjectCalendar schema={{ ...base, staticData: ROWS, filter: RECORD_FORM_FILTER }} />);
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().ids).toBe(OPEN_IDS);
  });

  it('astControl: the AST form draws the same three (green on both trees)', async () => {
    render(<ObjectCalendar schema={{ ...base, staticData: ROWS, filter: AST_FILTER }} />);
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().ids).toBe(OPEN_IDS);
  });
});
