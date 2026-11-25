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
 *
 * objectstack#37231 — the read says which approval holds a locked row
 * (`lockSource`). A master-detail line held because its MASTER is held
 * (`'master'`) offers no Delete either: the detail-row lock hook refuses that
 * delete with `RECORD_LOCKED`. A row held by its own approval (`'record'`)
 * keeps Delete.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent, within } from '@testing-library/react';
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
import { useListPageScope } from '../listPageScope';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'showcase_project';
const LOCKS_PATH = `/api/v1/approvals/records/${OBJECT}/locks`;
/** Under an executive review whose node locks the record. */
const LOCKED_ROW = { id: 'p_locked', name: 'Data Centre Build' };
/** Its sibling on the same page, with no approval running. */
const OPEN_ROW = { id: 'p_open', name: 'Office Refresh' };
/** A master-detail line whose MASTER is under a locking approval. */
const MASTER_HELD_ROW = { id: 'p_line', name: 'Rack Delivery' };

/**
 * What the lock door answers, per id; `undefined` is the read's `null` entry.
 * `sources` is the `lockSource` a locked entry carries.
 */
type LockDoor =
  | { kind: 'answers'; locked: Record<string, boolean | null>; sources?: Record<string, 'record' | 'master'> }
  | { kind: 'status'; status: number }
  | { kind: 'network' };

const server = {
  door: { kind: 'answers', locked: {} } as LockDoor,
  lockCalls: [] as Array<{ recordIds: string[] }>,
  responses: [] as Promise<unknown>[],
  /** Set by {@link hold}: lock answers wait here until `release` is called. */
  gate: null as Promise<void> | null,
  release: () => {},
  hold() {
    server.gate = new Promise<void>((resolve) => {
      server.release = () => resolve();
    });
  },
  reset() {
    server.gate = null;
    server.release = () => {};
    server.door = {
      kind: 'answers',
      locked: { [LOCKED_ROW.id]: true, [OPEN_ROW.id]: false, [MASTER_HELD_ROW.id]: true },
      sources: { [LOCKED_ROW.id]: 'record', [MASTER_HELD_ROW.id]: 'master' },
    };
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
    if (server.gate) await server.gate;
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
      data: {
        records: ids.map((recordId) => ({
          recordId,
          locked: door.locked[recordId] ?? null,
          ...(door.sources?.[recordId] ? { lockSource: door.sources[recordId] } : {}),
        })),
      },
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

/** The fixture page bar: it registers its page column as a list page scope. */
const PageBar: React.FC = () => {
  const [scope, setScope] = React.useState<HTMLElement | null>(null);
  useListPageScope(scope);
  return <div ref={(el) => setScope(el?.parentElement ?? null)} data-testid="page-bar" />;
};

function renderGrid(
  rows: Array<Record<string, unknown>> = [LOCKED_ROW, OPEN_ROW],
  { listPage = false, edit = true }: { listPage?: boolean; edit?: boolean } = {},
) {
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
    ...(listPage ? { selection: { type: 'multiple' } } : {}),
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource} apiFetch={apiFetch}>
        <div data-testid="page-column">
          {listPage && <PageBar />}
          <ObjectGrid schema={schema} dataSource={dataSource} onEdit={edit ? () => {} : undefined} onDelete={() => {}} />
        </div>
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
    renderGrid([{ ...LOCKED_ROW, approval_status: 'pending' }, OPEN_ROW, MASTER_HELD_ROW]);
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    await reachRowActions();
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    await settleReads();
    expect(await rowMenu(LOCKED_ROW.name)).toEqual({ edit: true, delete: true });
    expect(await rowMenu(OPEN_ROW.name)).toEqual({ edit: true, delete: true });
    expect(await rowMenu(MASTER_HELD_ROW.name)).toEqual({ edit: true, delete: true });
  });

  it('a null entry (a row the reader cannot read) leaves Edit where it was', async () => {
    server.door = {
      kind: 'answers',
      locked: { [LOCKED_ROW.id]: null, [OPEN_ROW.id]: false, [MASTER_HELD_ROW.id]: null },
    };
    renderGrid([LOCKED_ROW, OPEN_ROW, MASTER_HELD_ROW]);
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    await reachRowActions();
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    await settleReads();
    expect(await rowMenu(LOCKED_ROW.name)).toEqual({ edit: true, delete: true });
    expect(await rowMenu(MASTER_HELD_ROW.name)).toEqual({ edit: true, delete: true });
  });

  it('a read that fails, or that never answered, leaves Edit where it was', async () => {
    server.door = { kind: 'network' };
    renderGrid([LOCKED_ROW, OPEN_ROW, MASTER_HELD_ROW]);
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    // Not asked yet: the menu is the one it always was.
    expect(server.lockCalls).toHaveLength(0);
    expect(await rowMenu(MASTER_HELD_ROW.name)).toEqual({ edit: true, delete: true });
    await reachRowActions();
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    await settleReads();
    expect(await rowMenu(LOCKED_ROW.name)).toEqual({ edit: true, delete: true });
    expect(await rowMenu(MASTER_HELD_ROW.name)).toEqual({ edit: true, delete: true });
  });
});

/**
 * The list page draws no "⋮" column (objectstack#35554): one selected record's
 * actions are offered by the selection bar, which resolves them from the same
 * row menu props. Edit is a bar button there; Delete is a button or behind
 * 「More」.
 */
async function selectionBarOffers(label: string): Promise<{ edit: boolean; delete: boolean }> {
  const row = screen.getByText(label).closest('tr')!;
  fireEvent.click(within(row).getByRole('checkbox'));
  const bar = await screen.findByTestId('bulk-actions-bar');
  await settleReads();
  const offers = () => ({
    edit: within(bar).queryByTestId('selection-action-edit') !== null
      || screen.queryAllByTestId('row-action-builtin-edit').length > 0,
    delete: within(bar).queryByTestId('selection-action-delete') !== null
      || screen.queryAllByTestId('row-action-builtin-delete').length > 0,
  });
  const more = within(bar).queryByTestId('selection-actions-more');
  if (more) await userEvent.click(more);
  const answer = offers();
  if (more) await userEvent.keyboard('{Escape}');
  fireEvent.click(within(row).getByRole('checkbox'));
  await waitFor(() => expect(screen.queryByTestId('bulk-actions-bar')).toBeNull());
  return answer;
}

describe('objectstack#36911 — the list page selection bar follows the approval lock', () => {
  it('a selected locked row offers no Edit and keeps Delete; a selected unlocked sibling keeps Edit', async () => {
    const { container } = renderGrid([LOCKED_ROW, OPEN_ROW], { listPage: true });
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    // The list page scope: no Actions column, so the bar is the row's actions.
    expect(container.querySelector('th[data-column-key="_actions"]')).toBeNull();
    expect(server.lockCalls).toHaveLength(0);
    // CONTROL first: the unlocked row offers Edit through the bar, so the pin
    // below observes the lock, not a bar that never shows Edit.
    expect(await selectionBarOffers(OPEN_ROW.name)).toEqual({ edit: true, delete: true });
    expect(server.lockCalls).toHaveLength(1);
    expect(await selectionBarOffers(LOCKED_ROW.name)).toEqual({ edit: false, delete: true });
    expect(server.lockCalls).toHaveLength(1);
  });
});

describe('objectstack#36911 — the read in flight', () => {
  it('Edit shows while the lock read is on the wire, and leaves the open menu when it answers locked', async () => {
    server.hold();
    renderGrid();
    await waitFor(() => expect(screen.getByText(LOCKED_ROW.name)).toBeInTheDocument());
    const row = screen.getByText(LOCKED_ROW.name).closest('tr')!;
    await userEvent.click(row.querySelector('[data-testid="row-action-trigger"]')!);
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    // Unanswered: the menu is the one it always was.
    expect(screen.getAllByTestId('row-action-builtin-edit').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('row-action-builtin-delete').length).toBeGreaterThan(0);
    await act(async () => {
      server.release();
      await Promise.allSettled(server.responses);
    });
    await waitFor(() => expect(screen.queryAllByTestId('row-action-builtin-edit')).toHaveLength(0));
    expect(screen.getAllByTestId('row-action-builtin-delete').length).toBeGreaterThan(0);
  });
});

describe('objectstack#37231 — a line whose master is held offers no Delete', () => {
  it('a master-held line offers neither Edit nor Delete; a record-held sibling offers no Edit and keeps Delete', async () => {
    renderGrid([LOCKED_ROW, OPEN_ROW, MASTER_HELD_ROW]);
    await waitFor(() => expect(screen.getByText(MASTER_HELD_ROW.name)).toBeInTheDocument());
    await reachRowActions();
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    await settleReads();
    // CONTROL: the open sibling offers both, so the pins observe the lock.
    expect(await rowMenu(OPEN_ROW.name)).toEqual({ edit: true, delete: true });
    await waitFor(async () => expect(await rowMenu(MASTER_HELD_ROW.name)).toEqual({ edit: false, delete: false }));
    expect(await rowMenu(LOCKED_ROW.name)).toEqual({ edit: false, delete: true });
  });

  it('a grid whose rows offer Delete but no Edit still reads the lock, and drops Delete on the master-held line', async () => {
    renderGrid([OPEN_ROW, MASTER_HELD_ROW], { edit: false });
    await waitFor(() => expect(screen.getByText(MASTER_HELD_ROW.name)).toBeInTheDocument());
    expect(await rowMenu(OPEN_ROW.name)).toEqual({ edit: false, delete: true });
    await waitFor(() => expect(server.lockCalls).toHaveLength(1));
    await settleReads();
    await waitFor(() => expect(screen.getByText(MASTER_HELD_ROW.name).closest('tr')
      ?.querySelector('[data-testid="row-action-trigger"]') ?? null).toBeNull());
    expect(await rowMenu(MASTER_HELD_ROW.name)).toEqual({ edit: false, delete: false });
    expect(await rowMenu(OPEN_ROW.name)).toEqual({ edit: false, delete: true });
  });

  it('the list page selection bar: a selected master-held line offers neither; a selected record-held sibling keeps Delete', async () => {
    renderGrid([LOCKED_ROW, OPEN_ROW, MASTER_HELD_ROW], { listPage: true });
    await waitFor(() => expect(screen.getByText(MASTER_HELD_ROW.name)).toBeInTheDocument());
    expect(await selectionBarOffers(OPEN_ROW.name)).toEqual({ edit: true, delete: true });
    expect(server.lockCalls).toHaveLength(1);
    expect(await selectionBarOffers(MASTER_HELD_ROW.name)).toEqual({ edit: false, delete: false });
    expect(await selectionBarOffers(LOCKED_ROW.name)).toEqual({ edit: false, delete: true });
    expect(server.lockCalls).toHaveLength(1);
  });
});
