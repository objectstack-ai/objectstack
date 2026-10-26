/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8797 — every row on the swimlane axis has the SAME scroll RANGE.
 *
 * ## What broke
 *
 * objectui#8448 gave the board one horizontal axis: a scroll handler copies
 * `scrollLeft` from whichever row the user drove onto every other row. Equal
 * `scrollLeft` is equal ALIGNMENT only while the rows have the same scrollable
 * RANGE, and they did not. The lane content rows carried `px-2`; the header row
 * did not. `scrollLeft`'s maximum is `scrollWidth - clientWidth`, so the lane
 * rows' maximum was larger. Driven to a lane's maximum, the header row CLAMPED
 * at its own smaller one and every column title sat off its column — and stayed
 * there, because nothing moves again until the user scrolls back.
 *
 * Measured in Chromium 1194 at 1600x1000, five columns and six swimlanes, real
 * Tailwind CSS, the axis driven through the real input pipeline (`mouse.wheel`,
 * not an assignment — see the warning below):
 *
 *   before   header max scrollLeft 288 | lane max 298 | worst title/cell dx 9px
 *   after    header max scrollLeft 296 | lane max 298 | worst title/cell dx 1px
 *
 * 1px is the baseline objectui#7303 and objectui#8448 already record: the lane
 * content row sits inside the lane's `border rounded-lg` wrapper, so it starts
 * 1px right of the header row. That same border is why the two maxima are still
 * 2px apart after the fix — `clientWidth` 1550 against 1552. That 2px is NOT
 * padding and is not closable from the class lists this file guards; it is
 * reported on objectui#8797 rather than papered over with a magic offset.
 *
 * ## ⚠️ What this file can and cannot measure — read before extending it
 *
 * Vitest runs here in happy-dom, which performs NO layout and applies NO CSS.
 * `scrollWidth`, `clientWidth` and every `scrollLeft` MAXIMUM are therefore
 * indistinguishable between the broken build and the fixed one — the numbers
 * above cannot be reproduced here, and asserting them would be a pin that
 * cannot fail. That half is out-of-band browser work and is reported in the PR,
 * exactly as objectui#7303, objectui#8448 and objectui#8449 all document for
 * this surface.
 *
 * What IS mechanically true here is the CLASS CONTRACT that decides the range.
 * This file pins it as an INVARIANT rather than a spelling: it never asserts
 * that a row carries `px-2`, only that every row on the axis carries the SAME
 * horizontal padding as every other. A future re-spelling of the padding stays
 * green; a future DIVERGENCE between the two kinds of row goes red, which is
 * the whole defect class.
 *
 * ## ⚠️ Why this file does NOT re-assert propagation
 *
 * objectui#8448's pin drives a `fireEvent.scroll` and asserts the rows end up
 * with equal `scrollLeft`. That is exactly the assertion that could not see
 * this bug: a clamp only happens PAST the header row's own maximum, and
 * happy-dom has no maxima, so propagation is satisfied at every value. Pinning
 * propagation again here would reproduce the blind spot that let objectui#8797
 * through. Propagation stays objectui#8448's; range is this file's.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, within } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`. Module scope, not a hook: the import IS the
// registration (AGENTS.md's test-discipline section).
import '../index';
// Same specifier as `index.tsx`'s lazy factory, so ESM's module cache resolves
// the chunk immediately instead of racing a `waitFor` budget (objectui#3010).
import '../KanbanImpl';

afterEach(cleanup);

/** The viewport the browser numbers in the docblock were read at. */
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

const SWIMLANES = { grouping: { fields: [{ field: 'owner' }] } };

/** Every row that declares itself part of the board's shared horizontal axis. */
const axisRows = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('[data-swimlane-scroll-row]')];

/** `sm:pl-44` -> `pl-44`; a bare utility is returned unchanged. */
const utility = (token: string): string => token.slice(token.lastIndexOf(':') + 1);

/**
 * The classes that move a box's HORIZONTAL padding, and therefore its
 * `scrollWidth`: `p-*`, `px-*`, `pl-*`, `pr-*`, `ps-*`, `pe-*`. Deliberately
 * NOT `py-*` / `pt-*` / `pb-*` — the header row's `pt-3 sm:pt-4` and the lane
 * rows' `pb-3` are vertical, legitimately differ, and are objectui#8449's.
 */
const isHorizontalPadding = (token: string): boolean => /^p(?:[xlrse])?-/.test(utility(token));

/** Whatever decides the gap between columns, which also moves `scrollWidth`. */
const isGap = (token: string): boolean => /^gap(?:-x)?-/.test(utility(token));

const classesMatching = (el: HTMLElement, pred: (t: string) => boolean): string[] =>
  el.className.split(/\s+/).filter(Boolean).filter(pred).sort();

/**
 * Render a swimlane board and prove it is a real one before anything is read
 * off it: the region, both lanes, and a card INSIDE a lane.
 */
async function renderSwimlaneBoard() {
  const { container } = render(
    <SchemaRendererProvider dataSource={makeAdapter() as any}>
      <SchemaRenderer schema={{ ...BOARD, data: ROWS, ...SWIMLANES } as never} />
    </SchemaRendererProvider>,
  );

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

  return { container, region };
}

describe('objectui#8797 — every row on the swimlane axis has the same scroll range', () => {
  it('RANGE — the header row and every lane row carry the SAME horizontal padding', async () => {
    const { region } = await renderSwimlaneBoard();

    const rows = axisRows(region);
    // CONTROL — one header row + one row per lane, header row first.
    expect(rows.length, 'header row + one row per lane').toBe(3);
    expect(rows[0]).toBe(region.firstElementChild);

    const [headerRow, ...laneRows] = rows;
    const headerPadding = classesMatching(headerRow, isHorizontalPadding);

    // NON-VACUITY — "the sets agree" is trivially true of two empty sets. The
    // rows are indented off the lane labels, so this can never legitimately be
    // empty; if it is, the pin below is comparing nothing.
    expect(
      headerPadding.length,
      'the axis rows must carry horizontal padding at all, or this pin compares two empty sets',
    ).toBeGreaterThan(0);

    // THE INVARIANT. Not "the header row carries px-2" — that would pin a
    // spelling. Every row on one axis must agree with every other, whatever
    // the spelling, because that agreement IS the equal range.
    for (const [i, laneRow] of laneRows.entries()) {
      expect(
        classesMatching(laneRow, isHorizontalPadding),
        `lane row ${i} must carry the same horizontal padding as the column-header row, ` +
          'or its scrollable range differs and the shared scrollLeft clamps on one of them (objectui#8797)',
      ).toEqual(headerPadding);
    }
  });

  it('RANGE — the axis rows also agree on the gap, the other class-level input to scrollWidth', async () => {
    const { region } = await renderSwimlaneBoard();

    const [headerRow, ...laneRows] = axisRows(region);
    const headerGap = classesMatching(headerRow, isGap);

    expect(headerGap.length, 'the columns are laid out with a gap utility').toBeGreaterThan(0);

    // Padding is what objectui#8797 actually caught, but it is not the only
    // class that moves `scrollWidth`. A divergent gap would reintroduce the
    // same clamp by a different route. (Column WIDTH is objectui#8508's, which
    // pins both rows onto one `columnWidthClasses` source.)
    for (const [i, laneRow] of laneRows.entries()) {
      expect(
        classesMatching(laneRow, isGap),
        `lane row ${i} must space its columns exactly as the header row does (objectui#8797)`,
      ).toEqual(headerGap);
    }
  });

  it('NON-VACUITY — the rows are still scroll containers, so they still HAVE a range', async () => {
    const { region } = await renderSwimlaneBoard();

    // A row that cannot scroll has no range, and two rows that cannot scroll
    // agree about their padding for free. objectui#8448 refused "make the
    // header row unscrollable" as arm C and objectui#7303's shrink arithmetic
    // depends on these rows being scroll containers; this re-reads that so the
    // equality above cannot be satisfied by deleting the axis.
    for (const row of axisRows(region)) {
      expect(
        row.className.split(/\s+/).some((t) => /^(?:[a-z]+:)*overflow(?:-x)?-(?:auto|scroll)$/.test(t)),
        `a row on the shared axis must still be a scroll container; class was ${JSON.stringify(row.className)}`,
      ).toBe(true);
    }
  });
});
