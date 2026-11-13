/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33111 — the record header's Edit names the object of the record
 * it edits, so a drawer level's Edit reaches the host's `onEdit` with the
 * LEVEL's object, on both hosts of the in-place stack: the object list's
 * drawer (`ObjectViewRecordOverlay`) and the record page's
 * (`RecordPageDrawerHost`). Before, it handed the record alone, and the
 * console opened the route object's form with the child's id.
 * (`AppContent.recordFormOverDrawer-32685` pins what the console does with it:
 * the `formObject` child task.)
 *
 * CONTROL: the page's own Edit, and the list drawer's root level, name the
 * route's object.
 *
 * Harness: the `RecordDetailView.headerMenuIcons-12529` mount (the real
 * record view under a real `I18nProvider`, a metadata context and the real
 * `FavoritesProvider`). The child level is opened the way a ↗ round trip
 * hands a stack back (`recordDrawerRestore`), so the level drawn is the
 * real embedded record view the host renders for it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { ObjectViewRecordOverlay } from './objectViewRecordOverlay';
import { FavoritesProvider } from '../context/FavoritesProvider';

const LEAD = { objectName: 'crm_lead', recordId: 'L-1' };
const TASK = { objectName: 'crm_task', recordId: 'T-1' };

const OBJECTS = [
  {
    name: 'crm_lead',
    label: 'Lead',
    // The permissive bucket: edit + delete both default open.
    managedBy: 'platform',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  },
  {
    name: 'crm_task',
    label: 'Task',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      lead: { type: 'lookup', label: 'Lead', reference: 'crm_lead' },
    },
  },
];

const METADATA = {
  objects: OBJECTS,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as any;

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async (objectName: string, id: string) => ({ id, name: `${objectName} ${id}` })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function Providers({ entry, children }: { entry: { pathname: string; state?: unknown }; children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={METADATA}>
        <FavoritesProvider>
          <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
        </FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>
  );
}

/** The record page of the lead, with `levels` handed back as its drawer's stack. */
function mountRecordPage(levels?: Array<{ objectName: string; recordId: string }>) {
  const dataSource = makeDataSource();
  const onEdit = vi.fn();
  render(
    <Providers
      entry={{
        pathname: `/apps/crm/${LEAD.objectName}/record/${LEAD.recordId}`,
        ...(levels ? { state: { recordDrawerRestore: levels } } : {}),
      }}
    >
      <Routes>
        <Route
          path="/apps/:appName/:objectName/record/:recordId"
          element={<RecordDetailView dataSource={dataSource} objects={OBJECTS} onEdit={onEdit} />}
        />
      </Routes>
    </Providers>,
  );
  return { onEdit, dataSource };
}

/** The lead list's drawer, its root the lead row, `levels` its stack. */
function mountListDrawer(levels?: Array<{ objectName: string; recordId: string }>) {
  const dataSource = makeDataSource();
  const onEdit = vi.fn();
  render(
    <Providers entry={{ pathname: `/apps/crm/${LEAD.objectName}` }}>
      <Routes>
        <Route
          path="/apps/:appName/:objectName"
          element={
            <ObjectViewRecordOverlay
              navOverlay={{ isOpen: true, width: undefined } as any}
              mode="drawer"
              list={<div data-testid="list" />}
              handleDrawerClose={() => {}}
              objectDef={OBJECTS[0] as any}
              handleOpenAsPage={(() => {}) as any}
              drawerRoot={LEAD}
              drawerRestore={levels}
              handleRootStep={() => {}}
              dataSource={dataSource}
              objects={OBJECTS as any}
              onEdit={onEdit}
            />
          }
        />
      </Routes>
    </Providers>,
  );
  return { onEdit, dataSource };
}

/** The drawer's sheet, once the record it shows has loaded. */
async function drawerShowing(dataSource: { findOne: ReturnType<typeof vi.fn> }, level: { objectName: string; recordId: string }) {
  await waitFor(() =>
    expect(dataSource.findOne.mock.calls.some((call: unknown[]) => call[0] === level.objectName && call[1] === level.recordId)).toBe(true),
  );
  return waitFor(() => {
    const sheet = screen.getAllByRole('dialog').find((el) => within(el).queryByRole('button', { name: 'Edit' }));
    expect(sheet).toBeTruthy();
    return sheet!;
  }, { timeout: 5000 });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('a drawer level’s Edit names the level’s object (objectstack#33111)', () => {
  it('the record page’s drawer: a child level’s Edit hands the child’s id and the child’s object', async () => {
    const { onEdit, dataSource } = mountRecordPage([TASK]);
    const sheet = await drawerShowing(dataSource, TASK);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith({ id: TASK.recordId }, TASK.objectName);
  });

  it('the list’s drawer: a child level’s Edit hands the child’s id and the child’s object', async () => {
    const { onEdit, dataSource } = mountListDrawer([LEAD, TASK]);
    const sheet = await drawerShowing(dataSource, TASK);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith({ id: TASK.recordId }, TASK.objectName);
  });

  it('CONTROL: the record page’s own Edit names the route’s object', async () => {
    const { onEdit, dataSource } = mountRecordPage();
    await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
    const edit = await screen.findByRole('button', { name: 'Edit' }, { timeout: 5000 });
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledWith({ id: LEAD.recordId }, LEAD.objectName);
  });

  it('CONTROL: the list drawer’s root level names the route’s object', async () => {
    const { onEdit, dataSource } = mountListDrawer();
    const sheet = await drawerShowing(dataSource, LEAD);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith({ id: LEAD.recordId }, LEAD.objectName);
  });
});
