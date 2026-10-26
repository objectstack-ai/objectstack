/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11696 — an object list page is titled with the object's PLURAL
 * label.
 *
 * The page lists records and is opened by a nav entry reading "Projects", but
 * its `PageHeader` drew `objectLabel(objectDef)`, the singular: "Project". It
 * now draws `objectPluralLabel(objectDef)` — the translated plural, else the
 * declared one, else the singular (an object that declares no plural keeps its
 * label). The record page keeps the singular; nothing here touches it.
 *
 * Measured from a real `ObjectView` mount inside a real i18next instance booted
 * in the language under test (`ObjectView.recordCountFooter-10636`'s harness);
 * the list body is stubbed, since the title sits outside it. The `zh-CN` plural
 * differs from the `zh-CN` label on purpose, so the assertion can tell which
 * key was read — shipped zh-CN bundles often use one word for both.
 *
 * Direction, written before the run: the two plural cells RED with the title
 * put back to `objectLabel` (`Project` / `项目`), GREEN after; the no-plural
 * control GREEN on both sides.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

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

// The list body: the title is drawn outside it, so it is not what this reads.
vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: () => null,
  ViewTabBar: () => null,
  ManageViewsDialog: () => null,
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

type Lang = 'en' | 'zh-CN';

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
};

const OBJECTS = [
  { name: 'showcase_project', label: 'Project', pluralLabel: 'Projects', fields: FIELDS },
  { name: 'showcase_note', label: 'Note', fields: FIELDS },
];

/** The catalog as the console loads it: `zh-CN` translates both scalars. */
const BUNDLE: Record<Lang, Record<string, unknown>> = {
  en: {},
  'zh-CN': { showcase: { objects: { showcase_project: { label: '项目', pluralLabel: '项目清单' } } } },
};

beforeEach(() => {
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
  cleanup();
  vi.unstubAllGlobals();
});

/** The list page's title text for `objectName`, in `lang`. */
async function listTitle(lang: Lang, objectName: string): Promise<string> {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  i18n.addResourceBundle(lang, 'translation', BUNDLE[lang], true, true);
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${objectName}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName"
              element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  const heading = await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
  return heading.textContent ?? '';
}

describe('ObjectView — the list page is titled with the plural (objectui#11696)', () => {
  it('en: "Projects" titles the projects list', async () => {
    expect(await listTitle('en', 'showcase_project')).toBe('Projects');
  });

  it('zh-CN: the translated plural titles the projects list', async () => {
    expect(await listTitle('zh-CN', 'showcase_project')).toBe('项目清单');
  });

  it('control: an object that declares no plural is titled with its label', async () => {
    expect(await listTitle('en', 'showcase_note')).toBe('Note');
  });
});
