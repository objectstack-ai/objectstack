/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36911 — the row menu follows the approval lock.
 *
 * A row held by a locking approval is refused `RECORD_LOCKED` on update. The
 * record page offers no Edit on such a record (objectstack#35593) and keeps
 * Delete, because the server lets a locked record be deleted and cancels its
 * request. The grid's row menu, which the list page and a record page's
 * related tab both render, offered Edit on it.
 *
 * The menu now reads the lock the select-first cells read
 * (`useRowApprovalLocks`, the batch door
 * `POST /api/v1/approvals/records/:object/locks`), asked when a row's actions
 * are reached for, never on first paint (objectstack#35795). Only an ANSWERED
 * lock hides Edit: a 501, a `null` entry, a failed read or a read not yet
 * asked leaves the menu as it was.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

// Stable-identity permission stub, as `rowRecordCrudVerdict.test.tsx` has it:
// ObjectGrid carries `perms` in memo dependency arrays.
const { permsStub } = vi.hoisted(() => ({
  permsStub: {
    isLoaded: false,
    checkField: () => true,
    getObjectApiOperations: () => ['get', 'list', 'create', 'update', 'delete'],
    can: () => true,
  },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub };
});

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { __resetApprovalsServiceLatch } from '../hooks/useRowApprovalLocks';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'showcase_project';
const LOCKS_PATH = `/api/v1/approvals/records/${OBJECT}/locks`;
/** Under an executive review whose node locks the record. */
const LOCKED_ROW = { id: 'p_locked', name: 'Data Centre Build' };
/** Its sibling on the same page, with no approval running. */
const OPEN_ROW = { id: 'p_open', name: 'Office Refresh' };

/** What the lock door answers, per id; `undefined` is the read's `null` entry. */
type LockDoor =
  | { kind: 'answers'; locked: Record<string, boolean | null> }
  | { kind: 'status'; status: number }
  | { kind: 'network' };

const server = {
  door: { kind: 'answers', locked: {} } as LockDoor,
  lockCalls: [] as Array<{ recordIds: string[] }>,
  responses: [] as Promise<unknown>[],
  reset() {
    server.door = { kind: 'answers', locked: { [LOCKED_ROW.id]: true, [OPEN_ROW.id]: false } };
    server.lockCalls = [];
    server.responses = [];
  },
};

const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? '{}'));
  const respond = (status: number, payload: unknown) => {
    const res = { ok: status >= 200 && status < 300, status, json: async () => payload } as unknown as Response;
    const settled = Promise.resolve(res);
    server.responses.push(settled);
    return settled;
  };
  if (url === LOCKS_PATH) {
    server.lockCalls.push(body);
    const door = server.door;
    if (door.kind === 'network') {
      const failed = Promise.reject(new TypeError('Failed to fetch'));
      server.responses.push(failed.catch(() => undefined));
      return failed;
    }
    if (door.kind === 'status') return respond(door.status, { success: false });
    const ids: string[] = body.recordIds ?? [];
    return respond(200, {
      success: true,
      data: { records: ids.map((recordId) => ({ recordId, locked: door.locked[recordId] ?? null })) },
    });
  }
  // `security/explain`: every row may be written, so only the lock can take Edit away.
  const ids: string[] = Array.isArray(body.recordIds) ? body.recordIds : [];
  return respond(200, {
    allowed: true,
    object: body.object,
    operation: body.operation,
    principal: { userId: 'u_member' },
    layers: [],
    records: ids.map((recordId) => ({ recordId, visible: true })),
  });
};

function renderGrid(rows: Array<Record<string, unknown>> = [LOCKED_ROW, OPEN_ROW]) {
  const dataSource: any = {
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, approval_status: { type: 'text' } },
    }),
  };
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: rows },
    pageSize: 500,
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource} apiFetch={apiFetch}>
        <ObjectGrid schema={schema} dataSource={dataSource} onEdit={() => {}} onDelete={() => {}} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Reach for the first row's actions the way a pointer does: hover its "⋮". */
async function reachRowActions() {
  await userEvent.hover(screen.getAllByTestId('row-action-trigger')[0]);
}

async function settleReads() {
  await act(async () => {
    await Promise.allSettled(server.responses);
  });
}

/** What the "⋮" of the row showing `label` offers. */
async function rowMenu(label: string): Promise<{ edit: boolean; delete: boolean }> {
  const row = screen.getByText(label).closest('tr');
  const trigger = row?.querySelector('[data-testid="row-action-trigger"]');
  if (!trigger) return { edit: false, delete: false };
  await userEvent.click(trigger);
  const answer = {
    edit: screen.queryAllByTestId('row-action-builtin-edit').length > 0,
    delete: screen.queryAllByTestId('row-action-builtin-delete').length > 0,
  };
  await userEvent.keyboard('{Escape}');
  return answer;
}

beforeEach(() => {
  server.reset();
  __clearRecordCrudVerdictCache();
  __resetApprovalsServiceLatch();
});
afterEach(() => {
  cleanup();
});

describe('objectstack#36911 — the row menu follows the approval lock', () => {
  it('a row held by a locking approval offers no Edit and keeps Delete; its unlocked sibling keeps Edit', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    await reachRowActions();
    await waitFor(() => expect(server.lockCalls.length).toBe(1));
    await settleReads();
    await waitFor(async () => expect(await rowMenu(LOCKED_ROW.name)).toEqual({ edit: false, delete: true }));
    expect(await rowMenu(OPEN_ROW.name)).toEqual({ edit: true, delete: true });
  });

  it('reads no lock before a row\'s actions are reached for, then the page in one read', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    await settleReads();
    expect(server.lockCalls).toHaveLength(0);
    await reachRowActions();
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    expect([...server.lockCalls[0].recordIds].sort()).toEqual([LOCKED_ROW.id, OPEN_ROW.id].sort());
    // Reaching again, and opening the menus, asks nothing more.
    await settleReads();
    await rowMenu(LOCKED_ROW.name);
    await rowMenu(OPEN_ROW.name);
    expect(server.lockCalls).toHaveLength(1);
  });

  it('a 501 (no approvals service) leaves the menu as it was, even over an approval_status column', async () => {
    server.door = { kind: 'status', status: 501 };
    renderGrid([{ ...LOCKED_ROW, approval_status: 'pending' }, OPEN_ROW]);
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    await reachRowActions();
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    await settleReads();
    expect(await rowMenu(LOCKED_ROW.name)).toEqual({ edit: true, delete: true });
    expect(await rowMenu(OPEN_ROW.name)).toEqual({ edit: true, delete: true });
  });

  it('a null entry (a row the reader cannot read) leaves Edit where it was', async () => {
    server.door = { kind: 'answers', locked: { [LOCKED_ROW.id]: null, [OPEN_ROW.id]: false } };
    renderGrid();
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    await reachRowActions();
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    await settleReads();
    expect(await rowMenu(LOCKED_ROW.name)).toEqual({ edit: true, delete: true });
  });

  it('a read that fails, or that never answered, leaves Edit where it was', async () => {
    server.door = { kind: 'network' };
    renderGrid();
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    // Not asked yet: the menu is the one it always was.
    expect(server.lockCalls).toHaveLength(0);
    await reachRowActions();
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    await settleReads();
    expect(await rowMenu(LOCKED_ROW.name)).toEqual({ edit: true, delete: true });
  });
});
