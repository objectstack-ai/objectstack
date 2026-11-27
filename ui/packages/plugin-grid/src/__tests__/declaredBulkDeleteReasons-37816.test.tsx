/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#37816 item 2 — a view-declared
 * `bulkActionDefs[].operation: 'delete'` does NOT go through `recordDelete`
 * (the list's built-in Delete, fixed by #37758). It runs in the bulk action
 * dialog's executor, whose result panel already names every refused record by
 * its title, beside that record's own reason, on both paths: the data
 * source's batch delete (the reasons it names per id, objectui#13442) and the
 * row-by-row fallback. These pin that measurement on the real ObjectGrid.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ isLoaded: false, checkField: () => true, getObjectApiOperations: () => undefined, can: () => true }),
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'project_task';
const ROWS = [
  { id: 't1', name: 'Kickoff' },
  { id: 't2', name: 'Review' },
  { id: 't3', name: 'Launch' },
];
const RESTRICT = 'Cannot delete: referenced by 2 time entries';

async function runDeclaredDelete(dataSource: any) {
  render(
    <ObjectGrid
      schema={{
        type: 'object-grid',
        objectName: OBJECT,
        columns: [{ field: 'name', label: 'Name' }],
        pagination: { pageSize: 50 },
        bulkActionDefs: [{ name: 'purge', label: 'Purge', operation: 'delete', variant: 'danger' }],
      } as any}
      dataSource={{
        find: vi.fn(async () => ({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length, hasMore: false, pageSize: 50 })),
        getObjectSchema: async (name: string) => ({
          name,
          nameField: 'name',
          fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
        }),
        ...dataSource,
      }}
    />,
  );
  await waitFor(() => expect(screen.getByText('Kickoff')).toBeInTheDocument());
  await waitFor(() => expect(document.querySelector('thead [role="checkbox"]')).toBeTruthy());
  fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
  fireEvent.click(await screen.findByTestId('bulk-action-purge'));
  fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
  return screen.findByTestId('bulk-error-inspector');
}

afterEach(() => {
  cleanup();
});

describe('a view-declared bulk delete names each refused record and its reason (objectstack#37816)', () => {
  it('on the batch path: each id the server names, under its title, with its reason', async () => {
    const bulkDelete = vi.fn(async () => ({
      succeeded: 1,
      errors: [{ id: 't2', error: RESTRICT }, { id: 't3', error: 'Record is locked' }],
    }));
    const inspector = await runDeclaredDelete({ bulkDelete, delete: vi.fn() });
    expect(bulkDelete).toHaveBeenCalledWith(OBJECT, ['t1', 't2', 't3']);
    expect(within(inspector).getByTestId('bulk-error-record-t2')).toHaveTextContent('Review');
    expect(within(inspector).getByTestId('bulk-error-row-t2')).toHaveTextContent(RESTRICT);
    expect(within(inspector).getByTestId('bulk-error-record-t3')).toHaveTextContent('Launch');
    expect(within(inspector).getByTestId('bulk-error-row-t3')).toHaveTextContent('Record is locked');
    expect(within(inspector).queryByTestId('bulk-error-row-t1')).toBeNull();
  });

  it('row by row: each rejected delete, under its title, with its own message', async () => {
    const del = vi.fn(async (_object: string, id: string) => {
      if (id === 't1') throw new Error(RESTRICT);
      return true;
    });
    const inspector = await runDeclaredDelete({ delete: del });
    await waitFor(() => expect(del).toHaveBeenCalledTimes(ROWS.length));
    expect(within(inspector).getByTestId('bulk-error-record-t1')).toHaveTextContent('Kickoff');
    expect(within(inspector).getByTestId('bulk-error-row-t1')).toHaveTextContent(RESTRICT);
    expect(within(inspector).queryByTestId('bulk-error-row-t2')).toBeNull();
  });
});
