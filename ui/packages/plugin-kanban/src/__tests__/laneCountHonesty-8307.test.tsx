/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8307 — a lane header over a WINDOWED fetch must not paint a bare
 * number that reads as the size of the group.
 *
 * ## The defect this pins, and why it is the expensive kind
 *
 * `object-kanban` fetches with a real `$top` (objectui#4025) and then groups
 * WHAT CAME BACK into lanes client-side, so `col.cards.length` is a count of
 * fetched rows that fell into this lane. Over any object holding more rows
 * than the window every lane number is wrong and they sum to the window.
 * Measured in a consuming app on 200 records: the board displayed
 * 77 / 19 / 2 against a true 88 / 46 / 28 / 14 / 9 / 15.
 *
 * The numbers LOOK right — 77 / 19 / 2 is a plausible funnel — and there was
 * no ellipsis, no styling difference, nothing to distrust. A wrong number
 * with no tell is the one that reaches a status report.
 *
 * ## What is asserted, and why it is rendered output rather than a flag
 *
 * Every row below reads the header the way a person reads it: the text of the
 * count node, after a real `find` has resolved. A boolean prop threaded
 * correctly and then dropped one render short of the DOM would satisfy any
 * flag-shaped assertion and would ship the identical silent board.
 *
 * The claim being pinned is the honest one and only that one: `77+` — "at
 * least 77", which is exactly what a count over a window establishes. This
 * file does NOT assert a group total; nobody on this side of the wire has
 * one, and getting one means a server-side group-count aggregate over the
 * whole filtered set (the card's option 1, deliberately not this change).
 *
 * ## The boundary row is the point of the file, not an afterthought
 *
 * The marker is driven by SATURATION — the fetch came back with at least as
 * many rows as it asked for. A board whose object holds EXACTLY the window is
 * indistinguishable from a truncated one from here: both return `window`
 * rows, and no further client-side signal separates them. `BOUNDARY` below
 * fixes which way that ambiguity is resolved and why that direction is the
 * safe one: `4+` on a lane that really holds 4 is a TRUE statement, while the
 * bare `4` on a board that is really truncated is a FALSE one. The marker is
 * conservative; it is never wrong. Changing that row means arguing the
 * opposite, in writing.
 *
 * ## The controls
 *
 * `UNSATURATED` and `INLINE` are what make the marker a verdict instead of an
 * unconditional suffix. Without them a component that appended `+` to every
 * count on every board would pass every other row in this file.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`. Module scope, not a hook: the import IS the
// registration (AGENTS.md's test-discipline section).
import '../index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget (objectui#3010).
import '../KanbanImpl';

afterEach(cleanup);

const OBJECT = 'application';

const OBJECT_SCHEMA = {
  name: OBJECT,
  label: 'Application',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
    source: { type: 'text', label: 'Source' },
  },
};

/**
 * The authored window. Small on purpose — the defect is a ratio, not a
 * magnitude, and `4` reproduces `100` exactly while keeping the DOM readable.
 */
const WINDOW = 4;

/** Rows shaped like the measured case: one crowded lane, one thin one. */
function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    name: `Candidate ${i}`,
    // 3 : 1 within the first four rows, so the two lanes carry different
    // counts and a marker cannot be confused with a shared constant.
    stage: i < 3 ? 'screen' : 'offer',
    source: i % 2 === 0 ? 'referral' : 'inbound',
  }));
}

function makeAdapter(returned: any[]): Record<string, any> {
  return {
    find: vi.fn(async () => ({ data: returned })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
  };
}

const BOARD = {
  type: 'object-kanban',
  objectName: OBJECT,
  groupBy: 'stage',
  limit: WINDOW,
  columns: [
    { id: 'screen', title: 'Screen' },
    { id: 'offer', title: 'Offer' },
  ],
};

function renderBoard(adapter: Record<string, any>, extra: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={{ ...BOARD, ...extra } as any} />
    </SchemaRendererProvider>,
  );
}

/**
 * The text a person reads in one flat column header.
 *
 * Anchored on the header's own `id`, which `KanbanColumnView` owns, and then
 * on the first `<span>` of the controls beside it — the count badge. Reading
 * the whole board's `textContent` would not do: `'3'` is a substring of
 * `'3+'`, so a bare-number assertion written that way can never fail.
 */
function flatLaneCount(container: HTMLElement, columnId: string): string {
  const title = container.querySelector(`#kanban-col-${columnId}`);
  if (!title || !title.parentElement) throw new Error(`no flat header for ${columnId}`);
  const badge = title.parentElement.querySelector('span');
  if (!badge) throw new Error(`no count badge for ${columnId}`);
  return (badge.textContent ?? '').trim();
}

/** Wait until the board has painted its headers from a resolved `find`. */
async function settled(adapter: Record<string, any>, container: HTMLElement) {
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  await waitFor(() => expect(container.querySelector('#kanban-col-screen')).not.toBeNull());
}

describe('objectui#8307 — lane counts over a windowed fetch say what they mean', () => {
  it('WINDOWED: a saturated fetch paints `3+` / `1+`, never a bare `3` / `1`', async () => {
    // The board asked for 4 rows and got 4. There may be a hundred more; this
    // component cannot know, and the numbers it holds are lower bounds.
    const adapter = makeAdapter(rows(WINDOW));
    const { container } = renderBoard(adapter);
    await settled(adapter, container);

    await waitFor(() => expect(flatLaneCount(container, 'screen')).toBe('3+'));
    expect(flatLaneCount(container, 'offer')).toBe('1+');

    // Non-vacuity for the two lines above: the request really was windowed, so
    // `3+` is a verdict about a window rather than a decoration.
    const params = adapter.find.mock.calls[0][1] ?? {};
    expect(params.$top).toBe(WINDOW);
  });

  it('UNSATURATED CONTROL: a fetch that came back short keeps the bare number', async () => {
    // Fewer rows than the cap allowed is the one case where the client KNOWS
    // the result set was exhausted — and there the bare number is the truth.
    // Without this row, appending `+` to every count on every board would pass
    // every other assertion in this file.
    const adapter = makeAdapter(rows(WINDOW - 1));
    const { container } = renderBoard(adapter);
    await settled(adapter, container);

    await waitFor(() => expect(flatLaneCount(container, 'screen')).toBe('3'));
    expect(flatLaneCount(container, 'offer')).toBe('0');
  });

  it('BOUNDARY: a board holding EXACTLY the window still says `3+`, and that is the honest half', async () => {
    // This is the `rows.length === limit` case the card names, and it is the
    // one that cannot be decided from here: an object holding exactly 4 rows
    // and an object holding 4000 both answer a `$top: 4` query with 4 rows.
    //
    // The DIRECTION of the resolution is what this row fixes. Rendering `3+`
    // for a lane that really holds 3 is conservative and TRUE — "at least 3"
    // holds when the count is 3. Rendering the bare `3` would be FALSE on
    // every truncated board, which is the defect. A cheaper-looking heuristic
    // (asking for `limit + 1` rows and displaying `limit`) buys the difference
    // at the price of changing what reaches the wire, which is a contract this
    // card does not open — objectui#4025 pins `$top` to the authored window.
    const exactlyTheWindow = rows(WINDOW);
    const adapter = makeAdapter(exactlyTheWindow);
    const { container } = renderBoard(adapter);
    await settled(adapter, container);

    await waitFor(() => expect(flatLaneCount(container, 'screen')).toBe('3+'));
    // The true count of this lane IS 3. The marker does not misstate it; it
    // declines to promise it is the whole group, which is all the board knows.
    expect(exactlyTheWindow.filter((r) => r.stage === 'screen')).toHaveLength(3);
  });

  it('INLINE CONTROL: rows handed to the board whole keep the bare number', async () => {
    // Inline `data` never passed through this board's window, so it has
    // nothing truthful to say about whether anyone else truncated it.
    const adapter = makeAdapter(rows(WINDOW));
    const { container } = renderBoard(adapter, { data: rows(WINDOW), objectName: undefined });
    await waitFor(() => expect(container.querySelector('#kanban-col-screen')).not.toBeNull());

    await waitFor(() => expect(flatLaneCount(container, 'screen')).toBe('3'));
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('SWIMLANES: the second header implementation is marked too, on both its rows', async () => {
    // The swimlane layout paints its own column-title row and its own lane
    // rows — `KanbanColumnView` is not involved. A fix that reached only the
    // flat path would leave a board that is honest in one layout and silently
    // wrong in the other, which is the same defect with a smaller blast
    // radius (objectui#8508 is the precedent for that split going unnoticed).
    const adapter = makeAdapter(rows(WINDOW));
    const { container } = renderBoard(adapter, { swimlaneField: 'source' });
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Kanban board with swimlanes"]')).not.toBeNull(),
    );

    // Column-title row: `(3+)` and `(1+)`, parenthesised by that layout.
    await waitFor(() => expect(container.textContent).toContain('(3+)'));
    expect(container.textContent).toContain('(1+)');

    // Lane rows: `referral` holds rows 0 and 2, `inbound` rows 1 and 3.
    expect(container.textContent).toContain('(2+)');

    // And no header on this layout kept a bare parenthesised count.
    for (const n of ['(0)', '(1)', '(2)', '(3)', '(4)']) {
      expect(container.textContent).not.toContain(n);
    }
  });
});
