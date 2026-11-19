/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35548 — the list page's view bar is one bar for every view type.
 *
 * The host's `toolbarLeading` may be a function of the list's state: ListView
 * calls it with the record count it would print and the active layout, so the
 * Console's view switcher draws 「type icon · name · count · caret」 as one
 * trigger (the maintainer's 「记录数显示在下拉左侧」; objectstack#34603 had
 * taken the count away from the name).
 *
 * WHAT IS PINNED.
 *  - A grid hands the leading function `{ recordCount: <total>, layout: 'grid' }`.
 *  - A kanban draws the SAME view bar: the leading node, then 「筛选」「排序」
 *    「选项」 as text triggers, in the same `border-b` row, and is handed
 *    `layout: 'kanban'` with the board's count.
 *  - The condition row under the bar is drawn empty (`empty:hidden`), so it
 *    takes no height until a host portals a condition into it.
 *  - A plain node still works (objectui#12440 keeps its own file).
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView, type ListToolbarLeadingState } from '../ListView';

const OBJECT = 'crm_opportunity';
const TOTAL = 7;

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  stage: {
    type: 'select',
    label: 'Stage',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'won', label: 'Won' },
    ],
  },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({
      data: Array.from({ length: TOTAL }, (_, i) => ({ id: `o-${i}`, name: `Deal ${i}`, stage: i % 2 ? 'won' : 'open' })),
      total: TOTAL,
    })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: FIELDS })),
  } as never;
}

const GRID = { type: 'list-view', objectName: OBJECT, columns: ['name', 'stage'] };
const KANBAN = {
  ...GRID,
  viewType: 'kanban',
  kanban: { groupByField: 'stage', titleField: 'name' },
};

let prev: Record<string, unknown> = {};
beforeAll(() => {
  for (const [type, id] of [['object-grid', 'grid-standin'], ['object-kanban', 'kanban-standin']] as const) {
    prev[type] = ComponentRegistry.get(type);
    ComponentRegistry.register(type, () => <div data-testid={id} />, { namespace: 'test' } as never);
  }
});
afterAll(() => {
  for (const type of ['object-grid', 'object-kanban']) {
    if (prev[type]) ComponentRegistry.register(type, prev[type] as never);
    else ComponentRegistry.unregister(type);
  }
  prev = {};
});
afterEach(cleanup);

function mount(schema: Record<string, unknown>, leading: (s: ListToolbarLeadingState) => React.ReactNode) {
  const ds = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema as never} dataSource={ds} toolbarLeading={leading} />
    </SchemaRendererProvider>,
  );
}

const lead = (calls: ListToolbarLeadingState[]) => (s: ListToolbarLeadingState) => {
  calls.push(s);
  return <span data-testid="host-switcher">{`${s.layout}:${s.recordCount ?? '-'}`}</span>;
};

/** The view bar's own controls, read off the row that carries the leading node. */
function viewBar() {
  const row = screen.getByTestId('list-toolbar-leading').parentElement!.parentElement!;
  return {
    row,
    filter: row.querySelector('[data-testid="toolbar-filter-trigger"]'),
    sort: row.querySelector('[data-testid="toolbar-sort-trigger"]'),
    options: row.querySelector('[data-testid="toolbar-display-trigger"]'),
  };
}

describe('objectstack#35548 — one view bar, handed the list state', () => {
  it('a grid hands the leading function its total and layout', async () => {
    const calls: ListToolbarLeadingState[] = [];
    mount(GRID, lead(calls));
    await waitFor(() => expect(screen.getByTestId('host-switcher')).toHaveTextContent(`grid:${TOTAL}`));
    expect(calls.at(-1)).toEqual({ recordCount: TOTAL, layout: 'grid' });
  });

  it('a kanban draws the same bar: leading node, then the text triggers, in one bordered row', async () => {
    const calls: ListToolbarLeadingState[] = [];
    mount(KANBAN, lead(calls));
    await waitFor(() => expect(screen.getByTestId('kanban-standin')).toBeInTheDocument());
    await waitFor(() => expect(calls.at(-1)?.layout).toBe('kanban'));

    const bar = viewBar();
    expect(bar.row.className.split(/\s+/)).toEqual(expect.arrayContaining(['border-b', 'sm:h-10']));
    for (const trigger of [bar.filter, bar.sort, bar.options]) {
      expect(trigger, 'a text trigger is missing from the kanban view bar').not.toBeNull();
      expect(trigger!.className.split(/\s+/)).toContain('text-[13px]');
    }
    // Text, not icons, from `sm` up: each trigger carries its label.
    expect(bar.filter!.textContent).toMatch(/Filter|筛选/);
    expect(bar.sort!.textContent).toMatch(/Sort|排序/);
    expect(bar.options!.textContent).toMatch(/Options|选项/);
  });

  it('draws the condition row empty, so it takes no height', async () => {
    mount(GRID, lead([]));
    await waitFor(() => expect(screen.getByTestId('host-switcher')).toBeInTheDocument());
    const slot = screen.getByTestId('list-condition-row');
    expect(slot).toBeEmptyDOMElement();
    expect(slot.className.split(/\s+/)).toContain('empty:hidden');
  });
});
