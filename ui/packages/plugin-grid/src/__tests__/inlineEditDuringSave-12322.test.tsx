/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12322 — an estimate typed while a row save or Save All is on the
 * wire is still pending when the save lands.
 *
 * `ObjectGrid`'s default saves await `dataSource.update` over the network, and
 * every cell stays editable meanwhile. `data-table` used to settle a save by
 * rebuilding its pending edits from the copy it read when the save was
 * pressed, so an edit staged during the round trip vanished with no signal.
 * The table's own pins are in `@object-ui/components`
 * (`data-table-save-settles-current-12322.test.tsx`); these run the console's
 * path end to end.
 *
 * ## What is real here
 *
 * The real `ObjectGrid` renders the real `data-table` and its field-widget
 * editors, and every write goes through the real `@object-ui/data-objectstack`
 * adapter. Only `fetch` is stubbed, and it holds each write open until the test
 * releases it. Reads are served from the same store, most recently modified
 * first.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within, act } from '@testing-library/react';
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

const OBJECT = 'task_12322';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake server whose writes wait on `release()`. */
function makeServer(seed: Array<Record<string, unknown> & { id: string }>) {
  let clock = 0;
  const stamp = () => `2026-10-13 00:00:${String(++clock).padStart(2, '0')}.000`;
  const store: Record<string, Record<string, unknown>> = {};
  for (const row of seed) store[row.id] = { ...row, updated_at: stamp() };
  const patches: Array<{ id: string; body: Record<string, unknown> }> = [];
  let releaseWrites!: () => void;
  const writesHeld = new Promise<void>((resolve) => {
    releaseWrites = resolve;
  });

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
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    patches.push({ id, body });
    await writesHeld;
    store[id] = { ...store[id], ...body, updated_at: stamp() };
    return json(200, { success: true, data: { object, id, record: { ...store[id] } } });
  });

  const adapter = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch, autoReconnect: false });

  const project = (row: Record<string, unknown>, select: unknown) =>
    Array.isArray(select)
      ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]]))
      : { ...row };

  const dataSource = {
    find: vi.fn(async (_object: string, params?: { $select?: unknown }) => {
      const ordered = Object.values(store).sort((a, b) =>
        String(b.updated_at).localeCompare(String(a.updated_at)),
      );
      const rows = ordered.map((r) => project(r, params?.$select));
      return { data: rows, total: rows.length, hasMore: false, pageSize: rows.length };
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
      },
    })),
  } as any;

  return {
    store,
    patches,
    dataSource,
    /** Let every held write, and every later one, land. */
    release: () => act(async () => releaseWrites()),
  };
}

function renderGrid(server: ReturnType<typeof makeServer>) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'title', label: 'Title', editable: false },
      { field: 'estimate_hours', label: 'Estimate', type: 'number' },
    ],
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={server.dataSource}>
        {/* Row Edit/Delete handlers: the per-row save button exists. */}
        <ObjectGrid schema={schema} dataSource={server.dataSource} onEdit={() => {}} onDelete={() => {}} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

/** Stage a new Estimate on the row titled `title`, the way a user types it. */
async function editEstimate(title: string, from: string, to: string) {
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

const estimates = (server: ReturnType<typeof makeServer>) =>
  Object.fromEntries(Object.entries(server.store).map(([id, r]) => [id, r.estimate_hours]));

describe('ObjectGrid keeps an inline edit made while a save is on the wire (objectui#12322)', () => {
  it.each([
    ['a row save', (title: string) => fireEvent.click(within(rowOf(title)).getByTitle('Save row'))],
    ['Save All', () => fireEvent.click(screen.getByRole('button', { name: /Save All/ }))],
  ] as const)('%s held open: an estimate staged on another row is still pending after the save lands', async (_label, save) => {
    const server = makeServer([
      { id: 'a', title: 'Alpha', estimate_hours: 10 },
      { id: 'b', title: 'Bravo', estimate_hours: 20 },
    ]);
    renderGrid(server);
    await waitFor(() => expect(within(rowOf('Alpha')).getByText('10')).toBeInTheDocument());

    await editEstimate('Alpha', '10', '11');
    save('Alpha');
    await waitFor(() => expect(server.patches).toEqual([{ id: 'a', body: { estimate_hours: 11 } }]));

    // The write is on the wire; Bravo's cell is still editable.
    await editEstimate('Bravo', '20', '21');
    expect(screen.getByText(/2 rows modified/)).toBeInTheDocument();

    await server.release();
    await waitFor(() => expect(estimates(server)).toEqual({ a: 11, b: 20 }));
    await waitFor(() => expect(screen.getByText(/1 row modified/)).toBeInTheDocument());
    expect(within(rowOf('Bravo')).getByText('21')).toBeInTheDocument();

    // And the next Save All writes it.
    fireEvent.click(screen.getByRole('button', { name: /Save All/ }));
    await waitFor(() => expect(estimates(server)).toEqual({ a: 11, b: 21 }));
    expect(server.patches[1]).toEqual({ id: 'b', body: { estimate_hours: 21 } });
    await waitFor(() => expect(screen.queryByText(/row modified/)).toBeNull());
  });
});
