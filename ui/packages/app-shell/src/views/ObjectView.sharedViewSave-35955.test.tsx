// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35955 — 「Save to this view」 on a shared view (ruling record
 * 7058616478): offered to a reader who may edit the view, asked once (everyone
 * using the view sees it), then saved and published at once. A view with a
 * pending draft is not saved: that draft is never published on its saver's
 * behalf. The reader's row height is never written into the view.
 *
 * What runs: the real `ObjectView` on a stub data source and a stub `/meta`
 * client. `ListView` is a stand-in that records the props it is handed, so a
 * sort is told through its `onSortChange` / `onPersonalizationChange`, and
 * Save is pressed through its `onSaveView` (the options menu's Save, wired to
 * the same handler as the condition row's Save to this view). No i18n
 * provider is mounted, so copy reads as its key.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities: `ListView` names `perms` in its fetch dependencies.
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
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: { id: 'org1', name: 'Acme' } }),
  // The shared view's saves are an administrator's.
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

// The harness has no i18n provider, so `t` answers keys. The confirm's
// question also carries the name it was handed, so the name can be read back
// (objectstack#35955 L1-b S1).
vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/i18n')>();
  const React = await import('react');
  return {
    ...actual,
    useObjectTranslation: (...args: Parameters<typeof actual.useObjectTranslation>) => {
      const bound = actual.useObjectTranslation(...args);
      const t = React.useMemo(() => ((key: string, options?: Record<string, unknown>) => {
        const out = (bound.t as (k: string, o?: unknown) => unknown)(key, options);
        return key === 'console.objectView.draft.saveToViewConfirm' ? `${String(out)} [${String(options?.name)}]` : out;
      }) as typeof bound.t, [bound.t]);
      return { ...bound, t };
    },
  };
});

/** The props the list was last handed. */
const listProps = vi.hoisted(() => ({ current: null as Record<string, any> | null }));
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    listProps.current = props;
    return null;
  },
}));

/** The `/meta` client the view saves go through. */
const meta = vi.hoisted(() => ({
  client: {
    save: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({})),
    reset: vi.fn(async () => ({})),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
  } as Record<string, any>,
}));
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => meta.client,
}));

/** The session-held package list, as `GET /api/v1/packages` answers it (parsed). */
const packageList = vi.hoisted(() => ({ answer: (): Promise<any[]> => Promise.resolve([]) }));
vi.mock('./studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSessionPackages: vi.fn(() => packageList.answer()),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { toast } from 'sonner';
import { resetListDraftStoreForTests } from './listDraftStore';
import { listLayoutStorageKey, resetListLayoutStoreForTests } from './listLayoutStore';

const OBJECT = 'showcase_task';
const CUSTOM_PACKAGE = 'com.example.showcase.custom';
const SHIPPED_PACKAGE = 'com.example.showcase';

/** A shared view the console saved into the customization package. */
const SHARED = {
  name: `${OBJECT}.team_tasks`, object: OBJECT, label: 'Team tasks', type: 'grid',
  columns: ['name', 'amount'], rowHeight: 'short', kanban: { groupByField: 'status' }, _packageId: CUSTOM_PACKAGE,
};
/** A view the read-only code package ships. */
const SHIPPED = {
  name: `${OBJECT}.in_progress`, object: OBJECT, label: 'In progress', type: 'grid',
  columns: ['name', 'amount'], _packageId: SHIPPED_PACKAGE,
};
const PACKAGES = [
  { id: SHIPPED_PACKAGE, name: 'Showcase', writable: false, namespace: 'showcase' },
  { id: CUSTOM_PACKAGE, name: 'Showcase (custom)', writable: true, namespace: 'showcase' },
];

function mount(viewId: string) {
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: {} })),
    listViews: vi.fn(async () => [SHARED, SHIPPED]),
    updateView: vi.fn(async () => ({})),
  };
  const utils = render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/view/${encodeURIComponent(viewId)}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={
              <ObjectView
                dataSource={dataSource as never}
                objects={[{
                  name: OBJECT,
                  label: 'Task',
                  fields: {
                    name: { type: 'text', label: 'Name' },
                    amount: { type: 'number', label: 'Amount' },
                    status: { type: 'select', label: 'Status' },
                  },
                }]}
                onEdit={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  return { ...utils, dataSource };
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

/** A sort on the list: the draft holds it and the list reports the part. */
async function sortByAmount() {
  await act(async () => {
    listProps.current?.onSortChange?.([{ field: 'amount', order: 'desc' }]);
    listProps.current?.onPersonalizationChange?.(['sort']);
  });
  await settle();
}

/** The options menu's Save (the condition row's Save to this view takes the same handler). */
async function pressSave() {
  await act(async () => {
    listProps.current?.onSaveView?.();
  });
  await settle();
}

async function confirmSave() {
  const button = await screen.findByRole('button', { name: 'console.objectView.draft.saveToViewConfirmButton' });
  await act(async () => {
    fireEvent.click(button);
  });
  await settle();
}

const metaConflict = () => Object.assign(new Error('A draft is pending'), { status: 409, code: 'METADATA_CONFLICT' });

beforeEach(() => {
  listProps.current = null;
  packageList.answer = () => Promise.resolve(PACKAGES);
  localStorage.clear();
  resetListDraftStoreForTests();
  resetListLayoutStoreForTests();
  meta.client.save.mockReset().mockResolvedValue({});
  meta.client.publish.mockReset().mockResolvedValue({});
  meta.client.reset.mockReset().mockResolvedValue({});
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('objectstack#35955 — Save to this view on a shared view: confirm, then save and publish at once', () => {
  it('an admin confirms: the draft is written over no pending draft and published; the reader\'s row height stays theirs', async () => {
    // The reader's own row height (their layout in this browser, never a draft) differs from the view's.
    localStorage.setItem(listLayoutStorageKey('u1', OBJECT)!, JSON.stringify({ perView: { [SHARED.name]: { rowHeight: 'tall' } } }));
    mount(SHARED.name);
    await settle();
    await waitFor(() => expect(listProps.current).not.toBeNull());
    expect(listProps.current?.onSaveView).toBeUndefined();

    await sortByAmount();
    expect(typeof listProps.current?.onSaveView).toBe('function');
    await pressSave();
    // Nothing is written before the confirm.
    expect(meta.client.save).not.toHaveBeenCalled();
    await confirmSave();

    await waitFor(() => expect(meta.client.publish).toHaveBeenCalledWith('view', SHARED.name));
    expect(meta.client.save).toHaveBeenCalledTimes(1);
    const [type, name, body, options] = meta.client.save.mock.calls[0] as any[];
    expect([type, name]).toEqual(['view', SHARED.name]);
    // The first-write pin: the server refuses the write over a pending draft.
    expect(options).toEqual({ mode: 'draft', ifNoneMatch: '*' });
    expect(body.config.sort).toEqual([{ field: 'amount', order: 'desc' }]);
    // F5: the view keeps its own row height, not this reader's.
    expect(body.config.rowHeight).toBe('short');
    expect(meta.client.save.mock.invocationCallOrder[0]).toBeLessThan(meta.client.publish.mock.invocationCallOrder[0]);
    expect(meta.client.reset).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('console.objectView.draft.savedForEveryone');
    // The draft is the view now: Discard and Save go.
    await waitFor(() => expect(listProps.current?.onSaveView).toBeUndefined());
  });

  it.each([
    // A stored view with no label reaches the page named by its name, which is
    // what its tab draws (`viewTabLabel`), never an empty 「“”」.
    ['no label', undefined, `${OBJECT}.team_tasks`],
    ['a label given as a locale map', { en: 'Team list', 'zh-CN': '团队列表' }, 'Team list'],
    ['CONTROL: a plain label', 'Team tasks', 'Team tasks'],
  ])('the confirm names the view as its tab does when it has %s (L1-b S1)', async (_case, label, expected) => {
    const view = SHARED as Record<string, unknown>;
    const authored = view.label;
    if (label === undefined) delete view.label;
    else view.label = label;
    try {
      mount(SHARED.name);
      await settle();
      await sortByAmount();
      await pressSave();
      // Never 「“”」 or 「[object Object]」.
      expect(await screen.findByText(`console.objectView.draft.saveToViewConfirm [${expected}]`)).toBeInTheDocument();
    } finally {
      view.label = authored;
    }
  });

  it('cancelling the confirm writes nothing and keeps the draft', async () => {
    mount(SHARED.name);
    await settle();
    await sortByAmount();
    await pressSave();
    const cancel = await screen.findByRole('button', { name: 'console.objectView.cancel' });
    await act(async () => {
      fireEvent.click(cancel);
    });
    await settle();
    expect(meta.client.save).not.toHaveBeenCalled();
    expect(meta.client.publish).not.toHaveBeenCalled();
    expect(typeof listProps.current?.onSaveView).toBe('function');
  });

  it('a view with a pending draft is not saved: nothing is published, the reader is sent to the view settings, the draft stays', async () => {
    meta.client.save.mockRejectedValue(metaConflict());
    mount(SHARED.name);
    await settle();
    await sortByAmount();
    await pressSave();
    await confirmSave();
    await waitFor(() => expect(meta.client.save).toHaveBeenCalledTimes(1));
    expect(meta.client.publish).not.toHaveBeenCalled();
    expect(meta.client.reset).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('console.objectView.draft.pendingDraft');
    expect(toast.success).not.toHaveBeenCalled();
    expect(typeof listProps.current?.onSaveView).toBe('function');
  });

  it('a refused publish discards the draft this save wrote and keeps the list\'s draft', async () => {
    meta.client.publish.mockRejectedValue(Object.assign(new Error('Publish refused'), { status: 400 }));
    mount(SHARED.name);
    await settle();
    await sortByAmount();
    await pressSave();
    await confirmSave();
    await waitFor(() => expect(meta.client.reset).toHaveBeenCalledWith('view', SHARED.name, { state: 'draft' }));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(typeof listProps.current?.onSaveView).toBe('function');
  });

  it('a view a read-only package ships is offered no save into it (Save as my view stays the reader\'s)', async () => {
    mount(SHIPPED.name);
    await settle();
    await sortByAmount();
    expect(listProps.current?.onSaveView).toBeUndefined();
  });
});

describe('objectstack#35955 — the layout and the row colour the reader picks are the list\'s draft', () => {
  async function pickKanbanAndColour() {
    await act(async () => {
      listProps.current?.onViewChange?.('kanban');
      listProps.current?.onRowColorChange?.({ field: 'status', colors: {} });
      listProps.current?.onPersonalizationChange?.(['layout', 'rowColor']);
    });
    await settle();
  }

  it('they are laid into the list over the view\'s own, which goes to `viewDefaults`, and outlive a record opened as a page', async () => {
    mount(SHARED.name);
    await settle();
    await waitFor(() => expect(listProps.current).not.toBeNull());
    expect(listProps.current?.schema.viewType).toBe('grid');
    await pickKanbanAndColour();
    expect(listProps.current?.schema.viewType).toBe('kanban');
    expect(listProps.current?.schema.rowColor).toEqual({ field: 'status', colors: {} });
    expect(listProps.current?.viewDefaults).toMatchObject({ viewType: 'grid', rowColor: undefined });
    expect('rowColor' in (listProps.current?.viewDefaults ?? {})).toBe(true);

    // The list page unmounts while a record is open as a page, and mounts again on Back.
    cleanup();
    listProps.current = null;
    mount(SHARED.name);
    await settle();
    await waitFor(() => expect(listProps.current).not.toBeNull());
    // Read through a cast: the assignment above narrows `current` to `null` for the checker.
    const remounted = listProps.current as Record<string, any> | null;
    expect(remounted?.schema.viewType).toBe('kanban');
    expect(remounted?.schema.rowColor).toEqual({ field: 'status', colors: {} });
  });

  it('picking the view\'s own layout and colour again drops those parts', async () => {
    mount(SHARED.name);
    await settle();
    await pickKanbanAndColour();
    await act(async () => {
      listProps.current?.onViewChange?.('grid');
      listProps.current?.onRowColorChange?.(null);
    });
    await settle();
    expect(listProps.current?.schema.viewType).toBe('grid');
    expect(listProps.current?.schema.rowColor).toBeUndefined();
  });

  it('Save to this view keeps them: the view is retyped (its kanban lists the columns) and coloured', async () => {
    mount(SHARED.name);
    await settle();
    await pickKanbanAndColour();
    await pressSave();
    await confirmSave();
    await waitFor(() => expect(meta.client.publish).toHaveBeenCalledTimes(1));
    const body = (meta.client.save.mock.calls[0] as any[])[2];
    expect(body.config.type).toBe('kanban');
    expect(body.config.kanban).toEqual({ groupByField: 'status', columns: ['name', 'amount'] });
    expect(body.config.rowColor).toEqual({ field: 'status', colors: {} });
  });
});

describe('objectstack#36194 + objectstack#36195 — a shared view\'s Save to this view carries the footer calculations, and waits for the package list', () => {
  it('a footer calculation picked is a part of the draft, saved into the view with no write of its own; the reader\'s row height stays theirs', async () => {
    localStorage.setItem(`list-state:u1:${OBJECT}`, JSON.stringify({ perView: { [SHARED.name]: { rowHeight: 'tall' } } }));
    mount(SHARED.name);
    await settle();
    await waitFor(() => expect(typeof listProps.current?.onColumnSummaryPick).toBe('function'));
    let kept: unknown;
    await act(async () => {
      kept = listProps.current?.onColumnSummaryPick?.('amount', 'sum');
    });
    await settle();
    expect(await kept).toBe(true);
    // The pick writes nothing: it is the draft's, and the list draws it.
    expect(meta.client.save).not.toHaveBeenCalled();
    expect(listProps.current?.schema.columns).toEqual([{ field: 'name' }, { field: 'amount', summary: 'sum' }]);
    expect(typeof listProps.current?.onSaveView).toBe('function');

    await pressSave();
    await confirmSave();
    await waitFor(() => expect(meta.client.publish).toHaveBeenCalledWith('view', SHARED.name));
    const body = (meta.client.save.mock.calls[0] as any[])[2];
    expect(body.config.columns).toEqual([{ field: 'name' }, { field: 'amount', summary: 'sum' }]);
    expect(body.config.rowHeight).toBe('short');
  });

  it('while the package list is unread, Save to this view is not offered; it is once the list says the package takes saves', async () => {
    // Every reader of the package list waits on the same answer.
    const waiting: Array<(list: any[]) => void> = [];
    packageList.answer = () => new Promise<any[]>((resolve) => { waiting.push(resolve); });
    mount(SHARED.name);
    await settle();
    await sortByAmount();
    expect(listProps.current?.onSaveView).toBeUndefined();
    await act(async () => {
      for (const resolve of waiting) resolve(PACKAGES);
    });
    await settle();
    await waitFor(() => expect(typeof listProps.current?.onSaveView).toBe('function'));
  });

  it('a failed package read still offers it, as before: the server\'s gate refuses what it refuses', async () => {
    packageList.answer = () => Promise.reject(new Error('network'));
    mount(SHARED.name);
    await settle();
    await sortByAmount();
    await waitFor(() => expect(typeof listProps.current?.onSaveView).toBe('function'));
  });
});
