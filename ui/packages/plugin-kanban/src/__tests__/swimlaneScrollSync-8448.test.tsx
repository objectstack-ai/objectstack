/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8448 — a swimlane board has ONE horizontal axis.
 *
 * ## What broke
 *
 * The swimlane layout paints its column titles once, above every lane, and each
 * lane paints its own row of column cells. Both were `overflow-x-auto`, so they
 * were INDEPENDENT scroll containers: scrolling a lane sideways moved that lane
 * and nothing else, and the titles stayed where they were. Every column label
 * then sat over a different column's cells. Nothing threw — the board simply
 * lied about which lane was which status, which is worse than the height-0
 * header row objectui#7303 fixed, because that one failed loudly.
 *
 * Measured in Chromium 1194 at 1600x1000 with five columns: driving one lane to
 * `scrollLeft: 298` left the header row at `0`, putting the `'Open'` title at
 * x=200 over an Open lane cell at x=-97. The row overflows at ordinary widths
 * there (`scrollWidth` 1840 vs `clientWidth` 1552), so this is not an 800px edge
 * case. The ruling (comment 5597568414) is **option A — one horizontal axis for
 * the whole board**: the header row and every lane row share a scroll position.
 *
 * ## ⚠️ What this file can and cannot measure — read before extending it
 *
 * The same limit objectui#7303's pin documents applies: Vitest runs here in
 * happy-dom, which performs NO layout. `getBoundingClientRect()` is 0x0 for
 * every element, so the GEOMETRIC half of the acceptance — "each column title
 * lands over its own lane cell" — cannot be asserted here; a coordinate
 * assertion would be a pin that cannot fail. That half was measured out of band
 * in Chromium and is reported in the PR.
 *
 * What IS mechanically true in happy-dom, and is what this file pins, is the
 * MECHANISM that decides those coordinates: `scrollLeft` is a plain settable
 * number, so the propagation from one row to all the others is fully
 * observable. Given the two rows carry the same left indent and the same column
 * widths — which objectui#7303's pin asserts and this file re-reads — equal
 * `scrollLeft` IS the alignment.
 *
 * ⚠️ `scrollLeft` assignment fires no `scroll` event in happy-dom (measured), so
 * every case drives the axis with an explicit `fireEvent.scroll`. That is also
 * why the propagation cannot loop here: the writes this handler makes are
 * silent.
 *
 * ## Non-vacuity
 *
 * "The rows agree" is trivially true of a board with one row, or none. Every
 * case first proves a real swimlane board — its region label, both lanes, and a
 * card rendered INSIDE a lane — and reads a row count, so a board that stopped
 * rendering lanes cannot read as success. The last case is the arm-C half: the
 * ruling refused "make the header row unscrollable", and a board whose rows are
 * no longer scroll containers would satisfy every equality above while
 * reintroducing the collapse objectui#7303 closed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`. Module scope, not a hook: the import IS the
// registration (AGENTS.md's test-discipline section).
import '../index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget (objectui#3010), same specifier as
// `index.tsx`'s factory so ESM's module cache resolves it immediately.
import '../KanbanImpl';

afterEach(cleanup);

/**
 * The viewport this fixture states — the one the card measured at.
 *
 * happy-dom never applies CSS, so nothing below branches on it; it is pinned so
 * the fixture says which world it describes (objectui#7303's pin does the same).
 */
const VIEWPORT = { width: 1600, height: 1000 };

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: VIEWPORT.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: VIEWPORT.height });
  // Collapsed lanes persist per swimlane field; a leaked entry would silently
  // change how many rows the next case renders.
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

const OBJECT = 'deal';

const DEAL_SCHEMA = {
  name: OBJECT,
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'text', label: 'Status' },
    owner: { type: 'text', label: 'Owner' },
  },
};

function makeAdapter(): Record<string, any> {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => DEAL_SCHEMA),
  };
}

const ROWS = [
  { id: 'a', name: 'Alpha deal', status: 'open', owner: 'ann' },
  { id: 'b', name: 'Beta deal', status: 'won', owner: 'bob' },
];

/**
 * Five columns, as measured. The count is load-bearing for the card's own
 * numbers (`scrollWidth` 1840 vs `clientWidth` 1552 at 1600px) even though
 * happy-dom cannot reproduce them.
 */
const BOARD = {
  type: 'object-kanban',
  objectName: OBJECT,
  groupBy: 'status',
  columns: [
    { id: 'open', title: 'Open' },
    { id: 'qualified', title: 'Qualified' },
    { id: 'proposal', title: 'Proposal' },
    { id: 'won', title: 'Won' },
    { id: 'lost', title: 'Lost' },
  ],
};

function renderBoard(extra: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={makeAdapter() as any}>
      <SchemaRenderer schema={{ ...BOARD, data: ROWS, ...extra } as never} />
    </SchemaRendererProvider>,
  );
}

const SWIMLANES = { grouping: { fields: [{ field: 'owner' }] } };

/** Every row that declares itself part of the board's shared horizontal axis. */
const axisRows = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('[data-swimlane-scroll-row]')];

/**
 * Render a swimlane board and prove it is a real one before anything is
 * measured on it: the region, both lanes, and a card inside a lane.
 */
async function renderSwimlaneBoard() {
  const { container } = renderBoard(SWIMLANES);

  await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
  const region = container.querySelector('[role="region"]') as HTMLElement;
  expect(region?.getAttribute('aria-label')).toBe('Kanban board with swimlanes');

  const laneButtons = [...region.querySelectorAll('button[aria-expanded]')];
  expect(laneButtons.map((b) => b.textContent)).toEqual(['▶ann(1)', '▶bob(1)']);

  const laneList = region.querySelector('[role="list"][aria-label="Open - ann cards"]');
  expect(
    within(laneList as HTMLElement).queryByText('Alpha deal'),
    'the swimlane cell should hold its card',
  ).not.toBeNull();

  return { container, region, laneButtons: laneButtons as HTMLElement[] };
}

describe('objectui#8448 — the swimlane board scrolls on one horizontal axis', () => {
  it('SYNC — a lane driven sideways takes the header row and the other lane with it', async () => {
    const { region } = await renderSwimlaneBoard();

    // CONTROL — one header row + one row per lane, in document order, and the
    // header row is the region's first child (the layout objectui#7303 settled).
    const rows = axisRows(region);
    expect(rows.length, 'header row + one row per lane').toBe(3);
    expect(rows[0]).toBe(region.firstElementChild);
    expect(rows.every((r) => r.scrollLeft === 0), 'the board starts unscrolled').toBe(true);

    // The card's own measurement, inverted. 298 is the value it drove a lane to.
    const [headerRow, annRow, bobRow] = rows;
    annRow.scrollLeft = 298;
    fireEvent.scroll(annRow);

    expect(
      headerRow.scrollLeft,
      'the column-header row must follow the lane, or every title sits over the wrong column (objectui#8448)',
    ).toBe(298);
    expect(bobRow.scrollLeft, 'every other lane is on the same axis').toBe(298);
    expect(annRow.scrollLeft, 'the lane the user actually scrolled keeps its position').toBe(298);
  });

  it('SHARED, not header-follows-lane — driving the header row moves the lanes', async () => {
    const { region } = await renderSwimlaneBoard();
    const [headerRow, annRow, bobRow] = axisRows(region);
    expect(axisRows(region).length).toBe(3);

    // Arm B (the header tracks an "active" lane) was refused: the axis is one
    // value, so it is drivable from either end. A one-way lane-to-header sync
    // would leave this case red.
    headerRow.scrollLeft = 140;
    fireEvent.scroll(headerRow);

    expect(annRow.scrollLeft).toBe(140);
    expect(bobRow.scrollLeft).toBe(140);
  });

  it('LATE MOUNT — a lane expanded after the board was scrolled adopts its position', async () => {
    const { region, laneButtons } = await renderSwimlaneBoard();

    // Collapse the second lane, so its row unmounts and remounts later.
    fireEvent.click(laneButtons[1]);
    await waitFor(() => expect(axisRows(region).length).toBe(2));

    const [headerRow, annRow] = axisRows(region);
    annRow.scrollLeft = 210;
    fireEvent.scroll(annRow);
    expect(headerRow.scrollLeft).toBe(210);

    fireEvent.click(laneButtons[1]);
    await waitFor(() => expect(axisRows(region).length).toBe(3));

    const reopened = axisRows(region)[2];
    expect(
      reopened.scrollLeft,
      'a lane that mounts late must join the axis where the board already is, not at 0',
    ).toBe(210);
    // The rows that were already there did not get reset by the new arrival.
    expect(axisRows(region).map((r) => r.scrollLeft)).toEqual([210, 210, 210]);
  });

  it('ARM C REFUSED / NON-REGRESSION — the rows are still scroll containers, and the flat board is not on this axis', async () => {
    const { region } = await renderSwimlaneBoard();

    // The ruling refused "remove the header row's own scrollability": the fix
    // must not be bought by making a row unscrollable, which is the shrink
    // arithmetic objectui#7303's pin exists to protect. Equal `scrollLeft` is
    // trivially satisfied by rows that can never scroll at all.
    for (const row of axisRows(region)) {
      expect(
        row.className.split(/\s+/).some((t) => /^(?:[a-z]+:)*overflow(?:-x)?-(?:auto|scroll)$/.test(t)),
        `a synced row must still be a scroll container; class was ${JSON.stringify(row.className)}`,
      ).toBe(true);
    }

    cleanup();

    // The flat layout owns its own scroller (snap-scroll, mobile dot
    // indicator). It must not be roped into the swimlane axis.
    const { container } = renderBoard();
    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    const flatRegion = container.querySelector('[role="region"]') as HTMLElement;
    expect(flatRegion.getAttribute('aria-label')).toBe('Kanban board');
    expect(flatRegion.hasAttribute('data-swimlane-scroll-row')).toBe(false);
    expect(axisRows(container).length, 'a flat board has no swimlane axis rows').toBe(0);
  });
});
