/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8769 — a `provider: 'value'` gantt honours the three query keys the
 * fetching path honours: `filter`, `sort`, and the objectui#7210 row ceiling.
 *
 * ## What was wrong
 *
 * `reload` short-circuited the inline provider (`setData(dataItems)`; return)
 * BEFORE `effectiveDataSource.find(...)`, which is the ONE site that lowers
 * `schema.filter` to `$filter`, `schema.sort` to `$orderby` and the ceiling to
 * `$top`. An authored `filter` therefore reached nothing and every inline row
 * was charted — the fail-OPEN direction: the key that was ignored is the key
 * that NARROWS, so the author saw MORE rows than declared, with no diagnostic.
 *
 * ⛔ Not a data-exposure boundary. The rows are already in the authored schema;
 * what is wrong is that the chart answers a question nobody asked.
 *
 * ## The two-sided reading is the finding
 *
 * A one-sided reproduction cannot tell "the filter was ignored" from "the
 * filter matched everything", so the first case renders the SAME rows and the
 * SAME filter twice — once inline, once through a context adapter — and reads
 * the DISAGREEMENT. The adapter is a `ValueDataSource` over the same rows, so
 * the matcher is literally the same object on both sides and the only variable
 * left is which branch of `reload` ran.
 *
 * ## ORDER: filter first, ceiling second (objectui#7210 ruling a′)
 *
 * The ceiling is applied to the FILTERED set, matching the fetching path
 * exactly — there `$filter` and `$top` travel in one query and every backend
 * filters before it limits. `ceilingOrder` pins it from the observable side: a
 * set that is over the ceiling BEFORE filtering and under it after draws every
 * matching row and shows NO footnote. A ceiling-then-filter implementation
 * would draw at most 2,000 rows there and would still footnote.
 *
 * ## The `never capped by us` case this file replaces
 *
 * `ObjectGantt.rowCeiling-7210.test.tsx` asserted that an inline set is never
 * capped and never footnoted. That case pinned the SHORT-CIRCUIT's behaviour,
 * not ruling a′: the ruling's own budget is measured in DOM ELEMENTS PER
 * RECORD (its table was measured over "real child views, inline `value`
 * provider"), and an inline row costs the browser exactly what a fetched row
 * costs. Nothing in the ruling text carves the provider out. So the exemption
 * moves here, inverted, with the triage ruling on objectui#8769 as its
 * authority — and `ceilingNote` below is what makes the cut loud rather than
 * silent, which is the half ruling a′ actually protects.
 *
 * ## Live adjacency, measured (objectui#9001 / PR objectui#9049)
 *
 * That card makes core's `convertFiltersToAST` THROW `FilterOperatorError` for
 * an `$icontains` comparand that is not a non-empty string. This repair does
 * NOT inherit it: the inline provider resolves to `ValueDataSource`, whose
 * matcher is local and refuses by EXCLUDING the row and logging once. Since
 * objectui#10767 that adapter does reach the converter — its array arm lowers
 * a spec `ViewFilterRule[]` through `toFilterNode` before matching — but a
 * refusal the lowering raises is re-seated as the same excluded-and-logged
 * refusal, never rethrown from `find`; an AST tuple like the one below is
 * passed through the sink untouched and judged by the matcher's own comparand
 * door. `refusedComparandDoesNotThrow` pins the consequence from the outside
 * either way: a render, not a throw.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the short-circuit: `twoSidedFilter`, `inlineSort`,
 * `staticDataSpelling`, `ceilingCap`, `ceilingNote` and `ceilingOrder` go RED;
 * `control` and `refusedComparandDoesNotThrow` stay GREEN (the control draws
 * the same rows in the same order either way, which is what makes it a
 * control).
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NON_GRID_ROW_CEILING, nonGridRowCeilingQuery, ValueDataSource } from '@object-ui/core';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The bar canvas is irrelevant here — every assertion is about WHICH rows
// reached the chart and in WHAT ORDER. Same stub the sibling ObjectGantt pins
// use, widened by the id list because `sort` is unreadable from a count.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div
      data-testid="gantt-view"
      data-task-count={String(tasks.length)}
      data-task-ids={tasks.map((t: any) => String(t.id)).join(',')}
    />
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

const ROWS = [
  { id: '1', subject: 'Alpha', status: 'open', rank: 30, visible_from: '2026-01-01', due_date: '2026-01-31' },
  { id: '2', subject: 'Bravo', status: 'closed', rank: 10, visible_from: '2026-02-01', due_date: '2026-02-28' },
  { id: '3', subject: 'Charlie', status: 'open', rank: 40, visible_from: '2026-03-01', due_date: '2026-03-31' },
  { id: '4', subject: 'Delta', status: 'closed', rank: 20, visible_from: '2026-04-01', due_date: '2026-04-30' },
  { id: '5', subject: 'Echo', status: 'open', rank: 50, visible_from: '2026-05-01', due_date: '2026-05-31' },
];

/** The three rows an authored `status = open` filter declares. */
const OPEN_IDS = '1,3,5';
const OPEN_FILTER = [['status', '=', 'open']];

const base: any = {
  type: 'object-gantt',
  gantt: {
    titleField: 'subject',
    startDateField: 'visible_from',
    endDateField: 'due_date',
  },
};

function drawn() {
  const el = screen.getByTestId('gantt-view');
  return {
    count: el.getAttribute('data-task-count'),
    ids: el.getAttribute('data-task-ids'),
  };
}

function makeRows(n: number, status: (i: number) => string = () => 'open') {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    subject: `Task ${i + 1}`,
    status: status(i),
    visible_from: '2026-01-01',
    due_date: '2026-12-31',
  }));
}

describe('objectui#8769 — the inline `value` provider honours filter / sort / the row ceiling', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it('twoSidedFilter: the inline path and the fetching path agree on the SAME rows and the SAME filter', async () => {
    // One matcher, two branches of `reload`. Any disagreement here is the
    // short-circuit and nothing else.
    const dataSource = new ValueDataSource({ items: ROWS }) as any;

    const { unmount } = render(
      <ObjectGantt
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: OPEN_FILTER }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    await waitFor(() => expect(drawn().count).toBe('3'));
    const inline = drawn();
    unmount();

    render(
      <ObjectGantt
        schema={{ ...base, objectName: 'duly_task', filter: OPEN_FILTER }}
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
      <ObjectGantt
        schema={{
          ...base,
          data: { provider: 'value', items: ROWS },
          sort: [{ field: 'rank', order: 'desc' }],
        }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('5'));
    // rank 50,40,30,20,10 → Echo, Charlie, Alpha, Delta, Bravo
    expect(drawn().ids).toBe('5,3,1,4,2');
  });

  it('staticDataSpelling: the `staticData` rung reaches the same repair', async () => {
    // The ruled three-rung ladder wraps `staticData` into
    // `{ provider: 'value', items }`, so it lands on exactly this path. It is
    // the second spelling an author can use and it needs its own row.
    render(<ObjectGantt schema={{ ...base, staticData: ROWS, filter: OPEN_FILTER }} />);
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().ids).toBe(OPEN_IDS);
  });

  it('ceilingCap: an inline set past the ceiling draws exactly the ceiling', async () => {
    render(
      <ObjectGantt
        schema={{
          ...base,
          data: { provider: 'value', items: makeRows(nonGridRowCeilingQuery().$top + 500) },
        }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(String(NON_GRID_ROW_CEILING)));
  });

  it('ceilingNote: the cut is LOUD — the footnote names both numbers', async () => {
    const total = nonGridRowCeilingQuery().$top + 500;
    render(
      <ObjectGantt schema={{ ...base, data: { provider: 'value', items: makeRows(total) } }} />,
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
      <ObjectGantt
        schema={{ ...base, data: { provider: 'value', items: rows }, filter: OPEN_FILTER }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe('800'));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('control: an inline chart with NO filter, NO sort and under the ceiling is unchanged', async () => {
    // ⭐ Green on BOTH ablation legs by construction. Without it a reviewer
    // cannot tell this repair from "the inline path now drops rows".
    render(<ObjectGantt schema={{ ...base, data: { provider: 'value', items: ROWS } }} />);
    await waitFor(() => expect(drawn().count).toBe('5'));
    expect(drawn().ids).toBe('1,2,3,4,5');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('refusedComparandDoesNotThrow: a comparand core would refuse RENDERS, it does not throw', async () => {
    // objectui#9001 / PR objectui#9049 makes `convertFiltersToAST` throw for
    // this comparand. The inline path resolves to `ValueDataSource`, which
    // judges an AST tuple with its own comparand door — it excludes the row
    // and logs once — and re-seats a refusal its rule-array lowering raises
    // the same way (objectui#10767): `find` does not throw on a bad filter.
    render(
      <ObjectGantt
        schema={{
          ...base,
          data: { provider: 'value', items: ROWS },
          filter: [['subject', 'icontains', '']],
        }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    await waitFor(() => expect(drawn().count).toBe('0'));
    expect(
      warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('icontains')),
    ).toBe(true);
  });
});
