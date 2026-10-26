/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7210, half 2 — maintainer ruling a′ (2026-09-02), on the gantt.
 *
 * The ruling, and the pin it names: a non-grid visualisation may fetch the
 * whole FILTERED result set, because a truthful range needs all of it, but the
 * fetch carries a platform-level hard ceiling expressed as a named constant in
 * the renderer, not an authorable view key. Past the ceiling the visualisation
 * draws the first N rows and shows a LOUD FOOTNOTE naming both N and M.
 * Below it: no footnote, and the full set draws.
 *
 * ⛔ The direction the ruling calls dangerous is SILENT truncation — "a cut-off
 * schedule still looks like a schedule". That is precisely what these cases
 * exist to make impossible to reintroduce: the first one would still pass if
 * the footnote were deleted and only the cap kept, so it asserts the note's
 * text and BOTH numbers, not merely the row count.
 *
 * ⛔ This is the CAP, not the gate. objectui#7225's half gates the gantt's
 * DUPLICATE schema-driven query; nothing here is about that, and the two are
 * separate commits on this branch for that reason.
 *
 * REVERSE VERIFICATION — MEASURED, and corrected from what this docblock used
 * to predict (objectui#7507). Removing `...nonGridRowCeilingQuery()` from
 * `ObjectGantt`'s reload turns the truncation case red at the **`$top`
 * assertion**; the below-ceiling case stays green. ⚠️ The pass/fail TALLY that
 * used to be quoted here is deliberately gone: objectui#8769 changed how many
 * cases this file has, and a stale count reads as a measurement.
 *
 * ⚠️ It does NOT go red at the footnote. The prediction that it would — "no
 * probe row ⇒ `truncated` false ⇒ no note" — reads the mechanism backwards,
 * and a wrong mechanism in a docblock is worse than none, because the next
 * reader trusts it while deciding what an edit is safe to break. What actually
 * happens: an adapter with no `$top` answers with the WHOLE filtered set, so
 * `applyNonGridRowCeiling` sees far more rows than the ceiling, slices to it,
 * and reports `truncated` from the rows in hand. The drawn count stays 2,000
 * and the note still names both numbers. The probe row bounds the RESPONSE; it
 * is not what makes truncation detectable once an unbounded one has arrived.
 * So in this file the `$top` is graded by the `$top` assertion and by nothing
 * else — which is the reason that assertion is not redundant with the note.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NON_GRID_ROW_CEILING, nonGridRowCeilingQuery } from '@object-ui/core';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The bar canvas is irrelevant here — every assertion is about how many rows
// reached the chart and what the component says about them. Same stub the
// sibling ObjectGantt tests use, for the same reason.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view" data-task-count={String(tasks.length)} />
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

/** The whole filtered result set the store holds. */
const TOTAL_ROWS = 4321;

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    subject: `Task ${i + 1}`,
    visible_from: '2026-01-01',
    due_date: '2026-12-31',
  }));
}

let calls: Array<Record<string, any>> = [];

/** An adapter that HONOURS `$top`, the way a real one does. */
function makeDataSource(storeSize: number) {
  const store = makeRows(storeSize);
  return {
    find: vi.fn(async (_resource: string, params: any) => {
      calls.push({ ...(params ?? {}) });
      const top = typeof params?.$top === 'number' ? params.$top : store.length;
      return { data: store.slice(0, top), total: store.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'duly_task',
      fields: {
        id: { name: 'id', type: 'text' },
        subject: { name: 'subject', type: 'text' },
        visible_from: { name: 'visible_from', type: 'date' },
        due_date: { name: 'due_date', type: 'date' },
      },
    })),
  } as any;
}

const schema: any = {
  type: 'object-gantt',
  objectName: 'duly_task',
  gantt: {
    titleField: 'subject',
    startDateField: 'visible_from',
    endDateField: 'due_date',
  },
};

describe('objectui#7210 ruling a′ — the gantt draws at most the platform ceiling, loudly', () => {
  beforeEach(() => {
    calls = [];
  });

  it('above the ceiling: draws exactly N rows and names BOTH N and M', async () => {
    const dataSource = makeDataSource(TOTAL_ROWS);

    render(<ObjectGantt schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe(
        String(NON_GRID_ROW_CEILING),
      ),
    );

    // The fetch asked for one probe row past the ceiling — that is what makes
    // the cut a fact about the rows in hand rather than a guess.
    expect(calls.length).toBeGreaterThan(0);
    for (const params of calls) {
      expect(params.$top).toBe(nonGridRowCeilingQuery().$top);
    }

    // ⭐ The half the ruling cares about: the truncation is NOT silent.
    const note = await screen.findByRole('note');
    expect(note.getAttribute('data-row-ceiling-note')).toBe('non-grid');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(TOTAL_ROWS));
    expect(note.textContent).toMatch(/narrow the filter/i);
  });

  it('below the ceiling: the full set draws and there is NO footnote', async () => {
    const dataSource = makeDataSource(7);

    render(<ObjectGantt schema={schema} dataSource={dataSource} />);

    await waitFor(() =>
      expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe('7'),
    );
    expect(screen.queryByRole('note')).toBeNull();
  });

  /**
   * ⚠️ THIS CASE WAS INVERTED (objectui#8769). It used to read "an inline
   * `value` data set is never capped by us, and never footnoted", and it was
   * green because `reload` returned before the query — the same short-circuit
   * that dropped an authored `filter` on that provider. It pinned the
   * SHORT-CIRCUIT, not ruling a′: the ruling's budget is measured in DOM
   * ELEMENTS PER RECORD, its own measurement table was taken over "real child
   * views, inline `value` provider", and its text carves out no provider. An
   * inline row costs the browser exactly what a fetched row costs.
   *
   * The inline provider's own three-key pin lives in
   * `ObjectGantt.inlineQueryKeys-8769.test.tsx`; this one stays here so the
   * ceiling's own file states the exemption boundary in one place.
   */
  it('an inline `value` data set IS capped, and says so', async () => {
    const total = nonGridRowCeilingQuery().$top + 500;
    const inline: any = {
      ...schema,
      data: { provider: 'value', items: makeRows(total) },
    };

    render(<ObjectGantt schema={inline} />);

    await waitFor(() =>
      expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe(
        String(NON_GRID_ROW_CEILING),
      ),
    );
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(total));
  });

  /**
   * The exemption that REMAINS, and the reason the case above is not a
   * contradiction: rows a HOST component hands down through the `data` prop
   * are not ours to cap — we did not issue the query that produced them and
   * have no `total` to name in a footnote.
   */
  it('a host `data` prop is still never capped, and never footnoted', async () => {
    const rows = makeRows(nonGridRowCeilingQuery().$top + 500);

    render(<ObjectGantt schema={schema} {...({ data: rows } as any)} />);

    await waitFor(() =>
      expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe(
        String(rows.length),
      ),
    );
    expect(screen.queryByRole('note')).toBeNull();
  });
});
