/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32984 item 3 — the draft preview of an app the AI just built
 * showed 「无法加载记录 · Object 'b6bl_customer' is not registered ·
 * OBJECT_NOT_FOUND」 on its list page, right under the preview bar promising
 * that sample data appears once you publish. An object the build only drafted
 * is not registered with the data engine until its first publish, so its
 * record read answers `404 OBJECT_NOT_FOUND`: in the preview that is an empty
 * list, and the page says why.
 *
 * Mounted through the real `ObjectView` and the real `ListView`, with a real
 * i18next instance booted in `en`; the preview flag comes from the real
 * `PreviewModeProvider`. Controls: the same answer OUTSIDE the preview is still
 * an error (a missing object on the live console is a fault), and a 500 inside
 * the preview is still an error (only the not-registered answer is read).
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

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { PreviewModeProvider } from '../preview/PreviewModeContext';

/** The drafted object, as the draft overlay serves it. */
const B6BL_CUSTOMER = {
  name: 'b6bl_customer',
  label: 'Customer',
  pluralLabel: 'Customers',
  _draft: true,
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
  },
  listViews: {
    all: { name: 'all', label: 'All', type: 'grid', columns: ['name'] },
  },
};

/** The data engine's answer for an object it has not registered (the client decorates it). */
function refusal(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { httpStatus: status, code });
}

const NOT_REGISTERED = () =>
  refusal(404, 'OBJECT_NOT_FOUND', "Object 'b6bl_customer' is not registered");

afterEach(() => {
  cleanup();
});

function mount(opts: { preview: boolean; fail: () => Error }) {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const find = vi.fn(async () => {
    throw opts.fail();
  });
  const dataSource = {
    find,
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', positions: ['org_admin'] }} features={{}}>
        <MemoryRouter initialEntries={['/apps/app.b6bl/b6bl_customer/view/all']}>
          <PreviewModeProvider force={opts.preview}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/view/:viewId"
                element={<ObjectView dataSource={dataSource} objects={[B6BL_CUSTOMER]} onEdit={() => {}} />}
              />
            </Routes>
          </PreviewModeProvider>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  return { find };
}

describe('objectstack#32984 — a drafted object in the draft preview', () => {
  it('draws the empty list with the publish sentence, not OBJECT_NOT_FOUND', async () => {
    const { find } = mount({ preview: true, fail: NOT_REGISTERED });

    const empty = await screen.findByTestId('empty-state', undefined, { timeout: 5000 });
    expect(find).toHaveBeenCalled();
    expect(empty.textContent).toContain('Records appear here once you publish');
    expect(document.body.textContent).not.toContain('OBJECT_NOT_FOUND');
    expect(document.body.textContent).not.toContain('is not registered');
    expect(screen.queryByTestId('list-error-code')).toBeNull();
  });

  it('control: outside the preview the same answer is still an error', async () => {
    mount({ preview: false, fail: NOT_REGISTERED });

    const code = await screen.findByTestId('list-error-code', undefined, { timeout: 5000 });
    expect(code.textContent).toBe('OBJECT_NOT_FOUND');
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('control: a different failure inside the preview is still an error', async () => {
    mount({
      preview: true,
      fail: () => refusal(500, 'INTERNAL_ERROR', 'The driver could not be reached'),
    });

    const code = await screen.findByTestId('list-error-code', undefined, { timeout: 5000 });
    expect(code.textContent).toBe('INTERNAL_ERROR');
    expect(document.body.textContent).not.toContain('Records appear here once you publish');
  });
});
