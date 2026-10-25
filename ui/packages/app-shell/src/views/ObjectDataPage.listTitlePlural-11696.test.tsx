/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11696 — the `/data` page is titled with the object's PLURAL label.
 *
 * `/apps/:appName/:objectName/data` lists the object's records (a URL-defined
 * slice, badged "Data"), under the same object crumb `AppHeader` draws for the
 * object list, which reads the plural. Its `PageHeader` drew
 * `objectLabel(objectDef)`, so the page read "Projects ▾" in the crumb above
 * "Project · Data" (contract review on PR objectui#11728). It now draws
 * `objectPluralLabel(objectDef)`: the translated plural, else the declared one,
 * else the singular. The record drawer this page opens keeps the singular.
 *
 * Harness: `ObjectDataPage.filterChipI18n-9159`'s mocks, with a real i18next
 * instance booted in the language under test, as in
 * `ObjectView.listTitlePlural-11696`. The title's own text node is read (the
 * `span.truncate` inside the heading), because the heading also holds the
 * "Data" badge. The `zh-CN` plural differs from the `zh-CN` label on purpose,
 * so the assertion can tell which key was read.
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
  return {
    ...actual,
    usePermissions: () => ({
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
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

// The list body and the dialogs: the title is drawn outside them.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));
vi.mock('./CreateViewDialog', () => ({ CreateViewDialog: () => null }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({}) }));

import { ObjectDataPage } from './ObjectDataPage';
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
  vi.clearAllMocks();
});

/** The `/data` page's title text for `objectName`, in `lang` (the badge excluded). */
async function dataPageTitle(lang: Lang, objectName: string): Promise<string> {
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
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${objectName}/data`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/data"
              element={<ObjectDataPage dataSource={dataSource} objects={OBJECTS} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  const heading = await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
  const title = heading.querySelector('span.truncate');
  expect(title, 'the title span did not render inside the heading').toBeTruthy();
  return title!.textContent ?? '';
}

describe('ObjectDataPage — the /data page is titled with the plural (objectui#11696)', () => {
  it('en: "Projects" titles the projects /data page', async () => {
    expect(await dataPageTitle('en', 'showcase_project')).toBe('Projects');
  });

  it('zh-CN: the translated plural titles the projects /data page', async () => {
    expect(await dataPageTitle('zh-CN', 'showcase_project')).toBe('项目清单');
  });

  it('control: an object that declares no plural is titled with its label', async () => {
    expect(await dataPageTitle('en', 'showcase_note')).toBe('Note');
  });
});
