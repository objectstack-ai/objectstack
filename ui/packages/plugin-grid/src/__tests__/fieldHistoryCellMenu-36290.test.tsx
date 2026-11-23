/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36290, part ③ — a list cell's context menu offers the cell's
 * field's change history, and choosing it opens the same card the record page
 * opens, in place. Driven through the real `ObjectGrid` → `data-table` chain.
 *
 * 1. A right-click on a cell of a field the object declares lists
 *    「Change history」; choosing it opens the card with that record's changes
 *    of that field.
 * 2. A field the reader may not read is not drawn as a column, and a cell of a
 *    column the object does not declare offers no history.
 * 3. A data source that cannot read activity (no `find`) offers none.
 * 4. A field whose old → new values the writer never records
 *    (`fieldHistory: false`) offers none.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const permissions = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      isLoaded: true,
      checkField: (_object: string, field: string) => !permissions.denied.has(field),
      getObjectApiOperations: () => undefined,
      can: () => true,
      check: () => ({ allowed: true }),
    }),
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

afterEach(() => {
  cleanup();
  permissions.denied.clear();
});

const OBJECT = 'account';
const ROWS = [
  { id: 'a1', name: 'Acme', status: 'draft', score: 3, derived: 'x', quiet: 'q1' },
  { id: 'a2', name: 'Globex', status: 'active', score: 5, derived: 'y', quiet: 'q2' },
];

const activityRow = (id: string, field: string, from: string, to: string) => ({
  id,
  type: 'updated',
  summary: 'stored summary',
  timestamp: '2026-11-20T10:00:00.000Z',
  actor_name: 'Grace',
  metadata: JSON.stringify({
    summary_message: { key: 'fieldChanges', object: OBJECT, changes: [{ field, from: { text: from }, to: { text: to } }] },
  }),
});

function renderGrid(opts: { withFind?: boolean } = {}) {
  const find = vi.fn(async (object: string, params: Record<string, any>) => {
    if (object !== 'sys_activity') return { data: [] };
    return params.$filter?.record_id === 'a2'
      ? { data: [activityRow('h1', 'status', 'draft', 'active'), activityRow('h0', 'score', '4', '5')] }
      : { data: [] };
  });
  const dataSource: any = {
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        status: { type: 'text', label: 'Status' },
        score: { type: 'number', label: 'Score' },
        // History off on the field: the writer records no values for it.
        quiet: { type: 'text', label: 'Quiet', fieldHistory: false },
      },
    }),
    ...(opts.withFind === false ? {} : { find }),
  };
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'status', label: 'Status' },
      { field: 'score', label: 'Score' },
      { field: 'quiet', label: 'Quiet' },
      // A host-joined column the object does not declare.
      { field: 'derived', label: 'Derived' },
    ],
    data: { provider: 'value', items: ROWS },
    selection: { type: 'none' },
  };
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid schema={schema} dataSource={dataSource} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  return { find };
}

const cellOf = (rowName: string, text: string) =>
  within(screen.getByText(rowName).closest('tr') as HTMLElement).getByText(text).closest('td') as HTMLElement;
const rightClick = (el: HTMLElement) => fireEvent.contextMenu(el, { button: 2, clientX: 40, clientY: 60 });

async function settle() {
  await waitFor(() => expect(screen.getByText('Globex')).toBeInTheDocument());
  // The offer reads the object's declared fields; wait for the schema.
  await waitFor(() => expect(screen.getByText('Score')).toBeInTheDocument());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('a list cell\'s 「Change history」 (objectstack#36290)', () => {
  it('a right-click on a field\'s cell lists it; choosing it opens that record\'s changes of that field', async () => {
    const { find } = renderGrid();
    await settle();
    act(() => { rightClick(cellOf('Globex', 'active')); });
    const menu = await screen.findByTestId('row-context-menu');
    fireEvent.click(within(menu).getByTestId('row-context-field-history'));
    const card = await waitFor(() => {
      const el = document.querySelector('[data-field-history="status"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => expect(card.querySelectorAll('[data-field-history-entry]')).toHaveLength(1));
    expect(card.querySelector('[data-field-change-side="old"]')).toHaveTextContent('draft');
    expect(card.querySelector('[data-field-change-side="new"]')).toHaveTextContent('active');
    expect(find).toHaveBeenCalledWith('sys_activity', expect.objectContaining({
      $filter: { object_name: OBJECT, record_id: 'a2' },
    }));
  });

  it('a field the reader may not read has no column, so no cell offers its history', async () => {
    permissions.denied.add('status');
    renderGrid();
    await settle();
    expect(screen.queryByText('draft')).toBeNull();
    // CONTROL: a readable field's cell still offers its own.
    act(() => { rightClick(cellOf('Acme', '3')); });
    const menu = await screen.findByTestId('row-context-menu');
    expect(within(menu).getByTestId('row-context-field-history')).toBeInTheDocument();
  });

  it('a column the object does not declare offers no history', async () => {
    renderGrid();
    await settle();
    act(() => { rightClick(cellOf('Acme', 'x')); });
    expect(screen.queryByTestId('row-context-field-history')).toBeNull();
  });

  it('a field whose values are not recorded offers none (control: a recorded field\'s cell does)', async () => {
    renderGrid();
    await settle();
    act(() => { rightClick(cellOf('Acme', 'q1')); });
    // This table offers no row action of its own, so with no history to offer
    // the cell keeps the browser's menu: no row menu opens at all.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId('row-context-menu')).toBeNull();
    expect(screen.queryByTestId('row-context-field-history')).toBeNull();
    cleanup();
    renderGrid();
    await settle();
    act(() => { rightClick(cellOf('Acme', '3')); });
    const menu = await screen.findByTestId('row-context-menu');
    expect(within(menu).getByTestId('row-context-field-history')).toBeInTheDocument();
  });

  it('a data source that cannot read activity offers none', async () => {
    renderGrid({ withFind: false });
    await settle();
    act(() => { rightClick(cellOf('Acme', 'draft')); });
    expect(screen.queryByTestId('row-context-field-history')).toBeNull();
  });
});
