/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28211 — a list view's `kanban.lanes`, handed to the board as its
 * `columns` by `kanbanDeclaredLanes` (`@object-ui/core`), the mapping both
 * producers of the `object-kanban` node make.
 *
 * Rows:
 *   (a) the board draws only the listed lanes, in the listed order, over the
 *       options' own order and over the lifecycle order it derives itself;
 *   (b) a record whose value is not listed lands in `Uncategorized`, never
 *       hidden;
 *   (c) a listed lost lane still starts collapsed.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { kanbanDeclaredLanes } from '@object-ui/core';
// Registers `object-kanban`.
import './index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// (objectui#3010), same specifier as `index.tsx`'s factory.
import './KanbanImpl';

const STAGE_OPTIONS = [
  { value: 'new', label: 'New', kind: 'open' },
  { value: 'working', label: 'Working', kind: 'open' },
  { value: 'won', label: 'Won', kind: 'won' },
  { value: 'lost', label: 'Lost', kind: 'lost' },
];

const OBJECT_SCHEMA = {
  name: 'lanes_deal',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    stage: { name: 'stage', type: 'select', label: 'Stage', options: STAGE_OPTIONS },
  },
};

const ROWS = [
  { id: 'd1', name: 'Deal in new', stage: 'new' },
  { id: 'd2', name: 'Deal in working', stage: 'working' },
  { id: 'd3', name: 'Deal won', stage: 'won' },
  { id: 'd4', name: 'Deal lost', stage: 'lost' },
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

async function renderBoard(lanes: string[], waitForText: string) {
  const result = render(
    <SchemaRendererProvider dataSource={makeDataSource()}>
      <SchemaRenderer
        schema={{
          type: 'object-kanban',
          objectName: 'lanes_deal',
          groupBy: 'stage',
          columns: kanbanDeclaredLanes(lanes, STAGE_OPTIONS),
        } as any}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(result.container.textContent).toContain(waitForText));
  return result;
}

/** Each lane's `role="group"` element, in DOM order. */
const lanesOf = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[role="group"][aria-label]'));
const laneNamed = (container: HTMLElement, name: string) =>
  lanesOf(container).find((l) => l.getAttribute('aria-label') === name);

afterEach(cleanup);

describe('the board draws the declared lanes (objectstack#28211)', () => {
  it('(a) draws only the listed lanes, in the listed order', async () => {
    const { container } = await renderBoard(['won', 'new'], 'Deal won');
    const names = lanesOf(container).map((l) => l.getAttribute('aria-label'));
    expect(names.filter((n) => n !== 'Uncategorized')).toEqual(['Won', 'New']);
    expect(names).not.toContain('Working');
    expect(names).not.toContain('Lost');
  });

  it('(b) lands a record whose value is not listed in Uncategorized, never hidden', async () => {
    const { container } = await renderBoard(['won', 'new'], 'Deal won');
    const uncategorized = laneNamed(container, 'Uncategorized');
    expect(uncategorized).toBeDefined();
    expect(uncategorized!.textContent).toContain('Deal in working');
    expect(uncategorized!.textContent).toContain('Deal lost');
    expect(laneNamed(container, 'Won')!.textContent).toContain('Deal won');
    expect(laneNamed(container, 'New')!.textContent).toContain('Deal in new');
  });

  it('(c) starts a listed lost lane collapsed, and leaves the others open', async () => {
    const { container } = await renderBoard(['lost', 'new'], 'Deal in new');
    const lost = laneNamed(container, 'Lost')!;
    expect(within(lost).getByRole('button', { expanded: false })).toBeInTheDocument();
    expect(lost.textContent).not.toContain('Deal lost');
    expect(within(laneNamed(container, 'New')!).queryByRole('button', { expanded: false })).toBeNull();
  });
});
