/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9061 — a `provider: 'value'` calendar honours the three query keys
 * the fetching path honours: `filter`, `sort`, and the objectui#7210 row
 * ceiling. The port of objectui#8769, which removed the same short-circuit
 * from `ObjectGantt`; `ObjectMap.inlineQueryKeys-9061.test.tsx` is the twin.
 *
 * ## What was wrong
 *
 * The record-fetch effect short-circuited the inline provider
 * (`setData(dataItems)`; return) BEFORE the `find` below it, which is the ONE
 * site in the file that lowers `schema.filter` to `$filter`, `schema.sort` to
 * `$orderby` and the ceiling to `$top`. An authored `filter` therefore reached
 * nothing and every inline row was drawn — the fail-OPEN direction: the key
 * that was ignored is the key that NARROWS, so the author saw MORE events than
 * declared, with no diagnostic.
 *
 * ⛔ Not a data-exposure boundary. The rows are already in the authored schema;
 * what is wrong is that the calendar answers a question nobody asked.
 *
 * ## The two-sided reading is the finding
 *
 * A one-sided reproduction cannot tell "the filter was ignored" from "the
 * filter matched everything", so `twoSidedFilter` renders the SAME rows and the
 * SAME filter twice — once inline, once through a context adapter that is
 * itself a `ValueDataSource` over those rows — and reads the DISAGREEMENT. The
 * matcher is literally the same implementation on both sides, so the only
 * variable left is which branch of the effect ran.
 *
 * ## ORDER: filter first, ceiling second (objectui#7210 ruling a′)
 *
 * The ceiling is applied to the FILTERED set, matching the fetching path, where
 * `$filter` and `$top` travel in one query and every backend filters before it
 * limits. `ceilingOrder` pins it from the observable side: a set that is over
 * the ceiling BEFORE filtering and under it after draws every matching row and
 * shows NO footnote.
 *
 * ## What this repair does NOT inherit from the gantt
 *
 * `ObjectGantt` had a standing pin asserting an inline set is never capped and
 * never footnoted, which objectui#8769 had to invert. `ObjectCalendar` has no
 * such pin — `ObjectCalendar.rowCeiling-7210.test.tsx` grades the `object`
 * provider only — so the ceiling rows below are NEW coverage rather than an
 * inversion. Verified by reading that file's case list before writing this one.
 *
 * ⚠️ MEASURED CONSEQUENCE, reported rather than hidden: an author who supplies
 * more than `NON_GRID_ROW_CEILING` inline rows now sees fewer events than they
 * supplied. `ceilingCap` and `ceilingNote` are that measurement. It is the
 * ruled behaviour rather than a silent loss — ruling a′'s budget is measured in
 * DOM ELEMENTS PER RECORD and its own table was taken over the inline `value`
 * provider, and `NonGridRowCeilingNote` names BOTH numbers on screen, which is
 * the half the ruling actually protects. The calendar is the view where a cut
 * is hardest to see from the picture (a month grid draws at most four events
 * per day cell), so the footnote is the whole signal and `ceilingNote` is not
 * optional.
 *
 * ## HOW THE INLINE ROWS ARE SPELLED HERE, and why it is not the map's spelling
 *
 * `staticData`, on every row. Rung 1 of the record-source ladder is judged
 * against the BLOCK's own published `data` row (objectui#8348, decision batch
 * #83 — "the row decides"), and `object-calendar`'s row is
 * `z.array(z.unknown()).optional()` — an ARRAY. A `{ provider, items }` config
 * object under `data` is therefore refused BY KIND on this block, the ladder
 * falls through to a `staticData` and an `objectName` that are not there, and
 * the calendar is left with no record source at all. `offArmDataSpelling` pins
 * exactly that, with a lit control beside it.
 *
 * ⚠️ The twin file `ObjectMap.inlineQueryKeys-9061.test.tsx` is the MIRROR
 * IMAGE, not a copy: `object-map`'s row is `ViewData`, so there the config
 * object is the honoured spelling and the bare array is the refused one. The
 * two files use opposite spellings on purpose; copying either one's `data:`
 * line into the other is the defect each file's off-arm row exists to catch.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the short-circuit in `ObjectCalendar.tsx` ONLY (the map's
 * fix left in place): `twoSidedFilter`, `inlineSort`, `ceilingCap`,
 * `ceilingNote` and `ceilingOrder` go RED; `control`, `offArmDataSpelling` and
 * `providerBackedControl` stay GREEN — the first draws the same rows in the
 * same order either way, the second never reaches the inline branch, and the
 * third never touches the inline path at all, which is what makes them
 * controls.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NON_GRID_ROW_CEILING, nonGridRowCeilingQuery, ValueDataSource } from '@object-ui/core';
import { ObjectCalendar } from './ObjectCalendar';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

// The month grid is irrelevant here — every assertion is about WHICH records
// reached the view layer and in WHAT ORDER, and the grid deliberately hides
// both (at most four events per day cell, then a "+N more"). Same stub the
// sibling `ObjectCalendar.rowCeiling-7210` pin uses, widened by the id list
// because `sort` is unreadable from a count.
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
  { id: '1', subject: 'Alpha', status: 'open', rank: 30, start_at: dayOfThisMonth(0), end_at: dayOfThisMonth(0) },
  { id: '2', subject: 'Bravo', status: 'closed', rank: 10, start_at: dayOfThisMonth(1), end_at: dayOfThisMonth(1) },
  { id: '3', subject: 'Charlie', status: 'open', rank: 40, start_at: dayOfThisMonth(2), end_at: dayOfThisMonth(2) },
  { id: '4', subject: 'Delta', status: 'closed', rank: 20, start_at: dayOfThisMonth(3), end_at: dayOfThisMonth(3) },
  { id: '5', subject: 'Echo', status: 'open', rank: 50, start_at: dayOfThisMonth(4), end_at: dayOfThisMonth(4) },
];

/** The three rows an authored `status = open` filter declares. */
const OPEN_IDS = '1,3,5';
const OPEN_FILTER = [['status', '=', 'open']];

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

function makeRows(n: number, status: (i: number) => string = () => 'open') {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    subject: `Event ${i + 1}`,
    status: status(i),
    start_at: dayOfThisMonth(i),
    end_at: dayOfThisMonth(i),
  }));
}

describe('objectui#9061 — the calendar honours filter / sort / the row ceiling on inline `value` data', () => {
  it('twoSidedFilter: the inline path and the fetching path agree on the SAME rows and the SAME filter', async () => {
    // One matcher, two branches of the record-fetch effect. Any disagreement
    // here is the short-circuit and nothing else.
    const dataSource = new ValueDataSource({ items: ROWS }) as any;
    dataSource.getObjectSchema = vi.fn(async () => ({ name: 'event', fields: {} }));

    const { unmount } = render(
      <ObjectCalendar
        schema={{ ...base, staticData: ROWS, filter: OPEN_FILTER }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    const inline = drawn();
    unmount();

    render(
      <ObjectCalendar
        schema={{ ...base, objectName: 'event', filter: OPEN_FILTER }}
        dataSource={dataSource}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    const fetching = drawn();

    expect(inline.ids).toBe(OPEN_IDS);
    expect(fetching.ids).toBe(OPEN_IDS);
    // The finding, stated as the two paths agreeing.
    expect(inline.ids).toBe(fetching.ids);
  });

  it('inlineSort: an authored `sort` orders the inline rows', async () => {
    render(
      <ObjectCalendar
        schema={{
          ...base,
          staticData: ROWS,
          sort: [{ field: 'rank', order: 'desc' }],
        }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('5'));
    // rank 50,40,30,20,10 → Echo, Charlie, Alpha, Delta, Bravo
    expect(drawn().ids).toBe('5,3,1,4,2');
  });

  it('offArmDataSpelling: a `{ provider, items }` config under `data` is NOT an inline source here', async () => {
    // ⭐ The rung ruling, pinned on the block it actually bites (objectui#8348,
    // decision batch #83 — "the row decides"). `object-calendar`'s published
    // `data` row is `z.array(z.unknown()).optional()`, so `resolveRecordSourceConfig`
    // judges rung 1 on the `'array'` arm and refuses a CONFIG OBJECT by kind.
    // With no `staticData` and no `objectName` left to fall to, the ladder
    // returns null and the calendar has no record source at all — which is why
    // every inline row above is spelled `staticData`, the one rung that does
    // wrap into `{ provider: 'value', items }` on this block.
    //
    // ⛔ This is the row that must stay red if anyone "fixes" the reds above by
    // teaching the `'array'` arm to also accept the config object: that is the
    // AGENTS.md #0.1 tolerant-fallback defect, and it would re-open the drift
    // objectui#8348 closed.
    render(<ObjectCalendar schema={{ ...base, data: { provider: 'value', items: ROWS } }} />);
    await waitFor(() => expect(screen.queryByText(/Loading calendar/)).toBeNull());
    expect(screen.queryByTestId('calendar-view')).toBeNull();

    // The LIT CONTROL, so the line above is a reading about the SPELLING and
    // not about these rows, this stub or this harness: the same rows, same
    // component, on the arm the row does declare, draw all five.
    cleanup();
    render(<ObjectCalendar schema={{ ...base, staticData: ROWS }} />);
    await waitFor(() => expect(drawn().count).toBe('5'));
  });

  it('ceilingCap: an inline set past the ceiling draws exactly the ceiling', async () => {
    render(
      <ObjectCalendar
        schema={{
          ...base,
          staticData: makeRows(nonGridRowCeilingQuery().$top + 500),
        }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(String(NON_GRID_ROW_CEILING)));
  });

  it('ceilingNote: the cut is LOUD — the footnote names both numbers', async () => {
    const total = nonGridRowCeilingQuery().$top + 500;
    render(
      <ObjectCalendar schema={{ ...base, staticData: makeRows(total) }} />,
    );
    await waitFor(() => expect(drawn().count).toBe(String(NON_GRID_ROW_CEILING)));

    const note = await screen.findByRole('note');
    expect(note.getAttribute('data-row-ceiling-note')).toBe('non-grid');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(total));
  });

  it('ceilingOrder: the ceiling is applied to the FILTERED set, not to the raw one', async () => {
    // Over the ceiling before filtering, under it after: 2,400 rows of which
    // only every third is `open` (800). Filter-then-ceiling draws all 800 and
    // stays quiet; ceiling-then-filter could not.
    const rows = makeRows(2400, (i) => (i % 3 === 0 ? 'open' : 'closed'));
    render(
      <ObjectCalendar
        schema={{ ...base, staticData: rows, filter: OPEN_FILTER }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('800'));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('control: an inline calendar with NO filter, NO sort and under the ceiling is unchanged', async () => {
    // ⭐ Green on BOTH ablation legs by construction. Without it a reviewer
    // cannot tell this repair from "the inline path now drops rows".
    render(<ObjectCalendar schema={{ ...base, staticData: ROWS }} />);
    await waitFor(() => expect(drawn().count).toBe('5'));
    expect(drawn().ids).toBe('1,2,3,4,5');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('providerBackedControl: a NON-inline view is untouched by this repair', async () => {
    // ⭐ The control that BOUNDS the change to the inline path: same filter,
    // same sort, same rows, resolved through the context adapter. Green before
    // this repair, green after it, and green on both ablation legs.
    const dataSource = new ValueDataSource({ items: ROWS }) as any;
    dataSource.getObjectSchema = vi.fn(async () => ({ name: 'event', fields: {} }));

    render(
      <ObjectCalendar
        schema={{
          ...base,
          objectName: 'event',
          filter: OPEN_FILTER,
          sort: [{ field: 'rank', order: 'desc' }],
        }}
        dataSource={dataSource}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('3'));
    // rank 50,40,30 → Echo, Charlie, Alpha
    expect(drawn().ids).toBe('5,3,1');
    expect(screen.queryByRole('note')).toBeNull();
  });
});
