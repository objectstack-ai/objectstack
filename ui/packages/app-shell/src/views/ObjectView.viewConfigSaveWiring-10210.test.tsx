/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10210 — the WIRING half: "Edit view config → Save" on the real
 * `ObjectView` stages a ViewItem envelope, addressed to the tab it was saved
 * from. `ObjectView.viewConfigSaveEnvelope-10210.test.ts` pins the body the
 * builder produces; this pins that the save handler actually persists it,
 * rather than the flat draft the panel hands it.
 *
 * The panel is a stub that saves the draft shape captured from a live run (the
 * label edited, everything else the tab's own), so the assertion is on what
 * reaches the metadata seam — the same `save('view', name, body, { mode:
 * 'draft' })` call the platform receives as `PUT /meta/view/NAME?mode=draft`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ViewMetadataSchema } from '@objectstack/spec/ui';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities — `ListView` names `perms` in its fetch dependencies.
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
  // The config panel is admin-only.
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

// The metadata seam's client — the one `persistRuntimeMetadata` writes through.
const metadataClient = {
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => null),
};
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => metadataClient,
}));

// The panel, reduced to its Save: it hands the host the draft the real panel
// produced for a label edit (live capture, objectui#10210).
vi.mock('./ViewConfigPanel', () => ({
  ViewConfigPanel: ({ activeView, onSave }: any) => (
    <button
      type="button"
      data-testid="stub-view-config-save"
      onClick={() =>
        onSave({
          label: 'Everything EDITED',
          type: activeView.type,
          columns: activeView.columns,
          name: activeView.name,
          isDefault: !!activeView.isDefault,
          id: activeView.id,
        })
      }
    >
      save
    </button>
  ),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';
const VIEW_ID = `${OBJECT_NAME}.all`;

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    listViews: {
      [VIEW_ID]: { name: VIEW_ID, label: 'Everything', type: 'grid', columns: ['name'] },
    },
  },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

beforeEach(() => {
  cleanup();
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

describe('ObjectView — Edit view config → Save (objectui#10210)', () => {
  it('stages a spec-valid ViewItem envelope on the row the tab is keyed by', async () => {
    render(
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${VIEW_ID}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={makeDataSource()} objects={OBJECTS} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>,
    );
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-view-config-save'));
    });

    expect(metadataClient.save).toHaveBeenCalledTimes(1);
    const [type, name, body, opts] = metadataClient.save.mock.calls[0] as unknown as [string, string, any, any];
    expect(type).toBe('view');
    expect(name).toBe(VIEW_ID);
    expect(opts).toEqual({ mode: 'draft' });
    expect(body.name).toBe(VIEW_ID);
    expect(body).toMatchObject({ object: OBJECT_NAME, viewKind: 'list', label: 'Everything EDITED' });
    expect(body.config).toMatchObject({ type: 'grid', columns: ['name'] });
    const verdict = ViewMetadataSchema.safeParse(body);
    expect(verdict.success, JSON.stringify(verdict.error?.issues)).toBe(true);
  });
});
