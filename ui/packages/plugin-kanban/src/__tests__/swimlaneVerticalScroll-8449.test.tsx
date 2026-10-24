/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8449 — a swimlane board's lanes must be REACHABLE.
 *
 * ## What broke
 *
 * The swimlane region was `overflow-hidden`. It is a flex item of a
 * height-bounded (`h-full`) board, and a non-`visible` overflow zeroes a flex
 * item's automatic minimum size — so the region was already being shrunk to the
 * board's height while its content stayed at full height, and `hidden` then
 * threw the remainder away. Measured in Chromium at 1600x1000 with three
 * swimlanes:
 *
 *   swimlane region          scrollHeight 2104   clientHeight 1000   overflow: hidden
 *   document.documentElement                                         not scrollable
 *
 * ⇒ two of the three lanes could not be reached by ANY gesture. Not "awkward
 * to reach": there was no scroll affordance on the region and none on the
 * document. This is a different defect class from objectui#7303 (a collapsed
 * header row) and objectui#8448 (two horizontal axes out of sync) — those are
 * about labels, this is about content the user cannot get to.
 *
 * ## The ruling (comment 5597654059), and what it makes mechanical
 *
 * **Option A — the swimlane region scrolls**, and the column-header row
 * **sticks** to the top of it.
 *
 * - **B (drop the height bound, let the page scroll) was refused on blast
 *   radius**, not merit: it converts the board from a self-contained pane into
 *   something that stretches its container, a change to what the component
 *   promises every embedder. The case below therefore also re-reads the board
 *   root's height bound — dropping it is arm B, arriving by the back door.
 * - **C (collapse lanes beyond the first N) was refused** because it changes
 *   *which* content is hidden by default without making content reachable.
 * - **The header sticks** because objectui#8448 committed the board to one
 *   horizontal axis with exactly one header row; a frozen header over a
 *   vertically scrolling body is that same table model. A header row that
 *   scrolled away with the lanes would recreate objectui#7303's defect by a
 *   different route: titles gone, cells still there.
 *
 * ## ⚠️ What this file can and cannot measure — read before extending it
 *
 * The same limit objectui#7303's and objectui#8448's pins document applies, and
 * it is the reason this file asserts style contracts rather than pixels: Vitest
 * runs here in happy-dom, which performs **no layout and applies no CSS**.
 * `scrollHeight`, `clientHeight` and `getBoundingClientRect()` are 0 for the
 * broken build, the fixed build, and a board that never rendered, alike — and
 * `position: sticky` has no observable behaviour at all without layout. So the
 * ACCEPTANCE half of this card — "with lanes overflowing the viewport every
 * lane is reachable, and the column titles stay visible over their own columns
 * while scrolling vertically" — **cannot be asserted here**. A coordinate or a
 * `scrollHeight` assertion in this environment would be a pin that cannot fail,
 * which is worse than no pin: it converts an open bug into a green claim.
 *
 * That half was measured out of band in Chromium, on this component's own
 * rendered markup with Tailwind-generated CSS, and is reported in the PR.
 *
 * What IS mechanically true in happy-dom is the class contract that DECIDES
 * that geometry, and it is decided by exactly two things: whether the region's
 * computed `overflow-y` scrolls, and whether the header row is stuck to that
 * region's scrollport with something opaque behind it. Both are pinned as
 * invariants rather than as one blessed spelling.
 *
 * ## Non-vacuity
 *
 * "Nothing is unreachable" is trivially true of a board that rendered no lanes,
 * so every case first proves a real swimlane board — its region label, both
 * lane collapse buttons, and a card rendered INSIDE a lane — before reading
 * anything. The last case is the non-regression half: the vertical arm must not
 * have been bought by disturbing the horizontal axis objectui#8448 settled, and
 * the flat board must not have been dragged into any of it.
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
 * The viewport this fixture states — the one the card measured at, and the one
 * whose 1000px height is what three lanes overflowed.
 *
 * happy-dom applies no CSS, so nothing below branches on it (the `sm:` variants
 * are decided by a stylesheet that never runs here); it is pinned so the
 * fixture says which world it describes, as objectui#7303's pin does.
 */
const VIEWPORT = { width: 1600, height: 1000 };

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: VIEWPORT.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: VIEWPORT.height });
  // Collapsed lanes persist per swimlane field; a leaked entry would silently
  // change how many lanes the next case renders, and lane COUNT is the whole
  // subject here.
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
    { id: 'won', title: 'Won' },
  ],
};

const SWIMLANES = { grouping: { fields: [{ field: 'owner' }] } };

function renderBoard(extra: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={makeAdapter() as any}>
      <SchemaRenderer schema={{ ...BOARD, data: ROWS, ...extra } as never} />
    </SchemaRendererProvider>,
  );
}

const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);

/**
 * The element's effective `overflow-y`, read out of its Tailwind classes.
 *
 * Tailwind emits the `overflow` shorthand BEFORE the per-axis utilities in the
 * utilities layer, so an axis utility wins over the shorthand regardless of the
 * order the two appear in the class attribute. Anything unrecognised reads as
 * `visible`, the CSS initial value — which is a FAILING value for the region,
 * so an unreadable class list cannot pass by accident.
 */
function overflowY(el: Element): string {
  let value = 'visible';
  for (const t of tokens(el)) {
    const bare = t.replace(/^(?:[a-z-]+:)+/, '');
    const shorthand = /^overflow-(auto|scroll|hidden|clip|visible)$/.exec(bare);
    if (shorthand) value = shorthand[1];
  }
  for (const t of tokens(el)) {
    const bare = t.replace(/^(?:[a-z-]+:)+/, '');
    const axis = /^overflow-y-(auto|scroll|hidden|clip|visible)$/.exec(bare);
    if (axis) value = axis[1];
  }
  return value;
}

/** Same, for the horizontal axis objectui#8448 owns. */
function overflowX(el: Element): string {
  let value = 'visible';
  for (const t of tokens(el)) {
    const bare = t.replace(/^(?:[a-z-]+:)+/, '');
    const shorthand = /^overflow-(auto|scroll|hidden|clip|visible)$/.exec(bare);
    if (shorthand) value = shorthand[1];
  }
  for (const t of tokens(el)) {
    const bare = t.replace(/^(?:[a-z-]+:)+/, '');
    const axis = /^overflow-x-(auto|scroll|hidden|clip|visible)$/.exec(bare);
    if (axis) value = axis[1];
  }
  return value;
}

/** Does this class list paint an OPAQUE background? `bg-x/50` does not. */
const OPAQUE_BG = (el: Element): boolean =>
  tokens(el).some((t) => {
    const bare = t.replace(/^(?:[a-z-]+:)+/, '');
    return /^bg-/.test(bare) && !/\//.test(bare) && bare !== 'bg-transparent' && bare !== 'bg-none';
  });

/** objectui#7303's invariant, re-read (never weakened) — see that pin for why. */
const OVERFLOW_TOKEN = /^(?:[a-z-]+:)*overflow(?:-[xy])?-(?:auto|scroll|hidden|clip)$/;
const KEEPS_ITS_HEIGHT_TOKEN = /^(?:[a-z-]+:)*(?:shrink-0|flex-shrink-0|min-h-(?!0$).+)$/;

/** Every row that declares itself part of the board's ONE horizontal axis. */
const axisRows = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('[data-swimlane-scroll-row]')];

/**
 * Render a swimlane board and prove it is a real one before anything is read
 * off it: the region, both lanes, and a card inside a lane.
 */
async function renderSwimlaneBoard() {
  const { container } = renderBoard(SWIMLANES);

  await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
  const region = container.querySelector('[role="region"]') as HTMLElement;
  expect(region?.getAttribute('aria-label')).toBe('Kanban board with swimlanes');

  const laneButtons = [...region.querySelectorAll<HTMLElement>('button[aria-expanded]')];
  expect(laneButtons.map((b) => b.textContent)).toEqual(['▶ann(1)', '▶bob(1)']);

  const laneList = region.querySelector('[role="list"][aria-label="Open - ann cards"]');
  expect(laneList, 'the swimlane layout should paint a lane cell per column').not.toBeNull();
  expect(
    within(laneList as HTMLElement).queryByText('Alpha deal'),
    'the swimlane cell should hold its card',
  ).not.toBeNull();

  return { container, region, laneButtons };
}

describe('objectui#8449 — the swimlane region owns the vertical scroll', () => {
  it('REACHABLE — the region scrolls vertically, and the board stays height-bounded', async () => {
    const { region } = await renderSwimlaneBoard();

    // ── THE PIN ──────────────────────────────────────────────────────────────
    // The bug was not "the lanes are tall". It was that the one element which
    // is BOTH height-bounded and overflowing refused to scroll. `hidden` and
    // `clip` are the failing values, `visible` is failing too (that is arm B
    // arriving unannounced — see the height bound re-read below).
    expect(
      overflowY(region),
      `the swimlane region must own a vertical scroll or the lanes below the fold are ` +
        `UNREACHABLE — measured scrollHeight 2104 against clientHeight 1000 with the ` +
        `document not scrollable either (objectui#8449). class was: ${JSON.stringify(region.className)}`,
    ).toMatch(/^(auto|scroll)$/);

    // Arm B was refused: the board must remain a self-contained pane rather
    // than stretch its container. The bound is what makes the region the
    // element that overflows, so deleting it both voids the ruling and makes
    // the assertion above meaningless.
    const boardRoot = region.parentElement as HTMLElement;
    expect(
      tokens(boardRoot).some((t) => /^(?:[a-z-]+:)*h-full$/.test(t)),
      `the swimlane region's parent is the board root and it must stay height-bounded; ` +
        `dropping the bound is arm B, which the ruling refused on blast radius ` +
        `(objectui#8449). class was: ${JSON.stringify(boardRoot.className)}`,
    ).toBe(true);
  });

  it('STICKY HEADER — the column titles are pinned to the region they scroll inside', async () => {
    const { region } = await renderSwimlaneBoard();

    // The row must be a DIRECT child of the scrolling region: `sticky` is
    // relative to the nearest scrollport, so a wrapper with its own overflow
    // between the two would silently stick it to the wrong box. objectui#7303's
    // pin reads the same element the same way.
    const headerRow = region.firstElementChild as HTMLElement;
    for (const title of ['Open', 'Won']) {
      expect(
        within(headerRow).queryByText(title),
        `the region's first child should be the column-header row; text was ${JSON.stringify(headerRow.textContent)}`,
      ).not.toBeNull();
    }

    const list = tokens(headerRow);

    // Sticky, and actually stuck: `position: sticky` with no inset is inert —
    // the row would scroll away exactly as if it were static, and nothing else
    // in this file would notice.
    expect(
      list.some((t) => /^(?:[a-z-]+:)*sticky$/.test(t)) || headerRow.style.position === 'sticky',
      `the column-header row must stick to the top of the scrolling region, or the titles ` +
        `scroll away and the board stops saying which column is which — objectui#7303's ` +
        `defect by a different route. class was: ${JSON.stringify(headerRow.className)}`,
    ).toBe(true);
    expect(
      list.some((t) => /^(?:[a-z-]+:)*(?:top-0|inset-y-0|inset-0)$/.test(t)) || headerRow.style.top !== '',
      `a sticky box with no inset never sticks; the header row needs \`top-0\`. ` +
        `class was: ${JSON.stringify(headerRow.className)}`,
    ).toBe(true);

    // Opaque, or the lanes paint straight through the pinned row.
    expect(
      OPAQUE_BG(headerRow),
      `the sticky header row needs an opaque background — a translucent or absent one lets ` +
        `the lane content scroll visibly THROUGH the column titles. ` +
        `class was: ${JSON.stringify(headerRow.className)}`,
    ).toBe(true);

    // ── objectui#7303's invariant, RE-READ, not weakened ─────────────────────
    // This card adds a second scrollable region to the flex column whose shrink
    // arithmetic that pin protects, and `position: sticky` does NOT remove a box
    // from flow — so the header row is still a shrinkable-in-principle flex item
    // that is also a scroll container. `shrink-0` is what keeps it off the
    // shrink pool, and it must survive this change.
    const isScrollContainer = list.some((t) => OVERFLOW_TOKEN.test(t));
    const keepsItsHeight =
      list.some((t) => KEEPS_ITS_HEIGHT_TOKEN.test(t)) ||
      headerRow.style.flexShrink === '0' ||
      headerRow.style.minHeight !== '';
    expect(
      isScrollContainer && !keepsItsHeight,
      `objectui#8449's vertical arm must not reopen objectui#7303: the header row is a scroll ` +
        `container AND shrinkable, so the board's flex-col will shrink it to height 0 as soon ` +
        `as the lanes overflow. class was: ${JSON.stringify(headerRow.className)}`,
    ).toBe(false);
  });

  it('NON-REGRESSION — the horizontal axis objectui#8448 settled is untouched, and the flat board is not involved', async () => {
    const { region } = await renderSwimlaneBoard();

    // The region takes the VERTICAL axis only. Giving it a horizontal scroll
    // would put a second X scroller around the rows that already share one,
    // which is the two-axes defect objectui#8448 closed.
    expect(
      overflowX(region),
      `the swimlane region must not become a horizontal scroll container — objectui#8448 put ` +
        `the board's ONE horizontal axis on the header row and the lane rows. ` +
        `class was: ${JSON.stringify(region.className)}`,
    ).not.toMatch(/^(auto|scroll)$/);

    // And the axis still works: the rows are still scroll containers, and one
    // driven sideways still takes the others with it. `scrollLeft` is a plain
    // settable number in happy-dom, so this half IS mechanically observable
    // (assignment fires no scroll event here, hence the explicit `fireEvent`).
    const rows = axisRows(region);
    expect(rows.length, 'header row + one row per lane').toBe(3);
    expect(rows[0]).toBe(region.firstElementChild);
    for (const row of rows) {
      expect(
        tokens(row).some((t) => /^(?:[a-z-]+:)*overflow(?:-x)?-(?:auto|scroll)$/.test(t)),
        `a synced row must still be a scroll container; class was ${JSON.stringify(row.className)}`,
      ).toBe(true);
    }

    const [headerRow, annRow, bobRow] = rows;
    annRow.scrollLeft = 298;
    fireEvent.scroll(annRow);
    expect(headerRow.scrollLeft, 'the sticky header row is still on the shared axis').toBe(298);
    expect(bobRow.scrollLeft, 'and so is every other lane').toBe(298);

    cleanup();

    // The flat layout owns its own scroller and has per-column `<h3>` headings
    // instead of a header row. None of this reaches it.
    const { container } = renderBoard();
    await waitFor(() => expect(container.textContent).toContain('Alpha deal'));
    const flatRegion = container.querySelector('[role="region"]') as HTMLElement;
    expect(flatRegion.getAttribute('aria-label')).toBe('Kanban board');
    expect(overflowX(flatRegion), 'the flat board keeps its own horizontal scroller').toMatch(/^(auto|scroll)$/);
    expect(container.querySelector('h3#kanban-col-open')?.textContent).toBe('Open');
  });
});
