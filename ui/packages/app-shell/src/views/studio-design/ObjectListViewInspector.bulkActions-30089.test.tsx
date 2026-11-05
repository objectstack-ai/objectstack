// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30089 — the list-view panel's selection actions: the object's
 * actions picked into `bulkActions`, and field updates written to
 * `bulkActionDefs` (label, the fields the dialog asks for, a confirmation).
 *
 * The REAL hook (`useObjectListViewDraft`) and the REAL panel over a REAL
 * `MetadataClient`, whose transport judges every view PUT with the installed
 * spec's `view` schema and answers the write door's 422 on refusal; each
 * written def is judged again with `BulkActionDefSchema`.
 *
 * Pinned:
 *  - picking an action writes `bulkActions`, by name; the built-in Delete is
 *    offered as `delete`, and the section says whether Delete stays;
 *  - adding a field update writes one def the spec accepts, its params taken
 *    from the fields (options of a select, the object of a lookup);
 *  - editing a def's label, fields and confirmation, and removing a def or an
 *    action, round-trip; an emptied key is removed, not written empty;
 *  - a def of another kind is shown and removable, a name the object does not
 *    declare is shown marked;
 *  - a read-only package shows the actions and offers no edit;
 *  - CONTROLS: a view with neither key saves byte-for-byte as it was read, an
 *    edit elsewhere adds neither key, and a kanban view has no such section.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { BulkActionDefSchema } from '@objectstack/spec/ui';

const PKG = 'com.acme.app';
const VIEW = 'acme_task.default';

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
        { value: 'open', label: 'Open', color: '#94A3B8' },
        { value: 'done', label: 'Done' },
      ],
    },
    assignee: { name: 'assignee', label: 'Assignee', type: 'user' },
    project: { name: 'project', label: 'Project', type: 'lookup', reference: 'acme_project' },
    due_date: { name: 'due_date', label: 'Due date', type: 'date' },
    score: { name: 'score', label: 'Score', type: 'formula', expression: '1' },
    code: { name: 'code', label: 'Code', type: 'text', readonly: true },
  },
  actions: [
    { name: 'close_task', label: 'Close task', type: 'script' },
    { name: 'escalate', label: 'Escalate', type: 'script' },
  ],
};

const view = (config: Record<string, unknown>) => ({
  name: VIEW,
  object: 'acme_task',
  viewKind: 'list',
  isDefault: true,
  config: { data: { provider: 'object', object: 'acme_task' }, columns: ['title', 'status'], ...config },
});

const server = {
  active: new Map<string, Record<string, unknown>>(),
  puts: [] as Array<{ name: string; status: number; body: any }>,
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
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (method === 'PUT') {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const verdict = getMetadataTypeSchema('view')!.safeParse(body);
    server.puts.push({ name: seg[1]!, status: verdict.success ? 200 : 422, body });
    if (!verdict.success) {
      return json(422, {
        success: false,
        error: { code: 'INVALID_METADATA', message: 'view failed validation', details: { issues: verdict.error.issues } },
      });
    }
    return json(200, { success: true, version: 'v2', state: 'draft' });
  }
  if (seg[0] === 'object' && seg.length === 2) return json(200, { type: 'object', name: seg[1], item: OBJECT_DEF });
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = server.active.get(key);
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  if (seg.length === 2 && url.searchParams.get('state') === 'draft') {
    return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
  }
  const row = server.active.get(key);
  return row ? json(200, { type: seg[0], name: seg[1], item: row }) : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client };
});

import { ObjectListViewInspector, useObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';

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

/** The panel, and the pillar autosave's one call into it: send the buffer. */
function Host({ readOnly = false }: { readOnly?: boolean }) {
  const listView = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  return (
    <>
      <span data-testid="dirty">{String(listView.dirty)}</span>
      <button type="button" data-testid="save" onClick={() => void listView.save({ unmoved: () => true })}>
        save
      </button>
      <ObjectListViewInspector listView={listView} readOnly={readOnly} locale="en" />
    </>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function openPanel(readOnly = false): Promise<void> {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Host readOnly={readOnly} />
    </MetadataCtx.Provider>,
  );
  await settle();
  await waitFor(() => expect(screen.getByTestId('studio-list-view-inspector')).toBeInTheDocument());
}

const section = () => screen.getByTestId('list-view-bulk');
const deleteState = () => within(section()).getByTestId('list-view-bulk-delete').getAttribute('data-state');

/** Open the picker `id` and pick the option whose label (before its `<code>`) is `label`. */
async function pickFrom(id: string, label: string) {
  const trigger = document.getElementById(id);
  if (!trigger) throw new Error(`no picker ${id}`);
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const hit = within(listbox)
    .getAllByRole('option')
    .find((o) => o.querySelector('code')?.previousElementSibling?.textContent === label);
  if (!hit) throw new Error(`${id} lists no "${label}"`);
  fireEvent.click(hit);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

/** The labels a picker offers, closed again. */
async function offeredBy(id: string): Promise<string[]> {
  const trigger = document.getElementById(id)!;
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const labels = within(listbox)
    .getAllByRole('option')
    .map((o) => o.querySelector('code')?.previousElementSibling?.textContent ?? '');
  fireEvent.keyDown(listbox, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return labels;
}

async function save() {
  fireEvent.click(screen.getByTestId('save'));
  await settle();
}

const lastPut = () => server.puts[server.puts.length - 1]!;

/** Fill the "Add a field update" form and add it. */
async function addFieldUpdate(label: string, fields: string[], confirm?: string) {
  fireEvent.click(within(section()).getByTestId('list-view-bulk-add-def'));
  const form = await within(section()).findByTestId('list-view-bulk-new-def');
  fireEvent.change(within(form).getByTestId('list-view-bulk-new-def-label'), { target: { value: label } });
  for (const f of fields) await pickFrom('studio-list-view-bulk-new-def-field', f);
  if (confirm !== undefined) {
    fireEvent.change(within(form).getByTestId('list-view-bulk-new-def-confirm'), { target: { value: confirm } });
  }
  fireEvent.click(within(form).getByTestId('list-view-bulk-new-def-add'));
  await waitFor(() => expect(within(section()).queryByTestId('list-view-bulk-new-def')).toBeNull());
}

beforeEach(() => {
  server.active.clear();
  server.puts = [];
});
afterEach(cleanup);

describe('ObjectListViewInspector — selection actions (objectstack#30089)', () => {
  it('picking an action writes `bulkActions` by name; the built-in Delete is offered as `delete`', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'grid' }));
    await openPanel();
    expect(deleteState()).toBe('default');
    expect(await offeredBy('studio-list-view-bulk-action-pick')).toEqual(['Close task', 'Escalate', 'Delete (built-in)']);

    await pickFrom('studio-list-view-bulk-action-pick', 'Close task');
    expect(deleteState()).toBe('dropped');
    await save();
    expect(lastPut()).toMatchObject({ name: VIEW, status: 200 });
    expect(lastPut().body.config.bulkActions).toEqual(['close_task']);

    await pickFrom('studio-list-view-bulk-action-pick', 'Delete (built-in)');
    expect(deleteState()).toBe('kept');
    await save();
    expect(lastPut()).toMatchObject({ status: 200 });
    expect(lastPut().body.config.bulkActions).toEqual(['close_task', 'delete']);
    // Nothing else of the view moved.
    expect(lastPut().body.config.columns).toEqual(['title', 'status']);
    expect(lastPut().body.config).not.toHaveProperty('bulkActionDefs');
  });

  it('adding a field update writes one def the spec accepts, its params taken from the fields', async () => {
    server.active.set(`view/${VIEW}`, view({}));
    await openPanel();
    // Only fields a patch can write are offered: no formula, no read-only field.
    fireEvent.click(within(section()).getByTestId('list-view-bulk-add-def'));
    expect(await offeredBy('studio-list-view-bulk-new-def-field')).toEqual([
      'Title',
      'Status',
      'Assignee',
      'Project',
      'Due date',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await addFieldUpdate('Reassign', ['Assignee', 'Status', 'Project'], 'Reassign {{ count }} task(s) to {{ assignee }}?');
    expect(deleteState()).toBe('dropped');
    await save();
    expect(lastPut()).toMatchObject({ name: VIEW, status: 200 });
    const defs = lastPut().body.config.bulkActionDefs;
    expect(defs).toEqual([
      {
        name: 'update_assignee_status_project',
        label: 'Reassign',
        operation: 'update',
        params: [
          { name: 'assignee', label: 'Assignee', type: 'user', required: true },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            required: true,
            options: [
              { label: 'Open', value: 'open' },
              { label: 'Done', value: 'done' },
            ],
          },
          { name: 'project', label: 'Project', type: 'lookup', required: true, object: 'acme_project' },
        ],
        confirmText: 'Reassign {{ count }} task(s) to {{ assignee }}?',
      },
    ]);
    expect(BulkActionDefSchema.safeParse(defs[0]).success).toBe(true);
    expect(lastPut().body.config).not.toHaveProperty('bulkActions');
  });

  it('a field update waits for a label and a field before anything is written', async () => {
    server.active.set(`view/${VIEW}`, view({}));
    await openPanel();
    fireEvent.click(within(section()).getByTestId('list-view-bulk-add-def'));
    const add = within(section()).getByTestId('list-view-bulk-new-def-add');
    expect(add).toBeDisabled();
    fireEvent.change(within(section()).getByTestId('list-view-bulk-new-def-label'), { target: { value: 'Close' } });
    expect(add).toBeDisabled();
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
  });

  it('editing a def’s label, fields and confirmation, and removing it, round-trip; the emptied key is removed', async () => {
    server.active.set(
      `view/${VIEW}`,
      view({
        bulkActionDefs: [
          {
            name: 'set_status',
            label: 'Set status',
            operation: 'update',
            params: [{ name: 'status', label: 'Status', type: 'select', required: true, options: [{ label: 'Open', value: 'open' }] }],
          },
        ],
      }),
    );
    await openPanel();
    const row = within(section()).getByTestId('list-view-bulk-def');
    expect(row).toHaveAttribute('data-name', 'set_status');
    fireEvent.change(within(row).getByTestId('list-view-bulk-def-label'), { target: { value: 'Change status' } });
    await pickFrom('studio-list-view-bulk-def-0-add-field', 'Due date');
    fireEvent.change(within(row).getByTestId('list-view-bulk-def-confirm'), { target: { value: 'Change {{ count }}?' } });
    await save();
    expect(lastPut()).toMatchObject({ status: 200 });
    expect(lastPut().body.config.bulkActionDefs).toEqual([
      {
        name: 'set_status',
        label: 'Change status',
        operation: 'update',
        params: [
          { name: 'status', label: 'Status', type: 'select', required: true, options: [{ label: 'Open', value: 'open' }] },
          { name: 'due_date', label: 'Due date', type: 'date', required: true },
        ],
        confirmText: 'Change {{ count }}?',
      },
    ]);

    // The field just added is removed again; the def's last field cannot be.
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Due date' }));
    expect(within(row).queryByRole('button', { name: 'Remove Status' })).toBeNull();
    await save();
    expect(lastPut().body.config.bulkActionDefs[0].params.map((p: { name: string }) => p.name)).toEqual(['status']);

    fireEvent.click(within(row).getByRole('button', { name: 'Remove Change status' }));
    expect(within(section()).queryByTestId('list-view-bulk-def')).toBeNull();
    expect(deleteState()).toBe('default');
    await save();
    expect(lastPut()).toMatchObject({ status: 200 });
    expect(lastPut().body.config).not.toHaveProperty('bulkActionDefs');
  });

  it('a served confirmation, the parsed `{ dialect, source }` envelope, is shown and edited as its sentence', async () => {
    server.active.set(
      `view/${VIEW}`,
      view({
        bulkActionDefs: [
          {
            name: 'set_status',
            label: 'Set status',
            operation: 'update',
            params: [{ name: 'status', label: 'Status', type: 'text', required: true }],
            confirmText: { dialect: 'template', source: 'Set {{ count }}?' },
          },
        ],
      }),
    );
    await openPanel();
    const confirm = within(section()).getByTestId('list-view-bulk-def-confirm');
    expect(confirm).toHaveValue('Set {{ count }}?');
    fireEvent.change(confirm, { target: { value: 'Set status on {{ count }}?' } });
    await save();
    expect(lastPut()).toMatchObject({ status: 200 });
    expect(lastPut().body.config.bulkActionDefs[0].confirmText).toEqual({ dialect: 'template', source: 'Set status on {{ count }}?' });
  });

  it('removing the last action removes `bulkActions`', async () => {
    server.active.set(`view/${VIEW}`, view({ bulkActions: ['escalate'] }));
    await openPanel();
    expect(deleteState()).toBe('dropped');
    const row = within(section()).getByTestId('list-view-bulk-action');
    expect(row).toHaveTextContent('Escalate');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Escalate' }));
    await save();
    expect(lastPut()).toMatchObject({ status: 200 });
    expect(lastPut().body.config).not.toHaveProperty('bulkActions');
  });

  it('a def of another kind is shown and removable; a name the object does not declare is marked', async () => {
    server.active.set(
      `view/${VIEW}`,
      view({
        bulkActions: ['archive_all', 'delete'],
        bulkActionDefs: [{ name: 'purge', label: 'Purge', operation: 'delete' }],
      }),
    );
    await openPanel();
    expect(deleteState()).toBe('kept');
    const stale = within(section())
      .getAllByTestId('list-view-bulk-action')
      .find((r) => r.getAttribute('data-name') === 'archive_all')!;
    await waitFor(() => expect(stale).toHaveAttribute('data-stale', 'true'));
    const other = within(section()).getByTestId('list-view-bulk-def');
    expect(other).toHaveAttribute('data-operation', 'delete');
    expect(within(other).queryByTestId('list-view-bulk-def-label')).toBeNull();
    fireEvent.click(within(other).getByRole('button', { name: 'Remove Purge' }));
    await save();
    expect(lastPut().body.config).not.toHaveProperty('bulkActionDefs');
    expect(lastPut().body.config.bulkActions).toEqual(['archive_all', 'delete']);
  });

  it('a read-only package shows the actions and offers no edit', async () => {
    server.active.set(`view/${VIEW}`, view({ bulkActions: ['close_task'] }));
    await openPanel(true);
    expect(within(section()).getByTestId('list-view-bulk-action')).toHaveTextContent('Close task');
    expect(document.getElementById('studio-list-view-bulk-action-pick')).toBeNull();
    expect(within(section()).queryByTestId('list-view-bulk-add-def')).toBeNull();
    expect(within(section()).queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('CONTROL: a view with neither key saves byte-for-byte as it was read', async () => {
    const stored = view({ type: 'grid', sort: [{ field: 'title', order: 'asc' }] });
    server.active.set(`view/${VIEW}`, stored);
    await openPanel();
    expect(section()).toBeInTheDocument();
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
    await save();
    expect(server.puts).toHaveLength(1);
    expect(JSON.stringify(server.puts[0]!.body)).toBe(JSON.stringify(stored));
  });

  it('CONTROL: an edit elsewhere in the panel adds neither key', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'grid' }));
    await openPanel();
    const columns = screen.getByTestId('list-view-columns');
    fireEvent.click(within(columns).getAllByRole('button', { name: /^Remove/ })[0]!);
    await save();
    expect(lastPut()).toMatchObject({ status: 200 });
    expect(lastPut().body.config).not.toHaveProperty('bulkActions');
    expect(lastPut().body.config).not.toHaveProperty('bulkActionDefs');
  });

  it('CONTROL: a kanban view, which draws no selection bar, has no such section', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'kanban', kanban: { groupByField: 'status', columns: [] } }));
    await openPanel();
    expect(screen.getByTestId('list-view-kanban-card')).toBeInTheDocument();
    expect(screen.queryByTestId('list-view-bulk')).toBeNull();
  });
});
