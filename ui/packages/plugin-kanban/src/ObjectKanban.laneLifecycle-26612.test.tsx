/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26612 — the lanes a board derives from its lane field's picklist
 * follow the options' declared lifecycle `kind`.
 *
 * Before: the lanes ran in the options' authored order and nothing read
 * `kind`, so a lost lane authored mid-list sat between two open ones, open
 * like any other, and a terminal lane read as one more step.
 *
 * Rows:
 *   (a) `lanesFromOptions`: open → won → lost, each class in authored order,
 *       absent kind read as open, lost lanes collapsed; no declared kind at all
 *       keeps the authored order and collapses nothing (no spelling guess);
 *   (b) the board: the derived lanes render in that order, the lost lane as a
 *       collapsed spine that still shows its count and opens on demand;
 *   (c) CONTROL: authored `columns` keep the author's order and state.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { lanesFromOptions } from './kanbanLaneLifecycle';
// Registers `object-kanban`.
import './index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// (objectui#3010), same specifier as `index.tsx`'s factory.
import './KanbanImpl';

const STAGE_OPTIONS = [
  { value: 'new', label: 'New', kind: 'open' },
  { value: 'lost', label: 'Lost', kind: 'lost' },
  { value: 'working', label: 'Working' },
  { value: 'won', label: 'Won', kind: 'won' },
  { value: 'stalled', label: 'Stalled', kind: 'open' },
] as const;

const OBJECT_SCHEMA = {
  name: 'lifecycle_deal',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    stage: { name: 'stage', type: 'select', label: 'Stage', options: STAGE_OPTIONS },
  },
};

const ROWS = [
  { id: 'd1', name: 'Deal in new', stage: 'new' },
  { id: 'd2', name: 'Deal lost one', stage: 'lost' },
  { id: 'd3', name: 'Deal lost two', stage: 'lost' },
  { id: 'd4', name: 'Deal won', stage: 'won' },
];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as any;
}

async function renderBoard(extra: Record<string, unknown> = {}) {
  const result = render(
    <SchemaRendererProvider dataSource={makeDataSource()}>
      <SchemaRenderer
        schema={{ type: 'object-kanban', objectName: 'lifecycle_deal', groupBy: 'stage', ...extra } as any}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(result.container.textContent).toContain('Deal in new'));
  return result;
}

/** Each lane's `role="group"` element, in DOM order. */
const lanesOf = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[role="group"][aria-label]'));

afterEach(cleanup);

describe('(a) lanesFromOptions — the lane order a declared kind sets (objectstack#26612)', () => {
  it('runs open → won → lost, each class in authored order, and collapses the lost lanes', () => {
    expect(lanesFromOptions(STAGE_OPTIONS as any)).toEqual([
      { id: 'new', title: 'New' },
      { id: 'working', title: 'Working' },
      { id: 'stalled', title: 'Stalled' },
      { id: 'won', title: 'Won' },
      { id: 'lost', title: 'Lost', collapsed: true },
    ]);
  });

  it('a field that declares no kind keeps its authored order and guesses nothing from spelling', () => {
    expect(
      lanesFromOptions([
        { value: 'closed_lost', label: 'Closed Lost' },
        { value: 'prospecting', label: 'Prospecting' },
        { value: 'closed_won', label: 'Closed Won' },
      ]),
    ).toEqual([
      { id: 'closed_lost', title: 'Closed Lost' },
      { id: 'prospecting', title: 'Prospecting' },
      { id: 'closed_won', title: 'Closed Won' },
    ]);
  });
});

describe('(b) the board lays its derived lanes out by kind (objectstack#26612)', () => {
  it('orders the lanes open → won → lost', async () => {
    const { container } = await renderBoard();
    expect(lanesOf(container).map((l) => l.getAttribute('aria-label'))).toEqual([
      'New',
      'Working',
      'Stalled',
      'Won',
      'Lost',
    ]);
  });

  it('draws the lost lane collapsed with its count, and opens it on demand', async () => {
    const { container } = await renderBoard();
    const lost = lanesOf(container).find((l) => l.getAttribute('aria-label') === 'Lost')!;
    const toggle = within(lost).getByRole('button', { expanded: false });
    // The count stays on the spine while the cards are withheld.
    expect(lost.textContent).toContain('2');
    expect(lost.textContent).not.toContain('Deal lost one');

    fireEvent.click(toggle);
    await waitFor(() => expect(lost.textContent).toContain('Deal lost one'));
    expect(within(lost).getByRole('button', { expanded: true })).toBeInTheDocument();
  });

  it('leaves the open and won lanes expanded, with no disclosure', async () => {
    const { container } = await renderBoard();
    for (const lane of lanesOf(container).filter((l) => l.getAttribute('aria-label') !== 'Lost')) {
      expect(within(lane).queryByRole('button', { expanded: false })).toBeNull();
    }
    expect(container.textContent).toContain('Deal won');
  });
});

describe('(c) CONTROL: authored columns are the author\'s', () => {
  it('keeps the authored order and collapses nothing the author did not', async () => {
    const { container } = await renderBoard({
      columns: [
        { id: 'lost', title: 'Lost' },
        { id: 'new', title: 'New' },
        { id: 'won', title: 'Won' },
      ],
    });
    expect(lanesOf(container).map((l) => l.getAttribute('aria-label'))).toEqual(['Lost', 'New', 'Won']);
    expect(container.textContent).toContain('Deal lost one');
  });
});
