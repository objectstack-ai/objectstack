/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12303 row 1 — the grid's default inline-edit saves say what they
 * saved.
 *
 * Measured on the card: Tasks grid, inline edit on, change a row's Priority,
 * "Save All (1)". The `PATCH` answered 200 and the value landed, but no toast,
 * `role=status` or `role=alert` text appeared; the dirty bar just went away.
 * Every other write surface measured in the same pass gave feedback. The
 * default saves now raise the console's shared success toast (the `toast`
 * `@object-ui/components` re-exports from `sonner`, the one the form, kanban
 * and view surfaces raise), naming how many rows the server ACCEPTED: a row
 * that failed is not counted, and a batch where nothing landed says nothing.
 *
 * The real `ObjectGrid` and `data-table` over an in-memory data source whose
 * `update` persists, and can refuse named rows. Only that `toast` export is
 * replaced, so the toast call itself is read.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// The `toast` this grid raises is `@object-ui/components`' re-export of
// sonner's. `plugin-grid` does not depend on `sonner`, so a bare
// `vi.mock('sonner')` here would register against an id nothing in this
// package resolves to (the trap `WizardForm.outcomeToastSupersede.test.tsx`
// measured); the components entry is the module the grid imports it from.
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: Object.assign(vi.fn(), toasts) };
});

import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
  for (const fn of Object.values(toasts)) fn.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'task_12303';

function makeDataSource(refuse: Set<string> = new Set()) {
  const store: Record<string, Record<string, unknown>> = {
    t1: { id: 't1', title: 'Ingest pipeline', estimate_hours: 60 },
    t2: { id: 't2', title: 'Warehouse schema', estimate_hours: 33 },
  };
  return {
    store,
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    update: vi.fn(async (_object: string, id: string, changes: Record<string, unknown>) => {
      if (refuse.has(id)) throw new Error(`estimate_hours is locked on ${id}`);
      store[id] = { ...store[id], ...changes };
      return { ...store[id] };
    }),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        title: { type: 'text', label: 'Title' },
        estimate_hours: { type: 'number', label: 'Estimate' },
      },
    })),
  };
}

type GridProps = React.ComponentProps<typeof ObjectGrid>;

async function loaded(dataSource: ReturnType<typeof makeDataSource>) {
  const schema = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'title', label: 'Title', editable: false },
      { field: 'estimate_hours', label: 'Estimate', type: 'number' },
    ],
    pagination: { pageSize: 50 },
  } as GridProps['schema'];
  render(
    <ActionProvider>
      {/* Row Edit/Delete handlers: the per-row save button exists. */}
      <ObjectGrid
        schema={schema}
        // The in-memory double implements the three members the default saves read.
        dataSource={dataSource as unknown as GridProps['dataSource']}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('Ingest pipeline')).toBeInTheDocument());
}

const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

/** Stage a new Estimate on the row titled `title`, the way a user types it. */
async function editEstimate(title: string, from: string, to: string) {
  const td = await waitFor(() => {
    const cell = Array.from(rowOf(title).querySelectorAll('td')).find((c) => c.textContent?.trim() === from);
    if (!cell) throw new Error(`no ${from} cell on ${title}`);
    return cell as HTMLElement;
  });
  fireEvent.click(td);
  const input = await waitFor(() => {
    const el = td.querySelector('input') as HTMLInputElement | null;
    if (!el) throw new Error('editor not open');
    return el;
  });
  fireEvent.change(input, { target: { value: to } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(within(rowOf(title)).getByText(to)).toBeInTheDocument());
}

const clickSaveAll = () => fireEvent.click(screen.getByRole('button', { name: /Save All/ }));

describe('ObjectGrid default saves — the write is said (objectui#12303)', () => {
  it('"Save All" over two rows that both land raises one success toast naming two rows', async () => {
    const ds = makeDataSource();
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '61');
    await editEstimate('Warehouse schema', '33', '31');
    clickSaveAll();

    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(toasts.success).toHaveBeenCalledWith('2 rows saved');
    expect(ds.store.t1.estimate_hours).toBe(61);
    expect(ds.store.t2.estimate_hours).toBe(31);
    await waitFor(() => expect(screen.queryByText(/row modified|rows modified/)).toBeNull());
  });

  it('the card’s case: "Save All (1)" says one row was saved', async () => {
    const ds = makeDataSource();
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '61');
    expect(screen.getByRole('button', { name: /Save All \(1\)/ })).toBeInTheDocument();
    clickSaveAll();

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('1 row saved'));
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });

  it('the per-row save says one row was saved', async () => {
    const ds = makeDataSource();
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '61');
    fireEvent.click(within(rowOf('Ingest pipeline')).getByTitle('Save row'));

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('1 row saved'));
    expect(ds.store.t1.estimate_hours).toBe(61);
  });

  it('a batch where one row is refused counts only the row that landed, and the table still flags the other', async () => {
    const ds = makeDataSource(new Set(['t1']));
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '61');
    await editEstimate('Warehouse schema', '33', '31');
    clickSaveAll();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('estimate_hours is locked on t1'));
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith('1 row saved');
    expect(ds.store.t2.estimate_hours).toBe(31);
    expect(ds.store.t1.estimate_hours).toBe(60);
    expect(screen.getByRole('button', { name: /Save All \(1\)/ })).toBeInTheDocument();
  });

  it('CONTROL — a batch where nothing lands raises no success toast', async () => {
    const ds = makeDataSource(new Set(['t1', 't2']));
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '61');
    await editEstimate('Warehouse schema', '33', '31');
    clickSaveAll();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(ds.update).toHaveBeenCalledTimes(2);
    expect(toasts.success).not.toHaveBeenCalled();
  });
});
