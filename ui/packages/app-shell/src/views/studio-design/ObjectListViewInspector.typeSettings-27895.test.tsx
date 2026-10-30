// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27895 — the list-view panel edits a non-grid view's own
 * settings: the block its type keeps them in (`calendar`, `gallery`,
 * `timeline`, …), drawn from the spec's JSONSchema for that block, each field
 * setting picked from the object's fields by label.
 *
 * The REAL hook (`useObjectListViewDraft`) and the REAL panel over a REAL
 * `MetadataClient`, whose transport judges every view PUT with the installed
 * spec's `view` schema and answers the write door's 422 on refusal.
 *
 * Pinned:
 *  - a calendar's start date and title fields are picked by label, and the
 *    draft the panel saves holds them and is one the spec accepts;
 *  - a gallery's cover field and a timeline's start date field, the same way;
 *  - a setting the spec adds to a block is drawn with no change here: the
 *    section lists every key of the calendar block's schema;
 *  - opening a view writes nothing: no edit, no save;
 *  - a read-only package draws the settings disabled;
 *  - CONTROLS: a grid has no such section, a kanban keeps its card section
 *    and gets none, and a chart, whose block binds a dataset, gets none.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';

const PKG = 'com.acme.app';
const VIEW = 'acme_task.default';

const OBJECT_DEF = {
  name: 'acme_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    summary: { name: 'summary', label: 'Summary', type: 'text' },
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
    start_date: { name: 'start_date', label: 'Start date', type: 'date' },
    photo: { name: 'photo', label: 'Photo', type: 'image' },
  },
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
  // No view draft is pending in this suite.
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
import { getListVariantSchema } from '../metadata-admin/view-schema';

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

const section = () => screen.getByTestId('list-view-type-settings');

/** The picker of `key` in the type section: the control its label names. */
function setting(type: string, key: string): HTMLElement {
  const control = document.getElementById(`mdf-studio-list-view-${type}.${key}`);
  if (!control) throw new Error(`no ${type}.${key} setting`);
  expect(section()).toContainElement(control);
  return control;
}

/** Pick the field `label` in the field setting `key`, the way an author does. */
async function pickField(type: string, key: string, label: string) {
  await waitFor(() => expect(setting(type, key)).toBeEnabled());
  fireEvent.keyDown(setting(type, key), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const hit = within(listbox)
    .getAllByRole('option')
    // An option reads the field's label beside its machine name (`<code>`).
    .find((o) => o.querySelector('code')?.previousElementSibling?.textContent === label);
  if (!hit) throw new Error(`${type}.${key} lists no "${label}"`);
  fireEvent.click(hit);
  await waitFor(() => expect(setting(type, key)).toHaveTextContent(label));
}

async function save() {
  fireEvent.click(screen.getByTestId('save'));
  await settle();
}

beforeEach(() => {
  server.active.clear();
  server.puts = [];
});
afterEach(cleanup);

describe('ObjectListViewInspector — a non-grid view’s own settings (objectstack#27895)', () => {
  it('a calendar: its start date and title fields are picked by label, and the saved draft holds them', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'calendar', calendar: { startDateField: 'due_date', titleField: 'title' } }));
    await openPanel();
    expect(section()).toHaveAttribute('data-view-type', 'calendar');
    expect(setting('calendar', 'startDateField')).toHaveTextContent('Due date');
    expect(setting('calendar', 'titleField')).toHaveTextContent('Title');

    await pickField('calendar', 'startDateField', 'Start date');
    await pickField('calendar', 'titleField', 'Summary');
    await save();

    expect(server.puts).toHaveLength(1);
    const [put] = server.puts;
    expect(put).toMatchObject({ name: VIEW, status: 200 });
    expect(put.body.config.calendar).toEqual({ startDateField: 'start_date', titleField: 'summary' });
    // Nothing else of the view moved.
    expect(put.body.config.columns).toEqual(['title', 'status']);
    expect(put.body.config.type).toBe('calendar');
  });

  it('a gallery: its cover field is picked by label', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'gallery', gallery: { titleField: 'title' } }));
    await openPanel();
    await pickField('gallery', 'coverField', 'Photo');
    await save();
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0]).toMatchObject({ status: 200 });
    expect(server.puts[0].body.config.gallery).toEqual({ titleField: 'title', coverField: 'photo' });
  });

  it('a timeline: its start date field is picked by label', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'timeline', timeline: { startDateField: 'due_date', titleField: 'title' } }));
    await openPanel();
    await pickField('timeline', 'startDateField', 'Start date');
    await save();
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0]).toMatchObject({ status: 200 });
    expect(server.puts[0].body.config.timeline).toEqual({ startDateField: 'start_date', titleField: 'title' });
  });

  it('the section lists every setting the spec’s calendar block declares, and nothing it does not', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'calendar', calendar: { startDateField: 'due_date' } }));
    await openPanel();
    const declared = Object.keys(getListVariantSchema()!.properties.calendar.properties);
    expect(declared.length).toBeGreaterThan(2);
    for (const key of declared) expect(setting('calendar', key)).toBeInTheDocument();
    const drawn = Array.from(section().querySelectorAll('[id^="mdf-studio-list-view-calendar."]')).map((el) =>
      el.id.slice('mdf-studio-list-view-calendar.'.length),
    );
    expect(drawn.filter((k) => !k.includes('.')).sort()).toEqual([...declared].sort());
  });

  it('opening a view writes nothing: no edit, no save', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'gallery', gallery: { titleField: 'title' } }));
    await openPanel();
    expect(section()).toBeInTheDocument();
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
    await save();
    // `save` sends the buffer as it is; nothing in it was changed by drawing it.
    expect(server.puts[0]?.body.config.gallery).toEqual({ titleField: 'title' });
  });

  it('a read-only package draws the settings disabled', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'calendar', calendar: { startDateField: 'due_date' } }));
    await openPanel(true);
    expect(setting('calendar', 'startDateField')).toBeDisabled();
  });

  it('CONTROL: a grid has no such section, and its panel is the one it was', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'grid' }));
    await openPanel();
    expect(screen.queryByTestId('list-view-type-settings')).toBeNull();
    expect(screen.getByTestId('list-view-columns')).toBeInTheDocument();
  });

  it('CONTROL: a kanban keeps its card section and gets no second one', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'kanban', kanban: { groupByField: 'status', columns: [] } }));
    await openPanel();
    expect(screen.getByTestId('list-view-kanban-card')).toBeInTheDocument();
    expect(screen.queryByTestId('list-view-type-settings')).toBeNull();
  });

  it('CONTROL: a chart, whose block binds a dataset and not the object’s fields, gets no section', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'chart', chart: { dataset: 'task_stats', values: ['count'] } }));
    await openPanel();
    expect(screen.queryByTestId('list-view-type-settings')).toBeNull();
  });
});
