/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12463 — the list's half of the bounded height chain.
 *
 * On desktop the grid's rows scroll inside the table's own box while the
 * toolbar above and the record-count footer below stay put. `ListView`'s part
 * is: a full-height flex column root, the toolbar and the footer as
 * non-scrolling siblings OUTSIDE the view body, and a view body that is the
 * column's `flex-1 min-h-0` item handing the visualization `h-full`. The
 * table's own scroll box is `data-table`'s and is pinned beside it
 * (`data-table-scroll-shadow-12463.test.tsx`); jsdom does no layout, so the
 * scrolling itself was read in a real browser and is reported on the PR.
 *
 * The grid is a stub: what is pinned here is where ListView puts it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const RECORDS = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), name: `Lead ${i + 1}`, stage: 'new' }));

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: RECORDS, total: RECORDS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'lead', fields: {} }),
  };
}

const SCHEMA = {
  type: 'list-view',
  objectName: 'lead',
  viewType: 'grid',
  fields: ['name', 'stage'],
  kanban: { groupByField: 'stage' },
} as ListViewSchema;

const stubbed = ['object-grid', 'object-kanban'] as const;
const previous: Record<string, ReturnType<typeof ComponentRegistry.get>> = {};

beforeEach(() => {
  for (const type of stubbed) {
    previous[type] = ComponentRegistry.get(type);
    ComponentRegistry.register(type, (props: { schema?: { className?: string } }) => (
      <div data-testid={`${type}-stub`} className={props.schema?.className} />
    ));
  }
});

afterEach(() => {
  cleanup();
  for (const type of stubbed) {
    if (previous[type]) ComponentRegistry.register(type, previous[type] as never);
  }
});

function mount(schema: Partial<ListViewSchema> = {}) {
  render(
    <div className="h-[600px]">
      <SchemaRendererProvider dataSource={makeDataSource() as never}>
        <ListView schema={{ ...SCHEMA, ...schema } as ListViewSchema} dataSource={makeDataSource() as never} />
      </SchemaRendererProvider>
    </div>,
  );
}

function viewBodyOf(el: HTMLElement): HTMLElement {
  const body = el.closest('.min-h-0') as HTMLElement | null;
  if (!body) throw new Error('no bounded view body above the visualization');
  return body;
}

describe('ListView bounds the visualization between a fixed toolbar and footer (objectui#12463)', () => {
  it('grid: the body is the flex-1 min-h-0 item; toolbar above and the 50-record footer below stay outside it', async () => {
    mount();
    const grid = await screen.findByTestId('object-grid-stub');
    expect(grid).toHaveClass('h-full', 'w-full');

    const body = viewBodyOf(grid);
    expect(body).toHaveClass('flex-1', 'min-h-0', 'overflow-hidden');
    const root = body.parentElement as HTMLElement;
    expect(root).toHaveClass('flex', 'flex-col', 'h-full', 'overflow-hidden');

    const footer = await screen.findByTestId('record-count-bar');
    expect(footer).toHaveTextContent('50');
    expect(footer).toHaveClass('shrink-0');
    expect(footer.parentElement).toBe(root);
    expect(body.contains(footer)).toBe(false);
    expect(body.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const toolbar = document.querySelector('[data-print-hide]') as HTMLElement;
    expect(toolbar).not.toBeNull();
    expect(body.contains(toolbar)).toBe(false);
    expect(body.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('a non-grid visualization (kanban) sits in the same body, unchanged, with no table scroll box', async () => {
    mount({ viewType: 'kanban' } as Partial<ListViewSchema>);
    const board = await screen.findByTestId('object-kanban-stub');
    expect(board).toHaveClass('h-full', 'w-full');
    expect(viewBodyOf(board)).toHaveClass('flex-1', 'min-h-0', 'overflow-hidden');
    expect(document.querySelector('[data-testid="data-table-scroll-box"]')).toBeNull();
  });
});
