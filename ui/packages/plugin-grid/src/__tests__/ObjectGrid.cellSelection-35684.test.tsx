/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGrid`'s `cellSelection` host prop (objectstack#35684): the grid
 * mounts `data-table`'s select-first cell model and tells it, per cell, why the
 * cell opens no editor. The table's behaviour is pinned in
 * `@object-ui/components` (`data-table-select-first-35684.test.tsx`,
 * `data-table-keys-35687.test.tsx`); this file pins the relay and the reasons:
 *
 *   1. With the prop a click selects; without it the same click edits.
 *   2. The field's reason (read-only, calculated), the reader's grant, the
 *      view's opt-out, and the record's approval lock, each in its words.
 *   3. The lock is read from the approvals service's per-record answer when a
 *      cell of the row is selected; with no answer the row's
 *      `approval_status` stands in (`resolveApprovalLock`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// The viewer's update grant, switchable per test. Stable stub identity:
// `ObjectGrid` keeps `perms` in memo dependency arrays.
const { permsStub, grant } = vi.hoisted(() => {
  const grant = { update: true };
  return {
    grant,
    permsStub: {
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => undefined,
      can: (_obj: string, action: string) => (action === 'update' ? grant.update : true),
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub };
});

// Registers `object-grid`, the block under test.
import { ObjectGridRenderer } from '../index';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { __resetApprovalsServiceLatch } from '../hooks/useRowApprovalLocks';

const ROWS = [
  { id: '1', name: 'Alpha', total: 5, approval_status: null },
  { id: '2', name: 'Beta', total: 7, approval_status: 'pending' },
  { id: '3', name: 'Gamma', total: 9, approval_status: null },
];
const FIELDS = {
  name: { type: 'text', label: 'Name' },
  code: { type: 'text', label: 'Code', readonly: true },
  total: { type: 'formula', label: 'Total' },
};

let lockedIds = new Set<string>();
let lockStatus = 200;
let lockReads: string[] = [];

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  __resetApprovalsServiceLatch();
  lockedIds = new Set();
  lockStatus = 200;
  lockReads = [];
  // The explain engine permits every row; the approvals service answers the lock.
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const href = String(url);
    const lock = /\/api\/v1\/approvals\/records\/probe\/([^/]+)\/lock$/.exec(href);
    if (lock) {
      lockReads.push(decodeURIComponent(lock[1]));
      return { ok: lockStatus < 300, status: lockStatus, json: async () => ({ success: true, data: { locked: lockedIds.has(lock[1]) } }) };
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const ids: string[] = Array.isArray(body.recordIds) ? body.recordIds : [];
    return { ok: true, status: 200, json: async () => ({ allowed: true, records: ids.map((id) => ({ recordId: id, visible: true })) }) };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  grant.update = true;
});

async function renderGrid(extra: Record<string, unknown> = {}, cellSelection = true) {
  const utils = render(
    <ObjectGridRenderer
      schema={{
        type: 'object-grid',
        objectName: 'probe',
        columns: ['name', 'code', 'total'],
        data: { provider: 'value', items: ROWS.map((r) => ({ ...r, code: `C-${r.id}` })) },
        editable: true,
        ...extra,
      }}
      objectFields={FIELDS}
      cellSelection={cellSelection || undefined}
    />,
  );
  await screen.findByText('Gamma', {}, { timeout: 5000 });
  const cell = (row: number, col: number) =>
    utils.container.querySelectorAll('tbody tr')[row].querySelectorAll<HTMLElement>('td[data-grid-cell]')[col];
  return { ...utils, cell };
}

const reasonOn = async (cell: HTMLElement) => {
  fireEvent.click(cell);
  fireEvent.doubleClick(cell);
  return (await screen.findByTestId('cell-readonly-reason')).textContent;
};

describe('ObjectGrid cellSelection — the relay (objectstack#35684)', () => {
  it('with the prop a click selects the cell and opens no editor', async () => {
    const g = await renderGrid();
    fireEvent.click(g.cell(0, 0));
    expect(g.cell(0, 0)).toHaveAttribute('data-selected-cell');
    expect(g.cell(0, 0).querySelector('td[data-editing-cell], input:not([data-slot])')).toBeNull();
    fireEvent.doubleClick(g.cell(0, 0));
    await waitFor(() => expect(g.container.querySelector('td[data-editing-cell]')).not.toBeNull());
  });

  it('control: without it the grid keeps its click-to-edit', async () => {
    const { container } = render(
      <ObjectGridRenderer
        schema={{ type: 'object-grid', objectName: 'probe', columns: ['name'], data: { provider: 'value', items: ROWS }, editable: true }}
        objectFields={FIELDS}
      />,
    );
    await screen.findByText('Gamma', {}, { timeout: 5000 });
    const first = container.querySelector<HTMLElement>('tbody tr td[data-grid-cell]')!;
    fireEvent.click(first);
    await waitFor(() => expect(container.querySelector('td[data-editing-cell]')).not.toBeNull());
    expect(first).not.toHaveAttribute('data-selected-cell');
  });
});

describe('ObjectGrid cellSelection — why a cell opens no editor', () => {
  it('a read-only field, and a calculated one', async () => {
    const g = await renderGrid();
    expect(await reasonOn(g.cell(0, 1))).toBe('This field is read-only.');
    expect(await reasonOn(g.cell(0, 2))).toBe("This value is calculated, so it can't be edited.");
  });

  it('a reader with no update grant', async () => {
    grant.update = false;
    const g = await renderGrid();
    expect(await reasonOn(g.cell(0, 0))).toBe("You don't have permission to edit these records.");
  });

  it('a view that turned editing off', async () => {
    const g = await renderGrid({ editable: false });
    expect(await reasonOn(g.cell(0, 0))).toBe('Editing in the list is turned off for this view.');
  });

  it("a record in approval, read off its approval_status while the lock read has not answered", async () => {
    lockStatus = 501;
    const g = await renderGrid();
    expect(await reasonOn(g.cell(1, 0))).toBe("This record is locked while it's in approval.");
    // Its neighbour edits.
    fireEvent.click(g.cell(2, 0));
    fireEvent.doubleClick(g.cell(2, 0));
    await waitFor(() => expect(g.container.querySelector('td[data-editing-cell]')).not.toBeNull());
  });

  it("a record the approvals service says is locked, asked when its cell is selected", async () => {
    lockedIds = new Set(['3']);
    const g = await renderGrid();
    expect(lockReads).toEqual([]);
    fireEvent.click(g.cell(2, 0));
    await waitFor(() => expect(lockReads).toEqual(['3']));
    // Let the answer land before the edit is asked for.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.doubleClick(g.cell(2, 0));
    expect((await screen.findByTestId('cell-readonly-reason')).textContent).toBe("This record is locked while it's in approval.");
    expect(g.container.querySelector('td[data-editing-cell]')).toBeNull();
    // An answer that says unlocked wins over the column: the pending row edits.
    fireEvent.click(g.cell(1, 0));
    await waitFor(() => expect(lockReads).toEqual(['3', '2']));
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.doubleClick(g.cell(1, 0));
    await waitFor(() => expect(g.container.querySelector('td[data-editing-cell]')).not.toBeNull());
  });
});
