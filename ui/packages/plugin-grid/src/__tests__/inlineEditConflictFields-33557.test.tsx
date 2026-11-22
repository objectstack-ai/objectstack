/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33557 — a grid row save that changed several fields and meets a
 * newer version (409 `CONCURRENT_UPDATE`) lists each field on the conflict
 * dialog, under its column header, with both values. It printed the whole
 * draft and the current subset as two raw JSON objects.
 *
 * The real `ObjectGrid` renders the real `data-table` and the real
 * `ConcurrentUpdateDialog`; every write goes through the real
 * `@object-ui/data-objectstack` adapter and `@objectstack/client`. Only `fetch`
 * is stubbed, by a small server that answers a stale `If-Match` with the 409
 * envelope `@objectstack/types` maps a `ConcurrentUpdateError` to. The cells
 * are edited the way a user types them.
 *
 * CONTROL: a row save that changed one field keeps the one-field face (the
 * field's own before and after, no list).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'task_33557';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A store with an `updated_at` per record, refusing a stale `If-Match` with the 409 envelope. */
function makeServer(seed: Array<Record<string, unknown> & { id: string }>) {
  let clock = 0;
  const stamp = () => `2026-11-15 00:00:${String(++clock).padStart(2, '0')}.000`;
  const store: Record<string, Record<string, unknown>> = {};
  for (const row of seed) store[row.id] = { ...row, updated_at: stamp() };
  const statuses: number[] = [];

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/api/v1/discovery')) {
      return json(200, { success: true, data: { capabilities: {}, routes: {} } });
    }
    const match = url.match(/\/api\/v1\/data\/([^/?]+)\/([^/?]+)$/);
    if (!match || method !== 'PATCH') throw new Error(`unexpected request ${method} ${url}`);
    const [, object, rawId] = match;
    const id = decodeURIComponent(rawId);
    const ifMatch = ((init?.headers ?? {}) as Record<string, string>)['If-Match'];
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const current = store[id];
    if (ifMatch !== undefined && ifMatch !== current.updated_at) {
      statuses.push(409);
      return json(409, {
        error: 'Record was modified by another user',
        code: 'CONCURRENT_UPDATE',
        currentVersion: current.updated_at,
        currentRecord: { ...current },
        object,
      });
    }
    store[id] = { ...current, ...body, updated_at: stamp() };
    statuses.push(200);
    return json(200, { success: true, data: { object, id, record: { ...store[id] } } });
  });

  const adapter = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch, autoReconnect: false });
  const project = (row: Record<string, unknown>, select: unknown) =>
    Array.isArray(select)
      ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]]))
      : { ...row };

  const dataSource = {
    find: vi.fn(async (_object: string, params?: { $select?: unknown }) => {
      const rows = Object.values(store).map((r) => project(r, params?.$select));
      return { data: rows, total: rows.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (_object: string, id: string) => ({ ...store[id] })),
    update: vi.fn((object: string, id: string, data: any, opts?: { ifMatch?: string }) =>
      adapter.update(object, id, data, opts),
    ),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        title: { type: 'text', label: 'Title' },
        estimate_hours: { type: 'number', label: 'Estimate' },
        owner_note: { type: 'text', label: 'Owner note' },
      },
    })),
  } as any;

  return {
    store,
    statuses,
    dataSource,
    writeAsOtherUser(id: string, changes: Record<string, unknown>) {
      store[id] = { ...store[id], ...changes, updated_at: stamp() };
    },
  };
}

function renderGrid(server: ReturnType<typeof makeServer>) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    columns: [
      { field: 'title', label: 'Title', editable: false },
      { field: 'estimate_hours', label: 'Estimate', type: 'number' },
      { field: 'owner_note', label: 'Owner note' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={server.dataSource}>
        <ObjectGrid cellSelection={false} schema={schema} dataSource={server.dataSource} onEdit={() => {}} onDelete={() => {}} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

/** Stage a new value on the cell of the row titled `title` that reads `from`, the way a user types it. */
async function editCell(title: string, from: string, to: string) {
  const td = await waitFor(() => {
    const cell = Array.from(rowOf(title).querySelectorAll('td')).find(
      (c) => c.textContent?.trim() === from,
    );
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

async function staleRowSave(edits: Array<[from: string, to: string]>) {
  const server = makeServer([{ id: 't1', title: 'Ingest pipeline', estimate_hours: 60, owner_note: 'ready' }]);
  renderGrid(server);
  await waitFor(() => expect(screen.getByText('Ingest pipeline')).toBeInTheDocument());
  server.writeAsOtherUser('t1', { estimate_hours: 77, owner_note: 'blocked' });
  for (const [from, to] of edits) await editCell('Ingest pipeline', from, to);
  fireEvent.click(within(rowOf('Ingest pipeline')).getByTitle('Save row'));
  const dialog = await screen.findByRole('alertdialog');
  expect(server.statuses).toEqual([409]);
  return dialog;
}

describe('a multi-field grid row conflict lists each field (objectstack#33557)', () => {
  it('two changed fields + a 409: two rows, each under its column header with both values, no raw JSON', async () => {
    const dialog = await staleRowSave([['60', '61'], ['ready', 'shipped']]);

    const rows = within(dialog).getAllByTestId('concurrent-update-field');
    expect(rows.map((r) => r.getAttribute('data-field'))).toEqual(['estimate_hours', 'owner_note']);

    const [estimate, note] = rows;
    expect(within(estimate).getByText('Estimate')).toBeInTheDocument();
    expect(within(estimate).getByText('61')).toBeInTheDocument();
    expect(within(estimate).getByText('77')).toBeInTheDocument();
    expect(within(note).getByText('Owner note')).toBeInTheDocument();
    expect(within(note).getByText('shipped')).toBeInTheDocument();
    expect(within(note).getByText('blocked')).toBeInTheDocument();

    // Neither value is drawn as a serialized object.
    expect(dialog.textContent).not.toMatch(/[{}]/);
    expect(dialog.textContent).not.toContain('"estimate_hours"');
  });

  it('CONTROL: one changed field keeps the one-field face (no list), naming the column and both values', async () => {
    const dialog = await staleRowSave([['60', '61']]);

    expect(within(dialog).queryByTestId('concurrent-update-field-list')).toBeNull();
    expect(within(dialog).getByText('Estimate')).toBeInTheDocument();
    expect(within(dialog).getByText('61')).toBeInTheDocument();
    expect(within(dialog).getByText('77')).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/[{}]/);
  });
});
