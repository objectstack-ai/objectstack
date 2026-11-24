/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34807 (ruling 6946403206) — the list half: under `?preview=draft`
 * a list column on a field that exists only in the draft made the data door
 * refuse the whole list query (`400 INVALID_FIELD`), because the list read its
 * object definition from the adapter's PUBLISHED `getObjectSchema`, which does
 * not know the field, and sent every column.
 *
 * Pinned here, on the app-shell side:
 *  1. `withUnpublishedObjectReads`, given the overlay read, answers
 *     `getObjectSchema` with the published document plus each draft-only field
 *     under its draft label, marked with the underscore-private literal
 *     `_draftOnly` (`@object-ui/plugin-list` reads the same literal; its own
 *     pin is the `ListView.draftOnlyColumn-34807` block of its harness), with
 *     the published sortability projection kept. CONTROL: without the overlay
 *     read the source's own `getObjectSchema` answers.
 *  2. `usePreviewListDataSource`: the adapter ITSELF outside the preview; one
 *     wrapper per draft revision inside it.
 *  3. The `ObjectDataPage` (`/:objectName/data`) and `InterfaceListPage` call
 *     sites hand `ListView` that wrapper in the preview and the adapter itself
 *     outside it.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, renderHook, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { attachObjectSortability, readObjectSortability } from '@object-ui/core';

/** The overlay read the provider's `getItem('object', name)` answers in these cases. */
type OverlayRead = (type: string, name: string) => Promise<unknown>;
const OVERLAY: { doc: unknown; getItem: ReturnType<typeof vi.fn<OverlayRead>> } = {
  doc: null,
  getItem: vi.fn<OverlayRead>(),
};

vi.mock('../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const getItem = (type: string, name: string) => OVERLAY.getItem(type, name);
  return {
    ...actual,
    useMetadata: () => ({ objects: LIST_PAGE.objects, loading: false, getItem }),
  };
});

/** What the pages under test hand `ListView`. */
const CAPTURED: { dataSource: any } = { dataSource: undefined };
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: { dataSource: unknown }) => {
    CAPTURED.dataSource = props.dataSource;
    return null;
  },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  const perms = {
    check: () => ({ allowed: true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('../../views/RecordDetailView', () => ({ RecordDetailView: () => null }));
vi.mock('../../views/CreateViewDialog', () => ({ CreateViewDialog: () => null }));
vi.mock('../../views/metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({}) }));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => LIST_PAGE.dataSource,
}));

import { withUnpublishedObjectReads, usePreviewListDataSource } from '../unpublishedObjectReads';
import { PreviewModeProvider } from '../PreviewModeContext';
import { ObjectDataPage } from '../../views/ObjectDataPage';
import { InterfaceListPage } from '../../views/InterfaceListPage';
import { ExpressionProvider } from '../../providers/ExpressionProvider';

const OBJECT = 'tracker_task';

/** The published document the adapter serves, with its sortability projection. */
function publishedDocument() {
  const doc = {
    name: OBJECT,
    label: 'Task',
    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
  };
  return attachObjectSortability(doc, { fields: { title: { sortable: true } } });
}

/** The draft overlay's document: the published field plus the drafted one. */
const DRAFT_DOCUMENT = {
  name: OBJECT,
  label: 'Task',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
    priority: { name: 'priority', type: 'select', label: 'Priority (draft)' },
  },
  listViews: { all: { name: 'all', label: 'All', type: 'grid', columns: ['title', 'priority'] } },
};

function makeAdapter() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => publishedDocument()),
  } as any;
}

const LIST_PAGE: { dataSource: any; objects: any[] } = { dataSource: undefined, objects: [] };

beforeEach(() => {
  OVERLAY.doc = DRAFT_DOCUMENT;
  OVERLAY.getItem = vi.fn<OverlayRead>(async () => OVERLAY.doc);
  CAPTURED.dataSource = undefined;
  LIST_PAGE.dataSource = makeAdapter();
  LIST_PAGE.objects = [DRAFT_DOCUMENT];
  // The pages' permission reads go to the network; answer them empty.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('withUnpublishedObjectReads: the list definition under draft preview (objectstack#34807)', () => {
  it('answers the published document plus the draft-only field, marked `_draftOnly`, under its draft label', async () => {
    const adapter = makeAdapter();
    const ds = withUnpublishedObjectReads(adapter, () => {}, (name) => OVERLAY.getItem('object', name));
    const def: any = await ds.getObjectSchema(OBJECT);
    expect(OVERLAY.getItem).toHaveBeenCalledWith('object', OBJECT);
    expect(adapter.getObjectSchema).toHaveBeenCalledWith(OBJECT);
    expect(def.fields.priority).toMatchObject({ label: 'Priority (draft)', _draftOnly: true });
    // The published field keeps its published definition, unmarked.
    expect(def.fields.title._draftOnly).toBeUndefined();
    // The published sortability projection rides along: it names no draft-only field.
    expect(readObjectSortability(def)?.fields).toEqual({ title: { sortable: true } });
  });

  it('CONTROL: without the overlay read, the source answers its own definition', async () => {
    const adapter = makeAdapter();
    const ds = withUnpublishedObjectReads(adapter, () => {});
    const def: any = await ds.getObjectSchema(OBJECT);
    expect(def.fields.priority).toBeUndefined();
    expect(OVERLAY.getItem).not.toHaveBeenCalled();
  });
});

describe('usePreviewListDataSource (objectstack#34807)', () => {
  const wrapper = (preview: boolean) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <MemoryRouter>
          <PreviewModeProvider force={preview}>{children}</PreviewModeProvider>
        </MemoryRouter>
      );
    };

  it('CONTROL: outside the preview it is the adapter itself', () => {
    const adapter = makeAdapter();
    const { result } = renderHook(() => usePreviewListDataSource(adapter, DRAFT_DOCUMENT), { wrapper: wrapper(false) });
    expect(result.current).toBe(adapter);
  });

  it('in the preview it wraps the adapter, once per draft revision', async () => {
    const adapter = makeAdapter();
    let revision: unknown = DRAFT_DOCUMENT;
    const { result, rerender } = renderHook(() => usePreviewListDataSource(adapter, revision), { wrapper: wrapper(true) });
    const first = result.current;
    expect(first).not.toBe(adapter);
    expect(((await first.getObjectSchema(OBJECT)) as any).fields.priority._draftOnly).toBe(true);
    rerender();
    expect(result.current).toBe(first);
    revision = { ...DRAFT_DOCUMENT };
    rerender();
    expect(result.current).not.toBe(first);
  });
});

describe('the list pages hand ListView the preview wrapper (objectstack#34807)', () => {
  function renderDataPage(preview: boolean) {
    return render(
      <ExpressionProvider user={{ id: 'u1', name: 'Ada' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/data`]}>
          <PreviewModeProvider force={preview}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/data"
                element={<ObjectDataPage dataSource={LIST_PAGE.dataSource} objects={LIST_PAGE.objects} />}
              />
            </Routes>
          </PreviewModeProvider>
        </MemoryRouter>
      </ExpressionProvider>,
    );
  }

  function renderInterfacePage(preview: boolean) {
    const page = {
      name: 'my_tasks',
      label: 'My Tasks',
      interfaceConfig: { source: OBJECT, sourceView: 'all' },
    };
    return render(
      <MemoryRouter initialEntries={['/apps/demo/page/my_tasks']}>
        <PreviewModeProvider force={preview}>
          <InterfaceListPage page={page as any} />
        </PreviewModeProvider>
      </MemoryRouter>,
    );
  }

  for (const [name, renderPage] of [
    ['ObjectDataPage', renderDataPage],
    ['InterfaceListPage', renderInterfacePage],
  ] as const) {
    it(`${name}: in the preview, ListView reads the draft-only field marked`, async () => {
      renderPage(true);
      await waitFor(() => expect(CAPTURED.dataSource).toBeDefined());
      expect(CAPTURED.dataSource).not.toBe(LIST_PAGE.dataSource);
      const def: any = await CAPTURED.dataSource.getObjectSchema(OBJECT);
      expect(def.fields.priority).toMatchObject({ label: 'Priority (draft)', _draftOnly: true });
    });

    it(`${name} CONTROL: outside the preview, ListView gets the adapter itself`, async () => {
      renderPage(false);
      await waitFor(() => expect(CAPTURED.dataSource).toBeDefined());
      expect(CAPTURED.dataSource).toBe(LIST_PAGE.dataSource);
      expect(OVERLAY.getItem).not.toHaveBeenCalled();
    });
  }
});
