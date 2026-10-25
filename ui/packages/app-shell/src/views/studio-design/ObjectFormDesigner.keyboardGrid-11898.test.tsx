// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The form designer's arrow keys reach every place on a canvas of any column
 * count, and a keyboard drop commits the place the live region announced —
 * objectui#11898.
 *
 * The defect: the keyboard sensor's coordinate getter was dnd-kit's
 * `sortableKeyboardCoordinates`, which picks each step's target by corner
 * distance among the droppables in the arrow's direction, and the keyboard
 * drag was over whatever droppable the same measure then found under the
 * chip. On a multi-column canvas a section's droppable lost to the nearest
 * card, so the arrow keys skipped an empty group; upward, a field's own
 * section was the nearest, so the first ArrowUp from a group's first field did
 * nothing, and a full-row field's chip, as wide as its section, landed on its
 * own section and went to the group's end. After the canvas carried a field
 * into another group, the chip still sat on the card it had been carried
 * before, and the drop's same-group arithmetic moved it one place past the
 * place announced.
 *
 * The instrument: the REAL `DndContext`, the real `KeyboardSensor` with the
 * designer's own coordinate getter, the real `PointerSensor`, the designer's
 * own collision detection and its real handlers. Nothing in `@dnd-kit` is
 * mocked. The test DOM does no layout, so `layoutRect` lays the canvas out the
 * way real Chromium does for these drafts at a 1280px and a 480px viewport
 * (the reading is on the pull request): the field grid's container-query
 * columns, a full-row card starting its own row, the section headers between
 * grids. Each case runs at both widths, and reads the committed `fields` and
 * the live region.
 *
 * The controls ride beside the cases: a one-column keyboard move
 * objectui#11871 already reached, and pointer drags on the multi-column
 * canvas, which still answer through `pointerWithin`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ObjectFormDesigner } from './ObjectFormDesigner';

type Field = { name: string; type: string; label: string; group?: string };
type Draft = { name: string; fields: Field[]; fieldGroups: Array<{ key: string; label: string }> };

const GROUPS = [
  { key: 'contact', label: 'Contact' },
  { key: 'new_group', label: 'New group' },
];

/** objectui#11871's fixture: Contact (Phone, Email), New group (empty), Ungrouped (Name, Industry). */
const FOUR: Draft = {
  name: 'account',
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'industry', type: 'text', label: 'Industry' },
    { name: 'phone', type: 'text', label: 'Phone', group: 'contact' },
    { name: 'email', type: 'text', label: 'Email', group: 'contact' },
  ],
  fieldGroups: GROUPS,
};

/** Eleven fields, three columns wide at 1280px, with the full-row Notes textarea inside Contact. */
const ELEVEN: Draft = {
  name: 'account',
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'industry', type: 'text', label: 'Industry' },
    { name: 'rating', type: 'text', label: 'Rating' },
    { name: 'revenue', type: 'text', label: 'Revenue' },
    { name: 'owner', type: 'text', label: 'Owner' },
    { name: 'phone', type: 'text', label: 'Phone', group: 'contact' },
    { name: 'email', type: 'text', label: 'Email', group: 'contact' },
    { name: 'mobile', type: 'text', label: 'Mobile', group: 'contact' },
    { name: 'fax', type: 'text', label: 'Fax', group: 'contact' },
    { name: 'notes', type: 'textarea', label: 'Notes', group: 'contact' },
    { name: 'website', type: 'text', label: 'Website', group: 'contact' },
  ],
  fieldGroups: GROUPS,
};

// Chromium's layout of these canvases. Each section's field grid (the section
// droppable) starts at GRID_LEFT, is GRID_WIDTH wide and pads its cards by
// GRID_PAD; cards are CARD_HEIGHT tall (a textarea's WIDE_CARD_HEIGHT), GAP
// apart in both directions; an empty grid is EMPTY_GRID_HEIGHT tall. A
// section's header sits between its grid and the grid above: a declared
// group's (its name is an input) is BEFORE_GROUP_GRID tall with the borders
// and the gap, the Ungrouped bucket's BEFORE_UNGROUPED_GRID. The drag
// overlay's label chip, which dnd-kit measures as the dragged box, is
// CHIP_HEIGHT tall.
type Width = 1280 | 480;
const CANVAS: Record<Width, { GRID_LEFT: number; GRID_WIDTH: number; FIRST_GRID_TOP: number }> = {
  1280: { GRID_LEFT: 65, GRID_WIDTH: 1150, FIRST_GRID_TOP: 93 },
  480: { GRID_LEFT: 18, GRID_WIDTH: 444, FIRST_GRID_TOP: 109.5 },
};
const GRID_PAD = 10;
const GAP = 16;
const CARD_HEIGHT = 66;
const WIDE_CARD_HEIGHT = 94;
const EMPTY_GRID_HEIGHT = 62.5;
const BEFORE_GROUP_GRID = 50.5;
const BEFORE_UNGROUPED_GRID = 46.5;
const CHIP_HEIGHT = 34;

let width: Width = 1280;

const isGrid = (el: Element) => el.classList.contains('min-h-[52px]');
const isCard = (el: Element) => el.classList.contains('cursor-grab');
const cardsOf = (grid: Element) => Array.from(grid.children).filter(isCard);

type Box = { left: number; top: number; width: number; height: number };

/**
 * How many columns a field grid shows: its widest container-query step. A
 * 1280px canvas's sections reach every step the grid names, a 480px one's
 * none of them.
 */
function columnsOf(grid: Element): number {
  if (width === 480) return 1;
  const steps = Array.from(grid.className.matchAll(/@\w+:grid-cols-(\d)/g), (m) => Number(m[1]));
  return Math.max(1, ...steps);
}

/** A grid's height, and its cards' boxes, laid out from `top` the way CSS grid auto-placement does. */
function layGrid(grid: Element, top: number): { height: number; boxes: Map<Element, Box> } {
  const { GRID_LEFT, GRID_WIDTH } = CANVAS[width];
  const columns = columnsOf(grid);
  const column = (GRID_WIDTH - 2 * GRID_PAD - (columns - 1) * GAP) / columns;
  const boxes = new Map<Element, Box>();
  const cards = cardsOf(grid);
  let y = top + GRID_PAD;
  let col = 0;
  let rowHeight = 0;
  const nextRow = () => {
    y += rowHeight + GAP;
    col = 0;
    rowHeight = 0;
  };
  for (const card of cards) {
    // A full-row card starts its own row and takes all of it.
    const span = card.classList.contains('col-span-full') ? columns : 1;
    if (span > 1 && col > 0) nextRow();
    const height = card.querySelector('.h-14') ? WIDE_CARD_HEIGHT : CARD_HEIGHT;
    boxes.set(card, { left: GRID_LEFT + GRID_PAD + col * (column + GAP), top: y, width: span * column + (span - 1) * GAP, height });
    rowHeight = Math.max(rowHeight, height);
    col += span;
    if (col >= columns) nextRow();
  }
  const bottom = col > 0 ? y + rowHeight : y - GAP;
  return { height: cards.length ? bottom + GRID_PAD - top : EMPTY_GRID_HEIGHT, boxes };
}

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
  const { GRID_LEFT, GRID_WIDTH, FIRST_GRID_TOP } = CANVAS[width];
  let top = FIRST_GRID_TOP;
  for (const [i, grid] of Array.from(document.querySelectorAll('div')).filter(isGrid).entries()) {
    if (i > 0) top += grid.parentElement?.firstElementChild?.querySelector('input') ? BEFORE_GROUP_GRID : BEFORE_UNGROUPED_GRID;
    const { height, boxes } = layGrid(grid, top);
    if (grid === el) return { left: GRID_LEFT, top, width: GRID_WIDTH, height };
    const box = boxes.get(el);
    if (box) return box;
    top += height;
  }
  return null;
}

const originalRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const box = layoutRect(this) ?? { left: 0, top: 0, width: 0, height: 0 };
    const { left, top, width: w, height } = box;
    return { left, top, width: w, height, x: left, y: top, right: left + w, bottom: top + height, toJSON: () => box };
  };
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalRect;
});

/** Every `fields` the designer committed, in order. */
let commits: Field[][] = [];

function Host({ draft: initial }: { draft: Draft }): React.ReactElement {
  const [draft, setDraft] = React.useState<Record<string, unknown>>(initial);
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

function renderDesigner(at: Width, draft: Draft = FOUR) {
  width = at;
  commits = [];
  render(<Host draft={draft} />);
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

/** The place the last commit gives a field, in the live region's words: "Group, position N of M". */
function committedPlace(name: string): string {
  const fields = commits.at(-1) ?? [];
  const group = fields.find((f) => f.name === name)?.group;
  const members = fields.filter((f) => f.group === group).map((f) => f.name);
  const label = GROUPS.find((g) => g.key === group)?.label ?? 'Ungrouped';
  return `${label}, position ${members.indexOf(name) + 1} of ${members.length}`;
}

describe.each([1280, 480] as const)('the arrow keys step in reading order at %ipx (objectui#11898)', (at) => {
  it('case 1: Email, ArrowDown reaches the empty New group, and the drop commits it there', async () => {
    renderDesigner(at);
    const heard = await keyboardMove('Email', ['ArrowDown']);
    expect(heard).toEqual(['Email is over New group, position 1 of 1.']);
    expect(said()).toBe('Email moved to New group, position 1 of 1.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone'], new_group: ['email'], '': ['name', 'industry'] });
  });

  it('case 1: Name, ArrowUp reaches the empty New group from below', async () => {
    renderDesigner(at);
    const heard = await keyboardMove('Name', ['ArrowUp']);
    expect(heard).toEqual(['Name is over New group, position 1 of 1.']);
    expect(said()).toBe('Name moved to New group, position 1 of 1.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone', 'email'], new_group: ['name'], '': ['industry'] });
  });

  it('case 2: the full-row Notes moves up one place, and down one place', async () => {
    renderDesigner(at, ELEVEN);
    expect(await keyboardMove('Notes', ['ArrowUp'])).toEqual(['Notes is over Contact, position 4 of 6.']);
    expect(said()).toBe('Notes moved to Contact, position 4 of 6.');
    expect(layoutOfLastCommit().contact).toEqual(['phone', 'email', 'mobile', 'notes', 'fax', 'website']);

    cleanup();
    renderDesigner(at, ELEVEN);
    expect(await keyboardMove('Notes', ['ArrowDown'])).toEqual(['Notes is over Contact, position 6 of 6.']);
    expect(said()).toBe('Notes moved to Contact, position 6 of 6.');
    expect(layoutOfLastCommit().contact).toEqual(['phone', 'email', 'mobile', 'fax', 'website', 'notes']);
  });

  it("case 3: the first ArrowUp from a group's first field moves it, and the next one reaches the end of the group above", async () => {
    renderDesigner(at);
    const heard = await keyboardMove('Name', ['ArrowUp', 'ArrowUp']);
    expect(heard).toEqual(['Name is over New group, position 1 of 1.', 'Name is over Contact, position 3 of 3.']);
    expect(said()).toBe('Name moved to Contact, position 3 of 3.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone', 'email', 'name'], '': ['industry'] });
  });

  it('case 4: Phone, ArrowDown ×3 commits the place the region announced', async () => {
    renderDesigner(at);
    const heard = await keyboardMove('Phone', ['ArrowDown', 'ArrowDown', 'ArrowDown']);
    expect(heard).toEqual([
      'Phone is over Contact, position 2 of 2.',
      'Phone is over New group, position 1 of 1.',
      'Phone is over Ungrouped, position 1 of 3.',
    ]);
    expect(said()).toBe('Phone moved to Ungrouped, position 1 of 3.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['email'], '': ['phone', 'name', 'industry'] });
    // Control: the last place announced is the place committed.
    expect(heard.at(-1)).toBe(`Phone is over ${committedPlace('phone')}.`);
  });

  it('at either end of the canvas the step goes nowhere, and the drop leaves the field where it was', async () => {
    renderDesigner(at);
    await keyboardMove('Phone', ['ArrowUp', 'ArrowLeft']);
    expect(said()).toBe('Phone moved to Contact, position 1 of 2.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone', 'email'], '': ['name', 'industry'] });
  });
});

describe('controls (objectui#11898)', () => {
  it('a one-column keyboard move objectui#11871 already reached: Email, ArrowDown at 480px', async () => {
    renderDesigner(480);
    expect(await keyboardMove('Email', ['ArrowDown'])).toEqual(['Email is over New group, position 1 of 1.']);
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone'], new_group: ['email'], '': ['name', 'industry'] });
  });

  /** Press on Name's card, cross the 4px activation distance, move to each point in `path`. */
  function pointerDrag(from: { x: number; y: number }, path: Array<{ x: number; y: number }>) {
    fireEvent.pointerDown(card('Name'), { isPrimary: true, button: 0, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: from.x + 10, clientY: from.y });
    for (const p of path) fireEvent.pointerMove(document, { isPrimary: true, clientX: p.x, clientY: p.y });
    fireEvent.pointerUp(document, { isPrimary: true, button: 0 });
  }

  it('a pointer over the empty group on the two-column canvas drops the field into it', () => {
    renderDesigner(1280);
    // Name's card is at (75, 338.5 + 10); the New group's grid spans y 229.5..292.
    // The second move is the pointer resting while the canvas moves the card.
    pointerDrag({ x: 100, y: 380 }, [{ x: 600, y: 260 }, { x: 601, y: 260 }]);
    expect(said()).toBe('Name moved to New group, position 1 of 1.');
    expect(layoutOfLastCommit()).toEqual({ contact: ['phone', 'email'], new_group: ['name'], '': ['industry'] });
  });

  it('a pointer released outside every group on the two-column canvas commits nothing', () => {
    renderDesigner(1280);
    // Right of every grid (they end at x 1215): no droppable is under it.
    pointerDrag({ x: 100, y: 380 }, [{ x: 1250, y: 260 }]);
    expect(said()).toBe('Name was dropped outside the groups and is back in Ungrouped, position 1 of 2.');
    expect(commits).toHaveLength(0);
  });
});
