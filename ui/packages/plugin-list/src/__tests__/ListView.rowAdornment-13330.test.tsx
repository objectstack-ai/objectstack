/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13330 — `rowAdornment`, the host prop the console's Users list sets
 * on a managed environment, reaches the grid as the grid's own `rowAdornment`
 * (a React prop a host passes, never a view key), and only the grid: a board
 * draws no title cell to put it beside. The control mounts the same schema
 * without the prop and the grid is handed none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const GRID = { type: 'list-view', objectName: 'sys_user', viewType: 'grid', fields: ['name'] } as ListViewSchema;
const BOARD = {
  type: 'list-view',
  objectName: 'sys_user',
  viewType: 'kanban',
  fields: ['name'],
  options: { kanban: { groupBy: 'status' } },
} as unknown as ListViewSchema;

let gridProps: Record<string, unknown> | undefined;
let boardProps: Record<string, unknown> | undefined;
let previousGrid: ReturnType<typeof ComponentRegistry.get>;
let previousBoard: ReturnType<typeof ComponentRegistry.get>;

function mount(schema: ListViewSchema, props: Record<string, unknown> = {}) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Ada', status: 'active' }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'sys_user',
      fields: { name: { type: 'text' }, status: { type: 'select', options: [{ value: 'active', label: 'Active' }] } },
    }),
  };
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={schema} dataSource={dataSource as never} {...props} />
    </SchemaRendererProvider>,
  );
}

beforeEach(() => {
  gridProps = undefined;
  boardProps = undefined;
  previousGrid = ComponentRegistry.get('object-grid');
  previousBoard = ComponentRegistry.get('object-kanban');
  ComponentRegistry.register('object-grid', (props: any) => {
    gridProps = props;
    return <div data-testid="grid-stub" />;
  });
  ComponentRegistry.register('object-kanban', (props: any) => {
    boardProps = props;
    return <div data-testid="board-stub" />;
  });
});

afterEach(() => {
  cleanup();
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
  if (previousBoard) ComponentRegistry.register('object-kanban', previousBoard as any);
});

describe('ListView rowAdornment reaches the grid (objectui#13330)', () => {
  it('the grid is handed the host’s function as its own rowAdornment', async () => {
    const rowAdornment = vi.fn(() => null);
    mount(GRID, { rowAdornment });
    await screen.findByTestId('grid-stub');
    expect(gridProps?.rowAdornment).toBe(rowAdornment);
  });

  it('a board is not handed it', async () => {
    mount(BOARD, { rowAdornment: vi.fn(() => null) });
    await screen.findByTestId('board-stub');
    expect(boardProps).toBeDefined();
    expect(boardProps && 'rowAdornment' in boardProps).toBe(false);
  });

  it('CONTROL — without the prop the grid is handed none', async () => {
    mount(GRID);
    await screen.findByTestId('grid-stub');
    expect(gridProps).toBeDefined();
    expect(gridProps && 'rowAdornment' in gridProps).toBe(false);
  });
});
