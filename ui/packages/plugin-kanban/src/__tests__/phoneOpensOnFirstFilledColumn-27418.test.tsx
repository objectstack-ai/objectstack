/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #27418 — a phone board opens on its first column that holds a card.
 *
 * At 390px the flat board shows one column at a time, so a pipeline whose
 * first stage was empty opened on that empty column and read as an empty
 * board. On the first settled load the scroller now brings the first
 * non-empty column into view; it never moves the board after the viewer did.
 *
 * ## How the fixture supplies geometry
 *
 * happy-dom does no layout, so `Element.prototype.getBoundingClientRect` is
 * stubbed for each render with the phone board measured in Chromium at
 * 390x844: the scroller spans 0..390, each column is 358px wide on a 370px
 * pitch starting 16px in, and a column's box moves left by the scroller's
 * `scrollLeft`. The same stub feeds `useResizeObserver`'s first read, which is
 * what gives the board its width. `assertSized` guards the direction that
 * would pass silently: a stub that stopped reaching the board would leave
 * `boardWidth` at 0, the hook would never run, and "stays at 0" would read
 * as a pass.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
// Imported directly: the behaviour lives in this module's flat layout, and the
// lazy registry route adds an async boundary this pin has no use for.
import KanbanBoard from '../KanbanImpl';
import { KanbanRecordsSettledContext } from '../KanbanRecordsSettled';
import type { KanbanColumn } from '../types';

const COLUMN_WIDTH = 358;
const COLUMN_PITCH = 370;
const BOARD_PAD = 16;

let restoreRect: (() => void) | null = null;

afterEach(() => {
  restoreRect?.();
  restoreRect = null;
  cleanup();
});

function stubBoardGeometry(boardWidth: number) {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const box = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 600, height: 600, x: left, y: 0, toJSON() {} }) as DOMRect;
    const scroller = this.parentElement;
    if (this.getAttribute('role') === 'group' && scroller?.getAttribute('aria-label') === 'Kanban board') {
      const index = Array.prototype.indexOf.call(scroller.children, this);
      return box(BOARD_PAD + index * COLUMN_PITCH - scroller.scrollLeft, COLUMN_WIDTH);
    }
    return box(0, boardWidth);
  };
  restoreRect = () => { Element.prototype.getBoundingClientRect = original; };
}

function card(id: string) {
  return { id, title: `Deal ${id}` };
}

function stages(filled: Record<string, string[]>): KanbanColumn[] {
  return ['prospect', 'qualify', 'proposal', 'negotiation', 'won'].map((id) => ({
    id,
    title: id,
    cards: (filled[id] ?? []).map(card),
  }));
}

function board(columns: KanbanColumn[], settled = true) {
  return (
    <KanbanRecordsSettledContext.Provider value={settled}>
      <KanbanBoard columns={columns} />
    </KanbanRecordsSettledContext.Provider>
  );
}

function scroller(): HTMLElement {
  return screen.getByRole('region', { name: 'Kanban board' });
}

/** The board took its width from the stub, so the hook had what it waits for. */
function assertSized() {
  expect(screen.getByRole('group', { name: 'prospect' }).style.width).toBe(`${390 - 32}px`);
}

describe('a phone board opens on its first non-empty column (#27418)', () => {
  it('opens on the third stage when the first two are empty', () => {
    stubBoardGeometry(390);
    render(board(stages({ proposal: ['r1', 'r2'], negotiation: ['n1'] })));
    assertSized();
    expect(scroller().scrollLeft).toBe(2 * COLUMN_PITCH);
  });

  it('opens on the first stage, as before, when it holds a card', () => {
    stubBoardGeometry(390);
    render(board(stages({ prospect: ['p1'], proposal: ['r1'] })));
    assertSized();
    expect(scroller().scrollLeft).toBe(0);
  });

  it('waits for the records to settle, then moves once', () => {
    stubBoardGeometry(390);
    const { rerender } = render(board(stages({}), false));
    assertSized();
    expect(scroller().scrollLeft).toBe(0);
    rerender(board(stages({ negotiation: ['n1'] })));
    expect(scroller().scrollLeft).toBe(3 * COLUMN_PITCH);
  });

  it('never overrides a viewer who scrolled before the records arrived', () => {
    stubBoardGeometry(390);
    const { rerender } = render(board(stages({}), false));
    fireEvent.touchStart(scroller());
    scroller().scrollLeft = COLUMN_PITCH;
    rerender(board(stages({ negotiation: ['n1'] })));
    expect(scroller().scrollLeft).toBe(COLUMN_PITCH);
  });

  it('never moves the board again after the first load', () => {
    stubBoardGeometry(390);
    const { rerender } = render(board(stages({ proposal: ['r1'] })));
    expect(scroller().scrollLeft).toBe(2 * COLUMN_PITCH);
    // The viewer swipes back to the first stage; a refetch then lands with the
    // card moved further along. The board stays where the viewer left it.
    fireEvent.pointerDown(scroller());
    scroller().scrollLeft = 0;
    rerender(board(stages({ won: ['r1'] })));
    expect(scroller().scrollLeft).toBe(0);
  });

  it('leaves a wide board alone when the first non-empty column is already in view', () => {
    stubBoardGeometry(1280);
    render(board(stages({ qualify: ['q1'] })));
    expect(scroller().scrollLeft).toBe(0);
  });
});
