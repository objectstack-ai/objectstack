// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27836 — "Add view" in an `object` leaf's list-view panel: the
 * type first, then the fields that type requires, picked by label; the view is
 * created in the package draft and the panel shows it.
 *
 * The REAL hook (`useObjectListViewDraft`), the REAL panel and the REAL Create
 * View dialog over a REAL `MetadataClient`, whose transport judges every view
 * PUT with the installed spec's `view` schema and answers the write door's 422
 * on refusal.
 *
 * Pinned:
 *  - a kanban and a calendar are created, each under its own name, with the
 *    picked fields, in the package draft (`If-None-Match: *`), and the spec
 *    accepts them; the panel then edits the new view, and the default grid is
 *    not written;
 *  - "Back to …" shows the view the nav entry opens again;
 *  - a name a view already holds is refused: nothing is written, the dialog
 *    stays open, and the panel says why.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';

const PKG = 'com.acme.app';
const DEFAULT_VIEW = 'acme_task.default';

const OBJECT_DEF = {
  name: 'acme_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'done', label: 'Done' },
      ],
    },
    due_date: { name: 'due_date', label: 'Due date', type: 'date' },
  },
};

const gridView = {
  name: DEFAULT_VIEW,
  object: 'acme_task',
  viewKind: 'list',
  isDefault: true,
  config: { type: 'grid', data: { provider: 'object', object: 'acme_task' }, columns: ['title', 'status'] },
};

const server = {
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  puts: [] as Array<{ name: string; pkg: string | null; ifNoneMatch: string | null; status: number; body: any }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') {
    return json(200, { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1] })) });
  }
  if (method === 'PUT') {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const verdict = getMetadataTypeSchema('view')!.safeParse(body);
    const ifNoneMatch = new Headers(init?.headers).get('If-None-Match');
    server.puts.push({ name: seg[1]!, pkg: url.searchParams.get('package'), ifNoneMatch, status: verdict.success ? 200 : 422, body });
    if (!verdict.success) {
      return json(422, {
        success: false,
        error: { code: 'INVALID_METADATA', message: 'view failed validation', details: { issues: verdict.error.issues } },
      });
    }
    server.drafts.set(key, body);
    return json(200, { success: true, version: 'v1', state: 'draft' });
  }
  if (seg[0] === 'object' && seg.length === 2) return json(200, { type: 'object', name: seg[1], item: OBJECT_DEF });
  if (seg[0] === 'view' && seg.length === 1) return json(200, [...server.active.values()]);
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = server.active.get(key);
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  if (seg.length === 2 && url.searchParams.get('state') === 'draft') {
    const draft = server.drafts.get(key);
    return draft
      ? json(200, { type: seg[0], name: seg[1], item: { ...draft, _draft: true }, version: 'v1' })
      : json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
  }
  const row = server.active.get(key);
  return row ? json(200, { type: seg[0], name: seg[1], item: row }) : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client };
});
const toastError = vi.fn();
vi.mock('sonner', async (importOriginal) => {
  const mod = await importOriginal<typeof import('sonner')>();
  return { ...mod, toast: Object.assign(vi.fn(), mod.toast, { error: (...args: unknown[]) => toastError(...args) }) };
});

import { ObjectListViewInspector, useObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';
import { tFormat } from '../metadata-admin/i18n';

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_DEF],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
};

const LEAF: Surface = { type: 'object', name: 'acme_task', label: 'Tasks' };

function Host() {
  const listView = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  return <ObjectListViewInspector listView={listView} readOnly={false} locale="en" />;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function openPanel(): Promise<void> {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Host />
    </MetadataCtx.Provider>,
  );
  await settle();
  await waitFor(() => expect(screen.getByTestId('list-view-add-view')).toBeEnabled());
}

/** The view item name the panel shows beneath its title. */
const shownView = () => screen.getByTestId('list-view-name').textContent;

const typeCard = (type: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-testid^="create-view-type-"]')).find(
    (b) => b.getAttribute('data-testid') === `create-view-type-${type}`,
  );
const picker = (key: string) => screen.getByTestId(`create-view-required-${key}`);
const submitButton = () => screen.getByTestId('create-view-submit') as HTMLButtonElement;

/** "Add view", pick `type`, pick each required field by its label, name the view `label`, and press Create. */
async function addView(type: string, picks: Array<[key: string, label: string]>, label: string) {
  fireEvent.click(screen.getByTestId('list-view-add-view'));
  await waitFor(() => expect(typeCard(type)?.disabled).toBe(false));
  fireEvent.click(typeCard(type)!);
  for (const [key, option] of picks) {
    await waitFor(() => expect(picker(key)).toBeEnabled());
    fireEvent.keyDown(picker(key), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    const hit = within(listbox).getAllByRole('option').find((o) => o.textContent === option);
    if (!hit) throw new Error(`${type}: ${key} lists no "${option}"`);
    fireEvent.click(hit);
    await waitFor(() => expect(picker(key).textContent).toBe(option));
  }
  fireEvent.change(screen.getByTestId('create-view-name-input'), { target: { value: label } });
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  fireEvent.click(submitButton());
  await settle();
}

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.puts = [];
  toastError.mockClear();
  server.active.set(`view/${DEFAULT_VIEW}`, gridView);
});
afterEach(cleanup);

describe('ObjectListViewInspector — "Add view" creates a view of the chosen type and opens it (objectstack#27836)', () => {
  it('a kanban: born with the picked group-by field in the package draft, accepted by the spec, and opened in the panel', async () => {
    await openPanel();
    expect(shownView()).toBe(DEFAULT_VIEW);
    await addView('kanban', [['groupByField', 'Status']], 'Pipeline board');

    expect(server.puts).toHaveLength(1);
    const [put] = server.puts;
    expect(put).toMatchObject({ name: 'acme_task.pipeline_board', pkg: PKG, ifNoneMatch: '*', status: 200 });
    expect(put.body).toMatchObject({ name: 'acme_task.pipeline_board', object: 'acme_task', viewKind: 'list', label: 'Pipeline board' });
    expect(put.body.config.type).toBe('kanban');
    expect(put.body.config.kanban).toMatchObject({ groupByField: 'status' });
    // Never the object's default: the default grid stays the one it was.
    expect(put.body.isDefault).toBeUndefined();
    expect(server.puts.some((p) => p.name === DEFAULT_VIEW)).toBe(false);

    // The dialog closed, and the panel now edits the board, card section included.
    await waitFor(() => expect(screen.queryByTestId('create-view-submit')).toBeNull());
    await waitFor(() => expect(shownView()).toBe('acme_task.pipeline_board'));
    expect(screen.getByTestId('list-view-kanban-card')).toBeInTheDocument();
    expect(screen.getByTestId('list-view-back-to-entry')).toBeInTheDocument();
  });

  it('a calendar: born with its start-date and title fields, picked by label', async () => {
    await openPanel();
    await addView('calendar', [['startDateField', 'Due date'], ['titleField', 'Title']], 'Due dates');

    expect(server.puts).toHaveLength(1);
    const [put] = server.puts;
    expect(put).toMatchObject({ name: 'acme_task.due_dates', pkg: PKG, ifNoneMatch: '*', status: 200 });
    expect(put.body.config.type).toBe('calendar');
    expect(put.body.config.calendar).toEqual({ startDateField: 'due_date', titleField: 'title' });
    await waitFor(() => expect(shownView()).toBe('acme_task.due_dates'));
  });

  it('"Back to …" shows the view the nav entry opens again', async () => {
    await openPanel();
    await addView('kanban', [['groupByField', 'Status']], 'Pipeline board');
    await waitFor(() => expect(shownView()).toBe('acme_task.pipeline_board'));

    fireEvent.click(screen.getByTestId('list-view-back-to-entry'));
    await settle();
    expect(shownView()).toBe(DEFAULT_VIEW);
    expect(screen.queryByTestId('list-view-back-to-entry')).toBeNull();
  });

  it('a name a view already holds: nothing is written, the dialog stays open, and the panel says why', async () => {
    server.active.set('view/acme_task.pipeline_board', { ...gridView, name: 'acme_task.pipeline_board', isDefault: undefined });
    await openPanel();
    await addView('kanban', [['groupByField', 'Status']], 'Pipeline board');

    expect(server.puts).toEqual([]);
    expect(toastError).toHaveBeenCalledWith(
      tFormat('engine.studio.inspector.listView.addViewTaken', 'en', { name: 'acme_task.pipeline_board' }),
    );
    expect(screen.getByTestId('create-view-submit')).toBeInTheDocument();
    expect(shownView()).toBe(DEFAULT_VIEW);
  });
});
