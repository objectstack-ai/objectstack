// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27896, objectstack#30046 — an `object` leaf's view switcher, in
 * the header's title (object / view ▾, as the running list's title reads): the
 * object's list views by label, a draft one included, and a pick opens that
 * view's settings in the panel, where an edit saves to that view.
 *
 * Through the mounted Interfaces pillar, its real list-view autosave and the
 * real panel; the client is a recorder. The object has three list views: its
 * default grid and a calendar, published (the merged `listViews` the shell's
 * metadata holds), and a calendar only drafted in this package (served by the
 * draft-overlaid view list).
 *
 * Pinned:
 *  - the switcher lists all three by label, and the nav entry's view is the
 *    one the panel opens with; the panel's title is the switcher's label;
 *  - picking the drafted view shows its settings, and an edit there saves to
 *    that view, never to the nav entry's;
 *  - a pending edit is sent to the view it was made on before the switch, and
 *    asks nothing;
 *  - a held edit asks first: declined, the panel stays on that view and
 *    nothing is written; accepted, the other view opens;
 *  - an object with one list view still shows the switcher, with New view;
 *  - the panel holds no view picker, no Add view and no "Back to …";
 *  - the open view rides in the address (`?view=`), and a link carrying it
 *    (a reload, a shared link) opens that view; the entry's own view writes
 *    none; CONTROL: a link to another entry's view is not taken.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
afterEach(cleanup);

// This jsdom environment ships no window.confirm — install a mock outright.
let confirm: ReturnType<typeof vi.fn>;
beforeEach(() => {
  confirm = vi.fn(() => false);
  window.confirm = confirm as unknown as typeof window.confirm;
});

/** The address the pillar writes, as a reload or a shared link reads it. */
let address = new URLSearchParams();
function AddressProbe() {
  const location = useLocation();
  address = new URLSearchParams(location.search);
  return null;
}

function mountPillar(search = '', readOnly = false) {
  render(
    <MemoryRouter initialEntries={[`/studio/com.acme.app/interfaces${search}`]}>
      <MetadataCtx.Provider value={metadata()}>
        <InterfacesPillar packageId="com.acme.app" readOnly={readOnly} />
        <AddressProbe />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

async function openObjectLeaf() {
  mountPillar();
  fireEvent.click(await screen.findByTitle('object · showcase_task'));
  await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
  await waitFor(() => expect(shownView()).toBe('showcase_task.default'));
}

/** The panel's read of the package's view drafts has answered. */
async function draftsRead() {
  await waitFor(() => expect(previewClient.list).toHaveBeenCalledWith('view', { packageId: 'com.acme.app' }));
  await new Promise((r) => setTimeout(r, 50));
}

/** The panel's title: the view's name, as the switcher names it. */
const panelTitle = () =>
  screen.getByTestId('studio-list-view-inspector').parentElement?.parentElement?.querySelector('div.mt-1[title]')?.textContent;

/** The view item name the panel shows beneath its title. */
const shownView = () => screen.queryByTestId('list-view-name')?.textContent;

function viewSaves(): Array<[string, string, Record<string, unknown>, Record<string, unknown>]> {
  return mockClient.save.mock.calls.filter((c: unknown[]) => c[0] === 'view') as never;
}

/** The header's view switcher (the title's ▾). */
const switcher = () => within(screen.getByTestId('if-item-header')).getByTestId('list-view-switcher');

/** The switcher's rows, as an author reads them: each row's own button. */
async function switcherRows(): Promise<HTMLElement[]> {
  await waitFor(() => expect(within(screen.getByTestId('if-item-header')).getByTestId('list-view-switcher')).toBeInTheDocument(), {
    timeout: 4000,
  });
  fireEvent.click(switcher());
  const menu = await screen.findByTestId('list-view-switcher-menu');
  return Array.from(menu.querySelectorAll<HTMLElement>('[data-testid^="view-switcher-row-"]')).map(
    (row) => within(row).getAllByRole('button')[0]!,
  );
}

/** Pick the view labelled `label` in the header's view switcher. */
async function pickView(label: string) {
  const hit = (await switcherRows()).find((b) => b.textContent === label);
  if (!hit) throw new Error(`the view switcher lists no "${label}"`);
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

describe('the header’s view switcher switches between the object’s list views (objectstack#27896, objectstack#30046)', () => {
  it('lists all three views by label, opened on the nav entry’s view; the title reads object / view, the panel the same view name', async () => {
    await openObjectLeaf();
    await draftsRead();
    const rows = await switcherRows();
    expect(rows.map((b) => b.textContent)).toEqual(['All tasks', 'Due dates', 'My calendar']);
    expect(switcher()).toHaveTextContent('All tasks');
    expect(screen.getByTestId('if-list-view-title-object')).toHaveTextContent('Tasks');
    expect(panelTitle()).toBe('All tasks');
    // A Studio author keeps no list of their own: no ☆, no 📌, no recent views, no Save as my view.
    const menu = screen.getByTestId('list-view-switcher-menu');
    expect(within(menu).queryAllByTestId('view-switcher-star')).toHaveLength(0);
    expect(within(menu).queryAllByTestId('view-switcher-pin')).toHaveLength(0);
    expect(within(menu).queryByTestId('list-view-switcher-recent')).toBeNull();
    expect(within(menu).queryByTestId('list-view-switcher-save-mine')).toBeNull();
    expect(within(menu).getByTestId('list-view-switcher-new')).toBeInTheDocument();
    expect(within(menu).getByTestId('list-view-switcher-search')).toBeInTheDocument();
  });

  it('the panel holds no view picker, no Add view and no “Back to …”', async () => {
    await openObjectLeaf();
    await draftsRead();
    const panel = screen.getByTestId('studio-list-view-inspector');
    expect(within(panel).queryByTestId('list-view-switcher')).toBeNull();
    expect(within(panel).queryByTestId('list-view-switcher-trigger')).toBeNull();
    expect(screen.queryByTestId('list-view-add-view')).toBeNull();
    await pickView('Due dates');
    await waitFor(() => expect(shownView()).toBe('showcase_task.due'));
    expect(screen.queryByTestId('list-view-back-to-entry')).toBeNull();
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
    await openObjectLeaf();
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
    const question = t('engine.edit.unsavedLeaveConfirm', 'en');
    await openObjectLeaf();
    await pickView('Due dates');
    await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Due date'));
    await pickSetting('startDateField', t('engine.form.none', 'en'));
    await screen.findByTestId('studio-held');

    await pickView('All tasks');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(question);
    expect(shownView()).toBe('showcase_task.due');
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await pickView('All tasks');
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(shownView()).toBe('showcase_task.default'));
    expect(viewSaves()).toEqual([]);
  });

  it('an object with one list view still shows the switcher, so New view stays reachable', async () => {
    published = { [DEFAULT_VIEW.name]: DEFAULT_VIEW };
    drafts = {};
    await openObjectLeaf();
    await draftsRead();
    const rows = await switcherRows();
    expect(rows.map((b) => b.textContent)).toEqual(['All tasks']);
    expect(screen.getByTestId('list-view-switcher-new')).toBeInTheDocument();
  });

  it('a read-only package switches views and offers no New view', async () => {
    mountPillar('', true);
    fireEvent.click(await screen.findByTitle('object · showcase_task'));
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
    await draftsRead();
    await switcherRows();
    expect(screen.queryByTestId('list-view-switcher-new')).toBeNull();
    fireEvent.click(screen.getByTestId('view-switcher-row-showcase_task.due').querySelector('button')!);
    await waitFor(() => expect(shownView()).toBe('showcase_task.due'));
    expect(viewSaves()).toEqual([]);
  });
});

describe('the open view rides in the address (objectstack#30046)', () => {
  it('a pick writes `?view=` beside the leaf; the entry’s own view writes none', async () => {
    await openObjectLeaf();
    await waitFor(() => expect(address.get('surface')).toBe('object:showcase_task'));
    expect(address.get('nav')).toBe('nav_obj');
    expect(address.has('view')).toBe(false);

    await pickView('Due dates');
    await waitFor(() => expect(address.get('view')).toBe('showcase_task.due'));
    expect(address.get('surface')).toBe('object:showcase_task');

    await pickView('All tasks');
    await waitFor(() => expect(address.has('view')).toBe(false));
  });

  it('a link carrying the view (a reload, a shared link) opens that view, a drafted one included', async () => {
    mountPillar('?surface=object%3Ashowcase_task&nav=nav_obj&view=showcase_task.mine');
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
    await waitFor(() => expect(shownView()).toBe('showcase_task.mine'));
    await waitFor(() => expect(switcher()).toHaveTextContent('My calendar'));
    // The address keeps saying so.
    expect(address.get('view')).toBe('showcase_task.mine');
  });

  it('CONTROL: a link naming a view of another object is not taken: the entry’s view opens', async () => {
    mountPillar('?surface=object%3Ashowcase_task&nav=nav_obj&view=other_object.board');
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
    await waitFor(() => expect(shownView()).toBe('showcase_task.default'));
    await waitFor(() => expect(address.has('view')).toBe(false));
  });
});
