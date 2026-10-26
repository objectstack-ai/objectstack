// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A keyboard drag in the form designer reaches a drop target — objectui#11871.
 *
 * The defect: the designer's `DndContext` used `pointerWithin`, which answers
 * no droppable when dnd-kit has no pointer coordinates. dnd-kit reads them off
 * the activator event, and a `KeyboardEvent` has none, so every keyboard drag
 * was over nothing: Space, the arrow keys and Space again ended "dropped
 * outside the groups", and the draft never changed.
 *
 * The instrument: the REAL `DndContext`, the real `KeyboardSensor` with the
 * designer's own coordinate getter, the real `PointerSensor`, the
 * designer's own collision detection and its real handlers. Nothing in
 * `@dnd-kit` is mocked. The test DOM does no layout, so `layoutRect` lays the
 * canvas out the way real Chromium does for this draft at a narrow width, one
 * field per row (the reading is on the pull request). The numbers below come
 * from that reading, rounded to whole pixels, with `BETWEEN_GRIDS` the mean of
 * its two gaps between section grids. Each keyboard case asserts what Chromium
 * did with the same keys, and reads the committed `fields` and the live region.
 *
 * The control rides beside the keyboard cases: a pointer drag still answers
 * through `pointerWithin`, so a pointer released outside every group still
 * commits nothing, which a rect-based strategy on the pointer path would not
 * do (it answers the nearest droppable wherever the pointer is).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ObjectFormDesigner } from './ObjectFormDesigner';

type Field = { name: string; type: string; label: string; group?: string };

const DRAFT = {
  name: 'account',
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'industry', type: 'text', label: 'Industry' },
    { name: 'phone', type: 'text', label: 'Phone', group: 'contact' },
    { name: 'email', type: 'text', label: 'Email', group: 'contact' },
  ] as Field[],
  fieldGroups: [
    { key: 'contact', label: 'Contact' },
    { key: 'new_group', label: 'New group' },
  ],
};

// Chromium's one-column layout of this canvas: each section's field grid (the
// section droppable) spans GRID_LEFT..GRID_LEFT+GRID_WIDTH; a card sits
// GRID_PAD inside it, CARD_HEIGHT tall, CARD_GAP apart; an empty grid is
// EMPTY_GRID_HEIGHT tall; one section header separates a grid from the next.
// The drag overlay's label chip, which dnd-kit measures as the dragged box, is
// CHIP_HEIGHT tall.
const GRID_LEFT = 18;
const GRID_WIDTH = 444;
const FIRST_GRID_TOP = 110;
const GRID_PAD = 10;
const CARD_HEIGHT = 66;
const CARD_GAP = 16;
const EMPTY_GRID_HEIGHT = 63;
const BETWEEN_GRIDS = 48;
const CHIP_HEIGHT = 34;

const isGrid = (el: Element) => el.classList.contains('min-h-[52px]');
const isCard = (el: Element) => el.classList.contains('cursor-grab');
const cardsOf = (grid: Element) => Array.from(grid.children).filter(isCard);

type Box = { left: number; top: number; width: number; height: number };

/** Where Chromium puts `el` on the canvas as the DOM stands now; `null` for an element it does not lay out here. */
function layoutRect(el: HTMLElement): Box | null {
  // dnd-kit's drag overlay is a `position: fixed` wrapper at the box dnd-kit
  // gave it, and dnd-kit measures the wrapper's one child, the label chip:
  // the wrapper's width at the chip's own height.
  const wrapper = el.parentElement;
  if (wrapper?.style.position === 'fixed') {
    return {
      left: parseFloat(wrapper.style.left),
      top: parseFloat(wrapper.style.top),
      width: parseFloat(wrapper.style.width),
      height: CHIP_HEIGHT,
    };
  }
  if (!isGrid(el) && !isCard(el)) return null;
  const grids = Array.from(document.querySelectorAll('div')).filter(isGrid);
  let top = FIRST_GRID_TOP;
  for (const grid of grids) {
    const cards = cardsOf(grid);
    const height = cards.length
      ? 2 * GRID_PAD + cards.length * CARD_HEIGHT + (cards.length - 1) * CARD_GAP
      : EMPTY_GRID_HEIGHT;
    if (grid === el) return { left: GRID_LEFT, top, width: GRID_WIDTH, height };
    const index = cards.indexOf(el);
    if (index >= 0) {
      return {
        left: GRID_LEFT + GRID_PAD,
        top: top + GRID_PAD + index * (CARD_HEIGHT + CARD_GAP),
        width: GRID_WIDTH - 2 * GRID_PAD,
        height: CARD_HEIGHT,
      };
    }
    top += height + BETWEEN_GRIDS;
  }
  return null;
}

const originalRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const box = layoutRect(this) ?? { left: 0, top: 0, width: 0, height: 0 };
    const { left, top, width, height } = box;
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => box };
  };
});

/** Every `fields` the designer committed, in order. */
let commits: Field[][] = [];

function Host(): React.ReactElement {
  const [draft, setDraft] = React.useState<Record<string, unknown>>(DRAFT);
  return (
    <ObjectFormDesigner
      draft={draft}
      systemFieldNames={new Set()}
      onChange={(patch) => {
        if (patch.fields) commits.push(patch.fields as Field[]);
        setDraft((d) => ({ ...d, ...patch }));
      }}
      onSelectField={() => {}}
    />
  );
}

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalRect;
});

function renderDesigner() {
  commits = [];
  render(<Host />);
}

/** What the live region says now. */
const said = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? null;
const card = (label: string) => screen.getByText(label, { exact: true }).closest('.cursor-grab') as HTMLElement;
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/**
 * Focus the card, pick it up with Space, press `arrows`, drop with Space.
 * Returns what the region said after each arrow key.
 */
async function keyboardMove(label: string, arrows: string[]): Promise<string[]> {
  const el = card(label);
  el.focus();
  fireEvent.keyDown(el, { code: 'Space', key: ' ' });
  // dnd-kit's keyboard sensor listens for the next key one tick later.
  await tick();
  const heard: string[] = [];
  for (const code of arrows) {
    fireEvent.keyDown(document, { code, key: code });
    await tick();
    heard.push(said() ?? '');
  }
  fireEvent.keyDown(document, { code: 'Space', key: ' ' });
  await tick();
  return heard;
}

/** The last commit, as group key → field names in order (`''` = ungrouped). */
function layoutOfLastCommit(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of commits.at(-1) ?? []) (out[f.group ?? ''] ??= []).push(f.name);
  return out;
}

describe('a keyboard drag in the form designer reaches a drop target (objectui#11871)', () => {
  it('reorders a field inside its group, and the draft records it', async () => {
    renderDesigner();
    const heard = await keyboardMove('Phone', ['ArrowDown']);
    expect(heard).toEqual(['Phone is over Contact, position 2 of 2.']);
    expect(said()).toBe('Phone moved to Contact, position 2 of 2.');
    expect(commits).toHaveLength(1);
    expect(layoutOfLastCommit()).toEqual({ contact: ['email', 'phone'], '': ['name', 'industry'] });
  });

  it('reorders upward inside its group', async () => {
    renderDesigner();
    await keyboardMove('Email', ['ArrowUp']);
    expect(said()).toBe('Email moved to Contact, position 1 of 2.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['email', 'phone'], '': ['name', 'industry'] });
  });

  it('carries a field into the empty group below it', async () => {
    renderDesigner();
    const heard = await keyboardMove('Email', ['ArrowDown']);
    expect(heard).toEqual(['Email is over New group, position 1 of 1.']);
    expect(said()).toBe('Email moved to New group, position 1 of 1.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone'], new_group: ['email'], '': ['name', 'industry'] });
  });

  it('carries a field up through the empty group into a group that has fields', async () => {
    renderDesigner();
    const heard = await keyboardMove('Name', ['ArrowUp', 'ArrowUp', 'ArrowUp']);
    // Each step is one place in reading order (objectui#11898): the first
    // leaves the field's own group, which until objectui#11898 moved nothing,
    // and the second enters Contact at its end. Chromium does the same.
    expect(heard).toEqual([
      'Name is over New group, position 1 of 1.',
      'Name is over Contact, position 3 of 3.',
      'Name is over Contact, position 2 of 3.',
    ]);
    expect(said()).toBe('Name moved to Contact, position 2 of 3.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone', 'name', 'email'], '': ['industry'] });
  });

  it("the card's own steps: the drop lands on a target, not outside the groups", async () => {
    // Industry is the last field on the canvas, so ArrowDown has nowhere to
    // take it; before the fix the drop still missed every target.
    renderDesigner();
    await keyboardMove('Industry', ['ArrowDown', 'ArrowDown', 'ArrowDown']);
    expect(said()).toBe('Industry moved to Ungrouped, position 2 of 2.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone', 'email'], '': ['name', 'industry'] });
  });
});

describe('control: a pointer drag still answers through pointerWithin (objectui#11871)', () => {
  /** Press on `from`, cross the 4px activation distance, move to each point in `path`. */
  function pointerDrag(from: { x: number; y: number }, path: Array<{ x: number; y: number }>) {
    fireEvent.pointerDown(card('Name'), { isPrimary: true, button: 0, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: from.x + 10, clientY: from.y });
    for (const p of path) fireEvent.pointerMove(document, { isPrimary: true, clientX: p.x, clientY: p.y });
    fireEvent.pointerUp(document, { isPrimary: true, button: 0 });
  }

  it('a pointer over the empty group drops the field into it', () => {
    renderDesigner();
    // Name's card is at (28, 447); the New group's grid spans y 326..389.
    // The second move is the pointer resting while the canvas moves the card.
    pointerDrag({ x: 100, y: 470 }, [{ x: 100, y: 350 }, { x: 101, y: 350 }]);
    expect(said()).toBe('Name moved to New group, position 1 of 1.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone', 'email'], new_group: ['name'], '': ['industry'] });
  });

  it('a pointer released outside every group commits nothing', () => {
    renderDesigner();
    // Right of every grid (they end at x 462): no droppable is under it.
    pointerDrag({ x: 100, y: 470 }, [{ x: 600, y: 350 }]);
    expect(said()).toBe('Name was dropped outside the groups and is back in Ungrouped, position 1 of 2.');
    expect(commits).toHaveLength(0);
  });
});
