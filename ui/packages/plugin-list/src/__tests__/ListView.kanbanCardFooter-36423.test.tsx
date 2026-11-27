/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36423 — `kanban.cardFooter` through `ListView`: the block's
 * counts reach the `object-kanban` node only when declared, and the board's
 * 视图设置 offers a toggle for each count the object has (comments where its
 * discussion is on, attachments where it takes files), writing the member on
 * or gone, and no `cardFooter` once neither is on.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const OBJECT = 'footer_deal';

const objectDefWith = (enable: Record<string, unknown> | undefined) => ({
  name: OBJECT,
  label: 'Deal',
  ...(enable ? { enable } : {}),
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    stage: { name: 'stage', type: 'select', label: 'Stage', options: [{ label: 'New', value: 'new' }] },
  },
});

const rows = [{ id: 'd1', name: 'Alpha', stage: 'new' }];

let boardNodes: Array<Record<string, any>> = [];
ComponentRegistry.register(
  'object-kanban',
  (props: Record<string, any>) => {
    boardNodes.push(props.schema ?? props);
    return <div data-testid="object-kanban-spy" />;
  },
  { namespace: 'test', label: 'object-kanban spy', category: 'view' },
);

const makeDataSource = (enable: Record<string, unknown> | undefined) =>
  ({
    find: vi.fn(async () => rows),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => rows.length),
    getObjectSchema: vi.fn(async () => objectDefWith(enable)),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  }) as any;

function mount(kanban: Record<string, unknown>, enable: Record<string, unknown> | undefined, onKanbanChange = vi.fn()) {
  boardNodes = [];
  const dataSource = makeDataSource(enable);
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, viewType: 'kanban', columns: ['name'], kanban } as never}
        dataSource={dataSource}
        onKanbanChange={onKanbanChange}
      />
    </SchemaRendererProvider>,
  );
  return onKanbanChange;
}

async function openSettings() {
  await waitFor(() => expect(screen.getByTestId('object-kanban-spy')).toBeTruthy());
  // The toggles depend on the definition: let it settle before opening.
  await waitFor(() => expect(boardNodes.length).toBeGreaterThan(0));
  fireEvent.click(await screen.findByTestId('toolbar-display-trigger'));
  await screen.findByTestId('options-card-toggles');
}

afterEach(cleanup);

describe('ListView on a board: the card footer counts (objectstack#36423)', () => {
  it('relays a declared cardFooter onto the board node, and nothing without one', async () => {
    mount({ groupByField: 'stage', cardFooter: { comments: true } }, { files: true });
    await waitFor(() => expect(boardNodes[boardNodes.length - 1]?.cardFooter).toEqual({ comments: true }));
    cleanup();
    mount({ groupByField: 'stage' }, { files: true });
    await waitFor(() => expect(boardNodes.length).toBeGreaterThan(0));
    expect(boardNodes.every((node) => !('cardFooter' in node))).toBe(true);
  });

  it('turning a count on writes that member; off writes it gone, and no block once neither is on', async () => {
    const write = mount({ groupByField: 'stage' }, { files: true });
    await openSettings();
    fireEvent.click(await screen.findByTestId('options-toggle-footer-comments-switch'));
    expect(write).toHaveBeenLastCalledWith({ cardFooter: { comments: true } });
    cleanup();

    const both = mount({ groupByField: 'stage', cardFooter: { comments: true, attachments: true } }, { files: true });
    await openSettings();
    expect(screen.getByTestId('options-toggle-footer-comments-switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('options-toggle-footer-comments-switch'));
    expect(both).toHaveBeenLastCalledWith({ cardFooter: { attachments: true } });
    cleanup();

    const last = mount({ groupByField: 'stage', cardFooter: { attachments: true } }, { files: true });
    await openSettings();
    fireEvent.click(await screen.findByTestId('options-toggle-footer-attachments-switch'));
    expect(last).toHaveBeenLastCalledWith({ cardFooter: null });
  });

  it('offers a count only where the object has it', async () => {
    mount({ groupByField: 'stage' }, undefined);
    await openSettings();
    expect(screen.getByTestId('options-toggle-footer-comments')).toBeTruthy();
    expect(screen.queryByTestId('options-toggle-footer-attachments')).toBeNull();
    cleanup();

    mount({ groupByField: 'stage' }, { feeds: false, files: true });
    await openSettings();
    expect(screen.queryByTestId('options-toggle-footer-comments')).toBeNull();
    expect(screen.getByTestId('options-toggle-footer-attachments')).toBeTruthy();
  });
});
