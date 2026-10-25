// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11578, door 2 of 2: a refused Create View on the object page is
 * said to the user, and never reported as a save.
 *
 * ## The defect this pins
 *
 * `ObjectView.handleViewCreate` caught the failed save with
 * `console.error('[ViewConfigPanel] Failed to create view:', err)` and nothing
 * else, while the Create View dialog had already closed (it did not wait for
 * the save). The first door, "Save as view" on the object data page, had the
 * same shape and is pinned in `ObjectDataPage.saveAsViewRefusal-11578.test.tsx`;
 * the dialog's own close-on-success contract in
 * `CreateViewDialog.saveRefusal-11578.test.tsx`.
 *
 * ## What runs
 *
 * The real `ObjectView`, reached through the view tab bar's add button, the
 * real `CreateViewDialog`, and a real `@object-ui/data-objectstack`
 * `MetadataClient` whose fetch answers the PUT with the refusal under test, so
 * the error the door catches is the one the client's own parser builds from
 * the wire: the dispatcher's `422 INVALID_METADATA` envelope with structured
 * issues, or a `403` permission refusal that carries only a message.
 *
 * Direction, written before the run: on the unmodified tree both refused cases
 * go RED (no toast; the dialog has closed), and the saved case stays GREEN, as
 * the control that a successful create still navigates to the new draft.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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
  // The add-view button and the dialog are admin-only.
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

/** What the PUT answers in this test: a refusal, or a 2xx. */
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

const OBJECT_NAME = 'crm_deal';
const PAGE = `/apps/demo/${OBJECT_NAME}`;
const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  amount: { type: 'number', label: 'Amount' },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT_NAME, fields: {} })),
  } as unknown as ConsoleObjectViewProps['dataSource'];
}

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

const where = () => screen.getByTestId('where').textContent;
const submit = () => screen.getByTestId('create-view-submit') as HTMLButtonElement;
const labelInput = () => screen.getByTestId('create-view-name-input') as HTMLInputElement;
const nameInput = () => screen.getByTestId('create-view-machine-name-input') as HTMLInputElement;
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

/** Open Create View from the tab bar, name the view, press Create, and wait for the PUT. */
async function createViewThroughTheTabBar() {
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[PAGE]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/*"
            element={
              <ObjectView
                dataSource={makeDataSource()}
                objects={[{
                  name: OBJECT_NAME,
                  label: 'Deal',
                  fields: FIELDS,
                  listViews: { [`${OBJECT_NAME}.all`]: { name: `${OBJECT_NAME}.all`, label: 'All', type: 'grid', columns: ['name'] } },
                }]}
                onEdit={() => {}}
              />
            }
          />
        </Routes>
        <Where />
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await settle();
  fireEvent.click(screen.getByTestId('view-tab-add'));
  await screen.findByTestId('create-view-dialog');
  fireEvent.change(labelInput(), { target: { value: 'Pipeline board' } });
  await waitFor(() => expect(nameInput().value).toBe('pipeline_board'));
  await waitFor(() => expect(submit().disabled).toBe(false));
  await act(async () => {
    fireEvent.click(submit());
  });
  await waitFor(() => expect(puts).toHaveLength(1));
}

beforeEach(() => {
  cleanup();
  puts.length = 0;
  client = new MetadataClient({ baseUrl: 'http://localhost', fetch: wire() as unknown as typeof fetch });
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] }, 200)));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Unmount before the real fetch comes back (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Create View on the object page says a refused save, and never reports it as saved (objectui#11578)', () => {
  it.each([
    { refusal: '422 INVALID_METADATA', answer: INVALID_METADATA, says: ['columns', 'Column "ghost_field" is not a field of crm_deal'] },
    { refusal: '403 permission', answer: PERMISSION_DENIED, says: ['Saving views requires the Manage Metadata permission'] },
  ])('a $refusal refusal shows the door\'s message; the dialog stays open with the input, and the page does not move', async ({ answer, says }) => {
    putAnswer = answer;
    await createViewThroughTheTabBar();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [, options] = vi.mocked(toast.error).mock.calls[0] as [unknown, { description?: unknown } | undefined];
    for (const text of says) expect(String(options?.description)).toContain(text);
    expect(toast.success).not.toHaveBeenCalled();

    expect(screen.getByTestId('create-view-dialog')).toBeTruthy();
    expect(labelInput().value).toBe('Pipeline board');
    expect(nameInput().value).toBe('pipeline_board');
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(where()).toBe(PAGE);
  });

  it('a saved view still lands the user on the new draft in preview mode (control)', async () => {
    putAnswer = () => json({ success: true }, 200);
    await createViewThroughTheTabBar();

    await waitFor(() => expect(where()).toBe(`${PAGE}/view/${OBJECT_NAME}.pipeline_board?preview=draft`));
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('create-view-dialog')).toBeNull());
  });
});
