/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524 — the enlarged related list (the record page's active
 * tab, `RelatedListEnlargedContext`), the ride-along ruled at ③'s preview
 * gate: the board's toolbar over the table — the filter, 全部 / 我的 / 逾期,
 * 新建, 导出 — with the count and page line between them, and no card header
 * or card foot. Each chip is drawn only where the child object declares what
 * it says (an `owner_id` column; a `dueLike` deadline with no `settledWhen`),
 * and a chip narrows the list's own read; 导出 asks the server for the rows
 * the face shows.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { FilterScopeProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { RelatedList } from '../RelatedList';
import { RelatedListEnlargedContext } from '../relatedListCompact';

/**
 * The enlarged face draws `object-grid` (objectstack#28865), which
 * `plugin-grid` registers and this package cannot import (`plugin-grid`
 * depends on it). A stand-in draws the rows it is handed, as a table.
 */
function ObjectGridStandIn({ schema }: { schema: any }) {
  const rows: any[] = schema?.data?.items ?? [];
  const columns: string[] = schema?.columns ?? [];
  return (
    <table data-object-grid-stand-in="">
      <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
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

function dataSourceFor(fields: Record<string, unknown> = TASK_FIELDS) {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => ({ name: 'task', fields })),
    exportDownload: vi.fn(async () => new Blob(['subject\n'], { type: 'text/csv' })),
  };
}

function renderList({
  enlarged = true,
  fields,
  onNew = vi.fn(),
}: { enlarged?: boolean; fields?: Record<string, unknown>; onNew?: () => void } = {}) {
  const dataSource = dataSourceFor(fields);
  const utils = render(
    <FilterScopeProvider currentUserId="u-1">
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
          dataSource={dataSource as never}
        />
      </RelatedListEnlargedContext.Provider>
    </FilterScopeProvider>,
  );
  return { ...utils, dataSource };
}

const toolbar = () => document.querySelector('[data-related-enlarged-toolbar]') as HTMLElement | null;
const lastFilter = (find: ReturnType<typeof vi.fn>) => JSON.stringify(find.mock.calls[find.mock.calls.length - 1][1].$filter);

describe('the enlarged related list draws the board toolbar (objectstack#27524)', () => {
  it('a toolbar over the table: the filter, 全部 N / 我的 / 逾期, 新建, 导出 — and no card header or foot', async () => {
    const onNew = vi.fn();
    renderList({ onNew });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    const bar = toolbar()!;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(within(bar).getByRole('searchbox', { name: 'Filter Tasks…' })).toBeInTheDocument();
    const chips = Array.from(bar.querySelectorAll('[data-related-chip]')).map((el) => el.getAttribute('data-related-chip'));
    expect(chips).toEqual(['all', 'mine', 'overdue']);
    await waitFor(() => expect(bar.querySelector('[data-related-chip="all"]')?.textContent).toBe('All2'));
    expect(bar.querySelector('[data-related-chip="all"]')?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(bar).getByTestId('related-list-new'));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(bar.querySelector('[data-related-enlarged-export]')).not.toBeNull();
    // The count shows once (objectstack#28865): the 全部 chip says 2, so the
    // line under the toolbar, which holds no page either, is not drawn.
    expect(document.querySelector('[data-related-enlarged-status]')).toBeNull();
    // No card: no header title, no count badge, no View all.
    expect(screen.queryByLabelText('2 records')).toBeNull();
    expect(document.querySelector('.rounded-xl, [class*="card"]')).toBeNull();
    expect(document.querySelector('[data-object-grid-stand-in] thead')).not.toBeNull();
  });

  it('我的 and 逾期 narrow the list\'s own read, beside the parent', async () => {
    const { dataSource } = renderList();
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    const before = lastFilter(dataSource.find);
    expect(before).not.toContain('owner_id');

    fireEvent.click(document.querySelector('[data-related-chip="mine"]')!);
    await waitFor(() => expect(lastFilter(dataSource.find)).toContain('owner_id'));
    expect(lastFilter(dataSource.find)).toContain('u-1');
    expect(lastFilter(dataSource.find)).toContain('L-1');
    expect(document.querySelector('[data-related-chip="mine"]')?.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(document.querySelector('[data-related-chip="overdue"]')!);
    await waitFor(() => expect(lastFilter(dataSource.find)).toContain('due_date'));
    expect(lastFilter(dataSource.find)).not.toContain('owner_id');
    expect(lastFilter(dataSource.find)).toContain('<');
  });

  it('a chip is drawn only where the object declares what it says', async () => {
    const { dataSource } = renderList({
      fields: {
        subject: { type: 'text', label: 'Subject' },
        lead: { type: 'lookup', reference: 'lead', label: 'Lead' },
        // A deadline with a `settledWhen`: no query can ask which are settled.
        due_date: { type: 'date', label: 'Due', dueLike: true, settledWhen: 'record.done == true' },
      },
    });
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    // 全部 alone is no choice: no chip group at all.
    expect(document.querySelector('[data-related-chip]')).toBeNull();
    expect(toolbar()).not.toBeNull();
  });

  it('导出 asks the server for the rows the face shows: the parent and the chip', async () => {
    const { dataSource } = renderList();
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    fireEvent.click(document.querySelector('[data-related-chip="mine"]')!);
    await waitFor(() => expect(lastFilter(dataSource.find)).toContain('owner_id'));
    fireEvent.click(document.querySelector('[data-related-enlarged-export]')!);
    await waitFor(() => expect(dataSource.exportDownload).toHaveBeenCalledTimes(1));
    const [resource, request] = dataSource.exportDownload.mock.calls[0] as unknown as [string, { format: string; filter: unknown; fields: string[] }];
    expect(resource).toBe('task');
    expect(request.format).toBe('csv');
    expect(JSON.stringify(request.filter)).toContain('L-1');
    expect(JSON.stringify(request.filter)).toContain('u-1');
    expect(request.fields).toEqual(['subject', 'due_date']);
  });

  it('control: outside the active tab the list keeps its card face', async () => {
    renderList({ enlarged: false });
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    expect(toolbar()).toBeNull();
    expect(screen.getByLabelText('2 records')).toBeInTheDocument();
  });
});

/**
 * objectstack#30069 — 导出 asks the list page's question. `ListView`'s
 * `exportPermitted` reads the child object's effective API operation set
 * (`/me/permissions` `apiOperations`); the related table reads the same
 * `usePermissions()` source, so a reader the list page hides 导出 from sees no
 * 导出 here either, and a reader who may export still exports this relation's
 * rows alone. A refusal that still reaches the table — the server's 403 —
 * reads in the Console's language, never as the route's English sentence.
 */
describe('the related table asks the list page\'s export question (objectstack#30069)', () => {
  const SERVER_SENTENCE = "Export is not permitted on object 'task' for this user";

  function grant(apiOperations: string[]): MePermissionsAuthenticatedResponse {
    return {
      authenticated: true,
      userId: 'u-1',
      tenantId: null,
      hasAnyQueue: false,
      positions: [],
      permissionSets: ['rep'],
      objects: {
        task: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false, apiOperations },
      },
      fields: {},
    } as MePermissionsAuthenticatedResponse;
  }

  function renderUnder(perms: MePermissionsAuthenticatedResponse, language = 'en') {
    const dataSource = dataSourceFor();
    render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        <MePermissionsProvider initialPermissions={perms}>
          <FilterScopeProvider currentUserId="u-1">
            <RelatedListEnlargedContext.Provider value>
              <RelatedList
                title="Tasks"
                type="table"
                api="task"
                objectName="task"
                referenceField="lead"
                parentId="L-1"
                pageSize={25}
                columns={[{ field: 'subject', label: 'Subject' }, { field: 'due_date', label: 'Due' }]}
                dataSource={dataSource as never}
              />
            </RelatedListEnlargedContext.Provider>
          </FilterScopeProvider>
        </MePermissionsProvider>
      </I18nProvider>,
    );
    return dataSource;
  }

  it('a reader without export sees no 导出, and nothing is asked of the export route', async () => {
    const dataSource = renderUnder(grant(['get', 'list', 'create', 'update']));
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    expect(toolbar()).not.toBeNull();
    expect(document.querySelector('[data-related-enlarged-export]')).toBeNull();
    expect(dataSource.exportDownload).not.toHaveBeenCalled();
  });

  it('a reader with export sees 导出 and exports this relation\'s rows alone', async () => {
    const dataSource = renderUnder(grant(['get', 'list', 'export']));
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const button = document.querySelector('[data-related-enlarged-export]');
    expect(button).not.toBeNull();
    fireEvent.click(button!);
    await waitFor(() => expect(dataSource.exportDownload).toHaveBeenCalledTimes(1));
    const [resource, request] = dataSource.exportDownload.mock.calls[0] as unknown as [string, { filter: unknown }];
    expect(resource).toBe('task');
    // The parent scope: the lead this record page is about, and only it.
    expect(JSON.stringify(request.filter)).toContain('"lead"');
    expect(JSON.stringify(request.filter)).toContain('L-1');
  });

  it('the server\'s 403 reads in the Console\'s language, not as the route\'s English sentence', async () => {
    const dataSource = renderUnder(grant(['get', 'list', 'export']), 'zh');
    dataSource.exportDownload.mockRejectedValueOnce(
      Object.assign(new Error(SERVER_SENTENCE), { code: 'EXPORT_NOT_PERMITTED', status: 403 }),
    );
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    fireEvent.click(document.querySelector('[data-related-enlarged-export]')!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('你没有导出这些记录的权限。如需导出，请联系管理员。');
    expect(alert.textContent).not.toContain(SERVER_SENTENCE);
  });

  it('control: a failure that is not a refusal still says the server\'s sentence', async () => {
    const dataSource = renderUnder(grant(['get', 'list', 'export']));
    dataSource.exportDownload.mockRejectedValueOnce(Object.assign(new Error('Export timed out'), { status: 504 }));
    await waitFor(() => expect(screen.getByText('Send quote')).toBeInTheDocument());
    fireEvent.click(document.querySelector('[data-related-enlarged-export]')!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Export timed out');
  });
});
