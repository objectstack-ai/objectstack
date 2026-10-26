/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7303 — a swimlane board must keep its column-header row.
 *
 * ## What broke
 *
 * With swimlanes on (`grouping.fields[0].field`, the only authorable route —
 * `KanbanConfigSchema` is strict and rejects `kanban.swimlaneField`), the five
 * column titles stayed in the DOM, at the right coordinates, and painted
 * nothing. The board became a card wall with no way to tell Open from Done.
 *
 * The cause is a flexbox rule, not a paint bug. The header row is a flex ITEM
 * of the swimlane region (`flex-col`, inside a height-bounded `h-full` board).
 * `overflow-x-auto` makes it a scroll container, and a flex item's automatic
 * minimum size (`min-height: auto`) applies only while its overflow is
 * `visible` — so a scroll container may legally be shrunk to height 0. The
 * lanes below stay `overflow: visible`, so their automatic minimum size clamps
 * them at content height and they refuse to shrink; the moment the lanes
 * overflow the board, the ENTIRE deficit lands on the one shrinkable item.
 * `shrink-0` takes the header row out of that pool.
 *
 * ## ⚠️ What this file can and cannot measure — read before extending it
 *
 * The bug is VISUAL and the honest reading of it is a measured height. Vitest
 * runs here in happy-dom, which performs NO layout: every
 * `getBoundingClientRect()` in this environment is 0×0 for the collapsed row,
 * the healthy row, and a row that was never rendered alike. So a height
 * assertion here would be a pin that CANNOT fail, which is worse than no pin —
 * it converts an open bug into a green claim. This file therefore asserts the
 * STYLE CONTRACT that decides the height, and states the invariant rather than
 * one blessed spelling: the header row must not be BOTH a scroll container and
 * shrinkable. Removing `shrink-0` reddens it; so does dropping the row's
 * height by any other route that leaves it in the shrink pool.
 *
 * The real height was measured out-of-band in Chromium 1194 at 1600×1000, on
 * this component's own rendered markup with Tailwind-generated CSS, with the
 * lanes overflowing the board:
 *
 *   before `shrink-0` — header row 0, header cell 0, title span 16,
 *                       `elementFromPoint` at a title's own centre returning
 *                       the lane-collapse `<button>` behind it;
 *   after  `shrink-0` — header row 24, header cell 24, title span 16,
 *                       the title winning its own hit test.
 *
 * Note the trigger: the collapse needs the lanes to OVERFLOW the board's
 * bounded height. A short board (nothing to shrink) renders the row at 24 in
 * both worlds, which is why this reads as a data-dependent "sometimes the
 * labels are missing" bug in the field.
 *
 * A CI-resident version of that measurement needs a browser and real CSS —
 * neither is available in this project. See the PR for the proposal.
 *
 * ## Non-vacuity
 *
 * "The labels are absent" is trivially true of a board that rendered nothing,
 * so every case here waits for real DOM first and pins a rendered swimlane and
 * a rendered card alongside the header row. The second case is the
 * NON-REGRESSION half: deleting the swimlane header row, or the swimlane
 * layout itself, must not read as success.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, within } from '@testing-library/react';
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
 * The viewport this fixture states.
 *
 * happy-dom's ambient window is not pinned repo-wide, so a test that reads a
 * width inherits whatever default the runner happens to carry. This board's
 * swimlane header markup is width-INDEPENDENT — its `sm:` variants are decided
 * by CSS, which happy-dom never applies — so nothing below actually branches on
 * this. It is pinned anyway so the fixture says which world it describes: the
 * desktop branch (≥ Tailwind's `sm`, 640px), the one the card measured at
 * 1600×1000. Anything added here that DOES branch on width must re-state it.
 */
const VIEWPORT = { width: 1600, height: 1000 };

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: VIEWPORT.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: VIEWPORT.height });
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

/** The declared board, minus whatever the case adds. */
const BOARD = {
  type: 'object-kanban',
  objectName: OBJECT,
  groupBy: 'status',
  columns: [
    { id: 'open', title: 'Open' },
    { id: 'won', title: 'Won' },
  ],
};

function renderBoard(extra: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={makeAdapter() as any}>
      <SchemaRenderer schema={{ ...BOARD, data: ROWS, ...extra } as never} />
    </SchemaRendererProvider>,
  );
}

/**
 * Does this element's class list make it a scroll container?
 *
 * Every non-`visible` overflow does — `clip` and `hidden` zero a flex item's
 * automatic minimum size exactly as `auto` and `scroll` do, so the invariant
 * below must not be readable as "only `overflow-x-auto` is dangerous".
 */
const OVERFLOW_TOKEN = /^(?:[a-z]+:)*overflow(?:-[xy])?-(?:auto|scroll|hidden|clip)$/;

/**
 * Does this element's class list keep it out of the flex shrink pool?
 *
 * `shrink-0` is what the fix spells, but an explicit floor (`min-h-*`, any
 * value but `min-h-0`) prevents the same collapse — so both pass. What must NOT
 * pass is a row that is shrinkable AND a scroll container.
 */
const KEEPS_ITS_HEIGHT_TOKEN = /^(?:[a-z]+:)*(?:shrink-0|flex-shrink-0|min-h-(?!0$).+)$/;

const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);

/** Left-padding tokens — what lines the header cells up with their columns. */
const indent = (el: Element): string[] => tokens(el).filter((t) => /(^|:)pl-/.test(t));

describe('objectui#7303 — swimlane column-header row', () => {
  it('renders above the lanes and stays out of the flex shrink pool', async () => {
    const { container } = renderBoard({ grouping: { fields: [{ field: 'owner' }] } });

    // CONTROL 1 — a real swimlane board, not a fallback flat one.
    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    const region = container.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Kanban board with swimlanes');

    // CONTROL 2 — the lanes rendered, with their collapse buttons.
    const laneButtons = [...region!.querySelectorAll('button[aria-expanded]')];
    expect(laneButtons.map((b) => b.textContent)).toEqual(['▶ann(1)', '▶bob(1)']);

    // CONTROL 3 — a card rendered INSIDE a lane. Without this every assertion
    // below is also satisfied by a board that painted headers over nothing.
    const laneList = region!.querySelector('[role="list"][aria-label="Open - ann cards"]');
    expect(laneList).not.toBeNull();
    expect(
      within(laneList as HTMLElement).queryByText('Alpha deal'),
      'the swimlane cell should hold its card',
    ).not.toBeNull();

    // The header row is the region's FIRST child: the titles sit ABOVE every
    // lane, which is the layout the card settles ("keeps its height and paints
    // the column titles above the lanes"). A per-lane repeat would be a
    // different product, not a fix.
    const headerRow = region!.firstElementChild as HTMLElement;

    // Read presence through `queryByText` into an `expect` that carries a
    // message: `getByText` throws before `expect` runs, so its message never
    // reaches the summary.
    for (const title of ['Open', 'Won']) {
      expect(
        within(headerRow).queryByText(title),
        `the swimlane header row should carry the column title ${title}; row text was ${JSON.stringify(headerRow.textContent)}`,
      ).not.toBeNull();
    }

    // ── THE PIN ──────────────────────────────────────────────────────────────
    // The row's existence is NOT the assertion: on the broken build the row was
    // present, in the right place, holding all five titles — at height 0. What
    // decides the height is whether the row can be shrunk while being a scroll
    // container.
    const list = tokens(headerRow);
    const isScrollContainer = list.some((t) => OVERFLOW_TOKEN.test(t));
    const keepsItsHeight =
      list.some((t) => KEEPS_ITS_HEIGHT_TOKEN.test(t)) ||
      headerRow.style.flexShrink === '0' ||
      headerRow.style.minHeight !== '';
    expect(
      isScrollContainer && !keepsItsHeight,
      `the swimlane column-header row is a scroll container AND shrinkable, so the board's ` +
        `flex-col will shrink it to height 0 as soon as the lanes overflow (objectui#7303). ` +
        `Give it \`shrink-0\` (or a min-height floor), or stop making it a scroll container. ` +
        `class was: ${JSON.stringify(headerRow.className)}`,
    ).toBe(false);

    // The header cells line up with the lane content rows below only while the
    // two carry the same left indent — so a "fix" that bought height by moving
    // the indent would leave every title over the wrong column.
    const laneContentRow = laneList!.parentElement!.parentElement!;
    expect(indent(headerRow), 'header row indent').toEqual(indent(laneContentRow));
    expect(indent(headerRow).length, 'the indent tokens must actually exist to be compared').toBeGreaterThan(0);
  });

  it('NON-REGRESSION — the flat board still renders its own per-column headings', async () => {
    // Deleting the swimlane header row, or the swimlane layout itself, would
    // satisfy "no collapsed row" while making the product strictly worse. This
    // case pins the other path's headings, which are a DIFFERENT element in a
    // different place (`<h3 id="kanban-col-…">`, inside each column) — the
    // reason the two header implementations cannot simply be merged.
    const { container } = renderBoard();

    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Kanban board');

    const heading = container.querySelector('h3#kanban-col-open');
    expect(heading, 'the flat board keeps its per-column <h3> heading').not.toBeNull();
    expect(heading!.textContent).toBe('Open');
  });
});
