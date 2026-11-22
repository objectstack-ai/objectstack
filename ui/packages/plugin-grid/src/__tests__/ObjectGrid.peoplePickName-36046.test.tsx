/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36046 — a person picked in a list cell is drawn by name at
 * once, from the pick itself.
 *
 * The cell's edit stores the person's id, and the write answers the id too,
 * while the person cell draws a person from the expanded record a list read
 * brings. Before the fix the cell drew the raw id from the pick until the
 * next read of the list. The pick hands its record to the cache the
 * reference cells already read, so the cell draws the name and face from it:
 * while the save is on the wire, and once it landed, with no read of the
 * list and no read of the person.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() });
  return { ...actual, toast };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { __resetApprovalsServiceLatch } from '../hooks/useRowApprovalLocks';
import { installExplainDouble } from './explainDouble';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn() as any;
});
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  __resetApprovalsServiceLatch();
  installExplainDouble();
  try { window.localStorage.clear(); } catch { /* no storage */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'deal';
// Ids unique to this file: the reference cache is module-wide.
const PEOPLE = [
  { id: 'u36046_amy', name: 'Amy Lin', email: 'amy@x.io' },
  { id: 'u36046_bob', name: 'Bob Wu (Sales)', email: 'bob@x.io' },
];

/**
 * A server whose list is read once: every later read of the deals and every
 * read of one person never answers, so whatever the cell draws after the
 * pick comes from the pick. `landWrites: false` keeps the write on the wire.
 */
function makeDataSource(landWrites: boolean) {
  const store: Record<string, any> = {
    d1: { id: 'd1', name: 'Alpha', owner: { ...PEOPLE[0] }, updated_at: '2026-11-20T10:00:00.000Z' },
  };
  let dealReads = 0;
  const never = new Promise<never>(() => {});
  const find = vi.fn(async (object: string, params: any = {}) => {
    if (object === 'sys_user') {
      const idIn = params?.$filter?.id?.$in as any[] | undefined;
      const data = idIn ? PEOPLE.filter((p) => idIn.map(String).includes(p.id)) : PEOPLE;
      return { data: data.map((p) => ({ ...p })), total: data.length, hasMore: false };
    }
    dealReads += 1;
    if (dealReads > 1) return never;
    const data = Object.values(store).map((r) => ({ ...r }));
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  const findOne = vi.fn(() => never);
  const update = vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
    if (!landWrites) return never;
    // The write answers a person as the id it stores.
    store[id] = { ...store[id], ...changes, updated_at: '2026-11-20T11:00:00.000Z' };
    return { ...store[id] };
  });
  return {
    find,
    findOne,
    update,
    getObjectSchema: async (name: string) =>
      name === 'sys_user'
        ? { name, fields: { id: { type: 'text' }, name: { type: 'text' }, email: { type: 'email' } } }
        : {
            name,
            fields: {
              id: { type: 'text' },
              name: { type: 'text', label: 'Name' },
              owner: { type: 'user', label: 'Owner' },
              updated_at: { type: 'datetime' },
            },
          },
  } as any;
}

function renderGrid(ds: any) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'owner', label: 'Owner' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider>
      {/* The console's provider: the cell's picker reads its data source here. */}
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} cellSelection />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

const ownerCell = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('tbody tr')[0].querySelectorAll<HTMLElement>('td'))
    .find((td) => td.textContent?.includes('Amy Lin') || td.textContent?.includes('Bob Wu') || td.textContent?.includes('u36046_'))!;

/** Select the owner cell, open its editor with Enter, and pick Bob. */
async function pickBob(container: HTMLElement) {
  fireEvent.click(ownerCell(container));
  const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
  fireEvent.keyDown(catcher, { key: 'Enter' });
  const panel = await screen.findByTestId('people-picker-in-cell');
  const bob = await waitFor(() => {
    const row = within(panel).getAllByTestId('person-row').find((r) => r.textContent?.includes('Bob Wu'));
    expect(row).toBeTruthy();
    return row!;
  });
  fireEvent.click(bob);
}

describe('ObjectGrid — a person picked in a cell is drawn by name at once (objectstack#36046)', () => {
  it('while the save is on the wire: the name and face, never the id', async () => {
    const ds = makeDataSource(false);
    const { container } = renderGrid(ds);
    await screen.findByText('Amy Lin');
    await pickBob(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ owner: 'u36046_bob' });
    await waitFor(() => expect(screen.queryByTestId('people-picker-in-cell')).toBeNull());
    const cell = ownerCell(container);
    expect(cell).toHaveTextContent('Bob Wu (Sales)');
    expect(cell).not.toHaveTextContent('u36046_bob');
    expect(cell.querySelector('[data-slot="unresolved-reference"]')).toBeNull();
    // The face's initials are letters only.
    expect(cell).toHaveTextContent(/^BS/);
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('once the save landed with the id: still the name, with no read of the list or the person', async () => {
    const ds = makeDataSource(true);
    const { container } = renderGrid(ds);
    await screen.findByText('Amy Lin');
    const dealReads = ds.find.mock.calls.filter((c: any[]) => c[0] === OBJECT).length;
    await pickBob(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('people-picker-in-cell')).toBeNull());
    // Let the write's answer reach the row.
    await new Promise((r) => setTimeout(r, 0));
    const cell = ownerCell(container);
    expect(cell).toHaveTextContent('Bob Wu (Sales)');
    expect(cell).not.toHaveTextContent('u36046_bob');
    expect(cell.querySelector('[data-slot="unresolved-reference"]')).toBeNull();
    expect(ds.find.mock.calls.filter((c: any[]) => c[0] === OBJECT).length).toBe(dealReads);
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});
