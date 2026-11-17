/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34807 (ruling 6946403206) — the list half, through the real
 * `ObjectView` and the real `ListView`: under `?preview=draft` a list column on
 * a field that exists only in the draft made the data door refuse the whole
 * list query (`400 INVALID_FIELD`, it validates against the PUBLISHED object).
 *
 * The object view's list wrapper (`objectViewListRenderer`) now answers the
 * list's object definition through the provider's overlay read, with the
 * draft-only field marked, so `ListView` draws its column empty under the
 * draft label and never asks for it. The data source answers as the data door
 * does: any request naming `priority` is refused. CONTROL: outside the preview
 * nothing changes, so the same view still sends the column and is refused.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias):
// ObjectView reaches `import('@objectstack/lint')` through the CEL editor.
import '@objectstack/lint';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

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

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));


/** The overlay read (`useMetadata().getItem`), answered by the drafted document. */
const GET_ITEM = vi.fn();
vi.mock('../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers/MetadataProvider')>();
  return {
    ...actual,
    useMetadata: () => ({ ...actual.useMetadata(), getItem: (type: string, name: string) => GET_ITEM(type, name) }),
  };
});

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { PreviewModeProvider } from '../preview/PreviewModeContext';

const PUBLISHED_FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
};

/** The object as the draft overlay serves it: the drafted field and a list column on it. */
const DRAFT_TASK = {
  name: 'tracker_task',
  label: 'Task',
  pluralLabel: 'Tasks',
  fields: {
    ...PUBLISHED_FIELDS,
    priority: { type: 'select', label: 'Priority (draft)', options: [{ label: 'High', value: 'high' }] },
  },
  listViews: {
    all: { name: 'all', label: 'All', type: 'grid', columns: ['title', 'priority'] },
  },
};

afterEach(() => {
  cleanup();
  GET_ITEM.mockReset();
});

function mount(opts: { preview: boolean }) {
  GET_ITEM.mockImplementation(async (type: string, name: string) =>
    type === 'object' && name === 'tracker_task' ? DRAFT_TASK : null);
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const find = vi.fn(async (_object: string, params: unknown) => {
    if (JSON.stringify(params ?? {}).includes('"priority')) {
      throw Object.assign(new Error("Unknown field 'priority' on object 'tracker_task'"), {
        httpStatus: 400,
        code: 'INVALID_FIELD',
      });
    }
    return { data: [{ id: 't1', title: 'Write the spec' }], total: 1 };
  });
  const dataSource = {
    find,
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    // The adapter's PUBLISHED read: it does not know the drafted field.
    getObjectSchema: vi.fn(async () => ({ name: 'tracker_task', label: 'Task', fields: PUBLISHED_FIELDS })),
  } as never;
  render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', positions: ['org_admin'] }} features={{}}>
        <MemoryRouter initialEntries={['/apps/app.tracker/tracker_task/view/all']}>
          <PreviewModeProvider force={opts.preview}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/view/:viewId"
                element={<ObjectView dataSource={dataSource} objects={[DRAFT_TASK]} onEdit={() => {}} />}
              />
            </Routes>
          </PreviewModeProvider>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  return { find };
}

describe('objectstack#34807 — a list column on a draft-only field in the draft preview', () => {
  it('draws the list with the column empty under its draft label, never asking for it', async () => {
    const { find } = mount({ preview: true });

    await screen.findByText('Write the spec', undefined, { timeout: 5000 });
    expect(screen.getAllByText('Priority (draft)').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('list-error-state')).toBeNull();
    expect(GET_ITEM).toHaveBeenCalledWith('object', 'tracker_task');
    expect(find).toHaveBeenCalled();
    for (const [, params] of find.mock.calls) {
      expect(JSON.stringify(params ?? {})).not.toContain('"priority');
    }
  });

  it('control: outside the preview the column is still sent, and the data door refuses it', async () => {
    const { find } = mount({ preview: false });

    await screen.findByTestId('list-error-state', undefined, { timeout: 5000 });
    expect(screen.queryByText('Write the spec')).toBeNull();
    expect(JSON.stringify(find.mock.calls.at(-1)?.[1] ?? {})).toContain('"priority"');
    expect(GET_ITEM).not.toHaveBeenCalledWith('object', 'tracker_task');
  });
});
