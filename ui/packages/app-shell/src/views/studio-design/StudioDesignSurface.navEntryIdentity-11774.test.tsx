// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11774 — the Interfaces rail's surface is the nav ENTRY, not its
 * target.
 *
 * The showcase app's nav holds five entries on one object, `showcase_task`:
 * the plain list, three data slices (`filters`) and one named view
 * (`viewName`). The pillar identified a surface by `{type, name}` alone, so
 * for the filer, clicking *Urgent Tasks* previewed every task (Low and Medium
 * included), highlighted all five rows, and a reload landed on *Tasks*.
 *
 * These pins mount the real `InterfacesPillar` over a mocked metadata client
 * and keep the DEFAULT object canvas, so what is asserted is the schema that
 * canvas hands the list renderer: `object-view` is replaced by a recorder.
 * Each pin is one of the claim's acceptance points; the last is the control,
 * an app whose entries each open a distinct object.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';

const PKG = 'com.example.showcase';

/** The showcase nav, abridged to the entries on `showcase_task` and a first leaf ahead of them. */
const SHOWCASE_NAV = [
  { id: 'nav_home', type: 'page', pageName: 'home', label: 'Home' },
  {
    id: 'grp_data',
    type: 'group',
    label: 'Data Model',
    children: [{ id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' }],
  },
  {
    id: 'grp_slices',
    type: 'group',
    label: 'Data Slices (filters)',
    children: [
      { id: 'nav_slice_in_progress', type: 'object', objectName: 'showcase_task', filters: { status: 'in_progress' }, label: 'In-Progress Tasks' },
      { id: 'nav_slice_urgent', type: 'object', objectName: 'showcase_task', filters: { priority: 'urgent' }, label: 'Urgent Tasks' },
      { id: 'nav_slice_review', type: 'object', objectName: 'showcase_task', filters: { status: 'in_review' }, label: 'In-Review Tasks' },
    ],
  },
  {
    id: 'grp_analytics',
    type: 'group',
    label: 'Analytics',
    children: [{ id: 'nav_report_tabular', type: 'object', objectName: 'showcase_task', viewName: 'tabular', label: 'Task List' }],
  },
];

/** The control: every entry opens a distinct object. */
const DISTINCT_NAV = [
  { id: 'nav_projects', type: 'object', objectName: 'showcase_project', label: 'Projects' },
  { id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' },
  { id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts' },
];

let nav: unknown[] = SHOWCASE_NAV;

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'showcase_app', label: 'Showcase' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'showcase_app', label: 'Showcase', navigation: nav } };
    if (type === 'page') return { effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } };
    return { effective: { name, label: name } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
  withPreviewDrafts() { return this; },
};

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

/** The object's merged `listViews`, as the shell's metadata cache holds them. */
const TABULAR = {
  name: 'showcase_task.tabular',
  label: 'Task List',
  type: 'grid',
  columns: [{ field: 'title' }, { field: 'status' }],
  sort: [{ field: 'estimate_hours', order: 'desc' }],
};
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [{ name: 'showcase_task', label: 'Task', listViews: { 'showcase_task.tabular': TABULAR } }],
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

/** Stands in for `plugin-view`'s `object-view`: records the schema the canvas hands it. */
function ObjectViewRecorder({ schema }: { schema: Record<string, unknown> }) {
  return <pre data-testid="object-view-schema">{JSON.stringify(schema)}</pre>;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
});

afterEach(() => {
  cleanup();
  nav = SHOWCASE_NAV;
});

function mountPillar(search = '') {
  return render(
    <MetadataCtx.Provider value={METADATA}>
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces${search}`]}>
        <InterfacesPillar packageId={PKG} />
        <LocationProbe />
      </MemoryRouter>
    </MetadataCtx.Provider>,
  );
}

/** Every rail row that opens a surface (its `title` is the `type · name` pair). */
function railRows(): HTMLElement[] {
  return screen.getAllByRole('button').filter((b) => /^(object|page) · /.test(b.getAttribute('title') ?? ''));
}

/** The rail row whose label is `label`, exactly. */
function railRow(label: string): HTMLElement {
  const row = railRows().find((r) => within(r).queryByText(label, { exact: true }) !== null);
  if (!row) throw new Error(`no rail row labelled ${label}`);
  return row;
}

/** The labels of the rows the rail shows as active. */
function activeLabels(): string[] {
  return railRows()
    .filter((r) => r.className.includes('font-medium'))
    .map((r) => r.querySelector('.truncate')?.textContent ?? '');
}

function canvasSchema(): unknown {
  return JSON.parse(screen.getByTestId('object-view-schema').textContent ?? 'null');
}

const search = () => new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');

const PLAIN = { type: 'object-view', objectName: 'showcase_task' };
const sliced = (field: string, value: string) => ({ ...PLAIN, table: { filter: [[field, '=', value]] } });

/** Each `showcase_task` entry and the schema its preview must hand the list renderer. */
const ENTRIES: Array<{ label: string; navId: string; schema: unknown }> = [
  { label: 'Tasks', navId: 'nav_tasks', schema: PLAIN },
  { label: 'In-Progress Tasks', navId: 'nav_slice_in_progress', schema: sliced('status', 'in_progress') },
  { label: 'Urgent Tasks', navId: 'nav_slice_urgent', schema: sliced('priority', 'urgent') },
  { label: 'In-Review Tasks', navId: 'nav_slice_review', schema: sliced('status', 'in_review') },
  {
    label: 'Task List',
    navId: 'nav_report_tabular',
    schema: { ...PLAIN, listViews: { 'showcase_task.tabular': TABULAR }, defaultListView: 'showcase_task.tabular' },
  },
];

describe('the objectui#11774 fixtures are what the spec accepts', () => {
  it('every nav item of both apps parses against NavigationItemSchema', () => {
    for (const item of [...SHOWCASE_NAV, ...DISTINCT_NAV]) {
      expect(NavigationItemSchema.safeParse(item).success).toBe(true);
    }
  });
});

describe('Interfaces rail — one object, five entries (objectui#11774)', () => {
  it('clicking each entry makes exactly that entry active, and the preview gets its slice or view', async () => {
    mountPillar();
    await waitFor(() => expect(activeLabels()).toEqual(['Home']), { timeout: 4000 });
    for (const entry of ENTRIES) {
      fireEvent.click(railRow(entry.label));
      await waitFor(() => expect(activeLabels()).toEqual([entry.label]), { timeout: 4000 });
      await waitFor(() => expect(canvasSchema()).toEqual(entry.schema), { timeout: 4000 });
      expect(search().get('nav')).toBe(entry.navId);
    }
  });

  it('the deep link round-trips: Urgent Tasks, read back from the URL, is the entry that opens', async () => {
    mountPillar();
    await waitFor(() => expect(activeLabels()).toEqual(['Home']), { timeout: 4000 });
    fireEvent.click(railRow('Urgent Tasks'));
    await waitFor(() => expect(search().get('nav')).toBe('nav_slice_urgent'), { timeout: 4000 });
    expect(search().get('surface')).toBe('object:showcase_task');
    const link = `?${search().toString()}`;
    cleanup();

    mountPillar(link);
    await waitFor(() => expect(activeLabels()).toEqual(['Urgent Tasks']), { timeout: 4000 });
    await waitFor(() => expect(canvasSchema()).toEqual(sliced('priority', 'urgent')), { timeout: 4000 });
  });

  it('BACK-COMPAT: a `?surface=object:showcase_task` link with no entry id opens the first match, as before', async () => {
    mountPillar('?surface=object:showcase_task');
    await waitFor(() => expect(activeLabels()).toEqual(['Tasks']), { timeout: 4000 });
    await waitFor(() => expect(canvasSchema()).toEqual(PLAIN), { timeout: 4000 });
  });

  it('an entry id that no longer exists falls back exactly as the same link without it', async () => {
    mountPillar('?surface=object:showcase_task&nav=nav_deleted');
    await waitFor(() => expect(activeLabels()).toEqual(['Tasks']), { timeout: 4000 });
    // The URL heals to the entry that opened.
    await waitFor(() => expect(search().get('nav')).toBe('nav_tasks'), { timeout: 4000 });
    cleanup();

    // An unknown target as well: the pillar opens its first leaf, as it does for the bare link.
    mountPillar('?surface=object:deleted_object&nav=nav_deleted');
    await waitFor(() => expect(activeLabels()).toEqual(['Home']), { timeout: 4000 });
    cleanup();
    mountPillar('?surface=object:deleted_object');
    await waitFor(() => expect(activeLabels()).toEqual(['Home']), { timeout: 4000 });
  });
});

describe('Interfaces rail — CONTROL: entries on distinct objects (objectui#11774)', () => {
  it('one row active per click, the plain list of that object, and a `?surface=` link opens its entry', async () => {
    nav = DISTINCT_NAV;
    mountPillar();
    await waitFor(() => expect(activeLabels()).toEqual(['Projects']), { timeout: 4000 });
    for (const [label, objectName] of [
      ['Tasks', 'showcase_task'],
      ['Accounts', 'showcase_account'],
      ['Projects', 'showcase_project'],
    ]) {
      fireEvent.click(railRow(label));
      await waitFor(() => expect(activeLabels()).toEqual([label]), { timeout: 4000 });
      await waitFor(() => expect(canvasSchema()).toEqual({ type: 'object-view', objectName }), { timeout: 4000 });
      expect(search().get('surface')).toBe(`object:${objectName}`);
    }
    cleanup();

    mountPillar('?surface=object:showcase_account');
    await waitFor(() => expect(activeLabels()).toEqual(['Accounts']), { timeout: 4000 });
  });
});
