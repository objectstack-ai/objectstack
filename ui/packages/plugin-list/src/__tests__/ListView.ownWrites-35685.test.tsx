/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ListView` and the grid's own cell saves (objectstack#35685).
 *
 * The select-first grid redraws a saved row from the write's answer, so the
 * list must not read every row again when that write is announced, either by
 * the data source's `onMutation` or on the data-invalidation bus. The grid
 * holds the record in the registry the list provides (`OwnWritesContext`) for
 * the length of its write; any other write still re-reads the list.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider, useOwnWrites, notifyDataChanged, type OwnWrites } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

let held: OwnWrites | null = null;
let prevObjectGrid: ReturnType<typeof ComponentRegistry.get>;

beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => {
    held = useOwnWrites();
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});
beforeEach(() => {
  held = null;
});

function makeDataSource() {
  const listeners = new Set<(e: { type: string; resource: string; id?: string }) => void>();
  return {
    find: vi.fn().mockResolvedValue([{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    onMutation: (cb: (e: { type: string; resource: string; id?: string }) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    /** A write announced the way the adapter and the console's bridge announce it. */
    announce(id: string) {
      for (const l of Array.from(listeners)) l({ type: 'update', resource: 'contacts', id });
      notifyDataChanged({ objectName: 'contacts', recordId: id });
    },
  };
}

const view: ListViewSchema = {
  type: 'list-view',
  compactToolbar: false,
  objectName: 'contacts',
  viewType: 'grid',
  fields: ['name'],
} as ListViewSchema;

async function renderList(ds: ReturnType<typeof makeDataSource>) {
  render(
    <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
      <ListView schema={view} dataSource={ds as unknown as DataSource} />
    </SchemaRendererProvider>,
  );
  await screen.findByTestId('grid-stub');
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  // Let the first load settle before counting reads.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return ds.find.mock.calls.length;
}

describe('ListView — a write the grid holds as its own re-reads nothing (objectstack#35685)', () => {
  it('hands the grid a registry, and a held record\'s write re-reads no row', async () => {
    const ds = makeDataSource();
    const reads = await renderList(ds);
    expect(held).not.toBeNull();
    const release = held!.hold('contacts', '1');
    await act(async () => { ds.announce('1'); await new Promise((r) => setTimeout(r, 20)); });
    expect(ds.find.mock.calls.length).toBe(reads);
    release();
  });

  it('control: once released, or for another record, the write re-reads the list', async () => {
    const ds = makeDataSource();
    const reads = await renderList(ds);
    const release = held!.hold('contacts', '1');
    await act(async () => { ds.announce('2'); await new Promise((r) => setTimeout(r, 20)); });
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(reads));
    release();
    const after = ds.find.mock.calls.length;
    await act(async () => { ds.announce('1'); await new Promise((r) => setTimeout(r, 20)); });
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(after));
  });
});
