/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page's related tab (the enlarged related list,
 * `RelatedListEnlargedContext`).
 *
 * objectstack#35601 — the count only in the tab title, and 「+ 添加」, the one
 * add entry, at the right end. objectstack#35892 took 「↗」 (open in list)
 * away, put the list's name at the left and the list page's condition row
 * under it (`RelatedList.tab-35892.test.tsx`). The add entry is decided by the relationship when the page authored no
 * `add`: a `lookup` child opens a picker of the child object whose first row is
 * 「新建」; a `master_detail` child with a catalog opens a picker of the
 * catalog; one with none creates a row directly. A pick of several is ONE
 * transactional batch: all rows or none. A stateful child is grouped by its
 * status, completed last. The reader's header sort holds for this visit only
 * (objectstack#35892, ruling 7064083597): it is no longer remembered.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { FilterScopeProvider, RecordContextProvider, RecordPagePreferencesProvider, type RecordPagePreference } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { RelatedList } from '../RelatedList';
import { resetRelatedTabConditionsForTests } from '../relatedTabConditions';

// The related tab's conditions live in module memory for the visit (objectstack#35892).
afterEach(() => resetRelatedTabConditionsForTests());
import { RelatedListEnlargedContext } from '../relatedListCompact';

/**
 * The enlarged face draws `object-grid` (objectstack#28865), which
 * `plugin-grid` registers and this package cannot import (`plugin-grid`
 * depends on it). A stand-in draws the rows it is handed, as a table, with a
 * header button per column that sorts through the host channel.
 */
function ObjectGridStandIn({ schema, onSortChange }: { schema: any; onSortChange?: (s: unknown) => void }) {
  const rows: any[] = schema?.data?.items ?? [];
  const columns: string[] = schema?.columns ?? [];
  return (
    <table data-object-grid-stand-in="">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c}>
              <button type="button" data-sort-header={c} onClick={() => onSortChange?.([{ field: c, order: 'desc' }])}>{c}</button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{rows.map((row) => <tr key={row.id}>{columns.map((c) => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>)}</tbody>
    </table>
  );
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  ComponentRegistry.register('object-grid', ObjectGridStandIn as never);
});

const TASK_FIELDS = {
  subject: { type: 'text', label: 'Subject' },
  lead: { type: 'lookup', reference: 'lead', label: 'Lead' },
  owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
  due_date: { type: 'date', label: 'Due', dueLike: true },
};
const ROWS = [
  { id: 't1', subject: 'Send quote', lead: 'L-1', owner_id: 'u-1', due_date: '2026-10-30' },
  { id: 't2', subject: 'Call back', lead: 'L-1', owner_id: 'u-2', due_date: '2026-11-04' },
];
const CANDIDATES = [
  { id: 'c1', name: 'Alpha' },
  { id: 'c2', name: 'Bravo' },
  { id: 'c3', name: 'Charlie' },
];

interface Harness {
  fields?: Record<string, unknown>;
  rows?: any[];
  batch?: ((ops: unknown[]) => Promise<unknown>) | null;
  pickerObject?: string;
}

function dataSourceFor({ fields = TASK_FIELDS, rows = ROWS, batch, pickerObject }: Harness = {}) {
  const ds: Record<string, any> = {
    // The list's own read carries this record's condition; the picker's read
    // (the child object for a lookup, the catalog for a master_detail) does not.
    find: vi.fn(async (resource: string, params?: unknown) => (
      resource === 'task' && JSON.stringify(params ?? {}).includes('L-1')
        ? { data: rows, total: rows.length }
        : { data: CANDIDATES, total: CANDIDATES.length }
    )),
    getObjectSchema: vi.fn(async (name: string) => (
      name === 'task'
        ? { name: 'task', fields }
        : { name: name ?? pickerObject, fields: { name: { type: 'text', label: 'Name' } } }
    )),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
  };
  if (batch !== null) ds.batchTransaction = vi.fn(batch ?? (async (ops: unknown[]) => ({ results: ops.map(() => ({})) })));
  return ds;
}

function renderList({
  enlarged = true,
  onNew = vi.fn(),
  onViewAll = vi.fn(),
  preferences = null,
  ...harness
}: Harness & {
  enlarged?: boolean;
  onNew?: (() => void) | undefined;
  onViewAll?: (() => void) | undefined;
  preferences?: { get: (o: string) => RecordPagePreference; update: (o: string, p: RecordPagePreference) => void } | null;
} = {}) {
  const dataSource = dataSourceFor(harness);
  const utils = render(
    <FilterScopeProvider currentUserId="u-1">
      <RecordPagePreferencesProvider value={preferences}>
        <RelatedListEnlargedContext.Provider value={enlarged}>
          <RelatedList
            title="Tasks"
            type="table"
            api="task"
            objectName="task"
            referenceField="lead"
            parentId="L-1"
            pageSize={25}
            columns={[{ field: 'subject', label: 'Subject' }, { field: 'due_date', label: 'Due' }]}
            onNew={onNew}
            onViewAll={onViewAll}
            dataSource={dataSource as never}
          />
        </RelatedListEnlargedContext.Provider>
      </RecordPagePreferencesProvider>
    </FilterScopeProvider>,
  );
  return { ...utils, dataSource };
}

/** The list's own reads: the child object under this record's condition. */
const listReads = (ds: Record<string, any>) =>
  ds.find.mock.calls.filter(([r, p]: [string, unknown]) => r === 'task' && JSON.stringify(p ?? {}).includes('L-1')).length;
const toolbar = () => document.querySelector('[data-related-enlarged-toolbar]') as HTMLElement;
const addButton = () => toolbar().querySelector('[data-related-add]') as HTMLElement | null;

async function pickThree() {
  fireEvent.click(addButton()!);
  const dialog = await screen.findByTestId('record-picker-dialog');
  for (const id of ['c1', 'c2', 'c3']) {
    fireEvent.click(await within(dialog).findByTestId(`record-row-${id}`));
  }
  fireEvent.click(within(dialog).getByTestId('record-picker-confirm'));
}

describe('the related tab names its list and carries 「+ 添加」, with no 「↗」 (objectstack#35601, objectstack#35892)', () => {
  it('no filter box, chips, export, New or 「↗」; the count is not repeated; the name leads the row', async () => {
    const onViewAll = vi.fn();
    renderList({ onViewAll });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    const bar = toolbar();
    expect(bar.getAttribute('role')).toBe('toolbar');
    const controls = Array.from(bar.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || b.textContent);
    expect(controls).toEqual(['Add']);
    expect(document.querySelector('[data-related-enlarged-title]')?.textContent).toBe('Tasks');
    expect(within(bar).queryByRole('searchbox')).toBeNull();
    expect(bar.querySelector('[data-related-chip], [data-related-enlarged-export]')).toBeNull();
    expect(screen.queryByTestId('related-list-new')).toBeNull();
    expect(document.querySelector('[data-related-enlarged-status]')).toBeNull();
    expect(screen.queryByLabelText('2 records')).toBeNull();
    expect(document.querySelector('[data-related-open-list]')).toBeNull();
  });

  it('an empty list keeps its add entry', async () => {
    renderList({ rows: [] });
    await waitFor(() => expect(document.querySelector('[data-related-enlarged-empty]')).not.toBeNull());
    expect(document.querySelector('[data-related-open-list]')).toBeNull();
    expect(addButton()).not.toBeNull();
  });

  it('control: outside the active tab the list keeps its card face', async () => {
    renderList({ enlarged: false });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    expect(document.querySelector('[data-related-enlarged-toolbar]')).toBeNull();
    expect(screen.getByLabelText('2 records')).toBeInTheDocument();
  });
});

describe('「+ 添加」 is decided by the relationship, and a pick is one transactional batch (objectstack#35601)', () => {
  it('lookup: the picker lists the child object, its first row is 新建, and three picks are ONE batch of three', async () => {
    const onNew = vi.fn();
    const { dataSource } = renderList({ onNew });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    fireEvent.click(addButton()!);
    const dialog = await screen.findByTestId('record-picker-dialog');
    expect(within(dialog).getByTestId('record-picker-create-row')).toHaveTextContent('New');
    fireEvent.click(within(dialog).getByTestId('record-picker-create-row'));
    expect(onNew).toHaveBeenCalledTimes(1);

    const readsBefore = listReads(dataSource);
    await pickThree();
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    expect(dataSource.batchTransaction.mock.calls[0][0]).toEqual([
      { object: 'task', action: 'update', id: 'c1', data: { lead: 'L-1' } },
      { object: 'task', action: 'update', id: 'c2', data: { lead: 'L-1' } },
      { object: 'task', action: 'update', id: 'c3', data: { lead: 'L-1' } },
    ]);
    expect(dataSource.update).not.toHaveBeenCalled();
    expect(dataSource.create).not.toHaveBeenCalled();
    // The list reads again once the batch committed.
    await waitFor(() => expect(listReads(dataSource)).toBeGreaterThan(readsBefore));
  });

  it('lookup: the picker offers only unlinked children, never a row here or under another parent', async () => {
    const { dataSource } = renderList();
    // A server stand-in for the picker's read: it honours the emptiness rule
    // on the relationship, and serves all three rows when the rule is absent.
    const pool = [
      { id: 'p-here', name: 'Already here', lead: 'L-1' },
      { id: 'p-other', name: 'Under another lead', lead: 'L-2' },
      { id: 'p-free', name: 'Unlinked', lead: null },
    ];
    const listFind = dataSource.find.getMockImplementation()!;
    dataSource.find.mockImplementation(async (resource: string, params?: any) => {
      if (resource !== 'task' || JSON.stringify(params ?? {}).includes('L-1')) return listFind(resource, params);
      const unlinkedOnly = JSON.stringify(params?.$filter ?? []).includes('["lead","is_empty"]');
      const data = unlinkedOnly ? pool.filter((r) => r.lead == null) : pool;
      return { data, total: data.length };
    });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    fireEvent.click(addButton()!);
    const dialog = await screen.findByTestId('record-picker-dialog');
    expect(await within(dialog).findByTestId('record-row-p-free')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('record-row-p-here')).toBeNull();
    expect(within(dialog).queryByTestId('record-row-p-other')).toBeNull();
    const pickerReads = dataSource.find.mock.calls.filter(([r, p]: [string, unknown]) => r === 'task' && !JSON.stringify(p ?? {}).includes('L-1'));
    expect(pickerReads.length).toBeGreaterThan(0);
    expect(pickerReads.every(([, p]: [string, any]) => JSON.stringify(p?.$filter ?? []).includes('["lead","is_empty"]'))).toBe(true);
  });

  it('a failing batch adds nothing and says why; no single write is sent', async () => {
    const { dataSource } = renderList({
      batch: async () => { throw Object.assign(new Error("Field 'quantity' is required"), { status: 400 }); },
    });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    const readsBefore = listReads(dataSource);
    await pickThree();
    expect(await screen.findByRole('alert')).toHaveTextContent("Field 'quantity' is required");
    expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1);
    expect(dataSource.update).not.toHaveBeenCalled();
    expect(dataSource.create).not.toHaveBeenCalled();
    expect(listReads(dataSource)).toBe(readsBefore);
  });

  /**
   * objectstack#35726 — the refusal as the client SDK throws it: the server's
   * sentence as the message and the flat refusal body as `details`, which
   * carries `failedOperation` when one op caused the refusal.
   */
  const refusal = (message: string, failedOperation?: unknown) => Object.assign(new Error(message), {
    httpStatus: 400,
    code: 'VALIDATION_FAILED',
    details: { error: message, code: 'VALIDATION_FAILED', ...(failedOperation ? { failedOperation } : {}) },
  });

  it('a refusal naming the 2nd of three ops names that picked record by its picker label (objectstack#35726)', async () => {
    const { dataSource } = renderList({
      batch: async () => { throw refusal("Field 'title' is required", { index: 1, object: 'task' }); },
    });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    const readsBefore = listReads(dataSource);
    await pickThree();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Bravo: Field 'title' is required");
    expect(alert).not.toHaveTextContent('Alpha');
    expect(alert).not.toHaveTextContent('Charlie');
    expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1);
    expect(listReads(dataSource)).toBe(readsBefore);
  });

  it.each([
    ['no failedOperation', undefined],
    ['an index outside the ops sent', { index: 7, object: 'task' }],
  ] as const)('control: a refusal with %s shows the server message alone (objectstack#35726)', async (_label, failedOperation) => {
    renderList({
      batch: async () => { throw refusal("Field 'title' is required", failedOperation); },
    });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    await pickThree();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent?.trim()).toBe("Field 'title' is required");
  });

  it('master_detail with a catalog: the picker lists the catalog and a pick creates a row naming it', async () => {
    const { dataSource } = renderList({
      fields: {
        subject: { type: 'text', label: 'Subject' },
        lead: { type: 'master_detail', reference: 'lead', label: 'Lead' },
        product: { type: 'lookup', reference: 'product', label: 'Product', required: true },
        owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
      },
    });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    await pickThree();
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    expect(dataSource.find.mock.calls.some(([r]: [string]) => r === 'product')).toBe(true);
    expect(dataSource.batchTransaction.mock.calls[0][0]).toEqual([
      { object: 'task', action: 'create', data: { lead: 'L-1', product: 'c1' } },
      { object: 'task', action: 'create', data: { lead: 'L-1', product: 'c2' } },
      { object: 'task', action: 'create', data: { lead: 'L-1', product: 'c3' } },
    ]);
  });

  it('master_detail with no catalog: 「+ 添加」 creates a row directly', async () => {
    const onNew = vi.fn();
    renderList({
      onNew,
      fields: { subject: { type: 'text', label: 'Subject' }, lead: { type: 'master_detail', reference: 'lead', label: 'Lead' } },
    });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    fireEvent.click(addButton()!);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('record-picker-dialog')).toBeNull();
  });

  it('a data source with no transactional batch offers no picker: never a loop of single writes', async () => {
    const onNew = vi.fn();
    renderList({ onNew, batch: null });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    fireEvent.click(addButton()!);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('record-picker-dialog')).toBeNull();
  });
});

describe('a stateful child is grouped by its status on the related tab (objectstack#35601)', () => {
  const STATEFUL = {
    subject: { type: 'text', label: 'Subject' },
    lead: { type: 'lookup', reference: 'lead', label: 'Lead' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'todo', label: 'To Do' },
        { value: 'done', label: 'Done' },
        { value: 'doing', label: 'Doing' },
      ],
    },
    due_date: { type: 'date', label: 'Due', dueLike: true, settledWhen: "record.status == 'done'" },
  };
  const STATEFUL_ROWS = [
    { id: 's1', subject: 'Finished', lead: 'L-1', status: 'done' },
    { id: 's2', subject: 'Started', lead: 'L-1', status: 'doing' },
    { id: 's3', subject: 'Queued', lead: 'L-1', status: 'todo' },
  ];

  it('open groups first in option order, completed last, each collapsible', async () => {
    renderList({ fields: STATEFUL, rows: STATEFUL_ROWS });
    await waitFor(() => expect(screen.getByText('Finished')).toBeInTheDocument());
    const groups = Array.from(document.querySelectorAll('[data-related-status-group]'));
    expect(groups.map((g) => g.getAttribute('data-related-status-group'))).toEqual(['todo', 'doing', 'done']);
    expect(groups.map((g) => g.getAttribute('data-settled'))).toEqual(['false', 'false', 'true']);
    fireEvent.click(within(groups[2] as HTMLElement).getByRole('button', { expanded: true }));
    expect(screen.queryByText('Finished')).toBeNull();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('control: with no declared settled status there is nothing to tell open from done, so no groups', async () => {
    const { due_date: _drop, ...noDeadline } = STATEFUL;
    renderList({ fields: noDeadline, rows: STATEFUL_ROWS });
    await waitFor(() => expect(screen.getByText('Finished')).toBeInTheDocument());
    expect(document.querySelector('[data-related-status-groups]')).toBeNull();
  });
});

describe('the related tab no longer remembers the reader\'s header sort (objectstack#35601 → objectstack#35892)', () => {
  function store(initial: RecordPagePreference = {}) {
    const states: Record<string, RecordPagePreference> = { lead: initial };
    return {
      get: vi.fn((o: string) => states[o] ?? {}),
      update: vi.fn((o: string, patch: RecordPagePreference) => { states[o] = { ...states[o], ...patch }; }),
    };
  }

  it('a header click is not written to the record-page preference: it holds for this visit (objectstack#35892)', async () => {
    const preferences = store();
    render(
      <RecordPagePreferencesProvider value={preferences}>
        <RecordContextHarness>
          <RelatedListEnlargedContext.Provider value>
            <RelatedList
              title="Tasks"
              type="table"
              api="task"
              objectName="task"
              referenceField="lead"
              parentId="L-1"
              pageSize={25}
              columns={[{ field: 'subject', label: 'Subject' }]}
              dataSource={dataSourceFor() as never}
            />
          </RelatedListEnlargedContext.Provider>
        </RecordContextHarness>
      </RecordPagePreferencesProvider>,
    );
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    fireEvent.click(document.querySelector('[data-sort-header="subject"]')!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(preferences.update).not.toHaveBeenCalled();
  });

  it('a sort an earlier version remembered is no longer read: the list reads in its declared order (objectstack#35892)', async () => {
    const preferences = store({ relatedLists: { 'task.lead': { sort: { field: 'subject', order: 'desc' } } } });
    const ds = dataSourceFor();
    render(
      <RecordPagePreferencesProvider value={preferences}>
        <RecordContextHarness>
          <RelatedListEnlargedContext.Provider value>
            <RelatedList
              title="Tasks"
              type="table"
              api="task"
              objectName="task"
              referenceField="lead"
              parentId="L-1"
              pageSize={25}
              columns={[{ field: 'subject', label: 'Subject' }]}
              dataSource={ds as never}
            />
          </RelatedListEnlargedContext.Provider>
        </RecordContextHarness>
      </RecordPagePreferencesProvider>,
    );
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    for (const [resource, params] of ds.find.mock.calls as Array<[string, any]>) {
      if (resource === 'task') expect(params?.$orderby).toBeUndefined();
    }
  });
});

/** The parent record page's context: the object the preference row belongs to. */
function RecordContextHarness({ children }: { children: React.ReactNode }) {
  return <RecordContextProvider objectName="lead" recordId="L-1" data={{ id: 'L-1' }}>{children}</RecordContextProvider>;
}
