/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12292 — the grid's inline-edit saves carry each row's concurrency
 * token, so a stale grid edit is refused instead of silently overwriting a
 * concurrent write.
 *
 * ## What is real here
 *
 * The real `ObjectGrid` renders the real `data-table`, and every WRITE goes
 * through the real `@object-ui/data-objectstack` adapter and the real
 * `@objectstack/client`. Only `fetch` is stubbed, by a small server holding a
 * store with an `updated_at` per record. It answers a stale `If-Match` with the
 * envelope `@objectstack/types` 17.7.0 maps a `ConcurrentUpdateError` to
 * (`409`, `code: 'CONCURRENT_UPDATE'`, `currentVersion`, `currentRecord`), so
 * the error the grid handles is the one the console's adapter builds from that
 * answer.
 *
 * READS are stubbed on the data source, and they honour `$select` the way the
 * server does: a row carries only the keys the query asked for. That is
 * deliberate. A projection built from the columns alone leaves `updated_at`
 * off every row, and then a save has no token to send. So these pins fail
 * on that projection too, not only on a save that drops the token.
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

// The row menu asks the record-level verdict endpoint; serve it from a double.
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'task_12292';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Patch {
  id: string;
  ifMatch: string | undefined;
  body: Record<string, unknown>;
  status: number;
}

/**
 * The fake server. `writeAsOtherUser` is the concurrent write the card
 * reproduces with a second client; `freezeReads` makes every later read answer
 * the rows as they are now, which is how a re-read that has not landed yet
 * looks to the grid.
 */
function makeServer(seed: Array<Record<string, unknown> & { id: string }>) {
  let clock = 0;
  const stamp = () => `2026-10-13 00:00:${String(++clock).padStart(2, '0')}.000`;
  const store: Record<string, Record<string, unknown>> = {};
  for (const row of seed) store[row.id] = { ...row, updated_at: stamp() };
  const patches: Patch[] = [];
  let frozen: Record<string, unknown>[] | null = null;

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
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const ifMatch = headers['If-Match'];
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const current = store[id];
    if (ifMatch !== undefined && ifMatch !== current.updated_at) {
      patches.push({ id, ifMatch, body, status: 409 });
      return json(409, {
        error: 'Record was modified by another user',
        code: 'CONCURRENT_UPDATE',
        currentVersion: current.updated_at,
        currentRecord: { ...current },
        object,
      });
    }
    store[id] = { ...current, ...body, updated_at: stamp() };
    patches.push({ id, ifMatch, body, status: 200 });
    return json(200, { success: true, data: { object, id, record: { ...store[id] } } });
  });

  const adapter = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch, autoReconnect: false });

  const project = (row: Record<string, unknown>, select: unknown) =>
    Array.isArray(select)
      ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]]))
      : { ...row };

  const dataSource = {
    find: vi.fn(async (_object: string, params?: { $select?: unknown }) => {
      const rows = (frozen ?? Object.values(store)).map((r) => project(r, params?.$select));
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
      },
    })),
  } as any;

  return {
    store,
    patches,
    dataSource,
    writeAsOtherUser(id: string, changes: Record<string, unknown>) {
      store[id] = { ...store[id], ...changes, updated_at: stamp() };
    },
    freezeReads() {
      frozen = Object.values(store).map((r) => ({ ...r }));
    },
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
    pagination: { pageSize: 50 },
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

const conflictDialog = () => screen.findByRole('alertdialog');
const clickSaveAll = () =>
  fireEvent.click(screen.getByRole('button', { name: /Save All/ }));

async function loaded(server: ReturnType<typeof makeServer>) {
  renderGrid(server);
  await waitFor(() => expect(screen.getByText('Ingest pipeline')).toBeInTheDocument());
}

describe('ObjectGrid inline edit carries the row token (objectui#12292)', () => {
  it('a stale row save sends If-Match and surfaces the 409 on the conflict dialog', async () => {
    const server = makeServer([{ id: 't1', title: 'Ingest pipeline', estimate_hours: 60 }]);
    await loaded(server);
    const readVersion = server.store.t1.updated_at;

    server.writeAsOtherUser('t1', { estimate_hours: 77 });
    await editEstimate('Ingest pipeline', '60', '61');
    fireEvent.click(within(rowOf('Ingest pipeline')).getByTitle('Save row'));

    const dialog = await conflictDialog();
    expect(server.patches).toEqual([
      { id: 't1', ifMatch: readVersion, body: { estimate_hours: 61 }, status: 409 },
    ]);
    // The record surfaces' dialog, naming the column and both values.
    expect(within(dialog).getByText('This record was modified by someone else')).toBeInTheDocument();
    expect(within(dialog).getByText('Estimate')).toBeInTheDocument();
    expect(within(dialog).getByText('61')).toBeInTheDocument();
    expect(within(dialog).getByText('77')).toBeInTheDocument();

    // Cancel: nothing is written, the edit is kept and the row reads unsaved.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Record was modified by another user'),
    );
    expect(server.store.t1.estimate_hours).toBe(77);
    expect(screen.getByText(/1 row modified/)).toBeInTheDocument();
    expect(server.patches).toHaveLength(1);
  });

  it('Overwrite re-sends the edit keyed to the version the 409 reported', async () => {
    const server = makeServer([{ id: 't1', title: 'Ingest pipeline', estimate_hours: 60 }]);
    await loaded(server);

    server.writeAsOtherUser('t1', { estimate_hours: 77 });
    const theirVersion = server.store.t1.updated_at;
    await editEstimate('Ingest pipeline', '60', '61');
    clickSaveAll();

    fireEvent.click(within(await conflictDialog()).getByRole('button', { name: 'Overwrite anyway' }));
    await waitFor(() => expect(server.store.t1.estimate_hours).toBe(61));
    expect(server.patches.map((p) => [p.ifMatch, p.status])).toEqual([
      [expect.any(String), 409],
      [theirVersion, 200],
    ]);
    await waitFor(() => expect(screen.queryByText(/row modified/)).toBeNull());
  });

  it('Reload latest writes nothing and re-reads the record', async () => {
    const server = makeServer([{ id: 't1', title: 'Ingest pipeline', estimate_hours: 60 }]);
    await loaded(server);

    server.writeAsOtherUser('t1', { estimate_hours: 77 });
    await editEstimate('Ingest pipeline', '60', '61');
    clickSaveAll();

    fireEvent.click(within(await conflictDialog()).getByRole('button', { name: 'Reload latest' }));
    await waitFor(() => expect(within(rowOf('Ingest pipeline')).getByText('77')).toBeInTheDocument());
    expect(server.store.t1.estimate_hours).toBe(77);
    expect(server.patches).toHaveLength(1);
    expect(screen.queryByText(/row modified/)).toBeNull();
  });

  it('a fresh save succeeds, and the next save sends the token the server answered with', async () => {
    const server = makeServer([{ id: 't1', title: 'Ingest pipeline', estimate_hours: 60 }]);
    await loaded(server);
    const readVersion = server.store.t1.updated_at;
    // The grid's re-read after the save has not landed: reads keep answering
    // the row as it was loaded, token and all.
    server.freezeReads();

    await editEstimate('Ingest pipeline', '60', '61');
    clickSaveAll();
    await waitFor(() => expect(server.store.t1.estimate_hours).toBe(61));
    const answeredVersion = server.store.t1.updated_at;
    expect(server.patches[0]).toEqual({ id: 't1', ifMatch: readVersion, body: { estimate_hours: 61 }, status: 200 });
    await waitFor(() => expect(screen.queryByText(/row modified/)).toBeNull());

    // The row still shows the stale read; the second save must not 409 over
    // the user's own first save.
    await editEstimate('Ingest pipeline', '60', '62');
    clickSaveAll();
    await waitFor(() => expect(server.store.t1.estimate_hours).toBe(62));
    expect(server.patches[1]).toEqual({ id: 't1', ifMatch: answeredVersion, body: { estimate_hours: 62 }, status: 200 });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a batch with one stale row reports that row and keeps the row that saved', async () => {
    const server = makeServer([
      { id: 't1', title: 'Ingest pipeline', estimate_hours: 60 },
      { id: 't2', title: 'Warehouse schema', estimate_hours: 33 },
    ]);
    await loaded(server);

    server.writeAsOtherUser('t1', { estimate_hours: 77 });
    await editEstimate('Ingest pipeline', '60', '61');
    await editEstimate('Warehouse schema', '33', '31');
    expect(screen.getByRole('button', { name: /Save All \(2\)/ })).toBeInTheDocument();
    clickSaveAll();

    const dialog = await conflictDialog();
    // Both rows were sent with their own token; only the stale one was refused.
    expect(server.patches.map((p) => [p.id, p.status]).sort()).toEqual([['t1', 409], ['t2', 200]]);
    expect(server.patches.every((p) => typeof p.ifMatch === 'string')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    // The stale row alone stays pending and flagged; the saved row is not
    // rolled back and is not reported as failed.
    await waitFor(() => expect(screen.getByText(/1 row modified/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Save All \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Record was modified by another user');
    expect(within(rowOf('Ingest pipeline')).getByText('61')).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('Warehouse schema')).getByText('31')).toBeInTheDocument());
    expect(server.store.t2.estimate_hours).toBe(31);
    expect(server.store.t1.estimate_hours).toBe(77);
    // No silent retry.
    expect(server.patches).toHaveLength(2);
  });

  it('asks the server for the token even though no column shows it', async () => {
    const server = makeServer([{ id: 't1', title: 'Ingest pipeline', estimate_hours: 60 }]);
    await loaded(server);
    const select = server.dataSource.find.mock.calls.at(-1)?.[1]?.$select as string[];
    expect(select).toEqual(expect.arrayContaining(['id', 'title', 'estimate_hours', 'updated_at']));
  });
});
