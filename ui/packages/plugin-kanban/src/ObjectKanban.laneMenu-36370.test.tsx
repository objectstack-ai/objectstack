/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36370 — the lane header's 「+」 and 「⋯」, drawn where the host
 * passes `laneMenu` (`KanbanLaneMenu.ts`).
 *
 * Rows:
 *   (a) without `laneMenu` no lane header draws either control;
 *   (b) 「+」 reports its lane, and an empty lane carries a 「+ New」 row;
 *   (c) 「Hide column」 reports its lane; the `Uncategorized` lane offers
 *       neither hide nor create;
 *   (d) 「Collapse column」 collapses the lane, kept in this browser under the
 *       host's `collapseKey`: a new mount under that key opens collapsed, one
 *       under another key does not.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, waitFor, cleanup, within, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectKanban } from './ObjectKanban';
import type { KanbanLaneMenuRequest } from './KanbanLaneMenu';
import { KANBAN_LANE_COLLAPSE_PREFIX } from './KanbanLaneMenu';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase.
import './KanbanImpl';

const STAGE_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'working', label: 'Working' },
  { value: 'won', label: 'Won' },
];

const OBJECT_SCHEMA = {
  name: 'menu_deal',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    stage: { name: 'stage', type: 'select', label: 'Stage', options: STAGE_OPTIONS },
  },
};

const ROWS = [
  { id: 'd1', name: 'Deal in new', stage: 'new' },
  { id: 'd2', name: 'Deal in working', stage: 'working' },
  { id: 'd3', name: 'Deal nowhere', stage: 'gone' },
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

async function renderBoard(laneMenu?: KanbanLaneMenuRequest, waitForText = 'Deal in working') {
  const dataSource = makeDataSource();
  const result = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ObjectKanban
        schema={{ type: 'object-kanban', objectName: 'menu_deal', groupBy: 'stage' } as any}
        dataSource={dataSource}
        laneMenu={laneMenu}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(result.container.textContent).toContain(waitForText));
  return result;
}

const lanesOf = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[role="group"][aria-label]'));
const laneNamed = (container: HTMLElement, name: string): HTMLElement => {
  const lane = lanesOf(container).find((l) => l.getAttribute('aria-label') === name);
  if (!lane) throw new Error(`no lane named ${name}`);
  return lane;
};

/** Opens a lane's 「⋯」 menu (Radix opens on pointer down) and returns its items. */
async function openMenu(lane: HTMLElement): Promise<HTMLElement[]> {
  const trigger = lane.querySelector<HTMLElement>('[data-kanban-lane-menu]');
  if (!trigger) throw new Error('no lane menu');
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  return await waitFor(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.length).toBeGreaterThan(0);
    return items;
  });
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the lane header menu (objectstack#36370)', () => {
  it('(a) draws no 「+」 and no 「⋯」 without the host request', async () => {
    const { container } = await renderBoard();
    expect(container.querySelector('[data-kanban-lane-menu]')).toBeNull();
    expect(container.querySelector('[data-kanban-lane-create]')).toBeNull();
    expect(container.querySelector('[data-kanban-lane-create-row]')).toBeNull();
  });

  it('(b) reports the lane of its 「+」, and gives an empty lane a 「+ New」 row', async () => {
    const onCreateInLane = vi.fn();
    const { container } = await renderBoard({ onCreateInLane });
    const working = laneNamed(container, 'Working');
    fireEvent.click(within(working).getByRole('button', { name: 'New record in Working' }));
    expect(onCreateInLane).toHaveBeenLastCalledWith('working');

    const won = laneNamed(container, 'Won');
    const row = won.querySelector<HTMLElement>('[data-kanban-lane-create-row]');
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(onCreateInLane).toHaveBeenLastCalledWith('won');
    // A lane holding cards draws no create row.
    expect(working.querySelector('[data-kanban-lane-create-row]')).toBeNull();
    // An open lane keeps its bare title: it collapses from its 「⋯」, and only
    // a collapsed lane's heading is a disclosure (row d).
    expect(within(working).queryByRole('button', { expanded: true })).toBeNull();
  });

  it('(c) reports the lane its 「Hide column」 hides; Uncategorized offers neither hide nor create', async () => {
    const onHideLane = vi.fn();
    const onCreateInLane = vi.fn();
    const { container } = await renderBoard({ onHideLane, onCreateInLane });
    const items = await openMenu(laneNamed(container, 'New'));
    const hide = items.find((item) => item.textContent?.includes('Hide column'));
    expect(hide).toBeDefined();
    await act(async () => {
      fireEvent.click(hide!);
    });
    expect(onHideLane).toHaveBeenCalledWith('new');

    const uncategorized = laneNamed(container, 'Uncategorized');
    expect(uncategorized.querySelector('[data-kanban-lane-create]')).toBeNull();
    const uncategorizedItems = await openMenu(uncategorized);
    expect(uncategorizedItems.map((item) => item.textContent)).toEqual(['Collapse column']);
  });

  it('(d) collapses a lane from its menu and keeps it collapsed in this browser, under the host\'s key', async () => {
    const first = await renderBoard({ collapseKey: 'u1:menu_deal:pipeline' });
    const items = await openMenu(laneNamed(first.container, 'Working'));
    await act(async () => {
      fireEvent.click(items.find((item) => item.textContent?.includes('Collapse column'))!);
    });
    await waitFor(() => expect(laneNamed(first.container, 'Working').textContent).not.toContain('Deal in working'));
    expect(JSON.parse(localStorage.getItem(`${KANBAN_LANE_COLLAPSE_PREFIX}:u1:menu_deal:pipeline`)!)).toEqual({ working: true });
    cleanup();

    // The same board mounted again opens with the lane collapsed, and its
    // heading opens it again.
    const { container } = await renderBoard({ collapseKey: 'u1:menu_deal:pipeline' }, 'Deal in new');
    const working = laneNamed(container, 'Working');
    expect(working.textContent).not.toContain('Deal in working');
    fireEvent.click(within(working).getByRole('button', { expanded: false }));
    await waitFor(() => expect(laneNamed(container, 'Working').textContent).toContain('Deal in working'));
    expect(JSON.parse(localStorage.getItem(`${KANBAN_LANE_COLLAPSE_PREFIX}:u1:menu_deal:pipeline`)!)).toEqual({ working: false });
    cleanup();

    // Another board's key does not read it.
    localStorage.setItem(`${KANBAN_LANE_COLLAPSE_PREFIX}:u1:menu_deal:pipeline`, JSON.stringify({ working: true }));
    const other = await renderBoard({ collapseKey: 'u1:menu_deal:other' });
    expect(laneNamed(other.container, 'Working').textContent).toContain('Deal in working');
  });
});
