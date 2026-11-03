// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29113 — an Interfaces leaf edit whose save the server refused is
 * unsaved work: every departure that would drop it asks first.
 *
 * The leaf autosave keeps a refused edit in its buffer and sends it again only
 * after the next edit. Before this card the pillar reported only its
 * navigation edits up to the surface, so a reload, a pillar link or another
 * leaf in the rail dropped the refused edit with no question. Now the pillar
 * reports it beside them, while the edit is unsent: a save that lands, or the
 * load of another leaf, clears it.
 *
 * The report cases render the REAL `StudioDesignSurface` on the real route
 * shape (as `StudioDesignSurface.heldWidgetLeave-26705.test.tsx` does), with a
 * stub report canvas that offers one edit through `onPatch`; the client double
 * refuses a save with a 422 while `refuse` is set. The list-view case mounts
 * the pillar with its real list-view panel and reads its `onDirtyChange`
 * report, as `StudioDesignSurface.listViewSwitch-27896.test.tsx` mounts it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';

const PKG = 'com.acme.app';

const REPORT_NAV = [
  { id: 'nav_sales', type: 'report', label: 'Sales report', reportName: 'sales_report' },
  { id: 'nav_ops', type: 'report', label: 'Ops report', reportName: 'ops_report' },
];
const OBJECT_NAV = [{ id: 'nav_obj', type: 'object', label: 'Tasks', objectName: 'showcase_task' }];

const report = (name: string, label: string) => ({
  name,
  label,
  type: 'summary',
  dataset: 'sales_ds',
  rows: ['stage'],
  values: ['revenue'],
});
const REPORTS: Record<string, Record<string, unknown>> = {
  sales_report: report('sales_report', 'Sales report'),
  ops_report: report('ops_report', 'Ops report'),
};

const FIELDS = {
  title: { name: 'title', label: 'Title', type: 'text' },
  due_date: { name: 'due_date', label: 'Due date', type: 'date' },
  start_date: { name: 'start_date', label: 'Start date', type: 'date' },
};
const calendarBody = {
  type: 'calendar',
  data: { provider: 'object', object: 'showcase_task' },
  columns: ['title'],
  calendar: { startDateField: 'due_date', titleField: 'title' },
};
/** The object's one list view, a published calendar. */
const DEFAULT_VIEW = {
  name: 'showcase_task.default',
  object: 'showcase_task',
  viewKind: 'list',
  label: 'All tasks',
  isDefault: true,
  config: calendarBody,
};
function OBJECT_DEF() {
  return {
    name: 'showcase_task',
    label: 'Task',
    fields: FIELDS,
    listViews: { [DEFAULT_VIEW.name]: { ...calendarBody, name: DEFAULT_VIEW.name, label: DEFAULT_VIEW.label, isDefault: true } },
  };
}

const REFUSAL = 'Validation failed';
/** What the draft door answers a body it refuses, in the metadata client's thrown shape. */
const refused = () =>
  Object.assign(new Error(REFUSAL), {
    status: 422,
    code: 'VALIDATION_ERROR',
    body: { success: false, error: { code: 'VALIDATION_ERROR', message: REFUSAL } },
  });

const state = vi.hoisted(() => ({
  nav: [] as unknown[],
  /** While set, every draft save is refused with a 422. */
  refuse: false,
}));

const mockClient = vi.hoisted(() => {
  const client: Record<string, ReturnType<typeof vi.fn>> = {
    list: vi.fn(async (_type: string): Promise<unknown[]> => []),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async (): Promise<unknown> => undefined),
    references: vi.fn(async () => []),
    layered: vi.fn(async (): Promise<unknown> => ({ code: null, overlay: null, overlayScope: null, effective: null })),
    getDraft: vi.fn(async () => null),
    save: vi.fn(async (): Promise<unknown> => ({ success: true, version: 'v1', state: 'draft' })),
    publishDraft: vi.fn(async () => ({ success: true })),
    publishPackageDrafts: vi.fn(async () => ({ success: true, failed: [] })),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
  client.withPreviewDrafts = vi.fn(() => client);
  return client;
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => [{ id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InterfacesPillar, StudioDesignSurface } from './StudioDesignSurface';
import { registerMetadataPreview, getMetadataPreview } from '../metadata-admin/preview-registry';
import { t } from '../metadata-admin/i18n';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

let edits = 0;
/** Report canvas stand-in: prints the label it was handed and offers an edit, a new body each time. */
function StubCanvas({ draft, onPatch }: { draft: Record<string, unknown>; onPatch?: (patch: Record<string, unknown>) => void }) {
  return (
    <div>
      <span data-testid="stub-label">{String(draft.label ?? '')}</span>
      {onPatch && (
        <button type="button" data-testid="stub-edit" onClick={() => onPatch({ description: `edit ${++edits}` })}>
          edit
        </button>
      )}
    </div>
  );
}

/** Stands in for `plugin-view`'s `object-view`: the list-view case pins the panel, not the canvas. */
function ObjectViewStub() {
  return null;
}

const realPreview = getMetadataPreview('report');
const LEAVE_QUESTION = t('engine.edit.unsavedLeaveConfirm', 'en');
// This jsdom environment ships no window.confirm — install a mock outright.
let confirmSpy: ReturnType<typeof vi.fn>;

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewStub as never, { namespace: 'plugin-view' });
});

beforeEach(() => {
  state.refuse = false;
  state.nav = REPORT_NAV;
  edits = 0;
  for (const fn of Object.values(mockClient)) fn.mockClear();
  mockClient.list.mockImplementation(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'report') return Object.values(REPORTS);
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    if (type === 'view') return [DEFAULT_VIEW];
    return [];
  });
  mockClient.layered.mockImplementation(async (type: string, name: string) => {
    const effective =
      type === 'app'
        ? { name: 'acme_app', label: 'Acme', navigation: state.nav }
        : type === 'report' && REPORTS[name]
          ? JSON.parse(JSON.stringify(REPORTS[name]))
          : type === 'object'
            ? OBJECT_DEF()
            : type === 'view' && name === DEFAULT_VIEW.name
              ? DEFAULT_VIEW
              : null;
    return { code: type === 'object' ? effective : null, overlay: null, overlayScope: null, effective };
  });
  mockClient.get.mockImplementation(async (type: string) => (type === 'object' ? OBJECT_DEF() : undefined));
  mockClient.save.mockImplementation(async () => {
    if (state.refuse) throw refused();
    return { success: true, version: 'v1', state: 'draft' };
  });
  registerMetadataPreview('report', StubCanvas as never);
  confirmSpy = vi.fn(() => false);
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  if (realPreview) registerMetadataPreview('report', realPreview);
});

async function openSalesReport(): Promise<void> {
  // The shell's link guard reads the window's URL to skip a link to the page
  // already shown; `BrowserRouter` keeps the two equal, so this does too.
  window.history.replaceState(null, '', `/studio/${PKG}/interfaces`);
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTitle('report · sales_report', undefined, { timeout: 8000 });
  await waitFor(() => expect(screen.getByTestId('stub-label')).toHaveTextContent('Sales report'), { timeout: 8000 });
}

function reportSaves(): number {
  return mockClient.save.mock.calls.filter((c) => c[0] === 'report').length;
}

/** Edit the open report and wait for its autosave to answer: refused while `state.refuse`. */
async function editAndSave(): Promise<void> {
  const before = reportSaves();
  fireEvent.click(screen.getByTestId('stub-edit'));
  await waitFor(() => expect(reportSaves()).toBe(before + 1), { timeout: 8000 });
  if (state.refuse) await screen.findByTestId('studio-refusal', undefined, { timeout: 8000 });
  else await waitFor(() => expect(screen.queryByTestId('studio-refusal')).toBeNull(), { timeout: 8000 });
}

/** Whether a reload / tab close would be asked about. */
function reloadAsks(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/**
 * Wait until a reload asks (`true`) or no longer asks (`false`). The guard is
 * not part of the commit that shows or clears the refusal: the pillar reports
 * the change from an effect, and the surface installs or removes its
 * `beforeunload` listener from an effect of the render that report causes. So
 * a read straight after the refusal shows can run before either effect has
 * (objectstack#29468: red once on a loaded Test UI shard).
 */
async function untilReloadAsks(expected: boolean): Promise<void> {
  await waitFor(() => expect(reloadAsks()).toBe(expected));
}

const pillarLink = (name: string) => within(screen.getByTestId('studio-pillar-nav')).getByRole('link', { name });
const railRow = (name: string) => screen.getByTitle(`report · ${name}`);

describe('a leaf edit whose save was refused guards every departure (objectstack#29113)', () => {
  it('a refused report save makes a reload and the pillar link ask; a save that lands clears it', async () => {
    await openSalesReport();
    state.refuse = true;
    await editAndSave();

    // Red on base: the pillar reported only its nav edits, so neither asked.
    await untilReloadAsks(true);
    fireEvent.click(pillarLink('Data'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTestId('studio-rail-interfaces')).toBeInTheDocument();

    // The next edit is sent again, and this time it lands.
    state.refuse = false;
    await editAndSave();
    await untilReloadAsks(false);
    fireEvent.click(pillarLink('Data'));
    await screen.findByTestId('studio-rail-data');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('the rail asks before another report replaces the refused edit; OK opens it and clears the guard', async () => {
    await openSalesReport();
    state.refuse = true;
    await editAndSave();

    fireEvent.click(railRow('ops_report'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTestId('stub-label')).toHaveTextContent('Sales report');

    // Re-picking the open leaf drops nothing, so it asks nothing.
    fireEvent.click(railRow('sales_report'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(railRow('ops_report'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId('stub-label')).toHaveTextContent('Ops report'), { timeout: 8000 });
    // The other leaf's buffer is installed clean: the refusal went with the edit.
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    await untilReloadAsks(false);
  });

  // CONTROL: an untouched leaf, and an edit whose save landed, never ask.
  it('an untouched report, and an edit whose save lands, never make anything ask', async () => {
    await openSalesReport();
    expect(reloadAsks()).toBe(false);
    await editAndSave();
    expect(reloadAsks()).toBe(false);
    fireEvent.click(railRow('ops_report'));
    await waitFor(() => expect(screen.getByTestId('stub-label')).toHaveTextContent('Ops report'), { timeout: 8000 });
    fireEvent.click(pillarLink('Data'));
    await screen.findByTestId('studio-rail-data');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

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

function viewSaves(): number {
  return mockClient.save.mock.calls.filter((c) => c[0] === 'view').length;
}

describe("an object leaf's list-view edit whose save was refused is reported unsaved (objectstack#29113)", () => {
  it('reports dirty while the refused view edit is unsent, and clean once a save lands', async () => {
    state.nav = OBJECT_NAV;
    const onDirtyChange = vi.fn();
    const lastReport = () => onDirtyChange.mock.calls.at(-1)?.[0];
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <MetadataCtx.Provider value={metadata()}>
          <InterfacesPillar packageId={PKG} onDirtyChange={onDirtyChange} />
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTitle('object · showcase_task', undefined, { timeout: 8000 }));
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
    await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Due date'), { timeout: 8000 });
    expect(lastReport()).toBe(false);

    state.refuse = true;
    await pickSetting('startDateField', 'Start date');
    await waitFor(() => expect(viewSaves()).toBe(1), { timeout: 8000 });
    // Red on base: only the nav buffer was reported.
    await waitFor(() => expect(lastReport()).toBe(true));

    state.refuse = false;
    await pickSetting('startDateField', 'Due date');
    await waitFor(() => expect(viewSaves()).toBe(2), { timeout: 8000 });
    await waitFor(() => expect(lastReport()).toBe(false));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(lastReport()).toBe(false);
  });
});
