// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27896 — the list-view panel's view picker: the object's list
 * views by label, a draft one included, and a pick opens that view's settings
 * in the panel, where an edit saves to that view.
 *
 * Through the mounted Interfaces pillar, its real list-view autosave and the
 * real panel; the client is a recorder. The object has three list views: its
 * default grid and a calendar, published (the merged `listViews` the shell's
 * metadata holds), and a calendar only drafted in this package (served by the
 * draft-overlaid view list).
 *
 * Pinned:
 *  - the picker lists all three by label, the draft one marked, and the nav
 *    entry's view is the one the panel opens with;
 *  - picking the drafted view shows its settings, and an edit there saves to
 *    that view, never to the nav entry's;
 *  - a pending edit is sent to the view it was made on before the switch, and
 *    asks nothing;
 *  - a held edit asks first: declined, the panel stays on that view and
 *    nothing is written; accepted, the other view opens;
 *  - CONTROL: an object with one list view shows no picker.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';

const FIELDS = {
  title: { name: 'title', label: 'Title', type: 'text' },
  status: { name: 'status', label: 'Status', type: 'text' },
  due_date: { name: 'due_date', label: 'Due date', type: 'date' },
  start_date: { name: 'start_date', label: 'Start date', type: 'date' },
};

const NAV = [{ id: 'nav_obj', type: 'object', label: 'Tasks', objectName: 'showcase_task' }];

const calendarBody = { type: 'calendar', data: { provider: 'object', object: 'showcase_task' }, columns: ['title'], calendar: { startDateField: 'due_date', titleField: 'title' } };

/** The object's default grid, published. */
const DEFAULT_VIEW = {
  name: 'showcase_task.default',
  object: 'showcase_task',
  viewKind: 'list',
  label: 'All tasks',
  isDefault: true,
  config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: ['title', 'status'] },
};
/** A published calendar. */
const DUE_VIEW = { name: 'showcase_task.due', object: 'showcase_task', viewKind: 'list', label: 'Due dates', config: calendarBody };
/** A calendar only drafted in this package ("Add view", unpublished). */
const MINE_VIEW = { name: 'showcase_task.mine', object: 'showcase_task', viewKind: 'list', label: 'My calendar', config: calendarBody };

/** A record row as the shell's merged `listViews` holds it: the body, its label and default flag. */
const merged = (row: Record<string, any>) => ({ ...row.config, name: row.name, label: row.label, ...(row.isDefault ? { isDefault: true } : {}) });

let published: Record<string, Record<string, unknown>> = {};
let drafts: Record<string, Record<string, unknown>> = {};

const mockClient: Record<string, any> = {
  save: vi.fn(async (..._args: unknown[]) => ({ success: true, version: 'v1', state: 'draft' })),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'object') return { effective: OBJECT_DEF(), code: OBJECT_DEF() };
    if (type === 'view') {
      const row = published[name];
      return row ? { code: null, overlay: row, overlayScope: 'env', effective: row } : { code: null, overlay: null, overlayScope: null, effective: null };
    }
    return { effective: { name } };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    const row = type === 'view' ? drafts[name] : undefined;
    return row ? { type, name, item: { ...row, _draft: true }, version: 'v1' } : null;
  }),
  get: vi.fn(async (type: string) => (type === 'object' ? OBJECT_DEF() : undefined)),
};
// The draft-overlaid reads: the package's view drafts are tagged `_draft`, as the server serves them.
const previewClient: Record<string, any> = Object.assign(Object.create(mockClient), {
  list: vi.fn(async (type: string, opts?: unknown) =>
    type === 'view'
      ? [...Object.values(published), ...Object.values(drafts).map((d) => ({ ...d, _draft: true, _packageId: 'com.acme.app' }))]
      : mockClient.list(type, opts),
  ),
});
mockClient.withPreviewDrafts = () => previewClient;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

function OBJECT_DEF() {
  return {
    name: 'showcase_task',
    label: 'Task',
    fields: FIELDS,
    listViews: Object.fromEntries(Object.values(published).map((row) => [row.name as string, merged(row)])),
  };
}

/** Stands in for `plugin-view`'s `object-view`, recording the schema the canvas hands it. */
function ObjectViewRecorder({ schema }: { schema: Record<string, unknown> }) {
  return <pre data-testid="object-view-schema">{JSON.stringify(schema)}</pre>;
}

function metadata(): MetadataContextValue {
  return {
    apps: [],
    objects: [OBJECT_DEF()],
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
}

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
});
beforeEach(() => {
  published = { [DEFAULT_VIEW.name]: DEFAULT_VIEW, [DUE_VIEW.name]: DUE_VIEW };
  drafts = { [MINE_VIEW.name]: MINE_VIEW };
  mockClient.save.mockClear();
  previewClient.list.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openObjectLeaf() {
  render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <MetadataCtx.Provider value={metadata()}>
        <InterfacesPillar packageId="com.acme.app" readOnly={false} />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTitle('object · showcase_task'));
  await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
  await waitFor(() => expect(shownView()).toBe('showcase_task.default'));
}

/** The panel's read of the package's view drafts has answered. */
async function draftsRead() {
  await waitFor(() => expect(previewClient.list).toHaveBeenCalledWith('view', { packageId: 'com.acme.app' }));
  await new Promise((r) => setTimeout(r, 50));
}

/** The view item name the panel shows beneath its title. */
const shownView = () => screen.queryByTestId('list-view-name')?.textContent;

function viewSaves(): Array<[string, string, Record<string, unknown>, Record<string, unknown>]> {
  return mockClient.save.mock.calls.filter((c: unknown[]) => c[0] === 'view') as never;
}

/** The picker's options, as an author reads them. */
async function pickerOptions(): Promise<HTMLElement[]> {
  const trigger = await screen.findByTestId('list-view-switcher-trigger', undefined, { timeout: 4000 });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox')).getAllByRole('option');
}

/** Pick the view labelled `label` in the panel's view picker. */
async function pickView(label: string) {
  const hit = (await pickerOptions()).find((o) => o.querySelector('span > span')?.textContent === label);
  if (!hit) throw new Error(`the view picker lists no "${label}"`);
  fireEvent.click(hit);
}

function setting(key: string): HTMLElement {
  const control = document.getElementById(`mdf-studio-list-view-calendar.${key}`);
  if (!control) throw new Error(`no calendar.${key} setting`);
  return control;
}

/** Pick the option `text` of the calendar setting `key`, the way an author does. */
async function pickSetting(key: string, text: string) {
  await waitFor(() => expect(setting(key)).toBeEnabled());
  fireEvent.keyDown(setting(key), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const hit = within(listbox)
    .getAllByRole('option')
    .find((o) => (o.querySelector('code')?.previousElementSibling?.textContent ?? o.textContent) === text);
  if (!hit) throw new Error(`calendar.${key} lists no "${text}"`);
  fireEvent.click(hit);
}

describe('the list-view panel switches between the object’s list views (objectstack#27896)', () => {
  it('lists all three views by label, the drafted one marked, opened on the nav entry’s view', async () => {
    await openObjectLeaf();
    await draftsRead();
    const options = await pickerOptions();
    expect(options.map((o) => o.querySelector('span > span')?.textContent)).toEqual(['All tasks', 'Due dates', 'My calendar']);
    const draftMarks = options.map((o) => within(o).queryByTestId('list-view-switcher-draft')?.textContent ?? null);
    expect(draftMarks).toEqual([null, null, t('engine.studio.inspector.listView.switchViewDraft', 'en')]);
    expect(screen.getByTestId('list-view-switcher-trigger')).toHaveTextContent('All tasks');
  });

  it('picking the drafted view shows its settings, and an edit there saves to it, not to the nav entry’s view', async () => {
    await openObjectLeaf();
    await draftsRead();
    await pickView('My calendar');
    await waitFor(() => expect(shownView()).toBe('showcase_task.mine'));
    await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Due date'));

    await pickSetting('startDateField', 'Start date');
    await waitFor(() => expect(viewSaves().length).toBeGreaterThan(0), { timeout: 8000 });
    expect(viewSaves().map(([, name]) => name)).toEqual(['showcase_task.mine']);
    const [, , body, opts] = viewSaves()[0]!;
    expect((body.config as Record<string, unknown>).calendar).toEqual({ startDateField: 'start_date', titleField: 'title' });
    expect(opts).toMatchObject({ mode: 'draft', packageId: 'com.acme.app' });
  });

  it('a pending edit is sent to its own view before the switch, and nothing asks', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openObjectLeaf();
    await waitFor(() => expect(screen.getByTestId('list-view-switcher-trigger')).toBeInTheDocument(), { timeout: 4000 });
    await pickView('Due dates');
    await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Due date'));

    await pickSetting('startDateField', 'Start date');
    await pickView('All tasks');
    // Sent at the switch, not by the autosave's 1.5 s timer.
    await waitFor(() => expect(viewSaves().map(([, name]) => name)).toEqual(['showcase_task.due']), { timeout: 1000 });
    await waitFor(() => expect(shownView()).toBe('showcase_task.default'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a held edit asks first: declined, the panel stays and writes nothing; accepted, the other view opens', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openObjectLeaf();
    await waitFor(() => expect(screen.getByTestId('list-view-switcher-trigger')).toBeInTheDocument(), { timeout: 4000 });
    await pickView('Due dates');
    await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Due date'));
    await pickSetting('startDateField', t('engine.form.none', 'en'));
    await screen.findByTestId('studio-held');

    await pickView('All tasks');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(shownView()).toBe('showcase_task.due');
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await pickView('All tasks');
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(shownView()).toBe('showcase_task.default'));
    expect(viewSaves()).toEqual([]);
  });

  it('CONTROL: an object with one list view shows no picker', async () => {
    published = { [DEFAULT_VIEW.name]: DEFAULT_VIEW };
    drafts = {};
    await openObjectLeaf();
    await draftsRead();
    expect(screen.queryByTestId('list-view-switcher')).toBeNull();
    expect(screen.getByTestId('list-view-add-view')).toBeInTheDocument();
  });
});
