/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8508 — container-aware column sizing must reach BOTH board layouts.
 *
 * ## What was wrong
 *
 * `KanbanBoardInner` derives `columnInlineStyle` from the board's own slot
 * (`useResizeObserver` on a wrapper that encloses both layouts) so an embedded
 * board — a panel, a drawer, a pop-out window — sizes to its slot instead of
 * the viewport. The docblock over it said this "replaces hard-coded
 * `w-[85vw] sm:w-80`". It had exactly one consumer: the flat layout's
 * `KanbanColumnView`. The swimlane layout, which paints plain column cells
 * itself and has no column components to inherit from, still hard-coded the
 * viewport classes on both its header cells and its lane cells — so the
 * sentence was true of one of the two layouts, and the embedded case the
 * feature exists for was still viewport-sized whenever swimlanes were on.
 *
 * ## What this file pins, and why it is a PROP and not a measurement
 *
 * The width here is an inline style computed in JS, not a layout result, so it
 * is readable without a browser. That matters: the sibling pin
 * `swimlaneColumnHeaderRow-7303.test.tsx` documents at length that the #7303
 * defect was a real *rendered height* and could only be caught in Chromium at
 * 1600x1000 — happy-dom performs no layout, so every height here is 0 for
 * healthy and broken markup alike. Nothing below reads a rendered dimension.
 *
 * The pin is stated as a SOURCE identity rather than a list of blessed numbers:
 * at a given board width, a swimlane header cell and a swimlane lane cell must
 * carry the same width a flat column carries. The tier values are asserted too,
 * on both sides, so the identity cannot be satisfied by both layouts breaking
 * together.
 *
 * ## How the fixture supplies a board width — deliberate, and it has 3 states
 *
 * happy-dom does no layout: `getBoundingClientRect()` is 0x0 for every element,
 * and a `ResizeObserver` (happy-dom's own, or the no-op polyfill in
 * `vitest.setup.base.ts`) never fires without one. The single channel into
 * `boardWidth` is therefore the ONE synchronous `getBoundingClientRect()` read
 * `useResizeObserver` performs inside its effect — so the fixture stubs
 * `Element.prototype.getBoundingClientRect` for the duration of a render and
 * restores it after.
 *
 * A fixture that simply omits that stub is NOT "the small board" — it is the
 * `if (!boardWidth) return {}` early-out, a THIRD state in which
 * `columnInlineStyle` is `{}` and the viewport classes are the correct
 * behaviour. That state is pinned separately, on both layouts, and never used
 * as a stand-in for a sized one. `assertHarnessIsLive` guards the direction
 * that would otherwise pass silently: if the stub stopped reaching the hook,
 * every sized case would quietly become the third state.
 *
 * ## Non-regression axis (the caricature)
 *
 * The caricature is deleting the viewport classes outright, leaving swimlane
 * cells with no width from any source. It passes any "the cell no longer
 * carries `w-[85vw]`" assertion, so no assertion here is of that shape: every
 * sized case demands a real positive width from the container-derived source,
 * and the unsized case demands the viewport classes be present. The flat layout
 * is asserted in the same cases, so a change that sized swimlane cells by
 * breaking flat ones cannot pass either.
 *
 * Nothing below navigates by the width class being changed. Cells are reached
 * through structure and accessible names — the swimlane region's aria-label,
 * the header row's position, a lane list's aria-label, a flat column's
 * `role="group"` — none of which any width mutation can erase.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
// The board under test. Imported directly rather than through the registry:
// the defect is entirely inside this module's two layout branches, and the
// lazy/schema route adds an async boundary this pin has no use for.
import KanbanBoard from '../KanbanImpl';
import type { KanbanColumn } from '../types';

afterEach(cleanup);

const LANE_FIELD = 'owner';

const COLUMNS: KanbanColumn[] = [
  {
    id: 'open',
    title: 'Open',
    cards: [{ id: 'a', title: 'Alpha deal', [LANE_FIELD]: 'ann' }],
  },
  {
    id: 'won',
    title: 'Won',
    cards: [{ id: 'b', title: 'Beta deal', [LANE_FIELD]: 'bob' }],
  },
];

/**
 * Give every element a rect of this width for the duration of `fn`.
 *
 * Blunt on purpose: `useResizeObserver` reads the rect of exactly one node here
 * (the board wrapper), and nothing else in this render path reads a rect at all
 * — dnd-kit measures only while dragging. A narrower stub would have to name
 * the node, which means finding it, which means navigating by something the
 * component could legitimately change.
 */
function withBoardWidth<T>(width: number, fn: () => T): T {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return {
      width,
      height: 600,
      top: 0,
      left: 0,
      right: width,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
  try {
    return fn();
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}

function renderBoard(opts: { width?: number; swimlanes: boolean }) {
  const run = () =>
    render(
      <KanbanBoard
        columns={COLUMNS}
        swimlaneField={opts.swimlanes ? LANE_FIELD : undefined}
      />,
    );
  return opts.width == null ? run() : withBoardWidth(opts.width, run);
}

/** The swimlane region, by its accessible name. */
function swimlaneRegion(container: HTMLElement): HTMLElement {
  const region = container.querySelector<HTMLElement>(
    '[role="region"][aria-label="Kanban board with swimlanes"]',
  );
  expect(region, 'the fixture must render the SWIMLANE layout, not the flat one').not.toBeNull();
  return region as HTMLElement;
}

/**
 * The header cell for a column title.
 *
 * The header row is the swimlane region's first child (the titles are drawn
 * once, above every lane — see the sibling #7303 pin); the cell is the child of
 * that row whose text is the column's title.
 */
function headerCell(region: HTMLElement, title: string): HTMLElement {
  const headerRow = region.firstElementChild as HTMLElement;
  expect(headerRow, 'the swimlane region must have a header row as its first child').not.toBeNull();
  const cell = [...headerRow.children].find((c) => c.textContent?.startsWith(title));
  expect(
    cell,
    `no swimlane header cell for ${title}; row text was ${JSON.stringify(headerRow.textContent)}`,
  ).toBeDefined();
  return cell as HTMLElement;
}

/** The lane cell holding one column's cards for one lane, by the list's name. */
function laneCell(region: HTMLElement, column: string, lane: string): HTMLElement {
  const list = region.querySelector<HTMLElement>(
    `[role="list"][aria-label="${column} - ${lane} cards"]`,
  );
  expect(list, `no lane list for ${column} / ${lane}`).not.toBeNull();
  return list!.parentElement as HTMLElement;
}

/** The flat layout's column root — the element `columnStyle` lands on. */
function flatColumn(container: HTMLElement, title: string): HTMLElement {
  const col = container.querySelector<HTMLElement>(`[role="group"][aria-label="${title}"]`);
  expect(col, `no flat column for ${title}`).not.toBeNull();
  return col as HTMLElement;
}

/** Class tokens, so "carries the viewport classes" is a set question. */
const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);
const VIEWPORT_WIDTH_TOKEN = /^(?:[a-z]+:)?w-(?:\[85vw\]|80)$/;
const carriesViewportWidth = (el: Element): boolean => tokens(el).some((t) => VIEWPORT_WIDTH_TOKEN.test(t));

/**
 * Controls that make every reading below non-vacuous: a real swimlane board,
 * with real lanes, holding a real card inside the very cell being measured.
 * "The cell has no `w-[85vw]`" is trivially true of a board that rendered
 * nothing.
 */
function assertSwimlaneBoardIsReal(container: HTMLElement) {
  const region = swimlaneRegion(container);
  const laneButtons = [...region.querySelectorAll('button[aria-expanded]')];
  expect(
    laneButtons.map((b) => b.textContent),
    'both lanes should render with their collapse buttons',
  ).toEqual(['▶ann(1)', '▶bob(1)']);
  const cell = laneCell(region, 'Open', 'ann');
  expect(
    within(cell).queryAllByText('Alpha deal').length,
    'the measured lane cell should hold its card',
  ).toBe(1);
}

/**
 * The harness control for the SIZED cases.
 *
 * Every sized assertion below is downstream of one synchronous rect read
 * reaching `useResizeObserver`. If that channel ever closes — a hook rewrite, a
 * happy-dom change, a `ResizeObserver` that stops existing — `boardWidth` falls
 * to 0, `columnInlineStyle` becomes `{}`, and the suite would be silently
 * re-measuring the third state instead of the tiers. This asserts the channel
 * is open, on the layout that already worked.
 */
function assertHarnessIsLive(width: number, expected: number) {
  expect(
    typeof ResizeObserver,
    'useResizeObserver bails out entirely when ResizeObserver is undefined',
  ).not.toBe('undefined');
  const { container } = renderBoard({ width, swimlanes: false });
  expect(
    flatColumn(container, 'Open').style.width,
    `the fixture failed to give the board a width of ${width}px: the flat column, ` +
      `which consumed columnInlineStyle before objectui#8508 and after it, shows no inline width`,
  ).toBe(`${expected}px`);
  cleanup();
}

/**
 * The three tiers of `columnInlineStyle`, on both sides of each breakpoint so a
 * re-curved table cannot pass, plus the `Math.max(…, 220)` floor of the first.
 */
const TIERS: Array<{ board: number; expected: number; note: string }> = [
  { board: 240, expected: 220, note: 'tier 1, below the floor' },
  { board: 360, expected: 328, note: 'tier 1, board minus gutter' },
  { board: 479, expected: 447, note: 'tier 1, last width before the break' },
  { board: 480, expected: 280, note: 'tier 2, first width of the break' },
  { board: 719, expected: 280, note: 'tier 2, last width before the break' },
  { board: 720, expected: 320, note: 'tier 3, first width of the break' },
  { board: 1400, expected: 320, note: 'tier 3, a wide board' },
];

describe('objectui#8508 — container-aware column width reaches the swimlane layout', () => {
  it.each(TIERS)(
    'swimlane header cell and lane cell take the flat column width at $board px ($note)',
    ({ board, expected }) => {
      // The reference reading, from the layout that always consumed the value.
      assertHarnessIsLive(board, expected);

      const { container } = renderBoard({ width: board, swimlanes: true });
      assertSwimlaneBoardIsReal(container);
      const region = swimlaneRegion(container);

      for (const [what, cell] of [
        ['header cell', headerCell(region, 'Open')],
        ['lane cell', laneCell(region, 'Open', 'ann')],
      ] as const) {
        // POSITIVE — a real width, from the container-derived source. Deleting
        // the viewport classes without wiring the width leaves this empty, so
        // this reading is what makes the caricature fail rather than pass.
        // Deliberately NOT paired with a `parseFloat(...) > 0` companion: that
        // companion is implied by this equality and can never fail while this
        // one passes, which would ship a line that reads as a second axis and
        // is not one.
        expect(
          cell.style.width,
          `the swimlane ${what} should take its width from columnInlineStyle, the same source ` +
            `a flat column reads at this board width — a real positive width, not merely the ` +
            `absence of the viewport classes (objectui#8508)`,
        ).toBe(`${expected}px`);

        // And the viewport classes must step aside rather than fight it —
        // the same two-way switch KanbanColumnView has always applied.
        expect(
          carriesViewportWidth(cell),
          `the swimlane ${what} still carries a viewport-relative width class alongside the ` +
            `container-derived inline width; class was ${JSON.stringify(cell.className)}`,
        ).toBe(false);
      }
    },
  );

  it('NON-REGRESSION — the flat layout still sizes its columns from the same value', () => {
    for (const { board, expected } of TIERS) {
      const { container } = renderBoard({ width: board, swimlanes: false });
      expect(
        container.querySelector('[role="region"]')?.getAttribute('aria-label'),
        'this case must exercise the FLAT layout',
      ).toBe('Kanban board');
      for (const title of ['Open', 'Won']) {
        const col = flatColumn(container, title);
        expect(col.style.width, `flat column ${title} at ${board}px`).toBe(`${expected}px`);
        expect(carriesViewportWidth(col), `flat column ${title} at ${board}px`).toBe(false);
        expect(
          within(col).queryAllByText(title).length,
          'the measured column should still render its own heading',
        ).toBe(1);
      }
      cleanup();
    }
  });

  it('THIRD STATE — with no measured board width, both layouts keep the viewport classes', () => {
    // `if (!boardWidth) return {}`. This is not "a small board": it is the
    // pre-observation / SSR state, where the viewport classes are correct and
    // their absence would leave a cell with no width at all — the caricature.
    const swim = renderBoard({ swimlanes: true });
    assertSwimlaneBoardIsReal(swim.container);
    const region = swimlaneRegion(swim.container);
    for (const [what, cell] of [
      ['header cell', headerCell(region, 'Open')],
      ['lane cell', laneCell(region, 'Open', 'ann')],
    ] as const) {
      expect(
        cell.style.width,
        `unmeasured board: the swimlane ${what} must not invent an inline width`,
      ).toBe('');
      expect(
        carriesViewportWidth(cell),
        `unmeasured board: the swimlane ${what} must fall back to the viewport width classes, ` +
          `or it renders with no width from any source; class was ${JSON.stringify(cell.className)}`,
      ).toBe(true);
    }
    cleanup();

    const flat = renderBoard({ swimlanes: false });
    const col = flatColumn(flat.container, 'Open');
    expect(col.style.width, 'unmeasured board: the flat column must not invent an inline width').toBe('');
    expect(
      carriesViewportWidth(col),
      'unmeasured board: the flat column must fall back to the viewport width classes',
    ).toBe(true);
  });
});
