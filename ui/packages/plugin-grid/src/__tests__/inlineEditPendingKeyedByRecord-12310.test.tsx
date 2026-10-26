/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12310 — a pending inline edit belongs to its RECORD, not to the
 * position its row had when the edit was staged.
 *
 * `data-table` used to key pending edits by page-local row index. Every
 * re-read that put the page in a new order (a row save's refresh, the
 * data-invalidation bus, a page change) then drew a kept edit on whichever
 * record now sat at that index, and Save All wrote it there: a value typed on
 * one record landed on another with a 200, and the If-Match token from
 * objectui#12292 could not catch it, because the wrong row's own token was
 * current.
 *
 * ## What is real here
 *
 * The real `ObjectGrid` renders the real `data-table`, and every write goes
 * through the real `@object-ui/data-objectstack` adapter. Only `fetch` is
 * stubbed for writes, and reads are served from the same store, the way the
 * server answers them: most recently modified first, one page at a time
 * (`$top` / `$skip`), projected to `$select`. So a save moves the saved record
 * to the top of the next read, which is the reorder the card measured.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
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

const OBJECT = 'task_12310';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Patch {
  id: string;
  ifMatch: string | undefined;
  body: Record<string, unknown>;
  status: number;
}

/**
 * The fake server. Seeded oldest first, so the first seed row is the LAST row
 * of the first read. `writeAsOtherUser` is a concurrent write that moves the
 * record it touches to the top of the next read.
 */
function makeServer(seed: Array<Record<string, unknown> & { id: string }>) {
  let clock = 0;
  const stamp = () => `2026-10-13 00:00:${String(++clock).padStart(2, '0')}.000`;
  const store: Record<string, Record<string, unknown>> = {};
  for (const row of seed) store[row.id] = { ...row, updated_at: stamp() };
  const patches: Patch[] = [];

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
    find: vi.fn(async (_object: string, params?: { $select?: unknown; $top?: number; $skip?: number }) => {
      // The server's order: most recently modified first.
      const ordered = Object.values(store).sort((a, b) =>
        String(b.updated_at).localeCompare(String(a.updated_at)),
      );
      const skip = params?.$skip ?? 0;
      const top = params?.$top ?? ordered.length;
      const rows = ordered.slice(skip, skip + top).map((r) => project(r, params?.$select));
      return { data: rows, total: ordered.length, hasMore: skip + top < ordered.length, pageSize: top };
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
  };
}

function renderGrid(server: ReturnType<typeof makeServer>, pageSize = 50) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'title', label: 'Title', editable: false },
      { field: 'estimate_hours', label: 'Estimate', type: 'number' },
    ],
    pagination: { pageSize },
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

/** The titles of the body rows, top to bottom. */
const bodyOrder = () =>
  Array.from(document.querySelectorAll('tbody tr'))
    .map((tr) => ['Alpha', 'Bravo', 'Charlie', 'Delta'].find((t) => tr.textContent?.includes(t)))
    .filter(Boolean);

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

const clickSaveAll = () => fireEvent.click(screen.getByRole('button', { name: /Save All/ }));

/** What each record holds, as `{ id: estimate }`. */
const estimates = (server: ReturnType<typeof makeServer>) =>
  Object.fromEntries(Object.entries(server.store).map(([id, r]) => [id, r.estimate_hours]));

describe('ObjectGrid inline edit keeps each pending edit on its record (objectui#12310)', () => {
  it("the card's sequence: a row save's re-read reorders the page, and Save All writes each edit to its own record", async () => {
    // Seeded oldest first: the first read is Bravo, Alpha.
    const server = makeServer([
      { id: 'a', title: 'Alpha', estimate_hours: 10 },
      { id: 'b', title: 'Bravo', estimate_hours: 20 },
    ]);
    renderGrid(server);
    await waitFor(() => expect(bodyOrder()).toEqual(['Bravo', 'Alpha']));

    await editEstimate('Bravo', '20', '21');
    await editEstimate('Alpha', '10', '11');
    expect(screen.getByText(/2 rows modified/)).toBeInTheDocument();

    // Save Alpha alone; the re-read that follows puts Alpha on top.
    fireEvent.click(within(rowOf('Alpha')).getByTitle('Save row'));
    await waitFor(() => expect(bodyOrder()).toEqual(['Alpha', 'Bravo']));
    expect(server.patches.map((p) => [p.id, p.body])).toEqual([['a', { estimate_hours: 11 }]]);

    // Bravo's edit is still drawn on Bravo, and on nothing else.
    expect(screen.getByText(/1 row modified/)).toBeInTheDocument();
    expect(within(rowOf('Bravo')).getByText('21')).toBeInTheDocument();
    expect(within(rowOf('Alpha')).getByText('11')).toBeInTheDocument();
    expect(within(rowOf('Alpha')).queryByText('21')).toBeNull();

    clickSaveAll();
    await waitFor(() => expect(server.patches).toHaveLength(2));
    expect(server.patches[1]).toMatchObject({ id: 'b', body: { estimate_hours: 21 }, status: 200 });
    expect(estimates(server)).toEqual({ a: 11, b: 21 });
    await waitFor(() => expect(screen.queryByText(/row modified/)).toBeNull());
  });

  it('a re-read through the invalidation bus that reorders the page keeps each edit on its record', async () => {
    // First read: Charlie, Bravo, Alpha, Delta.
    const server = makeServer([
      { id: 'd', title: 'Delta', estimate_hours: 40 },
      { id: 'a', title: 'Alpha', estimate_hours: 10 },
      { id: 'b', title: 'Bravo', estimate_hours: 20 },
      { id: 'c', title: 'Charlie', estimate_hours: 30 },
    ]);
    renderGrid(server);
    await waitFor(() => expect(bodyOrder()).toEqual(['Charlie', 'Bravo', 'Alpha', 'Delta']));

    await editEstimate('Bravo', '20', '21');
    await editEstimate('Alpha', '10', '11');

    // Someone else writes Delta; the bus re-reads, and every row moves down one.
    server.writeAsOtherUser('d', { estimate_hours: 41 });
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'd' }));
    await waitFor(() => expect(bodyOrder()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']));

    expect(within(rowOf('Bravo')).getByText('21')).toBeInTheDocument();
    expect(within(rowOf('Alpha')).getByText('11')).toBeInTheDocument();
    expect(within(rowOf('Charlie')).getByText('30')).toBeInTheDocument();
    expect(within(rowOf('Delta')).getByText('41')).toBeInTheDocument();

    clickSaveAll();
    await waitFor(() => expect(server.patches).toHaveLength(2));
    expect(server.patches.map((p) => [p.id, p.body, p.status]).sort()).toEqual([
      ['a', { estimate_hours: 11 }, 200],
      ['b', { estimate_hours: 21 }, 200],
    ]);
    expect(estimates(server)).toEqual({ a: 11, b: 21, c: 30, d: 41 });
  });

  it("a row's own save on a reordered page writes that row's edit", async () => {
    const server = makeServer([
      { id: 'd', title: 'Delta', estimate_hours: 40 },
      { id: 'a', title: 'Alpha', estimate_hours: 10 },
      { id: 'b', title: 'Bravo', estimate_hours: 20 },
      { id: 'c', title: 'Charlie', estimate_hours: 30 },
    ]);
    renderGrid(server);
    await waitFor(() => expect(bodyOrder()).toEqual(['Charlie', 'Bravo', 'Alpha', 'Delta']));

    await editEstimate('Bravo', '20', '21');
    await editEstimate('Alpha', '10', '11');
    server.writeAsOtherUser('d', { estimate_hours: 41 });
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'd' }));
    await waitFor(() => expect(bodyOrder()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']));

    fireEvent.click(within(rowOf('Bravo')).getByTitle('Save row'));
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect(server.patches[0]).toMatchObject({ id: 'b', body: { estimate_hours: 21 }, status: 200 });
    await waitFor(() => expect(screen.getByText(/1 row modified/)).toBeInTheDocument());
    expect(within(rowOf('Alpha')).getByText('11')).toBeInTheDocument();
    expect(estimates(server)).toEqual({ a: 10, b: 21, c: 30, d: 41 });
  });

  it('a page change keeps a pending edit with its record, and Save All from another page writes it there', async () => {
    // Two rows a page. First read: page 1 is Charlie, Bravo; page 2 is Alpha.
    const server = makeServer([
      { id: 'a', title: 'Alpha', estimate_hours: 10 },
      { id: 'b', title: 'Bravo', estimate_hours: 20 },
      { id: 'c', title: 'Charlie', estimate_hours: 30 },
    ]);
    renderGrid(server, 2);
    await waitFor(() => expect(bodyOrder()).toEqual(['Charlie', 'Bravo']));
    await editEstimate('Bravo', '20', '21');
    const readVersion = server.store.b.updated_at;

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(bodyOrder()).toEqual(['Alpha']));
    // Nothing on page 2 is drawn as edited; the edit is still counted.
    expect(within(rowOf('Alpha')).getByText('10')).toBeInTheDocument();
    expect(within(rowOf('Alpha')).queryByText('21')).toBeNull();
    expect(screen.getByText(/1 row modified/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(bodyOrder()).toEqual(['Charlie', 'Bravo']));
    expect(within(rowOf('Bravo')).getByText('21')).toBeInTheDocument();
    expect(within(rowOf('Charlie')).queryByText('21')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(bodyOrder()).toEqual(['Alpha']));
    clickSaveAll();
    await waitFor(() => expect(server.patches).toHaveLength(1));
    // Written to Bravo, with the token Bravo was read with.
    expect(server.patches[0]).toEqual({ id: 'b', ifMatch: readVersion, body: { estimate_hours: 21 }, status: 200 });
    expect(estimates(server)).toEqual({ a: 10, b: 21, c: 30 });
    await waitFor(() => expect(screen.queryByText(/row modified/)).toBeNull());
  });

  it('a re-read that drops a record with a pending edit keeps the edit pending against that record', async () => {
    // Two rows a page. First read: page 1 is Charlie, Bravo.
    const server = makeServer([
      { id: 'a', title: 'Alpha', estimate_hours: 10 },
      { id: 'b', title: 'Bravo', estimate_hours: 20 },
      { id: 'c', title: 'Charlie', estimate_hours: 30 },
    ]);
    renderGrid(server, 2);
    await waitFor(() => expect(bodyOrder()).toEqual(['Charlie', 'Bravo']));
    await editEstimate('Bravo', '20', '21');

    // Someone else writes Alpha; the re-read pushes Bravo onto page 2.
    server.writeAsOtherUser('a', { estimate_hours: 12 });
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'a' }));
    await waitFor(() => expect(bodyOrder()).toEqual(['Alpha', 'Charlie']));

    // The edit is not drawn on the row now at Bravo's old position.
    expect(within(rowOf('Charlie')).getByText('30')).toBeInTheDocument();
    expect(within(rowOf('Charlie')).queryByText('21')).toBeNull();
    expect(screen.getByText(/1 row modified/)).toBeInTheDocument();

    clickSaveAll();
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect(server.patches[0]).toMatchObject({ id: 'b', body: { estimate_hours: 21 }, status: 200 });
    expect(estimates(server)).toEqual({ a: 12, b: 21, c: 30 });
  });
});
