/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The audit log's Action column and detail drawer show the declared label of
 * a row's action, the label the same page's Action filter already offers.
 *
 * Both used to print the stored value (`update`, `create`), so in a Chinese
 * console the column read in lowercase English beside a filter that read
 * 更新 / 创建.
 *
 * The transport is stubbed at the seams the page reads through:
 *  - the console's metadata cache (`useMetadata().objects`) serves the
 *    `sys_audit_log` document as a zh console receives it: its `action`
 *    options carry translated labels, and `nightly_purge` is stored on a row
 *    but declared by no option;
 *  - `fetch` answers `/data/sys_audit_log` with the ledger below;
 *  - the console adapter (`useAdapter`) serves `sys_user` to the actor lookup.
 *
 * Pinned:
 *  - each Action cell shows its action's declared label, and an action no
 *    option declares shows its stored value;
 *  - the detail drawer's badge shows the same label, for a declared action
 *    and for an undeclared one;
 *  - with no `sys_audit_log` document served, the cells show stored values.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { ADAPTER, METADATA, SERVED_OBJECTS } = vi.hoisted(() => {
  const AUDIT = Object.freeze({
    name: 'sys_audit_log',
    label: '审计日志',
    fields: {
      created_at: { type: 'datetime', label: '时间' },
      action: {
        type: 'select',
        label: '操作',
        options: [
          { value: 'create', label: '创建' },
          { value: 'update', label: '更新' },
          { value: 'delete', label: '删除' },
        ],
      },
      user_id: { type: 'lookup', reference: 'sys_user', label: '用户' },
    },
  });
  const SERVED_OBJECTS = Object.freeze([{ name: 'crm_account', label: '客户' }, AUDIT]) as readonly unknown[];
  return {
    ADAPTER: {
      find: async () => ({ data: [], total: 0 }),
      findOne: async () => null,
      getObjectSchema: async () => undefined,
    },
    SERVED_OBJECTS,
    // Mutable per test: the served objects.
    METADATA: { objects: SERVED_OBJECTS },
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: METADATA.objects }),
}));

// Imported after the mocks so the page picks them up.
import { AuditLogPage } from './AuditLogPage';

/** The stored ledger, newest first: two declared actions and one no option declares. */
const LEDGER = [
  { id: 'log_1', created_at: '2026-11-02T03:00:00.000Z', action: 'update', object_name: 'crm_account', record_id: 'acc_1', user_id: null },
  { id: 'log_2', created_at: '2026-11-02T02:00:00.000Z', action: 'create', object_name: 'crm_account', record_id: 'acc_2', user_id: null },
  { id: 'log_3', created_at: '2026-11-02T01:00:00.000Z', action: 'nightly_purge', object_name: 'crm_account', record_id: 'acc_3', user_id: null },
];

beforeEach(() => {
  METADATA.objects = SERVED_OBJECTS;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ object: 'sys_audit_log', records: LEDGER, total: LEDGER.length }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(): void {
  render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
}

/** The body rows of the log table. */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1);
}

/** The Action cell's badge text, by row. */
function actionCells(): string[] {
  return bodyRows().map((row) => row.querySelectorAll('td')[1]?.textContent ?? '');
}

/** Open the detail drawer of the row at `index` and answer the drawer's title. */
async function openDrawer(index: number): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(bodyRows()[index]!);
  });
  const dialog = await screen.findByRole('dialog');
  // The title's first child is the action badge; the object name follows it.
  const title = within(dialog).getByRole('heading');
  return title.firstElementChild as HTMLElement;
}

describe('AuditLogPage — the Action column and drawer show the declared action label', () => {
  it('labels each Action cell with its declared option, and an undeclared action with its stored value', async () => {
    renderPage();
    await waitFor(() => expect(actionCells()).toHaveLength(LEDGER.length));

    expect(actionCells()).toEqual(['更新', '创建', 'nightly_purge']);
  });

  it('labels the drawer badge as the row does', async () => {
    renderPage();
    await waitFor(() => expect(actionCells()).toHaveLength(LEDGER.length));

    expect(await openDrawer(0)).toHaveTextContent(/^更新$/);
    cleanup();

    renderPage();
    await waitFor(() => expect(actionCells()).toHaveLength(LEDGER.length));
    expect(await openDrawer(2)).toHaveTextContent(/^nightly_purge$/);
  });

  it('shows stored values when no sys_audit_log document is served', async () => {
    METADATA.objects = [{ name: 'crm_account', label: '客户' }];
    renderPage();
    await waitFor(() => expect(actionCells()).toHaveLength(LEDGER.length));

    expect(actionCells()).toEqual(['update', 'create', 'nightly_purge']);
  });
});
