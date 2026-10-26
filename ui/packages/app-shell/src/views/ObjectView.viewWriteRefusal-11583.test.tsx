// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11583: every metadata write the object page makes says a refusal,
 * and the view-config panel never reports a refused save as saved.
 *
 * ## The defects this pins
 *
 * objectui#11578 closed the two Create View doors. This card is that family's
 * closing card, and these are the object page's remaining write sites:
 *
 * - `handleViewConfigSave` (the view-config panel's edit Save) caught a refused
 *   `persistRuntimeMetadata` with `console.error` only. Measured by the
 *   objectui#11578 dev with a client whose save answers 403: no `toast.error`,
 *   no `toast.success`. And `ViewConfigPanel.handleSave` cleared `isDirty`
 *   and bumped `savedSignal` before the save settled, so the panel looked
 *   saved, raised the "unpublished changes" indicator, and disabled Save, so
 *   the refused edit could not be retried.
 * - `handlePinView` caught a refused `updateView` with `console.error` only.
 * - `handleReorderViews` caught a refused `sortOrder` write with
 *   `console.error` only. (Since objectui#12418 it writes no view at all: the
 *   drag is the user's own tab order, and its block pins that instead.)
 * - `persistViewPatch` (the toolbar toggles' `updateViewConfig`) said only the
 *   client-side permission gate's refusal; every other refusal, a server 403
 *   included, was `console.error` only. (Since objectui#12474 no toolbar
 *   toggle writes a view: the density and the hidden fields are the user's
 *   own list state, and its block pins that instead. objectui#12504 retired
 *   the write itself, with its gate.)
 *
 * - `handleSetDefaultView` raised the untranslated literal
 *   'Failed to set default view', with no description, so the refusal's own
 *   reason never reached the user (the objectui#11583 patch round).
 *
 * - `handleRenameView` said a refusal with the translated
 *   `objectViewActions.renameFailed` title and no description, so the
 *   server's sentence reached `console.error` alone (objectui#12417, this
 *   family's last silent view-write row).
 *
 * - `handleDeleteView` said a refusal with the translated
 *   `objectViewActions.deleteFailed` title and no description, so the
 *   server's sentence (a 409 naming the `?package=` remedy for a view two
 *   packages hold, a permission refusal) reached `console.error` alone
 *   (objectui#12398, this family's delete row).
 *
 * ## What runs
 *
 * The real `ObjectView`, the real `ViewConfigPanel` and its real
 * `RuntimeDraftBar`, and a real `@object-ui/data-objectstack` `MetadataClient`
 * whose fetch answers the view PUT with the refusal under test, so the error
 * `handleViewConfigSave` catches is the one the client's own parser builds
 * from the wire. Three seams are stubbed, each to reach a door without
 * driving a third-party widget: the panel's spec inspector (one button makes
 * an edit), `ManageViewsDialog` (buttons call the handlers the page hands it)
 * and `ListView` (its schema is captured, so a toolbar toggle's callback can
 * be called).
 *
 * Direction, written before the run: on the unmodified tree the refused cases
 * of the panel, pin, reorder and toolbar toggle go RED (no `toast.error`; the
 * panel's Save disables and the indicator shows), and every control stays
 * GREEN, since it pins behaviour this change does not move. The
 * set-as-default case was added in the patch round and went RED on the first
 * round's head for its own reason: a toast, but no description.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';
import { toast } from 'sonner';

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
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  // The config panel and the view-management handlers are admin-only.
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

/**
 * The list schema the object page hands down: captured, not rendered. The
 * stand-in draws only the page's `toolbarLeading` node — the view tab strip
 * rides the list's toolbar row since objectui#12440.
 */
let listSchema: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    listSchema = props.schema;
    return props.toolbarLeading ?? null;
  },
}));

// The panel's spec inspector, reduced to one edit: a new label.
vi.mock('./metadata-admin/inspectors/ViewVariantInspector', () => ({
  ViewVariantInspector: ({ onPatch }: any) => (
    <button type="button" data-testid="stub-inspector-edit" onClick={() => onPatch({ label: 'Pipeline EDITED' })}>
      edit
    </button>
  ),
}));

const OBJECT_NAME = 'crm_deal';
const SYSTEM_ID = `${OBJECT_NAME}.all`;
const SAVED_ID = `${OBJECT_NAME}.pipeline`;

// The view-management dialog, reduced to the handlers the page hands it.
vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-view')>()),
  ManageViewsDialog: (props: any) => (
    <div>
      <button type="button" data-testid="stub-config" onClick={() => props.onConfigView?.(SAVED_ID)}>config</button>
      <button type="button" data-testid="stub-pin" onClick={() => props.onSetPinned?.(SAVED_ID, true)}>pin</button>
      <button type="button" data-testid="stub-reorder" onClick={() => props.onReorder?.([SAVED_ID, SYSTEM_ID])}>reorder</button>
      <button type="button" data-testid="stub-rename" onClick={() => props.onRename?.(SAVED_ID, 'Renamed')}>rename</button>
      <button type="button" data-testid="stub-set-default" onClick={() => props.onSetDefault?.(SAVED_ID)}>default</button>
      <button type="button" data-testid="stub-delete" onClick={() => props.onDelete?.(SAVED_ID)}>delete</button>
    </div>
  ),
}));

/** What the view PUT answers in this test: a refusal, or a 2xx. */
let putAnswer: () => Response;
const puts: string[] = [];

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The dispatcher's ADR-0112 refusal envelope for a view the spec gate refused. */
const INVALID_METADATA = () =>
  json(
    {
      success: false,
      error: {
        code: 'INVALID_METADATA',
        message: 'The view failed spec validation: 1 issue (columns [custom])',
        details: {
          code: 'INVALID_METADATA',
          issues: [{ path: 'columns', message: 'Column "ghost_field" is not a field of crm_deal', code: 'custom' }],
        },
      },
    },
    422,
  );
/** A permission refusal: a message and no structured issues. */
const PERMISSION_DENIED = () =>
  json(
    { success: false, error: { code: 'PERMISSION_DENIED', message: 'Saving views requires the Manage Metadata permission' } },
    403,
  );

function wire() {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname;
    if (init?.method === 'PUT' && path.includes('/meta/view/')) {
      puts.push(path);
      return putAnswer();
    }
    // No draft is pending on any view: the bar's draft read answers 404.
    if (path.includes('/meta/view/')) return json({ success: false }, 404);
    if (path.endsWith('/meta/dataset')) return json([], 200);
    return json({ data: [] }, 200);
  });
}
let client: MetadataClient;

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { ObjectView, type ConsoleObjectViewProps } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  amount: { type: 'number', label: 'Amount' },
};
/** The saved view: an overlay row the adapter's `listViews` serves. */
const SAVED_ROW = { name: SAVED_ID, object: OBJECT_NAME, label: 'Pipeline', type: 'grid', columns: ['name'] };

/** A refusal as the adapter's `updateView` raises it. */
const refusal = (message: string) => Object.assign(new Error(message), { status: 403 });

function makeDataSource(writes: Record<string, unknown> = {}) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT_NAME, fields: {} })),
    listViews: vi.fn(async () => [SAVED_ROW]),
    updateView: vi.fn(async () => ({})),
    deleteView: vi.fn(async () => ({})),
    ...writes,
  } as unknown as ConsoleObjectViewProps['dataSource'];
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

/** Mount the object page on the saved view, and wait for its tab. */
async function mountOnSavedView(dataSource: ConsoleObjectViewProps['dataSource']) {
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${SAVED_ID}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={
              <ObjectView
                dataSource={dataSource}
                objects={[{
                  name: OBJECT_NAME,
                  label: 'Deal',
                  fields: FIELDS,
                  listViews: { [SYSTEM_ID]: { name: SYSTEM_ID, label: 'All', type: 'grid', columns: ['name'] } },
                }]}
                onEdit={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await settle();
  // The saved view is a tab once `listViews` has answered.
  await screen.findByText('Pipeline');
}

/** The one `toast.error` call's description, as text. */
const errorDescription = (call = 0) => {
  const [, options] = vi.mocked(toast.error).mock.calls[call] as [unknown, { description?: unknown } | undefined];
  return String(options?.description);
};

const saveButton = () => screen.getByTestId('view-config-save') as HTMLButtonElement;

/** Open the config panel on the saved view, edit it, and press Save. */
async function editAndSave() {
  fireEvent.click(screen.getByTestId('stub-config'));
  await screen.findByTestId('stub-inspector-edit');
  fireEvent.click(screen.getByTestId('stub-inspector-edit'));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await waitFor(() => expect(puts).toHaveLength(1));
}

beforeEach(() => {
  cleanup();
  puts.length = 0;
  listSchema = null;
  client = new MetadataClient({ baseUrl: 'http://localhost', fetch: wire() as unknown as typeof fetch });
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] }, 200)));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // Unmount before the real fetch comes back (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the view-config panel\'s edit Save says a refused save, and stays dirty (objectui#11583, handleViewConfigSave)', () => {
  it.each([
    { refusal: '403 permission', answer: PERMISSION_DENIED, says: ['Saving views requires the Manage Metadata permission'] },
    { refusal: '422 INVALID_METADATA', answer: INVALID_METADATA, says: ['columns', 'Column "ghost_field" is not a field of crm_deal'] },
  ])('a $refusal refusal shows the door\'s message; Save stays enabled and no draft is announced', async ({ answer, says }) => {
    putAnswer = answer;
    await mountOnSavedView(makeDataSource());
    await editAndSave();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    for (const text of says) expect(errorDescription()).toContain(text);
    expect(toast.success).not.toHaveBeenCalled();
    // Still dirty: the refused edit can be retried with one click.
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.queryByTestId('runtime-draft-indicator')).toBeNull();
  });

  it('a saved edit clears the panel and announces the draft (control)', async () => {
    putAnswer = () => json({ success: true }, 200);
    await mountOnSavedView(makeDataSource());
    await editAndSave();

    await screen.findByTestId('runtime-draft-indicator');
    expect(saveButton().disabled).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('pin says a refused write (objectui#11583, handlePinView)', () => {
  it('a refused pin raises the door\'s message', async () => {
    const dataSource = makeDataSource({
      updateView: vi.fn(async () => { throw refusal('Pinning views requires the Manage Metadata permission'); }),
    });
    await mountOnSavedView(dataSource);
    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-pin'));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(errorDescription()).toContain('Pinning views requires the Manage Metadata permission');
    expect((dataSource as any).updateView).toHaveBeenCalledWith(OBJECT_NAME, SAVED_ID, { isPinned: true });
  });

  it('a pin that lands raises nothing (control)', async () => {
    const dataSource = makeDataSource();
    await mountOnSavedView(dataSource);
    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-pin'));
    });
    await waitFor(() => expect((dataSource as any).updateView).toHaveBeenCalledTimes(1));
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('reorder is no view write any more (objectui#12418, handleReorderViews)', () => {
  // objectui#11583 pinned a refused `sortOrder` write here. Since objectui#12418
  // the drag is the user's own tab order: nothing reaches a view, so a view
  // write that would be refused is never attempted, and nothing is said.
  it('a reorder writes no view and raises nothing, even where every view write is refused', async () => {
    const dataSource = makeDataSource({
      updateView: vi.fn(async () => { throw refusal('Reordering views requires the Manage Metadata permission'); }),
    });
    await mountOnSavedView(dataSource);
    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-reorder'));
    });
    await settle();

    expect((dataSource as any).updateView).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('a toolbar toggle is no view write any more (objectui#12474, density and Hide Fields)', () => {
  // objectui#11583 pinned a refused toolbar `updateViewConfig` here (the
  // density toggle through `persistViewPatch`). Since objectui#12474 the
  // density and the hidden fields are the user's own list state, as the sort
  // and the column layout became in objectui#12418: nothing reaches a view, so
  // a view write that would be refused is never attempted, and nothing is said.
  // objectui#12504 retired that toolbar write and the adapter method with it.
  it('a density change and a Hide Fields change write no view and raise nothing, even where every view write is refused', async () => {
    const dataSource = makeDataSource({
      updateView: vi.fn(async () => { throw refusal('View settings are refused for this session'); }),
    });
    await mountOnSavedView(dataSource);
    await waitFor(() => expect(typeof listSchema?.onDensityChange).toBe('function'));
    act(() => {
      listSchema.onDensityChange('compact');
      listSchema.onHiddenFieldsChange(['name']);
    });
    // Past the 300 ms debounce the toolbar's view write used to wait out.
    await settle();
    await settle();

    expect((dataSource as any).updateView).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('set-as-default says a refused write with the door\'s message (objectui#11583, handleSetDefaultView)', () => {
  it('a refused set-as-default raises the door\'s message, not a bare literal', async () => {
    const dataSource = makeDataSource({
      updateView: vi.fn(async () => { throw refusal('Setting a default view requires the Manage Metadata permission'); }),
    });
    await mountOnSavedView(dataSource);
    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-set-default'));
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(errorDescription()).toContain('Setting a default view requires the Manage Metadata permission');
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toBe('Failed to set default view');
    expect((dataSource as any).updateView).toHaveBeenCalledWith(OBJECT_NAME, SAVED_ID, { isDefault: true });
  });

  it('a set-as-default that lands raises nothing (control)', async () => {
    const dataSource = makeDataSource();
    await mountOnSavedView(dataSource);
    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-set-default'));
    });
    await waitFor(() => expect((dataSource as any).updateView).toHaveBeenCalledWith(OBJECT_NAME, SAVED_ID, { isDefault: true }));
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('rename says a refused write with the door\'s message (objectui#12417, handleRenameView)', () => {
  it('a refused rename keeps its translated title and shows the door\'s message as the description', async () => {
    const dataSource = makeDataSource({
      updateView: vi.fn(async () => { throw refusal('Renaming views requires the Manage Metadata permission'); }),
    });
    await mountOnSavedView(dataSource);
    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-rename'));
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe('objectViewActions.renameFailed');
    expect(errorDescription()).toContain('Renaming views requires the Manage Metadata permission');
    expect((dataSource as any).updateView).toHaveBeenCalledWith(OBJECT_NAME, SAVED_ID, { label: 'Renamed' });
  });
});

describe('delete says a refused write with the door\'s message (objectui#12398, handleDeleteView)', () => {
  it('a refused delete keeps its translated title and shows the door\'s message as the description', async () => {
    const dataSource = makeDataSource({
      deleteView: vi.fn(async () => {
        throw Object.assign(
          new Error("view 'crm_deal.pipeline' is held by two packages (com.acme.a, com.acme.b); name one with ?package="),
          { status: 409, code: 'RESOURCE_CONFLICT' },
        );
      }),
    });
    await mountOnSavedView(dataSource);
    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-delete'));
    });
    // The page asks first; the user confirms.
    const dialog = await screen.findByRole('alertdialog');
    const buttons = within(dialog).getAllByRole('button');
    await act(async () => {
      fireEvent.click(buttons[buttons.length - 1]);
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe('objectViewActions.deleteFailed');
    expect(errorDescription()).toContain('held by two packages');
    expect((dataSource as any).deleteView).toHaveBeenCalledWith(OBJECT_NAME, SAVED_ID);
  });
});
