/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36270 — the grid an `object-view` draws itself (route 2, no
 * `renderListView` host) edits as the list page's grid does when the view
 * makes it editable: a click selects a cell, Enter opens its editor, and the
 * committed cell saves on its own. No pending-changes bar and no "Save All"
 * is drawn. A read-only grid keeps click-to-open.
 *
 * Mounts the REAL `ObjectGrid` under `ObjectView`, with the same harness as
 * `ObjectView.tableEditable-10976.test.tsx`, and reads what a user sees: the
 * write the data source receives and the bar that is (not) drawn.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
import { ObjectView } from '../ObjectView';
import { installExplainDouble } from './explainDouble';

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const OBJECT = 'per_cell_save_task';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

beforeEach(() => {
  installExplainDouble();
});

afterEach(() => {
  // Unmount before restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', name: 'Alpha' },
    r2: { id: 'r2', name: 'Beta' },
  };
  const update = vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
    store[id] = { ...store[id], ...changes };
    return { ...store[id] };
  });
  return {
    update,
    ds: {
      find: vi.fn(async () => ({ data: Object.values(store).map((r) => ({ ...r })), total: 2 })),
      findOne: vi.fn(),
      create: vi.fn(),
      update,
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => ({
        name: OBJECT,
        label: 'Task',
        fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
      })),
    } as unknown as DataSource,
  };
}

function mount(schema: ObjectViewSchema, ds: DataSource) {
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Select the `Alpha` cell, open its editor with Enter, type `value`, commit with Enter. */
async function editAlpha(value: string) {
  await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
  const td = screen.getByText('Alpha').closest('td') as HTMLElement;
  fireEvent.click(td);
  const catcher = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]');
    expect(el).toBeTruthy();
    return el!;
  });
  fireEvent.keyDown(catcher, { key: 'Enter' });
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('td[data-editing-cell] input');
    expect(el).toBeTruthy();
    return el!;
  });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe("objectstack#36270 — an editable object-view's own grid saves each cell on its own", () => {
  it('`table.editable`: the committed cell sends one update for its record, and no Save All is drawn', async () => {
    const { ds, update } = makeDataSource();
    mount({ type: 'object-view', objectName: OBJECT, layout: 'drawer', table: { columns: ['name'], editable: true } }, ds);
    await editAlpha('Alpha one');
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toBe(OBJECT);
    expect(update.mock.calls[0][1]).toBe('r1');
    expect(update.mock.calls[0][2]).toEqual({ name: 'Alpha one' });
    await screen.findByText('Alpha one');
    expect(screen.queryByText(/Save All/)).toBeNull();
    expect(screen.queryByText(/Cancel All/)).toBeNull();
    // Selecting and editing a cell opened no record.
    expect(screen.queryByTestId('object-form')).toBeNull();
  });

  it("a named view's `inlineEdit: true`: the same per-cell save", async () => {
    const { ds, update } = makeDataSource();
    const schema = {
      type: 'object-view',
      objectName: OBJECT,
      layout: 'drawer',
      defaultListView: 'v1',
      listViews: { v1: { label: 'Open work', type: 'grid', columns: ['name'], inlineEdit: true } },
    } as unknown as ObjectViewSchema;
    mount(schema, ds);
    await editAlpha('Alpha two');
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2]).toEqual({ name: 'Alpha two' });
    expect(screen.queryByText(/Save All/)).toBeNull();
  });

  it('CONTROL: a read-only object-view grid keeps click-to-open and selects no cell', async () => {
    const { ds } = makeDataSource();
    mount({ type: 'object-view', objectName: OBJECT, layout: 'drawer', table: { columns: ['name'] } }, ds);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha').closest('td') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('object-form')).toBeInTheDocument());
    expect(document.querySelector('[data-slot="cell-type-catcher"]')).toBeNull();
  });
});
