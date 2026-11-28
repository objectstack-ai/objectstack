/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The selection bar's built-in **Change Owner** (objectstack#35403).
 *
 * The grid offers it exactly where its host wires `onBulkChangeOwner` — the
 * Console wires it only on an object whose switch is on and whose
 * `/me/permissions` grant covers a change of owner — and hands the host every
 * selected record. The grid judges nothing itself: the host's dialog sends
 * the rows, and the server reports each one it did not move.
 *
 * `/api/v1/security/explain` is served permissively by a recording double for
 * the reason `bulkDeleteVisibleWhen.test.tsx` gives (objectui#7307): the
 * grid's per-record CRUD verdict read degrades to the global `fetch`.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => undefined,
      can: () => true,
    }),
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { CHANGE_OWNER_BULK_ACTION } from '../components/BulkActionBar';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'crm_deal';
const ROWS = [
  { id: 'd1', name: 'Deal One', owner_id: 'u_amy' },
  { id: 'd2', name: 'Deal Two', owner_id: 'u_bo' },
  { id: 'd3', name: 'Deal Three', owner_id: 'u_cy' },
];

const EXPLAIN_ROUTE = '/api/v1/security/explain';
let fetchCalls: string[] = [];

function installExplainDouble() {
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      fetchCalls.push(url);
      if (url !== EXPLAIN_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      let body: { recordIds?: unknown } = {};
      try {
        body = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? '{}'));
      } catch {
        /* not a request this route answers */
      }
      const recordIds = Array.isArray(body.recordIds) ? body.recordIds : null;
      return {
        ok: true,
        status: 200,
        json: async () =>
          recordIds
            ? { records: recordIds.map((recordId) => ({ recordId, visible: true })) }
            : { record: { visible: true } },
      };
    }),
  );
}

function renderGrid(onBulkChangeOwner?: (rows: any[]) => void) {
  const dataSource: any = {
    find: vi.fn(async () => ({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length, hasMore: false, pageSize: 50 })),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, owner_id: { type: 'lookup' } },
    }),
  };
  render(
    <ObjectGrid
      schema={{
        type: 'object-grid',
        objectName: OBJECT,
        columns: [{ field: 'name', label: 'Name' }],
        pagination: { pageSize: 50 },
        // Selection on in both cases, so the unwired case selects rows too.
        selection: { type: 'multiple' },
      } as any}
      dataSource={dataSource}
      onBulkChangeOwner={onBulkChangeOwner}
    />,
  );
  return dataSource;
}

function checkboxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[role="checkbox"]')) as HTMLElement[];
}

async function selectRows(names: string[]) {
  for (const row of ROWS) {
    await waitFor(() => expect(screen.getByText(row.name)).toBeInTheDocument());
  }
  await waitFor(() => expect(checkboxes().length).toBeGreaterThan(ROWS.length));
  const all = checkboxes();
  for (const name of names) {
    fireEvent.click(all[ROWS.findIndex((r) => r.name === name) + 1]);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  installExplainDouble();
});

afterEach(() => {
  expect(fetchCalls.filter((url) => url !== EXPLAIN_ROUTE)).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

describe('the selection bar offers Change Owner where its host wires it (objectstack#35403)', () => {
  it('hands the host every selected record, and writes nothing itself', async () => {
    const onBulkChangeOwner = vi.fn();
    const dataSource = renderGrid(onBulkChangeOwner);
    await selectRows(['Deal One', 'Deal Three']);
    fireEvent.click(await screen.findByTestId(`bulk-action-${CHANGE_OWNER_BULK_ACTION}`));
    await waitFor(() => expect(onBulkChangeOwner).toHaveBeenCalledTimes(1));
    expect(onBulkChangeOwner.mock.calls[0][0].map((r: any) => r.id)).toEqual(['d1', 'd3']);
    expect(dataSource.update).not.toHaveBeenCalled();
  });

  it('a host that does not wire it is offered no Change Owner', async () => {
    renderGrid(undefined);
    await selectRows(['Deal One', 'Deal Two']);
    // The selection is live; the bar carries no Change Owner.
    await waitFor(() => expect(checkboxes().filter((c) => c.getAttribute('data-state') === 'checked').length).toBe(2));
    expect(screen.queryByTestId(`bulk-action-${CHANGE_OWNER_BULK_ACTION}`)).not.toBeInTheDocument();
  });
});
